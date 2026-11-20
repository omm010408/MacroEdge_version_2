import assert from "node:assert/strict";

// Dynamic import of compiled TS services or TS execution via Node / tsx
import { calculatePositionSize } from "../src/services/trading/position-sizing.ts";
import { evaluateRiskGate } from "../src/services/trading/risk-manager.ts";
import { US30_SPEC, XAUUSD_SPEC, getInstrumentSpec } from "../src/services/trading/instruments.ts";
import {
  evaluateHtfBias,
  scanUs30Strategy,
  findFractalSwings,
} from "../src/services/trading/engine/us30-strategy.ts";

console.log("================================================================================");
console.log("MACROEDGE × US30 STRATEGY INTEGRATION TEST SUITE");
console.log("================================================================================");

// -----------------------------------------------------------------------------
// TEST 1: US30 Instrument Specification & Position Sizing Arithmetic
// -----------------------------------------------------------------------------
console.log("\n[TEST 1] US30 Contract Specification & Position Sizing Calculation");
const spec = getInstrumentSpec("US30");
assert.equal(spec.symbol, "US30");
assert.equal(spec.assetClass, "INDEX");
assert.equal(spec.contractSize, 1.0);
assert.equal(spec.tickValue, 1.0);

// $100,000 balance, 0.5% risk = $500 risk, 40-point stop loss
const sizeResult1 = calculatePositionSize({
  accountEquity: 100_000,
  riskPct: 0.5,
  entryPrice: 43_500,
  stopLossPrice: 43_460,
  instrumentSpec: US30_SPEC,
});

console.log("  US30 40-pt stop sizing:", sizeResult1);
assert.equal(sizeResult1.dollarRisk, 500);
assert.equal(sizeResult1.stopDistancePoints, 40);
assert.equal(sizeResult1.lotSize, 12.5); // 500 / (40 * 1.00) = 12.5 lots
assert.equal(sizeResult1.isCapped, false);
console.log("  ✓ Test 1 Passed: Exact $500 risk on 40-pt stop yields 12.5 lots.");

// -----------------------------------------------------------------------------
// TEST 2: Deterministic Pre-Trade Risk Gatekeeper (Prop-Firm Compliance)
// -----------------------------------------------------------------------------
console.log("\n[TEST 2] Pre-Trade Risk Gatekeeper & Prop-Firm Protection");

const riskProfile = {
  id: "profile-1",
  userId: "user-1",
  profileName: "FTMO $100k Challenge",
  accountEquity: 100_000,
  accountCurrency: "USD",
  riskPerTradePct: 1.0,
  maxOpenTrades: 2,
  isActive: true,
};

const propRules = {
  id: "rules-1",
  firmName: "FTMO",
  challengePhase: "PHASE_1",
  startingBalance: 100_000,
  currentEquityHwm: 100_000,
  maxDailyLossPct: 5.0, // $5,000 max daily loss
  maxTotalLossPct: 10.0, // $10,000 max trailing drawdown
  dailyLossResetUtc: "21:00:00",
  allowWeekendHold: false,
  newsBlackoutMinutes: 15,
  isBreached: false,
};

// Case 2A: Clean Pass
const passVerdict = evaluateRiskGate({
  instrument: "US30",
  direction: "BUY",
  plannedLotSize: 10.0,
  dollarRisk: 500,
  rewardToRiskRatio: 2.5,
  riskProfile,
  propRules,
  currentDailyPnl: 0,
  openPositionsCount: 0,
  isNewsBlackout: false,
  isDataStale: false,
});
assert.equal(passVerdict.verdict, "PASS");
assert.equal(passVerdict.code, "ALL_CONDITIONS_MET");
console.log("  ✓ Case 2A Passed: Normal conditions yield PASS verdict.");

// Case 2B: News Blackout Active Block
const newsBlockVerdict = evaluateRiskGate({
  instrument: "US30",
  direction: "BUY",
  plannedLotSize: 10.0,
  dollarRisk: 500,
  rewardToRiskRatio: 2.5,
  riskProfile,
  propRules,
  currentDailyPnl: 0,
  openPositionsCount: 0,
  isNewsBlackout: true, // During CPI/NFP window
  isDataStale: false,
});
assert.equal(newsBlockVerdict.verdict, "BLOCK");
assert.equal(newsBlockVerdict.code, "NEWS_BLACKOUT_ACTIVE");
console.log("  ✓ Case 2B Passed: High-impact news window yields BLOCK verdict.");

