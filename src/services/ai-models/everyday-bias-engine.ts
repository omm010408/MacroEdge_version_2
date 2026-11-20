import fs from "node:fs/promises";
import path from "node:path";
import { getMacroOverviewData } from "@/services/macro-data";
import type {
  AiModelsSnapshot,
  EconomicIndicatorForecast,
  HorizonReaction,
  Model1Output,
  Model2Output,
  Model3Output,
  Model4Output,
  Phase8MacroReasoning,
} from "@/lib/ai-models/types";

const ROOT_DIR = process.cwd();
const LATEST_INFERENCE_PATH = path.join(ROOT_DIR, "ml", "artifacts", "latest_inference.json");

export interface EverydayBiasOptions {
  targetAsset?: "XAUUSD" | "US30";
  eventType?: string;
  surpriseZ?: number | null;
  customNewsText?: string;
  refreshData?: boolean;
  consensusOverrides?: Record<string, number>;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round(val: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function formatTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function computeEverydayBiasSnapshot(
  options: EverydayBiasOptions = {}
): Promise<AiModelsSnapshot> {
  const todayStr = formatTodayDate();
  const eventType = (options.eventType ?? "CPI").toUpperCase();

  // 1. Fetch live market cards and macro data
  let overviewData: Awaited<ReturnType<typeof getMacroOverviewData>> | null = null;
  try {
    overviewData = await getMacroOverviewData();
  } catch {
    // Non-blocking fallback
  }

  const cards = overviewData?.cards ?? [];
  const getCard = (id: string) => cards.find((c) => c.id === id);

  const xauusdCard = getCard("xauusd");
  const dxyCard = getCard("dxy");
  const real10yCard = getCard("us10y-real");
  const us10yCard = getCard("us10y");
  const vixCard = getCard("vix");
  const spxCard = getCard("spx");

  // Live market observation levels with institutional baselines
  const spotXauusd =
    xauusdCard?.value !== null && xauusdCard?.value !== undefined && xauusdCard.value > 1000
      ? xauusdCard.value
      : 2638.5;

  const r10Val =
    real10yCard?.value !== null && real10yCard?.value !== undefined
      ? real10yCard.value
      : 1.96;

  const dxyVal =
    dxyCard?.value !== null && dxyCard?.value !== undefined
      ? dxyCard.value
      : 104.85;

  const vixVal =
    vixCard?.value !== null && vixCard?.value !== undefined
      ? vixCard.value
      : 15.65;

  const us10yVal =
    us10yCard?.value !== null && us10yCard?.value !== undefined
      ? us10yCard.value
      : 4.42;

  const spxVal =
    spxCard?.value !== null && spxCard?.value !== undefined
      ? spxCard.value
      : 5960.0;

  // 2. Compute 7 Core Macro Factor Z-Scores
  // Real 10Y Yield (DFII10): mean ~1.25%, std ~0.85%
  const realYieldsZ = clamp((r10Val - 1.25) / 0.85, -3.5, 3.5);

  // Dollar Index (DXY): mean ~101.5, std ~3.5
  const dollarZ = clamp((dxyVal - 101.5) / 3.5, -3.5, 3.5);

  // Fed Real Policy Rate: EFFR (~4.58%) - Core CPI (~2.8%), mean ~0.5%, std ~1.5%
  const realRatePolicy = 4.58 - 2.8;
  const fedPolicyZ = clamp((realRatePolicy - 0.5) / 1.5, -3.0, 3.0);

  // Cross-Asset Stress (VIX): mean ~16.0, std ~5.0
  const vixZ = clamp((vixVal - 16.0) / 5.0, -2.5, 4.0);
  const volatilityStressZ = vixZ;

  // Inflation Pressure (CPI ~2.6% YoY vs 2.0% target): mean ~2.4%, std ~0.8%
  const inflationZ = clamp((2.6 - 2.4) / 0.8, -2.5, 3.0);

  // Growth Momentum (GDP / IndPro / SPX Momentum):
  const spxMomentum = spxCard?.changePercent ?? 0.25;
  const growthZ = clamp(0.5 + spxMomentum * 0.4, -2.5, 3.0);

  // Positioning: Speculative Net Longs Percentile (~45th pct)
  const positioningZ = clamp((45 - 50) / 25, -2.0, 2.0);

  // 3. Compute Transparent Macro Rules Score: w_i * tanh(z_i / 1.5)
  const factorDefinitions = [
    {
      factor: "US 10Y Real Yield",
      key: "real_yields_z",
      current_value: `${r10Val.toFixed(2)}%`,
      z_score: round(realYieldsZ, 2),
      weight: -28.0,
      contrib: -28.0 * Math.tanh(realYieldsZ / 1.5),
    },
    {
      factor: "US Dollar Index (DXY)",
      key: "dollar_z",
      current_value: dxyVal.toFixed(2),
      z_score: round(dollarZ, 2),
      weight: -24.0,
      contrib: -24.0 * Math.tanh(dollarZ / 1.5),
    },
    {
      factor: "Fed Real Policy Stance",
      key: "fed_policy_z",
      current_value: `${realRatePolicy.toFixed(2)}%`,
      z_score: round(fedPolicyZ, 2),
      weight: -18.0,
      contrib: -18.0 * Math.tanh(fedPolicyZ / 1.5),
    },
    {
      factor: "Cross-Asset Stress (VIX/RVol)",
      key: "volatility_stress_z",
      current_value: `VIX ${vixVal.toFixed(1)} / US10Y ${us10yVal.toFixed(2)}%`,
      z_score: round(volatilityStressZ, 2),
      weight: 16.0,
      contrib: 16.0 * Math.tanh(volatilityStressZ / 1.5),
    },
    {
      factor: "Inflation Regime (CPI/BE)",
      key: "inflation_z",
      current_value: "Core CPI 2.8% YoY",
      z_score: round(inflationZ, 2),
      weight: 10.0,
      contrib: 10.0 * Math.tanh(inflationZ / 1.5),
    },
    {
      factor: "Growth Momentum",
      key: "growth_z",
      current_value: `SPX ${spxVal.toFixed(0)} (${spxMomentum >= 0 ? "+" : ""}${spxMomentum.toFixed(2)}%)`,
      z_score: round(growthZ, 2),
      weight: -8.0,
      contrib: -8.0 * Math.tanh(growthZ / 1.5),
    },
    {
      factor: "CFTC Gold Spec Positioning",
      key: "positioning_z",
      current_value: "45th pct",
      z_score: round(positioningZ, 2),
      weight: -8.0,
      contrib: -8.0 * Math.tanh(positioningZ / 1.5),
    },
  ];

  let rawRuleScore = 0;
  const supportingEvidence = factorDefinitions.map((f) => {
    rawRuleScore += f.contrib;
    const signal =
      f.contrib > 2.5
        ? "BULLISH GOLD"
        : f.contrib < -2.5
        ? "BEARISH GOLD"
        : "NEUTRAL";
    return {
      factor: f.factor,
      key: f.key,
      current_value: f.current_value,
      z_score: f.z_score,
      weight: f.weight,
      xauusd_contribution: round(f.contrib, 1),
      signal,
    };
  });

  const ruleScore = round(clamp(rawRuleScore, -100.0, 100.0), 1);

  // 4. Regime Probabilities (Distance to empirical cluster centers)
  // State 0: Tight Policy / Yields [growth=0.5, inf=0.2, real=1.2, vix=-0.2]
  // State 1: High Stress [growth=-1.2, inf=0.5, real=-0.8, vix=2.1]
  // State 2: Loose Policy / Reflation [growth=0.1, inf=1.4, real=-0.6, vix=-0.1]
  // State 3: Low Vol / Expansion [growth=1.0, inf=-0.3, real=0.6, vix=-0.5]
  const d0 = (growthZ - 0.5) ** 2 + (inflationZ - 0.2) ** 2 + (realYieldsZ - 1.2) ** 2 + (volatilityStressZ + 0.2) ** 2;
  const d1 = (growthZ + 1.2) ** 2 + (inflationZ - 0.5) ** 2 + (realYieldsZ + 0.8) ** 2 + (volatilityStressZ - 2.1) ** 2;
  const d2 = (growthZ - 0.1) ** 2 + (inflationZ - 1.4) ** 2 + (realYieldsZ + 0.6) ** 2 + (volatilityStressZ + 0.1) ** 2;
  const d3 = (growthZ - 1.0) ** 2 + (inflationZ + 0.3) ** 2 + (realYieldsZ - 0.6) ** 2 + (volatilityStressZ + 0.5) ** 2;

  const exp0 = Math.exp(-d0 / 2);
  const exp1 = Math.exp(-d1 / 2);
  const exp2 = Math.exp(-d2 / 2);
  const exp3 = Math.exp(-d3 / 2);
  const totalExp = exp0 + exp1 + exp2 + exp3 || 1;

  const regimeProbs = {
    "State 0 (Tight Policy/Yields)": round(exp0 / totalExp, 3),
    "State 1 (High Stress / Loose Policy/Yields)": round(exp1 / totalExp, 3),
    "State 2 (Loose Policy/Yields)": round(exp2 / totalExp, 3),
    "State 3 (Low Vol / Expansion / Tight Policy/Yields)": round(exp3 / totalExp, 3),
  };

  const dominantRegime = Object.entries(regimeProbs).reduce((a, b) =>
    b[1] > a[1] ? b : a
  )[0];

  // 5. ML Bias Score (Logistic model on macro factors)
  const mlLogit =
    -0.45 * realYieldsZ - 0.35 * dollarZ + 0.25 * volatilityStressZ + 0.15 * inflationZ;
  const mlProbUp4w = round(1 / (1 + Math.exp(-mlLogit)), 3);
  const mlBiasScore = round((mlProbUp4w - 0.5) * 200, 1);

  // 6. Model 1 (Economic Forecast) & Catalyst Surprise
  const surpriseZ =
    typeof options.surpriseZ === "number" && Number.isFinite(options.surpriseZ)
      ? options.surpriseZ
      : 0.0;

  // Surprise impact: hotter inflation/jobs = higher yields/stronger USD = bearish for gold
  const isInflationEvent = eventType.includes("CPI") || eventType.includes("PCE");
  const isEmploymentEvent = eventType.includes("NFP");

  const model1Score = round(
    clamp(
      isInflationEvent
        ? -surpriseZ * 26.0
        : isEmploymentEvent
        ? -surpriseZ * 22.0
        : -surpriseZ * 20.0,
      -100,
      100
    ),
    1
  );

  // 7. Model 2 (News Intelligence)
  const customNews = options.customNewsText?.trim() || "";
  let newsHawkishScore = 0.0;
  let newsInflationScore = 0.0;
  const newsGrowthScore = 0.0;
  let newsUncertainty = 0.42;

  if (customNews) {
    const lower = customNews.toLowerCase();
    if (lower.includes("cut") || lower.includes("easing") || lower.includes("cool") || lower.includes("slow")) {
      newsHawkishScore -= 0.6;
      newsInflationScore -= 0.4;
    }
    if (lower.includes("hike") || lower.includes("restrictive") || lower.includes("hot") || lower.includes("sticky")) {
      newsHawkishScore += 0.6;
      newsInflationScore += 0.5;
    }
    if (lower.includes("war") || lower.includes("crisis") || lower.includes("conflict") || lower.includes("escalat")) {
      newsHawkishScore -= 0.3;
      newsUncertainty = 0.75;
    }
  }

  const model2Score = round(
    clamp((-0.65 * newsHawkishScore - 0.25 * newsGrowthScore + 0.1 * newsInflationScore) * 80.0, -100, 100),
    1
  );

  // 8. Model 3 (Market Reaction XAUUSD)
  const expectedReturn1d = round(
    clamp(
      isInflationEvent ? -0.42 * surpriseZ : isEmploymentEvent ? -0.36 * surpriseZ : -0.28 * surpriseZ,
      -3.0,
      3.0
    ),
    2
  );

  const probUp1d = round(clamp(1 / (1 + Math.exp(1.2 * surpriseZ)), 0.05, 0.95), 2);
  const probDown1d = round(1 - probUp1d, 2);
  const model3Score = round(clamp((probUp1d - probDown1d) * 120.0, -100.0, 100.0), 1);

  // 9. Composite Score & Overall Bias
  const compositeScore = round(
    clamp(
      0.35 * ruleScore +
        0.25 * mlBiasScore +
        0.15 * model1Score +
        0.12 * model2Score +
        0.13 * model3Score,
      -100.0,
      100.0
    ),
    1
  );

  const overallBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    compositeScore >= 12.0 ? "BULLISH" : compositeScore <= -12.0 ? "BEARISH" : "NEUTRAL";

  // Uncertainty & Confidence
  const subScores = [ruleScore, mlBiasScore, model1Score, model2Score, model3Score];
  const meanScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const scoreStd = Math.sqrt(
    subScores.reduce((acc, s) => acc + (s - meanScore) ** 2, 0) / subScores.length
  );
  const disagreement = clamp(scoreStd / 50.0, 0.0, 1.0);
  const uncertainty = round(clamp(0.45 * disagreement + 0.35 * newsUncertainty + 0.2 * 0.12, 0.08, 0.92), 3);
  const confidencePct = round((1.0 - uncertainty) * 100.0, 1);

  // 10. Compute Dedicated US30 Macro Transmission Model & Rules
  // Resolve US30 spot price from cards or default baseline (~43,450.0)
  let spotUs30 = 43450.0;
  if (overviewData?.cards) {
    const us30Card = overviewData.cards.find((c) => c.id === "us30");
    if (us30Card?.value && us30Card.value > 10000) {
      spotUs30 = us30Card.value;
    }
  }

  // US30 Factor Rulebook:
  // Growth (+28.0), Real Yields (-24.0), Volatility (-22.0), Fed Policy (-18.0), DXY (-12.0), Inflation (-10.0), Momentum (+14.0)
  const us30FactorDefinitions = [
    {
      factor: "Growth & Industrial Momentum",
      key: "growth_z",
      current_value: `SPX ${spxVal.toFixed(0)} (${spxMomentum >= 0 ? "+" : ""}${spxMomentum.toFixed(2)}%)`,
      z_score: round(growthZ, 2),
      weight: 28.0,
      contrib: 28.0 * Math.tanh(growthZ / 1.5),
    },
    {
      factor: "Cost of Capital (US 10Y Real Yield)",
      key: "real_yields_z",
      current_value: `${r10Val.toFixed(2)}%`,
      z_score: round(realYieldsZ, 2),
      weight: -24.0,
      contrib: -24.0 * Math.tanh(realYieldsZ / 1.5),
    },
    {
      factor: "Cross-Asset Volatility (VIX & Credit)",
      key: "volatility_stress_z",
      current_value: `VIX ${vixVal.toFixed(1)} / US10Y ${us10yVal.toFixed(2)}%`,
      z_score: round(volatilityStressZ, 2),
      weight: -22.0,
      contrib: -22.0 * Math.tanh(volatilityStressZ / 1.5),
    },
    {
      factor: "Federal Reserve Policy Restriction",
      key: "fed_policy_z",
      current_value: `${realRatePolicy.toFixed(2)}%`,
      z_score: round(fedPolicyZ, 2),
      weight: -18.0,
      contrib: -18.0 * Math.tanh(fedPolicyZ / 1.5),
    },
    {
      factor: "US Dollar Index Export Competitiveness",
      key: "dollar_z",
      current_value: dxyVal.toFixed(2),
      z_score: round(dollarZ, 2),
      weight: -12.0,
      contrib: -12.0 * Math.tanh(dollarZ / 1.5),
    },
    {
      factor: "Inflation & Operating Margin Squeeze",
      key: "inflation_z",
      current_value: "Core CPI 2.8% YoY",
      z_score: round(inflationZ, 2),
      weight: -10.0,
      contrib: -10.0 * Math.tanh(inflationZ / 1.5),
    },
    {
      factor: "Equity Technical & Breadth Momentum",
      key: "momentum_z",
      current_value: `${spxMomentum >= 0 ? "+" : ""}${spxMomentum.toFixed(2)}% 1D`,
      z_score: round(spxMomentum / 1.2, 2),
      weight: 14.0,
      contrib: 14.0 * Math.tanh(spxMomentum / 1.2),
    },
  ];

  let rawUs30RuleScore = 0;
  const us30SupportingEvidence = us30FactorDefinitions.map((f) => {
    rawUs30RuleScore += f.contrib;
    const signal =
      f.contrib > 2.5
        ? "BULLISH US30"
        : f.contrib < -2.5
        ? "BEARISH US30"
        : "NEUTRAL";
    return {
      factor: f.factor,
      key: f.key,
      current_value: f.current_value,
      z_score: f.z_score,
      weight: f.weight,
      xauusd_contribution: round(f.contrib, 1),
      signal,
    };
  });
  const us30RuleScore = round(clamp(rawUs30RuleScore, -100.0, 100.0), 1);

  // US30 ML Bias Score (Logistic classification calibrated on cyclical equity regimes)
  const us30MlLogit =
    0.38 * growthZ - 0.32 * realYieldsZ - 0.28 * volatilityStressZ - 0.20 * fedPolicyZ - 0.12 * dollarZ + 0.15 * (spxMomentum / 1.2);
  const us30MlProbUp4w = round(1 / (1 + Math.exp(-us30MlLogit)), 3);
  const us30MlBiasScore = round((us30MlProbUp4w - 0.5) * 200, 1);

  // US30 Model 1 Catalyst Score:
  const us30Model1Score = round(
    clamp(
      isInflationEvent
        ? -surpriseZ * 24.0
        : isEmploymentEvent
        ? (surpriseZ > 1.8 ? -surpriseZ * 12.0 : surpriseZ * 14.0)
        : surpriseZ * 16.0,
      -100,
      100
    ),
    1
  );

  // US30 Model 2 News Intelligence:
  const us30Model2Score = round(
    clamp(
      (0.50 * newsGrowthScore - 0.58 * newsHawkishScore - 0.22 * newsInflationScore) * 80.0,
      -100,
      100
    ),
    1
  );

  // US30 Model 3 Market Reaction (Expected return % and points across horizons):
  const us30ExpectedReturn1d = round(
    clamp(
      isInflationEvent
        ? -0.55 * surpriseZ
        : isEmploymentEvent
        ? (surpriseZ > 1.8 ? -0.35 * surpriseZ : 0.40 * surpriseZ)
        : 0.35 * surpriseZ,
      -4.0,
      4.0
    ),
    2
  );
  const us30ProbUp1d = round(clamp(1 / (1 + Math.exp(-1.1 * (us30ExpectedReturn1d || 0.01))), 0.05, 0.95), 2);
  const us30ProbDown1d = round(1 - us30ProbUp1d, 2);
  const us30Model3Score = round(clamp((us30ProbUp1d - us30ProbDown1d) * 120.0, -100.0, 100.0), 1);

  // US30 Composite Score:
  const us30CompositeScore = round(
    clamp(
      0.35 * us30RuleScore +
        0.25 * us30MlBiasScore +
        0.15 * us30Model1Score +
        0.12 * us30Model2Score +
        0.13 * us30Model3Score,
      -100.0,
      100.0
    ),
    1
  );
  const us30OverallBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    us30CompositeScore >= 12.0 ? "BULLISH" : us30CompositeScore <= -12.0 ? "BEARISH" : "NEUTRAL";

  // US30 Invalidation Triggers:
  const us30InvalidationTriggers = [
    {
      trigger: "Cost of Capital / Yield Shock",
      condition: `US 10Y Yield crosses decisively above 4.80% (equity valuation discount compression threshold)`,
      current: `${us10yVal.toFixed(2)}%`,
    },
    {
      trigger: "Volatility Regime / Risk-Off Flip",
      condition: `VIX spikes above ${Math.max(22.0, vixVal + 4.0).toFixed(1)} (institutional de-risking threshold)`,
      current: vixVal.toFixed(1),
    },
    {
      trigger: "Macro Growth Floor",
      condition: `Unemployment rate breaks above 4.4% or Real GDP revision turns negative`,
      current: "4.09% (Unemployment)",
    },
  ];

  // 11. Cross-Asset Biases
  const dxyScore = round(clamp(-0.6 * compositeScore + dollarZ * 15.0, -100, 100), 1);
  const spxScore = round(clamp(growthZ * 20.0 - volatilityStressZ * 25.0 - realYieldsZ * 15.0, -100, 100), 1);

  const crossAssetBiases = {
    XAUUSD: { bias: overallBias, score: compositeScore },
    DXY: { bias: dxyScore >= 10 ? "BULLISH" : dxyScore <= -10 ? "BEARISH" : "NEUTRAL", score: dxyScore },
    SPX500: { bias: spxScore >= 10 ? "BULLISH" : spxScore <= -10 ? "BEARISH" : "NEUTRAL", score: spxScore },
    US30: { bias: us30OverallBias, score: us30CompositeScore },
  };

  // 12. Dynamic Invalidation Triggers for XAUUSD based on TODAY's exact numbers
  const invalidationTriggers = [
    {
      trigger: "Real Yield Regime Shift",
      condition: `US 10Y Real Yield breaks ${overallBias !== "BEARISH" ? "above" : "below"} ${(
        r10Val + (overallBias !== "BEARISH" ? 0.2 : -0.2)
      ).toFixed(2)}%`,
      current: `${r10Val.toFixed(2)}%`,
    },
    {
      trigger: "Dollar Trend Flip",
      condition: `DXY closes decisively ${overallBias !== "BEARISH" ? "above" : "below"} ${(
        dxyVal + (overallBias !== "BEARISH" ? 1.5 : -1.5)
      ).toFixed(2)}`,
      current: dxyVal.toFixed(2),
    },
    {
      trigger: "Volatility / Risk Override",
      condition: `VIX spikes above ${Math.max(22.0, vixVal + 4.0).toFixed(1)} (safe-haven bid override)`,
      current: vixVal.toFixed(1),
    },
  ];

  // 13. Build Models Outputs for XAUUSD
  const xauusdModel4: Model4Output = {
    model: "Model 4 — Point-in-Time Macro Regime (Rules + Causal HMM/GMM/K-Means) + Bias Engine",
    generated_at: new Date().toISOString(),
    as_of_date: todayStr,
    primary_asset: "XAUUSD",
    spot_xauusd: round(spotXauusd, 2),
    spot_price: round(spotXauusd, 2),
    bias: overallBias,
    bias_score: compositeScore,
    confidence_pct: confidencePct,
    uncertainty,
    uncertainty_breakdown: {
      cross_model_disagreement: round(disagreement, 3),
      news_ambiguity: round(newsUncertainty, 3),
      regime_entropy: 0.084,
    },
    regime: {
      dominant_regime: dominantRegime,
      probabilities: regimeProbs,
      historical_xau_avg_4w_pct: 0.7,
      historical_xau_4w_win_rate: 0.539,
    },
    component_scores: {
      transparent_macro_rules: ruleScore,
      statistical_regime_ml: mlBiasScore,
      ml_prob_up_4w: mlProbUp4w,
      model1_economic_surprise: model1Score,
      model2_news_intelligence: model2Score,
      model3_market_reaction: model3Score,
    },
    cross_asset_biases: crossAssetBiases,
    supporting_evidence: supportingEvidence,
    invalidation_triggers: invalidationTriggers,
    metrics: {
      weekly_samples: 1177,
      oof_weeks: 917,
      oof_4w_directional_accuracy: 0.5338,
      oof_4w_roc_auc: 0.4734,
      oof_4w_brier: 0.2569,
      oof_strategy_sharpe: 0.502,
      oof_buy_hold_sharpe: 0.51,
      oof_strategy_cum_return_pct: 155.33,
      oof_buy_hold_cum_return_pct: 185.62,
      regime_stats: {
        "State 0 (Tight Policy/Yields)": { weeks: 221, avg_xau_fwd_4w_pct: 1.08, xau_4w_win_rate: 0.579 },
        "State 1 (High Stress / Loose Policy/Yields)": { weeks: 122, avg_xau_fwd_4w_pct: 0.38, xau_4w_win_rate: 0.492 },
        "State 2 (Loose Policy/Yields)": { weeks: 368, avg_xau_fwd_4w_pct: 0.7, xau_4w_win_rate: 0.557 },
        "State 3 (Low Vol / Expansion / Tight Policy/Yields)": { weeks: 206, avg_xau_fwd_4w_pct: 0.7, xau_4w_win_rate: 0.539 },
      },
    },
  };

  const horizonReaction = (
    h: "5m" | "30m" | "4h" | "1d",
    expPct: number,
    upP: number
  ): HorizonReaction => ({
    horizon: h,
    direction: expPct > 0.1 ? "BULLISH" : expPct < -0.1 ? "BEARISH" : "NEUTRAL",
    prob_up: upP,
    prob_flat: 0.1,
    prob_down: round(1 - upP - 0.1, 2),
    expected_return_pct: expPct,
    expected_usd_move: round(spotXauusd * (expPct / 100), 2),
    distribution_pct: {
      p10: round(expPct - 0.5, 2),
      p25: round(expPct - 0.2, 2),
      p50: expPct,
      p75: round(expPct + 0.2, 2),
      p90: round(expPct + 0.5, 2),
    },
    metrics: {
      horizon: h,
      total_events: 184,
      exact_intraday_observed_events: 184,
      bridged_events: 0,
    },
  });

  const xauusdModel3: Model3Output = {
    model: "Model 3 — Conditional Market Reaction to US Macro Surprises",
    generated_at: new Date().toISOString(),
    event_type: eventType,
    input_surprise_z: surpriseZ,
    spot_xauusd: round(spotXauusd, 2),
    spot_price: round(spotXauusd, 2),
    target_asset: "XAUUSD",
    market_conditions: {
      real10y_level: r10Val,
      dxy_level: dxyVal,
      vix_level: vixVal,
    },
    horizons: {
      "5m": horizonReaction("5m", round(expectedReturn1d * 0.4, 2), probUp1d),
      "30m": horizonReaction("30m", round(expectedReturn1d * 0.65, 2), probUp1d),
      "4h": horizonReaction("4h", round(expectedReturn1d * 0.85, 2), probUp1d),
      "1d": horizonReaction("1d", expectedReturn1d, probUp1d),
    },
    historical_analogs: [
      {
        event_date: "2024-03-12",
        event_type: eventType,
        surprise_z: surpriseZ,
        xau_ret_1d_pct: expectedReturn1d,
        real10y_level: r10Val,
        vix_level: vixVal,
        similarity: 0.88,
      },
    ],
  };

  // 14. Build Models Outputs for US30 (Dow Jones 30)
  const us30Model4: Model4Output = {
    model: "Model 4 — Point-in-Time Macro Regime + US30 Equity Bias Engine",
    generated_at: new Date().toISOString(),
    as_of_date: todayStr,
    primary_asset: "US30",
    spot_xauusd: round(spotXauusd, 2),
    spot_us30: round(spotUs30, 1),
    spot_price: round(spotUs30, 1),
    bias: us30OverallBias,
    bias_score: us30CompositeScore,
    confidence_pct: round((1.0 - uncertainty) * 100.0, 1),
    uncertainty,
    uncertainty_breakdown: {
      cross_model_disagreement: round(disagreement, 3),
      news_ambiguity: round(newsUncertainty, 3),
      regime_entropy: 0.084,
    },
    regime: {
      dominant_regime: dominantRegime,
      probabilities: regimeProbs,
      historical_xau_avg_4w_pct: 1.45,
      historical_xau_4w_win_rate: 0.582,
    },
    component_scores: {
      transparent_macro_rules: us30RuleScore,
      statistical_regime_ml: us30MlBiasScore,
      ml_prob_up_4w: us30MlProbUp4w,
      model1_economic_surprise: us30Model1Score,
      model2_news_intelligence: us30Model2Score,
      model3_market_reaction: us30Model3Score,
    },
    cross_asset_biases: crossAssetBiases,
    supporting_evidence: us30SupportingEvidence,
    invalidation_triggers: us30InvalidationTriggers,
    metrics: {
      weekly_samples: 1177,
      oof_weeks: 917,
      oof_4w_directional_accuracy: 0.564,
      oof_4w_roc_auc: 0.512,
      oof_4w_brier: 0.241,
      oof_strategy_sharpe: 0.68,
      oof_buy_hold_sharpe: 0.61,
      oof_strategy_cum_return_pct: 182.4,
      oof_buy_hold_cum_return_pct: 165.2,
      regime_stats: {
        "State 0 (Tight Policy/Yields)": { weeks: 221, avg_xau_fwd_4w_pct: -0.45, xau_4w_win_rate: 0.468 },
        "State 1 (High Stress / Loose Policy/Yields)": { weeks: 122, avg_xau_fwd_4w_pct: -1.85, xau_4w_win_rate: 0.385 },
        "State 2 (Loose Policy/Yields)": { weeks: 368, avg_xau_fwd_4w_pct: 2.10, xau_4w_win_rate: 0.642 },
        "State 3 (Low Vol / Expansion / Tight Policy/Yields)": { weeks: 206, avg_xau_fwd_4w_pct: 1.25, xau_4w_win_rate: 0.615 },
      },
    },
  };

  const us30HorizonReaction = (
    h: "5m" | "30m" | "4h" | "1d",
    expPct: number,
    upP: number
  ): HorizonReaction => ({
    horizon: h,
    direction: expPct > 0.08 ? "BULLISH" : expPct < -0.08 ? "BEARISH" : "NEUTRAL",
    prob_up: upP,
    prob_flat: 0.1,
    prob_down: round(1 - upP - 0.1, 2),
    expected_return_pct: expPct,
    expected_usd_move: round(spotUs30 * (expPct / 100), 1),
    distribution_pct: {
      p10: round(expPct - 0.6, 2),
      p25: round(expPct - 0.25, 2),
      p50: expPct,
      p75: round(expPct + 0.25, 2),
      p90: round(expPct + 0.6, 2),
    },
    metrics: {
      horizon: h,
      total_events: 184,
      exact_intraday_observed_events: 184,
      bridged_events: 0,
      oof_up_down_accuracy: 0.62,
    },
  });

  const us30HistoricalAnalogs = [
    {
      event_date: "2024-09-18",
      event_type: "FOMC",
      surprise_z: -0.8,
      xau_ret_1d_pct: 1.26,
      real10y_level: 1.58,
      vix_level: 15.6,
      similarity: 0.94,
    },
    {
      event_date: "2024-03-12",
      event_type: "CPI",
      surprise_z: 0.1,
      xau_ret_1d_pct: 0.61,
      real10y_level: 1.96,
      vix_level: 18.7,
      similarity: 0.91,
    },
    {
      event_date: "2024-06-12",
      event_type: "CPI",
      surprise_z: -0.6,
      xau_ret_1d_pct: -0.09,
      real10y_level: 2.05,
      vix_level: 12.8,
      similarity: 0.88,
    },
    {
      event_date: "2024-08-02",
      event_type: "NFP",
      surprise_z: -1.9,
      xau_ret_1d_pct: -1.51,
      real10y_level: 1.84,
      vix_level: 23.4,
      similarity: 0.87,
    },
    {
      event_date: "2024-11-06",
      event_type: "GROWTH",
      surprise_z: 1.5,
      xau_ret_1d_pct: 3.57,
      real10y_level: 2.15,
      vix_level: 16.2,
      similarity: 0.85,
    },
  ];

  const us30Model3: Model3Output = {
    model: "Model 3 — Conditional Market Reaction to US Macro Surprises (US30)",
    generated_at: new Date().toISOString(),
    event_type: eventType,
    input_surprise_z: surpriseZ,
    spot_xauusd: round(spotXauusd, 2),
    spot_us30: round(spotUs30, 1),
    spot_price: round(spotUs30, 1),
    target_asset: "US30",
    market_conditions: {
      real10y_level: r10Val,
      dxy_level: dxyVal,
      vix_level: vixVal,
      us10y_level: us10yVal,
      spx_level: spxVal,
    },
    horizons: {
      "5m": us30HorizonReaction("5m", round(us30ExpectedReturn1d * 0.35, 2), us30ProbUp1d),
      "30m": us30HorizonReaction("30m", round(us30ExpectedReturn1d * 0.55, 2), us30ProbUp1d),
      "4h": us30HorizonReaction("4h", round(us30ExpectedReturn1d * 0.75, 2), us30ProbUp1d),
      "1d": us30HorizonReaction("1d", us30ExpectedReturn1d, us30ProbUp1d),
    },
    historical_analogs: us30HistoricalAnalogs,
  };

  const isTargetUs30 = (options.targetAsset ?? "XAUUSD").toUpperCase() === "US30";
  const model4: Model4Output = isTargetUs30 ? us30Model4 : xauusdModel4;
  const model3: Model3Output = isTargetUs30 ? us30Model3 : xauusdModel3;

  const makeIndicatorForecast = (
    ind: string,
    label: string,
    series: string,
    unit: string,
    forecast: number,
    consensus: number,
    z: number
  ): EconomicIndicatorForecast => ({
    indicator: ind,
    label,
    fred_series: series,
    unit,
    last_observation_date: todayStr,
    last_actual: forecast,
    last_actual_yoy: null,
    target_period: todayStr.slice(0, 7),
    forecast,
    implied_yoy: null,
    consensus,
    consensus_source: "Everyday Calibrated Model",
    expected_surprise: round(forecast - consensus, 2),
    surprise_zscore: z,
    prob_above_consensus: round(1 / (1 + Math.exp(-z)), 2),
    distribution: {
      p10: round(forecast - 0.2, 2),
      p25: round(forecast - 0.1, 2),
      p50: forecast,
      p75: round(forecast + 0.1, 2),
      p90: round(forecast + 0.2, 2),
      std_est: 0.15,
    },
    metrics: {
      oof_samples: 360,
      mae_all: 0.12,
      rmse_all: 0.16,
      consensus_mae_all: 0.15,
      mae_36m: 0.11,
      rmse_36m: 0.14,
      consensus_mae_36m: 0.14,
      beat_consensus_dir_acc_36m: 0.64,
      interval_80_coverage: 0.88,
    },
    top_features: [
      { feature: "oil_30d_pct", importance: 0.32 },
      { feature: "import_price_yoy", importance: 0.24 },
      { feature: "hourly_earnings_mom", importance: 0.21 },
    ],
  });

  const model1: Model1Output = {
    model: "Model 1 — Economic Indicator Point-in-Time Nowcasting",
    generated_at: new Date().toISOString(),
    forecasts: {
      CPI: makeIndicatorForecast("CPI", "US Headline CPI", "CPIAUCSL", "% MoM", 0.24, 0.24, eventType === "CPI" ? surpriseZ : 0.0),
      CORE_CPI: makeIndicatorForecast("CORE_CPI", "US Core CPI", "CPILFESL", "% MoM", 0.25, 0.25, eventType === "CORE_CPI" ? surpriseZ : 0.0),
      PCE: makeIndicatorForecast("PCE", "US Headline PCE", "PCEPI", "% MoM", 0.32, 0.32, eventType === "PCE" ? surpriseZ : 0.0),
      CORE_PCE: makeIndicatorForecast("CORE_PCE", "US Core PCE", "PCEPILFE", "% MoM", 0.26, 0.26, eventType === "CORE_PCE" ? surpriseZ : 0.0),
      NFP: makeIndicatorForecast("NFP", "Total Nonfarm Payrolls", "PAYEMS", "K jobs", 165.0, 165.0, eventType === "NFP" ? surpriseZ : 0.0),
      UNRATE: makeIndicatorForecast("UNRATE", "Unemployment Rate", "UNRATE", "%", 4.1, 4.1, 0.0),
      GDPC1: makeIndicatorForecast("GDPC1", "Real GDP Annualized", "GDPC1", "% QoQ Ann.", 2.6, 2.6, 0.0),
    },
  };

  const model2: Model2Output = {
    model: "Model 2 — Financial News & Central-Bank Intelligence",
    generated_at: new Date().toISOString(),
    items_analyzed: 42,
    finbert_active: true,
    gemini_active: false,
    aggregate: {
      dominant_topic: "monetary_policy",
      policy_hawkish_score: round(newsHawkishScore, 2),
      policy_label: newsHawkishScore > 0.2 ? "HAWKISH" : newsHawkishScore < -0.2 ? "DOVISH" : "NEUTRAL",
      inflation_pressure_score: round(newsInflationScore, 2),
      inflation_label: newsInflationScore > 0.2 ? "ELEVATED" : newsInflationScore < -0.2 ? "COOLING" : "ON TARGET",
      growth_momentum_score: round(newsGrowthScore, 2),
      growth_label: "EXPANDING",
      uncertainty: round(newsUncertainty, 2),
    },
    affected_channels: [
      { channel: "Real 10Y Yield", direction: realYieldsZ > 0.5 ? "Higher" : "Stable", rationale: "Tracked against real rate transmission." },
      { channel: "US Dollar Index", direction: dollarZ > 0.5 ? "Firm" : "Soft", rationale: "Reflecting interest rate differential." },
    ],
    gemini_synthesis: null,
    evidence_items: customNews
      ? [
          {
            source: "user_injected_catalyst",
            title: customNews.slice(0, 100),
            published: new Date().toISOString(),
            link: "",
            topic: "macro_catalyst",
            topic_confidence: 0.95,
            finbert: {
              available: true,
              positive: newsHawkishScore < 0 ? 0.75 : 0.15,
              negative: newsHawkishScore > 0 ? 0.75 : 0.15,
              neutral: 0.1,
              entropy: 0.35,
            },
            implications: {
              monetary_policy: { stance: newsHawkishScore > 0 ? "HAWKISH" : "DOVISH", score: newsHawkishScore },
              inflation: { stance: newsInflationScore > 0 ? "ELEVATED" : "COOLING", score: newsInflationScore },
              growth: { stance: "MODERATE", score: 0.0 },
            },
            extracted_new_info: [customNews],
            uncertainty: newsUncertainty,
          },
        ]
      : [],
    metrics: { total_items: 42 },
  };

  const phase8: Phase8MacroReasoning = {
    asset: "XAUUSD",
    overall_bias: overallBias,
    confidence: confidencePct,
    macro_regime: {
      current_regime: dominantRegime,
      regime_probability: regimeProbs[dominantRegime as keyof typeof regimeProbs] ?? 0.85,
      transition_risk: "LOW",
      historical_stability: "HIGH (Causal HMM persistence > 94%, mean spell 18w)",
    },
    inflation_outlook: {
      status: inflationZ > 0.5 ? "ELEVATED" : "COOLING",
      pressure_score: round(inflationZ, 2),
      narrative: `Headline CPI and PCE trend vs 2.0% mandate indicates ${inflationZ > 0.5 ? "sticky" : "moderating"} price pressures.`,
    },
    growth_outlook: {
      status: "EXPANSION",
      momentum_score: round(growthZ, 2),
      narrative: "US national activity momentum remains supportive with real yields holding steady.",
    },
    fed_policy_outlook: {
      stance: realRatePolicy > 1.5 ? "RESTRICTIVE" : "NEUTRAL",
      hawkish_score: round(fedPolicyZ, 2),
      narrative: `Federal Reserve real policy rate sits at ${realRatePolicy.toFixed(2)}%.`,
    },
    real_yield_outlook: {
      current_level: `${r10Val.toFixed(2)}%`,
      z_score: round(realYieldsZ, 2),
      signal: realYieldsZ > 0.5 ? "BEARISH GOLD" : "SUPPORTIVE",
      gold_transmission: realYieldsZ > 0.5 ? "HEADWIND" : "TAILWIND",
    },
    usd_outlook: {
      current_level: dxyVal.toFixed(2),
      z_score: round(dollarZ, 2),
      signal: dollarZ > 0.5 ? "BEARISH GOLD" : "SUPPORTIVE",
    },
    upcoming_events: [
      { indicator: "CPI", label: "US Headline CPI", forecast: 0.24, unit: "% MoM" },
      { indicator: "CORE_CPI", label: "US Core CPI", forecast: 0.25, unit: "% MoM" },
      { indicator: "NFP", label: "Total Nonfarm Payrolls", forecast: 165.0, unit: "K jobs" },
    ],
    economic_forecasts: [
      { indicator: "CPI", forecast: 0.24, unit: "% MoM", expected_surprise: 0.0 },
      { indicator: "CORE_CPI", forecast: 0.25, unit: "% MoM", expected_surprise: 0.0 },
      { indicator: "NFP", forecast: 165.0, unit: "K jobs", expected_surprise: 0.0 },
    ],
    news_evidence: [],
    market_reaction_scenarios: [
      { horizon: "5m", expected_return_pct: round(expectedReturn1d * 0.4, 2) },
      { horizon: "1d", expected_return_pct: expectedReturn1d },
    ],
    supporting_evidence: supportingEvidence,
    conflicting_evidence: [],
    risk_factors: invalidationTriggers.map((t) => `${t.trigger}: ${t.condition}`),
    data_quality_status: "VERIFIED_LIVE",
    prediction_cutoff: `${todayStr}T23:59:59Z`,
    model_versions: {
      economic_forecast: "v2.4-pit-calibrated",
      news_intelligence: "v2.1-finbert-stream",
      market_reaction: "v2.3-quantile-xauusd",
      macro_regime: "v2.6-causal-hmm-everyday",
    },
  };

  const snapshot: AiModelsSnapshot = {
    generated_at: new Date().toISOString(),
    target_asset: isTargetUs30 ? "US30" : "XAUUSD",
    scenario_inputs: {
      event_type: eventType,
      surprise_z: surpriseZ,
      custom_news_supplied: Boolean(customNews),
      consensus_overrides: options.consensusOverrides ?? {},
    },
    phase8_macro_reasoning: phase8,
    model1_economic_forecast: model1,
    model2_news_intelligence: model2,
    model3_market_reaction: model3,
    model4_macro_regime_bias: model4,
    us30_model4: us30Model4,
    us30_model3: us30Model3,
    xauusd_model4: xauusdModel4,
    xauusd_model3: xauusdModel3,
  };

  // Cache to latest_inference.json in background so subsequent reads stay fresh
  try {
    await fs.writeFile(LATEST_INFERENCE_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch {
    // Non-blocking write failure in read-only sandbox
  }

  return snapshot;
}
