import { NextRequest, NextResponse } from "next/server";
import { runAiModelsInference } from "@/services/ai-models/runner";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "CPI",
  "CORE_CPI",
  "PCE",
  "CORE_PCE",
  "NFP",
  "FOMC",
]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      event_type?: string;
      surprise_z?: number | null;
      consensus_overrides?: Record<string, number>;
      custom_news_text?: string;
      refresh_data?: boolean;
      use_finbert?: boolean;
    };

    const eventType = (body.event_type ?? "CPI").toUpperCase();
    if (!ALLOWED_EVENTS.has(eventType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid event_type." },
        { status: 400 }
      );
    }

    const surpriseZ =
      typeof body.surprise_z === "number" && Number.isFinite(body.surprise_z)
        ? Math.max(-4, Math.min(4, body.surprise_z))
        : null;

    const cleanOverrides: Record<string, number> = {};
    if (body.consensus_overrides && typeof body.consensus_overrides === "object") {
      for (const [k, v] of Object.entries(body.consensus_overrides)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          cleanOverrides[k] = v;
        }
      }
    }

    const snapshot = await runAiModelsInference({
      event_type: eventType,
      surprise_z: surpriseZ,
      consensus_overrides: cleanOverrides,
      custom_news_text: typeof body.custom_news_text === "string" ? body.custom_news_text.slice(0, 4000) : "",
      refresh_data: Boolean(body.refresh_data),
      use_finbert: body.use_finbert !== false,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to run AI simulation.",
      },
      { status: 500 }
    );
  }
}