// Case 2C: Prop Firm Daily Loss Breach Block
const dailyLossBlockVerdict = evaluateRiskGate({
  instrument: "US30",
  direction: "SELL",
  plannedLotSize: 10.0,
  dollarRisk: 600,
  rewardToRiskRatio: 2.2,
  riskProfile,
  propRules,
  currentDailyPnl: -4500, // already lost $4,500 today; $600 risk would breach $5,000 limit
  openPositionsCount: 0,
  isNewsBlackout: false,
  isDataStale: false,
});
assert.equal(dailyLossBlockVerdict.verdict, "BLOCK");
assert.equal(dailyLossBlockVerdict.code, "MAX_DAILY_LOSS_BREACHED");
console.log("  ✓ Case 2C Passed: Projected daily loss breach yields BLOCK verdict.");

// Case 2D: R:R Hurdle Insufficient Block (< 2.0R)
const rrBlockVerdict = evaluateRiskGate({
  instrument: "US30",
  direction: "BUY",
  plannedLotSize: 10.0,
  dollarRisk: 500,
  rewardToRiskRatio: 1.6, // Below 2.0R hurdle
  riskProfile,
  propRules,
  currentDailyPnl: 0,
  openPositionsCount: 0,
  isNewsBlackout: false,
  isDataStale: false,
});
assert.equal(rrBlockVerdict.verdict, "BLOCK");
assert.equal(rrBlockVerdict.code, "REWARD_TO_RISK_INSUFFICIENT");
console.log("  ✓ Case 2D Passed: 1.6R setup yields REWARD_TO_RISK_INSUFFICIENT block.");

// -----------------------------------------------------------------------------
// TEST 3: High-Timeframe (1D / 4H) Market Structure & Macro Bias
// -----------------------------------------------------------------------------
console.log("\n[TEST 3] High-Timeframe Structure & Conflict Evaluation");

