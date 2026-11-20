import { NextRequest, NextResponse } from "next/server";
import { US30_SPEC } from "@/services/trading/instruments";
import { calculatePositionSize } from "@/services/trading/position-sizing";
import { evaluateRiskGate } from "@/services/trading/risk-manager";
import { scanUs30Strategy, type SessionLevels } from "@/services/trading/engine/us30-strategy";
import type { MarketBar } from "@/services/trading/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();

  // Detect Active Trading Session
  let currentSession = "CLOSED";
  let isRth = false;

  // US RTH: 14:30 - 21:00 UTC (09:30 - 16:00 ET)
  if (
    (utcHours === 14 && utcMinutes >= 30) ||
    (utcHours > 14 && utcHours < 21)
  ) {
    currentSession = "NEW_YORK_RTH";
    isRth = true;
  } else if (utcHours >= 7 && utcHours < 13) {
    currentSession = "LONDON";
  } else if (utcHours >= 0 && utcHours < 7) {
    currentSession = "ASIA";
  }

  return NextResponse.json({
    ok: true,
    instrument: US30_SPEC,
    session: {
      currentSession,
      isRth,
      timeUtc: now.toISOString(),
      openingSweepWindowUtc: "14:30:00Z - 15:30:00Z",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      dailyBars?: MarketBar[];
      fourHourBars?: MarketBar[];
      fifteenMinuteBars?: MarketBar[];
      fiveMinuteBars?: MarketBar[];
      sessionLevels?: SessionLevels;
      accountEquity?: number;
      riskPct?: number;
      macroRegimeScore?: number;
      dominantRegime?: string;
    };

    const accountEquity = body.accountEquity ?? 100_000;
    const riskPct = body.riskPct ?? 0.5;

    // Use supplied bars or construct default evaluation
    if (
      !body.dailyBars ||
      !body.fourHourBars ||
      !body.fifteenMinuteBars ||
      !body.fiveMinuteBars ||
      !body.sessionLevels
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required bar data or sessionLevels (dailyBars, fourHourBars, fifteenMinuteBars, fiveMinuteBars, sessionLevels).",
        },
        { status: 400 }
      );
    }

    const setup = scanUs30Strategy({
      dailyBars: body.dailyBars,
      fourHourBars: body.fourHourBars,
      fifteenMinuteBars: body.fifteenMinuteBars,
      fiveMinuteBars: body.fiveMinuteBars,
      sessionLevels: body.sessionLevels,
      macroInput: {
        macroRegimeScore: body.macroRegimeScore ?? 0,
        dominantRegime: body.dominantRegime ?? "Neutral",
        treasuryYieldTrend: "NEUTRAL",
      },
    });

    let sizing = null;
    let riskVerdict = null;

    if (setup && setup.status === "TRIGGERED") {
      sizing = calculatePositionSize({
        accountEquity,
        riskPct,
        entryPrice: setup.plannedEntry,
        stopLossPrice: setup.plannedStopLoss,
        instrumentSpec: US30_SPEC,
      });

      riskVerdict = evaluateRiskGate({
        instrument: "US30",
        direction: setup.direction,
        plannedLotSize: sizing.lotSize,
        dollarRisk: sizing.dollarRisk,
        rewardToRiskRatio: setup.rewardToRiskRatio,
        riskProfile: {
          id: "default",
          userId: "anonymous",
          profileName: "Standard Risk",
          accountEquity,
          accountCurrency: "USD",
          riskPerTradePct: riskPct,
          maxOpenTrades: 2,
          isActive: true,
        },
        currentDailyPnl: 0,
        openPositionsCount: 0,
        isNewsBlackout: false,
        isDataStale: false,
      });
    }

    return NextResponse.json({
      ok: true,
      setup,
      sizing,
      riskVerdict,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to scan US30 strategy.",
      },
      { status: 500 }
    );
  }
}
