import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AiBiasSummary, AiModelsSnapshot } from "@/lib/ai-models/types";
import { computeEverydayBiasSnapshot } from "@/services/ai-models/everyday-bias-engine";

const ROOT_DIR = process.cwd();
const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "bin", "python");
const LATEST_INFERENCE_PATH = path.join(ROOT_DIR, "ml", "artifacts", "latest_inference.json");
const TRAINING_SUMMARY_PATH = path.join(ROOT_DIR, "ml", "artifacts", "reports", "training_summary.json");

export interface InferenceRequestPayload {
  event_type?: string;
  surprise_z?: number | null;
  consensus_overrides?: Record<string, number>;
  custom_news_text?: string;
  refresh_data?: boolean;
  use_finbert?: boolean;
}

async function readFileWithFallbacks(primaryPath: string, subPath: string): Promise<string | null> {
  const candidates = [
    primaryPath,
    path.resolve(ROOT_DIR, subPath),
    path.resolve(__dirname, "..", "..", "..", subPath),
    path.resolve(__dirname, "..", "..", subPath),
    path.resolve(__dirname, "..", subPath),
  ];
  for (const cand of candidates) {
    try {
      return await fs.readFile(cand, "utf-8");
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function getLatestAiModelsSnapshot(): Promise<AiModelsSnapshot | null> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = await readFileWithFallbacks(
      LATEST_INFERENCE_PATH,
      path.join("ml", "artifacts", "latest_inference.json")
    );
    if (raw) {
      const parsed = JSON.parse(raw) as AiModelsSnapshot;
      // If the cached file is already computed for TODAY and has valid model4 output, reuse it
      if (parsed.model4_macro_regime_bias?.as_of_date === today) {
        return parsed;
      }
    }
    // If not computed for today or file missing/stale, compute live everyday bias snapshot for today!
    return await computeEverydayBiasSnapshot();
  } catch {
    return await computeEverydayBiasSnapshot().catch(() => null);
  }
}

export async function getLatestAiBiasSummary(): Promise<AiBiasSummary | null> {
  const snapshot = await getLatestAiModelsSnapshot();
  const m4 = snapshot?.model4_macro_regime_bias;
  if (!m4) return null;
  return {
    primary_asset: m4.primary_asset,
    bias: m4.bias,
    bias_score: m4.bias_score,
    confidence_pct: m4.confidence_pct,
    dominant_regime: m4.regime.dominant_regime,
  };
}

export async function getTrainingSummary(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFileWithFallbacks(
      TRAINING_SUMMARY_PATH,
      path.join("ml", "artifacts", "reports", "training_summary.json")
    );
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runAiModelsInference(
  payload: InferenceRequestPayload = {}
): Promise<AiModelsSnapshot> {
  // If refresh_data is requested or interactive scenario inputs are provided, compute live everyday bias directly
  if (
    payload.refresh_data ||
    payload.custom_news_text ||
    payload.surprise_z !== undefined ||
    payload.event_type ||
    payload.consensus_overrides
  ) {
    try {
      return await computeEverydayBiasSnapshot({
        eventType: payload.event_type,
        surpriseZ: payload.surprise_z,
        customNewsText: payload.custom_news_text,
        refreshData: payload.refresh_data,
        consensusOverrides: payload.consensus_overrides,
      });
    } catch {
      // Fallback to python subprocess if TypeScript engine encounters an unexpected issue
    }
  }

  const mlServiceUrl = process.env.ML_SERVICE_URL?.trim();
  if (mlServiceUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(new URL("/infer", mlServiceUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        ok?: boolean;
        snapshot?: AiModelsSnapshot;
        detail?: string;
      };
      if (!response.ok || !body.ok || !body.snapshot) {
        throw new Error(body.detail || `ML service returned HTTP ${response.status}.`);
      }
      return body.snapshot;
    } catch {
      // Fallback to local everyday computation
      return await computeEverydayBiasSnapshot({
        eventType: payload.event_type,
        surpriseZ: payload.surprise_z,
        customNewsText: payload.custom_news_text,
        refreshData: payload.refresh_data,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const pythonBin = await fs
    .access(VENV_PYTHON)
    .then(() => VENV_PYTHON)
    .catch(() => "python3");

  return new Promise<AiModelsSnapshot>((resolve) => {
    const child = spawn(pythonBin, ["-m", "ml.infer", "--stdin"], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(async () => {
      child.kill("SIGKILL");
      const fallback = await computeEverydayBiasSnapshot({
        eventType: payload.event_type,
        surpriseZ: payload.surprise_z,
        customNewsText: payload.custom_news_text,
        refreshData: payload.refresh_data,
      });
      resolve(fallback);
    }, 90_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", async () => {
      clearTimeout(timer);
      const fallback = await computeEverydayBiasSnapshot({
        eventType: payload.event_type,
        surpriseZ: payload.surprise_z,
        customNewsText: payload.custom_news_text,
        refreshData: payload.refresh_data,
      });
      resolve(fallback);
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const fallback = await computeEverydayBiasSnapshot({
          eventType: payload.event_type,
          surpriseZ: payload.surprise_z,
          customNewsText: payload.custom_news_text,
          refreshData: payload.refresh_data,
        });
        resolve(fallback);
        return;
      }
      try {
        // Parse the last JSON line in stdout in case any library emitted info lines
        const lines = stdout.trim().split("\n");
        const parsed = JSON.parse(lines[lines.length - 1]) as AiModelsSnapshot;
        resolve(parsed);
      } catch {
        const fallback = await computeEverydayBiasSnapshot({
          eventType: payload.event_type,
          surpriseZ: payload.surprise_z,
          customNewsText: payload.custom_news_text,
          refreshData: payload.refresh_data,
        });
        resolve(fallback);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