// Create synthetic 1D daily bars with higher highs and higher lows
const dailyBars = [
  { symbol: "US30", timeframe: "1d", barTimeUtc: "2026-11-01T00:00:00Z", open: 42000, high: 42200, low: 41900, close: 42100, volume: 100, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-01T00:00:00Z" },
  { symbol: "US30", timeframe: "1d", barTimeUtc: "2026-11-02T00:00:00Z", open: 42100, high: 42500, low: 42050, close: 42450, volume: 100, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-02T00:00:00Z" },
  { symbol: "US30", timeframe: "1d", barTimeUtc: "2026-11-03T00:00:00Z", open: 42450, high: 42300, low: 42200, close: 42250, volume: 100, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-03T00:00:00Z" },
  { symbol: "US30", timeframe: "1d", barTimeUtc: "2026-11-04T00:00:00Z", open: 42250, high: 42800, low: 42200, close: 42750, volume: 100, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-04T00:00:00Z" },
  { symbol: "US30", timeframe: "1d", barTimeUtc: "2026-11-05T00:00:00Z", open: 42750, high: 43200, low: 42600, close: 43150, volume: 100, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T00:00:00Z" },
];

const fourHourBars = [
  { symbol: "US30", timeframe: "4h", barTimeUtc: "2026-11-05T00:00:00Z", open: 42700, high: 42900, low: 42650, close: 42850, volume: 50, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T00:00:00Z" },
  { symbol: "US30", timeframe: "4h", barTimeUtc: "2026-11-05T04:00:00Z", open: 42850, high: 43100, low: 42800, close: 43050, volume: 50, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T04:00:00Z" },
  { symbol: "US30", timeframe: "4h", barTimeUtc: "2026-11-05T08:00:00Z", open: 43050, high: 43300, low: 43000, close: 43250, volume: 50, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T08:00:00Z" },
];

const htfResult = evaluateHtfBias(dailyBars, fourHourBars, {
  macroRegimeScore: 25.0,
  dominantRegime: "Disinflationary Expansion / Easing",
  treasuryYieldTrend: "FALLING",
});

console.log("  HTF Bias Evaluation:", htfResult);
assert.equal(htfResult.bias, "BULLISH");
console.log("  ✓ Test 3 Passed: Aligned higher highs & expansionary macro score yield BULLISH bias.");

// -----------------------------------------------------------------------------
// TEST 4: Full End-to-End US30 4-Stage Algorithmic Sequence
// -----------------------------------------------------------------------------
console.log("\n[TEST 4] Full 4-Stage US30 Opening Liquidity Sweep Strategy Execution");

// Build synthetic 15M bars
const fifteenMinuteBars = [];
for (let i = 0; i < 25; i++) {
  fifteenMinuteBars.push({
    symbol: "US30",
    timeframe: "15m",
    barTimeUtc: new Date(Date.parse("2026-11-05T08:00:00Z") + i * 15 * 60_000).toISOString(),
    open: 43000 + i * 10,
    high: 43020 + i * 10,
    low: 42990 + i * 10,
    close: 43015 + i * 10,
    volume: 50,
    isClosed: true,
    provider: "twelve_data",
    fetchedAtUtc: "2026-11-05T14:00:00Z",
  });
}

// Build 5M bars with a classic 09:30 AM ET (14:30 UTC) opening liquidity sweep:
// London Low reference: 43,100
// Bar at 14:35 UTC sweeps low to 43,085 (wick pierce by 15 pts), but closes back inside at 43,110!
// Subsequent 5M bar prints a bullish CHOCH breaking 43,130 with close at 43,150!
const fiveMinuteBars = [
  { symbol: "US30", timeframe: "5m", barTimeUtc: "2026-11-05T14:20:00Z", open: 43140, high: 43160, low: 43120, close: 43130, volume: 80, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T14:20:00Z" },
  { symbol: "US30", timeframe: "5m", barTimeUtc: "2026-11-05T14:25:00Z", open: 43130, high: 43140, low: 43110, close: 43115, volume: 90, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T14:25:00Z" },
  // 14:30 UTC - 09:30 AM ET NYSE OPENING SWEEP BAR:
  { symbol: "US30", timeframe: "5m", barTimeUtc: "2026-11-05T14:30:00Z", open: 43115, high: 43125, low: 43085, close: 43110, volume: 250, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T14:30:00Z" },
  // 14:35 UTC - REVERSAL & BULLISH CHOCH DISPLACEMENT:
  { symbol: "US30", timeframe: "5m", barTimeUtc: "2026-11-05T14:35:00Z", open: 43110, high: 43155, low: 43105, close: 43150, volume: 220, isClosed: true, provider: "twelve_data", fetchedAtUtc: "2026-11-05T14:35:00Z" },
];

const sessionLevels = {
  asianHigh: 43250,
  asianLow: 43120,
  londonHigh: 43300,
  londonLow: 43100, // Reference sweep level
  previousDayHigh: 43350,
  previousDayLow: 42950,
};

const setup = scanUs30Strategy({
  dailyBars,
  fourHourBars,
  fifteenMinuteBars,
  fiveMinuteBars,
  sessionLevels,
  macroInput: {
    macroRegimeScore: 25.0,
    dominantRegime: "Disinflationary Expansion",
    treasuryYieldTrend: "FALLING",
  },
  asOfUtc: "2026-11-05T14:40:00Z",
});

console.log("  Detected US30 Setup:", setup);
assert.ok(setup !== null, "Setup should be detected");
assert.equal(setup.instrument, "US30");
assert.equal(setup.direction, "BUY");
assert.equal(setup.status, "TRIGGERED");
assert.equal(setup.qualityGrade, "A+");
assert.equal(setup.components.length, 4);

// Verify exact price levels
assert.equal(setup.plannedEntry, 43125); // Proximal high of sweep candle
assert.equal(setup.plannedStopLoss, 43075); // Sweep extreme 43085 - 10 pts buffer = 43075
assert.equal(setup.rewardToRiskRatio, 2.0);
assert.equal(setup.plannedTakeProfit1, 43225); // Entry 43125 + 2 * 50 = 43225
console.log("  ✓ Test 4 Passed: 4-Stage US30 Opening Sweep confirmed A+ Setup with 2.0R target.");

console.log("\n================================================================================");
console.log("ALL US30 STRATEGY INTEGRATION TESTS PASSED SUCCESSFULLY (4/4)");
console.log("================================================================================");
