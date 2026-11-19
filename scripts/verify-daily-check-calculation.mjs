import assert from "node:assert";
import { buildDailyCheckRegimeLenses } from "../src/services/data/daily-check-regime.ts";

console.log("Compiling & testing Daily Check dynamic calculation rules...");

// Test 1: Simulation with 4+ confirming (Bearish Gold Regime)
// In gold lens:
// DXY +1.2% (confirms), TIPS 1.84% (confirms), VIX 18.2 (confirms), HY OAS 320 (confirms), Gold 0.00% (confirms) = 5 confirm
{
  const cards = [
    { id: "dxy", symbol: "DXY", name: "US Dollar Index", value: 104.5, change: 1.2, changePercent: 1.15, unit: "", decimals: 2 },
    { id: "vix", symbol: "VIX", name: "CBOE Volatility Index", value: 18.2, change: -0.4, changePercent: -2.1, unit: "", decimals: 2 },
    { id: "spx", symbol: "SPX", name: "S&P 500 Index", value: 5900, change: 15, changePercent: 0.25, unit: "", decimals: 2 },
    { id: "xauusd", symbol: "XAUUSD", name: "Gold Spot", value: 2700, change: 0, changePercent: 0.0, unit: "$", decimals: 2 },
  ];
  const latestValues = [
    { seriesKey: "US10Y_REAL", value: 1.84, changeValue: 0.02, publishedAt: new Date().toISOString() },
    { seriesKey: "HY_OAS", value: 3.20, changeValue: -0.05, publishedAt: new Date().toISOString() },
  ];

  const lenses = buildDailyCheckRegimeLenses(cards, latestValues);
  const gold = lenses.find((l) => l.id === "gold");
  assert.ok(gold, "Gold lens exists");
  console.log(`Test 1 (5 of 6 confirm): confirmCount=${gold.confirmationsCount}, bias=${gold.biasLabel}, tone=${gold.tone}, verdict=${gold.tradeVerdict}`);
  assert.strictEqual(gold.confirmationsCount >= 4, true);
  assert.strictEqual(gold.biasLabel, "BEARISH");
  assert.strictEqual(gold.tone, "bearish");
  assert.strictEqual(gold.tradeVerdict, "CONFIRMED");
}

// Test 2: Simulation with exactly 4 confirming (e.g. Gold rallies +2.5% [diverges], SPX drops -1.0% [diverges])
// Confirming: DXY (+1.15%), 10Y TIPS (1.84%), VIX (18.2 < 20), HY OAS (320 < 350) -> exactly 4 confirm
{
  const cards = [
    { id: "dxy", symbol: "DXY", name: "US Dollar Index", value: 104.5, change: 1.2, changePercent: 1.15, unit: "", decimals: 2 },
    { id: "vix", symbol: "VIX", name: "CBOE Volatility Index", value: 18.2, change: -0.4, changePercent: -2.1, unit: "", decimals: 2 },
    { id: "spx", symbol: "SPX", name: "S&P 500 Index", value: 5800, change: -60, changePercent: -1.02, unit: "", decimals: 2 },
    { id: "xauusd", symbol: "XAUUSD", name: "Gold Spot", value: 2750, change: 65, changePercent: 2.42, unit: "$", decimals: 2 },
  ];
  const latestValues = [
    { seriesKey: "US10Y_REAL", value: 1.84, changeValue: 0.02, publishedAt: new Date().toISOString() },
    { seriesKey: "HY_OAS", value: 3.20, changeValue: -0.05, publishedAt: new Date().toISOString() },
  ];

  const lenses = buildDailyCheckRegimeLenses(cards, latestValues);
  const gold = lenses.find((l) => l.id === "gold");
  console.log(`Test 2 (4 of 6 confirm): confirmCount=${gold.confirmationsCount}, bias=${gold.biasLabel}, tone=${gold.tone}`);
  assert.strictEqual(gold.confirmationsCount, 4);
  assert.strictEqual(gold.biasLabel, "BEARISH");
  assert.strictEqual(gold.tone, "bearish");
  assert.strictEqual(gold.tradeVerdict, "CONFIRMED");
}

