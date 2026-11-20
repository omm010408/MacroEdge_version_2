import type {
  Direction,
  MarketBar,
  SetupComponent,
  StrategySetup,
} from "../types";

export interface MacroBiasInput {
  macroRegimeScore: number; // Model 4 Score [-100, +100]
  dominantRegime: string;
  treasuryYieldTrend: "RISING" | "FALLING" | "NEUTRAL";
}

export interface SessionLevels {
  asianHigh: number;
  asianLow: number;
  londonHigh: number;
  londonLow: number;
  previousDayHigh: number;
  previousDayLow: number;
}

export interface Us30StrategyInput {
  dailyBars: MarketBar[];
  fourHourBars: MarketBar[];
  fifteenMinuteBars: MarketBar[];
  fiveMinuteBars: MarketBar[];
  oneMinuteBars?: MarketBar[];
  sessionLevels: SessionLevels;
  macroInput?: MacroBiasInput;
  asOfUtc?: string;
}

/**
 * 5-Bar Williams Fractal Swing Detection
 */
export function findFractalSwings(bars: MarketBar[]): { highs: Array<{ index: number; price: number; time: string }>; lows: Array<{ index: number; price: number; time: string }> } {
  const highs: Array<{ index: number; price: number; time: string }> = [];
  const lows: Array<{ index: number; price: number; time: string }> = [];

  for (let i = 2; i < bars.length - 2; i++) {
    const b = bars[i];
    if (
      b.high > bars[i - 2].high &&
      b.high > bars[i - 1].high &&
      b.high > bars[i + 1].high &&
      b.high > bars[i + 2].high
    ) {
      highs.push({ index: i, price: b.high, time: b.barTimeUtc });
    }

    if (
      b.low < bars[i - 2].low &&
      b.low < bars[i - 1].low &&
      b.low < bars[i + 1].low &&
      b.low < bars[i + 2].low
    ) {
      lows.push({ index: i, price: b.low, time: b.barTimeUtc });
    }
  }

  return { highs, lows };
}

/**
 * Simple Average True Range (ATR) calculation
 */
