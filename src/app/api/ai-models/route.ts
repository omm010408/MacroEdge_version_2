import { NextRequest, NextResponse } from "next/server";
import {
  getLatestAiModelsSnapshot,
  getTrainingSummary,
  runAiModelsInference,
} from "@/services/ai-models/runner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const refreshData = req.nextUrl.searchParams.get("refreshData") === "1";
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";
    const rawAsset = req.nextUrl.searchParams.get("asset")?.toUpperCase();
    const targetAsset: "XAUUSD" | "US30" = rawAsset === "US30" ? "US30" : "XAUUSD";

    let snapshot = refresh ? null : await getLatestAiModelsSnapshot(targetAsset);
    if (!snapshot) {
      snapshot = await runAiModelsInference({ refresh_data: refreshData, target_asset: targetAsset });
    }

    if (summaryOnly) {
      const m4 = snapshot.model4_macro_regime_bias;
      const xauusdM4 = snapshot.xauusd_model4 ?? (m4?.primary_asset === "XAUUSD" ? m4 : null);
      const us30M4 = snapshot.us30_model4 ?? (m4?.primary_asset === "US30" ? m4 : null);

      return NextResponse.json({
        ok: true,
        summary: {
          primary_asset: m4.primary_asset,
          bias: m4.bias,
          bias_score: m4.bias_score,
          confidence_pct: m4.confidence_pct,
          dominant_regime: m4.regime.dominant_regime,
        },
        summaries: {
          xauusd: xauusdM4
            ? {
                primary_asset: "XAUUSD",
                bias: xauusdM4.bias,
                bias_score: xauusdM4.bias_score,
                confidence_pct: xauusdM4.confidence_pct,
                dominant_regime: xauusdM4.regime.dominant_regime,
              }
            : null,
          us30: us30M4
            ? {
                primary_asset: "US30",
                bias: us30M4.bias,
                bias_score: us30M4.bias_score,
                confidence_pct: us30M4.confidence_pct,
                dominant_regime: us30M4.regime.dominant_regime,
              }
            : null,
        },
      });
    }

    const trainingSummary = await getTrainingSummary();

    return NextResponse.json({
      ok: true,
      snapshot,
      trainingSummary,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load AI model snapshot.",
      },
      { status: 500 }
    );
  }
}