// Test 3: Simulation with exactly 3 confirming -> MIXED
// Let VIX spike to 24.5 (> 20 -> diverges from lack of haven demand).
// Gold +2.42% (diverges). SPX -1.02% (diverges).
// Confirming: DXY (confirms), 10Y TIPS (confirms), HY OAS (confirms) -> exactly 3 confirm!
{
  const cards = [
    { id: "dxy", symbol: "DXY", name: "US Dollar Index", value: 104.5, change: 1.2, changePercent: 1.15, unit: "", decimals: 2 },
    { id: "vix", symbol: "VIX", name: "CBOE Volatility Index", value: 24.5, change: 4.2, changePercent: 20.7, unit: "", decimals: 2 },
    { id: "spx", symbol: "SPX", name: "S&P 500 Index", value: 5800, change: -60, changePercent: -1.02, unit: "", decimals: 2 },
    { id: "xauusd", symbol: "XAUUSD", name: "Gold Spot", value: 2750, change: 65, changePercent: 2.42, unit: "$", decimals: 2 },
  ];
  const latestValues = [
    { seriesKey: "US10Y_REAL", value: 1.84, changeValue: 0.02, publishedAt: new Date().toISOString() },
    { seriesKey: "HY_OAS", value: 3.20, changeValue: -0.05, publishedAt: new Date().toISOString() },
  ];

  const lenses = buildDailyCheckRegimeLenses(cards, latestValues);
  const gold = lenses.find((l) => l.id === "gold");
  console.log(`Test 3 (3 of 6 confirm): confirmCount=${gold.confirmationsCount}, bias=${gold.biasLabel}, tone=${gold.tone}`);
  assert.strictEqual(gold.confirmationsCount, 3);
  assert.strictEqual(gold.biasLabel, "MIXED");
  assert.strictEqual(gold.tone, "mixed");
  assert.strictEqual(gold.tradeVerdict, "SELECTIVE");
}

// Test 4: Simulation with <= 2 confirming -> NEUTRAL / NOT CONFIRMED
// Let DXY drop (-0.8% -> diverges).
// Now only 10Y TIPS and HY OAS confirm = 2 confirm!
{
  const cards = [
    { id: "dxy", symbol: "DXY", name: "US Dollar Index", value: 102.5, change: -0.8, changePercent: -0.77, unit: "", decimals: 2 },
    { id: "vix", symbol: "VIX", name: "CBOE Volatility Index", value: 24.5, change: 4.2, changePercent: 20.7, unit: "", decimals: 2 },
    { id: "spx", symbol: "SPX", name: "S&P 500 Index", value: 5800, change: -60, changePercent: -1.02, unit: "", decimals: 2 },
    { id: "xauusd", symbol: "XAUUSD", name: "Gold Spot", value: 2750, change: 65, changePercent: 2.42, unit: "$", decimals: 2 },
  ];
  const latestValues = [
    { seriesKey: "US10Y_REAL", value: 1.84, changeValue: 0.02, publishedAt: new Date().toISOString() },
    { seriesKey: "HY_OAS", value: 3.20, changeValue: -0.05, publishedAt: new Date().toISOString() },
  ];

  const lenses = buildDailyCheckRegimeLenses(cards, latestValues);
  const gold = lenses.find((l) => l.id === "gold");
  console.log(`Test 4 (2 of 6 confirm): confirmCount=${gold.confirmationsCount}, bias=${gold.biasLabel}, tone=${gold.tone}`);
  assert.strictEqual(gold.confirmationsCount, 2);
  assert.strictEqual(gold.biasLabel, "NEUTRAL");
  assert.strictEqual(gold.tone, "neutral");
  assert.strictEqual(gold.tradeVerdict, "NO TRADE");
}

console.log("ALL 4 DYNAMIC CALCULATION TESTS PASSED!");