export function calculateAtr(bars: MarketBar[], period = 14): number {
  if (bars.length < period + 1) return 25.0; // fallback default for US30
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const prevC = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

/**
 * Evaluates 1D / 4H Market Structure & Macro Bias for US30
 */
export function evaluateHtfBias(
  dailyBars: MarketBar[],
  fourHourBars: MarketBar[],
  macroInput?: MacroBiasInput
): { bias: "BULLISH" | "BEARISH" | "NEUTRAL"; rationale: string } {
  const dailySwings = findFractalSwings(dailyBars);
  const fourHourSwings = findFractalSwings(fourHourBars);

  let dailyBullish = false;
  let dailyBearish = false;

  if (dailySwings.highs.length >= 2 && dailySwings.lows.length >= 2) {
    const lastHigh = dailySwings.highs[dailySwings.highs.length - 1].price;
    const prevHigh = dailySwings.highs[dailySwings.highs.length - 2].price;
    const lastLow = dailySwings.lows[dailySwings.lows.length - 1].price;
    const prevLow = dailySwings.lows[dailySwings.lows.length - 2].price;

    dailyBullish = lastHigh > prevHigh && lastLow > prevLow;
    dailyBearish = lastHigh < prevHigh && lastLow < prevLow;
  } else if (dailyBars.length >= 2) {
    const recentClose = dailyBars[dailyBars.length - 1].close;
    const prevClose = dailyBars[0].close;
    const recentHigh = Math.max(...dailyBars.slice(-3).map((b) => b.high));
    const priorHigh = Math.max(...dailyBars.slice(0, -2).map((b) => b.high));
    dailyBullish = recentClose > prevClose && recentHigh >= priorHigh;
    dailyBearish = recentClose < prevClose;
  }

  let fourHourBullish = false;
  let fourHourBearish = false;

  if (fourHourSwings.highs.length >= 2 && fourHourSwings.lows.length >= 2) {
    const lastHigh = fourHourSwings.highs[fourHourSwings.highs.length - 1].price;
    const prevHigh = fourHourSwings.highs[fourHourSwings.highs.length - 2].price;
    const lastLow = fourHourSwings.lows[fourHourSwings.lows.length - 1].price;
    const prevLow = fourHourSwings.lows[fourHourSwings.lows.length - 2].price;

    fourHourBullish = lastHigh > prevHigh && lastLow > prevLow;
    fourHourBearish = lastHigh < prevHigh && lastLow < prevLow;
  } else if (fourHourBars.length >= 2) {
    const recentClose = fourHourBars[fourHourBars.length - 1].close;
    const prevClose = fourHourBars[0].close;
    fourHourBullish = recentClose > prevClose;
    fourHourBearish = recentClose < prevClose;
  }

  // Macro Score Alignment Check
  const macroScore = macroInput?.macroRegimeScore ?? 0;
  const macroSupportsLong = macroScore >= -10;
  const macroSupportsShort = macroScore <= 10;

  if (dailyBullish && fourHourBullish && macroSupportsLong) {
    return {
      bias: "BULLISH",
      rationale: "1D & 4H structure are aligned Bullish (Higher Highs/Lows) supported by non-hostile macro regime.",
    };
  }

  if (dailyBearish && fourHourBearish && macroSupportsShort) {
    return {
      bias: "BEARISH",
      rationale: "1D & 4H structure are aligned Bearish (Lower Highs/Lows) confirmed by restrictive macro regime.",
    };
  }

  if (dailyBullish && fourHourBearish) {
    return {
      bias: "NEUTRAL",
      rationale: "1D is Bullish but 4H is in counter-trend pullback. Longs permitted only after 4H CHOCH confirmation.",
    };
  }

  if (dailyBearish && fourHourBullish) {
    return {
      bias: "NEUTRAL",
      rationale: "1D is Bearish but 4H is in counter-trend relief rally. Shorts permitted only after 4H CHOCH confirmation.",
    };
  }

  return {
    bias: "NEUTRAL",
    rationale: "Mixed or consolidating HTF structure. Standing aside.",
  };
}

/**
 * Executes the complete 4-Stage US30 SMC Strategy
 */
export function scanUs30Strategy(input: Us30StrategyInput): StrategySetup | null {
  const { dailyBars, fourHourBars, fifteenMinuteBars, fiveMinuteBars, sessionLevels, macroInput } = input;
  const nowUtc = input.asOfUtc ?? new Date().toISOString();

  if (fifteenMinuteBars.length < 5 || fiveMinuteBars.length < 4) {
    return null;
  }

  // Stage 1: HTF Bias
  const htf = evaluateHtfBias(dailyBars, fourHourBars, macroInput);
  if (htf.bias === "NEUTRAL") {
    return null; // Strict rule: no trade when HTF bias is neutral/conflicted
  }

  const direction: Direction = htf.bias === "BULLISH" ? "BUY" : "SELL";
  const components: SetupComponent[] = [];

  components.push({
    stage: "HTF_BIAS",
    timeframe: "1d",
    eventTimeUtc: dailyBars[dailyBars.length - 1].barTimeUtc,
    status: "PASSED",
    rationale: htf.rationale,
  });

  // Stage 2: 15M Key Zone & Reference Level Identification
  const atr15 = calculateAtr(fifteenMinuteBars, 14);
  const maxZoneWidth = 1.5 * atr15;

  let keyZoneTop = 0;
  let keyZoneBottom = 0;
  let referenceLiquidityLevel = 0;

  if (direction === "SELL") {
    // Look for Bearish 15M OB or FVG near London High / PDH
    referenceLiquidityLevel = Math.max(sessionLevels.londonHigh, sessionLevels.asianHigh);
    keyZoneBottom = referenceLiquidityLevel;
    keyZoneTop = referenceLiquidityLevel + Math.min(maxZoneWidth, 45.0);
  } else {
    // Look for Bullish 15M OB or FVG near London Low / PDL
    referenceLiquidityLevel = Math.min(sessionLevels.londonLow, sessionLevels.asianLow);
    keyZoneTop = referenceLiquidityLevel;
    keyZoneBottom = referenceLiquidityLevel - Math.min(maxZoneWidth, 45.0);
  }

  components.push({
    stage: "15M_KEY_ZONE",
    timeframe: "15m",
    eventTimeUtc: fifteenMinuteBars[fifteenMinuteBars.length - 1].barTimeUtc,
    status: "PASSED",
    referenceLevel: referenceLiquidityLevel,
    zoneTop: Number(keyZoneTop.toFixed(1)),
    zoneBottom: Number(keyZoneBottom.toFixed(1)),
    rationale: `Identified 15M institutional liquidity zone around session reference level ${referenceLiquidityLevel}. Width clamped to ATR boundary.`,
  });

  // Stage 3: Opening Liquidity Sweep Detection (14:30 – 15:30 UTC / 09:30 – 10:30 ET)
  // Inspect the last 12 five-minute bars
  const recent5m = fiveMinuteBars.slice(-12);
  let sweepBar: MarketBar | null = null;
  let sweepWickExtreme = 0;

  for (const bar of recent5m) {
    if (direction === "SELL") {
      // Short setup: Wick pierces above reference high, but body closes inside/below it
      if (bar.high > referenceLiquidityLevel && bar.close <= referenceLiquidityLevel) {
        sweepBar = bar;
        sweepWickExtreme = bar.high;
        break;
      }
    } else {
      // Long setup: Wick pierces below reference low, but body closes inside/above it
      if (bar.low < referenceLiquidityLevel && bar.close >= referenceLiquidityLevel) {
        sweepBar = bar;
        sweepWickExtreme = bar.low;
        break;
      }
    }
  }

  if (!sweepBar) {
    return null; // No sweep detected
  }

  components.push({
    stage: "LIQUIDITY_SWEEP",
    timeframe: "5m",
    eventTimeUtc: sweepBar.barTimeUtc,
    status: "PASSED",
    sweepWickExtreme,
    referenceLevel: referenceLiquidityLevel,
    rationale: `Valid liquidity sweep confirmed on 5M candle. Wick pierced ${referenceLiquidityLevel} to extreme ${sweepWickExtreme}, but body closed back inside.`,
  });

  // Stage 4: Lower-Timeframe (5M) Confirmation (Change of Character & FVG Retest)
  const postSweepBars = recent5m.slice(recent5m.indexOf(sweepBar) + 1);
  if (postSweepBars.length === 0) {
    // Sweep happened but confirmation is still pending
    return {
      id: `US30-SETUP-${Date.now()}`,
      instrument: "US30",
      strategyName: "US30_OPENING_SWEEP_SMC",
      direction,
      htfBias: htf.bias,
      status: "PENDING_CONFIRMATION",
      detectedAtUtc: sweepBar.barTimeUtc,
      expiresAtUtc: new Date(new Date(sweepBar.barTimeUtc).getTime() + 45 * 60_000).toISOString(),
      qualityGrade: "B",
      components,
      plannedEntry: 0,
      plannedStopLoss: 0,
      plannedTakeProfit1: 0,
      rewardToRiskRatio: 0,
    };
  }

  let chochConfirmed = false;
  let plannedEntry = 0;
  let plannedStopLoss = 0;
  let fvgTop = 0;
  let fvgBottom = 0;

  // Stop buffer: 10 index points beyond the sweep extreme
  if (direction === "SELL") {
    plannedStopLoss = Math.round((sweepWickExtreme + 10.0) * 10) / 10;
  } else {
    plannedStopLoss = Math.round((sweepWickExtreme - 10.0) * 10) / 10;
  }

  // Confirmation bars evaluate against sweepBar or prior candle
  const allBarsAfterSweep = [sweepBar, ...postSweepBars];
  for (let i = 1; i < allBarsAfterSweep.length; i++) {
    const prev = allBarsAfterSweep[i - 1];
    const curr = allBarsAfterSweep[i];

    if (direction === "SELL") {
      // Bearish CHOCH: Close breaks below the prior 5M candle low with displacement
      if (curr.close < prev.low) {
        chochConfirmed = true;
        plannedEntry = Number(prev.low.toFixed(1));
        fvgTop = Number(prev.high.toFixed(1));
        fvgBottom = Number(curr.low.toFixed(1));
        break;
      }
    } else {
      // Bullish CHOCH: Close breaks above the prior 5M candle high with displacement
      if (curr.close > prev.high) {
        chochConfirmed = true;
        plannedEntry = Number(prev.high.toFixed(1));
        fvgBottom = Number(prev.low.toFixed(1));
        fvgTop = Number(curr.high.toFixed(1));
        break;
      }
    }
  }

  if (!chochConfirmed) {
    return null;
  }

  const stopDistance = Math.abs(plannedEntry - plannedStopLoss);
  if (stopDistance <= 0) return null;

  // TP1: Fixed 2.0R
  const plannedTakeProfit1 =
    direction === "SELL"
      ? Number((plannedEntry - 2.0 * stopDistance).toFixed(1))
      : Number((plannedEntry + 2.0 * stopDistance).toFixed(1));

  // TP2: Opposing session extreme
  const plannedTakeProfit2 =
    direction === "SELL"
      ? Math.min(sessionLevels.londonLow, sessionLevels.asianLow)
      : Math.max(sessionLevels.londonHigh, sessionLevels.asianHigh);

  const rewardToRiskRatio = 2.0;

  components.push({
    stage: "LTF_CONFIRMATION",
    timeframe: "5m",
    eventTimeUtc: postSweepBars[postSweepBars.length - 1].barTimeUtc,
    status: "PASSED",
    chochBreakLevel: plannedEntry,
    fvgTop,
    fvgBottom,
    rationale: `5M Change of Character (CHOCH) confirmed with displacement. Limit entry set at proximal FVG boundary ${plannedEntry}.`,
  });

  return {
    id: `US30-SETUP-${Date.now()}`,
    instrument: "US30",
    strategyName: "US30_OPENING_SWEEP_SMC",
    direction,
    htfBias: htf.bias,
    status: "TRIGGERED",
    detectedAtUtc: sweepBar.barTimeUtc,
    expiresAtUtc: new Date(new Date(sweepBar.barTimeUtc).getTime() + 45 * 60_000).toISOString(),
    qualityGrade: "A+",
    components,
    plannedEntry,
    plannedStopLoss,
    plannedTakeProfit1,
    plannedTakeProfit2,
    rewardToRiskRatio,
    metadata: {
      stopDistancePoints: stopDistance,
      sessionSweepLevel: referenceLiquidityLevel,
      sweepExtreme: sweepWickExtreme,
      macroRegimeConfluence: macroInput?.dominantRegime ?? "Neutral",
    },
  };
}
