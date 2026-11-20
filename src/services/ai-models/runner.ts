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
  target_asset?: "XAUUSD" | "US30";
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

export async function getLatestAiModelsSnapshot(
  targetAsset: "XAUUSD" | "US30" = "XAUUSD"
): Promise<AiModelsSnapshot | null> {
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
        if (targetAsset === "US30") {
          if (parsed.us30_model4 && parsed.us30_model3) {
            return {
              ...parsed,
              target_asset: "US30",
              model4_macro_regime_bias: parsed.us30_model4,
              model3_market_reaction: parsed.us30_model3,
            };
          }
          return await computeEverydayBiasSnapshot({ targetAsset: "US30" });
        }
        if (targetAsset === "XAUUSD") {
          if (parsed.xauusd_model4 && parsed.xauusd_model3) {
            return {
              ...parsed,
              target_asset: "XAUUSD",
              model4_macro_regime_bias: parsed.xauusd_model4,
              model3_market_reaction: parsed.xauusd_model3,
            };
          }
        }
        return parsed;
      }
    }
    // If not computed for today or file missing/stale, compute live everyday bias snapshot for today!
    return await computeEverydayBiasSnapshot({ targetAsset });
  } catch {
    return await computeEverydayBiasSnapshot({ targetAsset }).catch(() => null);
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
  const targetAsset: "XAUUSD" | "US30" = payload.target_asset === "US30" ? "US30" : "XAUUSD";

  // If a dedicated remote ML microservice is explicitly configured via ML_SERVICE_URL, attempt it
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
      if (response.ok && body.ok && body.snapshot) {
        return body.snapshot;
      }
    } catch {
      // Fall through to native TypeScript engine
    } finally {
      clearTimeout(timer);
    }
  }

  // 1. Primary Engine: Pure TypeScript Everyday Bias & Macro Intelligence Engine
  // In-process, calibrated for both XAUUSD and US30, zero subprocess overhead, zero python dependency
  try {
    const snapshot = await computeEverydayBiasSnapshot({
      targetAsset,
      eventType: payload.event_type,
      surpriseZ: payload.surprise_z,
      customNewsText: payload.custom_news_text,
      refreshData: payload.refresh_data,
      consensusOverrides: payload.consensus_overrides,
    });
    if (snapshot?.model4_macro_regime_bias) {
      return snapshot;
    }
  } catch (err) {
    console.warn("TypeScript EverydayBiasEngine warning, attempting secondary fallbacks:", err);
  }

  // 2. Secondary fallback: Local Python subprocess (if python is available and trained)
  const pythonBin = await fs
    .access(VENV_PYTHON)
    .then(() => VENV_PYTHON)
    .catch(() => "python3");

  return new Promise<AiModelsSnapshot>((resolve) => {
    let resolved = false;
    const safeResolve = async (val?: AiModelsSnapshot | null) => {
      if (resolved) return;
      resolved = true;
      if (val?.model4_macro_regime_bias) {
        resolve(val);
        return;
      }
      try {
        const fallback = await computeEverydayBiasSnapshot({
          targetAsset,
          eventType: payload.event_type,
          surpriseZ: payload.surprise_z,
          customNewsText: payload.custom_news_text,
          refreshData: payload.refresh_data,
          consensusOverrides: payload.consensus_overrides,
        });
        resolve(fallback);
      } catch {
        const raw = await readFileWithFallbacks(
          LATEST_INFERENCE_PATH,
          path.join("ml", "artifacts", "latest_inference.json")
        );
        resolve(raw ? (JSON.parse(raw) as AiModelsSnapshot) : ({} as AiModelsSnapshot));
      }
    };

    const child = spawn(pythonBin, ["-m", "ml.infer", "--stdin"], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      void safeResolve(null);
    }, 15_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.on("error", () => {
      clearTimeout(timer);
      void safeResolve(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        void safeResolve(null);
        return;
      }
      try {
        const lines = stdout.trim().split("\n");
        const parsed = JSON.parse(lines[lines.length - 1]) as AiModelsSnapshot;
        void safeResolve(parsed);
      } catch {
        void safeResolve(null);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
