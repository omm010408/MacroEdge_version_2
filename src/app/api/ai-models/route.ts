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
      return NextResponse.json({
        ok: true,
        summary: {
          primary_asset: m4.primary_asset,
          bias: m4.bias,
          bias_score: m4.bias_score,
          confidence_pct: m4.confidence_pct,
          dominant_regime: m4.regime.dominant_regime,
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
