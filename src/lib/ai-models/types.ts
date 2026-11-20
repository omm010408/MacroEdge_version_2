export interface AiBiasSummary {
  primary_asset: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  bias_score: number;
  confidence_pct: number | null;
  dominant_regime: string;
}

export interface EconomicIndicatorForecast {
  indicator: string;
  label: string;
  fred_series: string;
  unit: string;
  last_observation_date: string;
  last_actual: number;
  last_actual_yoy: number | null;
  target_period: string;
  forecast: number;
  implied_yoy: number | null;
  consensus: number;
  consensus_source: string;
  expected_surprise: number;
  surprise_zscore: number;
  prob_above_consensus: number;
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    std_est: number;
  };
  metrics: {
    oof_samples: number;
    mae_all: number;
    rmse_all: number;
    consensus_mae_all: number;
    mae_36m: number;
    rmse_36m: number;
    consensus_mae_36m: number;
    beat_consensus_dir_acc_36m: number;
    interval_80_coverage: number;
  };
  top_features: { feature: string; importance: number }[];
}

export interface Model1Output {
  model: string;
  generated_at: string;
  forecasts: Record<string, EconomicIndicatorForecast>;
}

export interface NewsEvidenceItem {
  source: string;
  title: string;
  published: string;
  link: string;
  topic: string;
  topic_confidence: number;
  finbert: {
    available: boolean;
    positive: number;
    negative: number;
    neutral: number;
    entropy: number;
  };
  implications: {
    monetary_policy: { stance: string; score: number };
    inflation: { stance: string; score: number };
    growth: { stance: string; score: number };
  };
  extracted_new_info: string[];
  uncertainty: number;
}

export interface Model2Output {
  model: string;
  generated_at: string;
  items_analyzed: number;
  finbert_active: boolean;
  gemini_active: boolean;
  aggregate: {
    dominant_topic: string;
    policy_hawkish_score: number;
    policy_label: string;
    inflation_pressure_score: number;
    inflation_label: string;
    growth_momentum_score: number;
    growth_label: string;
    uncertainty: number;
  };
  affected_channels: {
    channel: string;
    direction: string;
    rationale: string;
  }[];
  gemini_synthesis: Record<string, unknown> | null;
  evidence_items: NewsEvidenceItem[];
  metrics: Record<string, number>;
}

export interface HorizonReaction {
  horizon: "5m" | "30m" | "4h" | "1d";
  status?: "READY" | "CONDITIONALLY_READY" | "BLOCKED";
  available?: boolean;
  reason?: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNAVAILABLE";
  prob_up: number | null;
  prob_flat: number | null;
  prob_down: number | null;
  expected_return_pct: number | null;
  expected_usd_move: number | null;
  distribution_pct: {
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
  };
  metrics: {
    horizon: string;
    status?: string;
    readiness?: string;
    reason?: string;
    total_events: number;
    exact_intraday_observed_events: number;
    bridged_events: number;
    oof_test_events?: number;
    oof_mae_pct?: number;
    oof_rmse_pct?: number;
    oof_3class_accuracy?: number;
    oof_up_down_accuracy?: number;
    oof_brier_up?: number;
    top_features?: { feature: string; importance: number }[];
  };
}

export interface Model3Output {
  model: string;
  generated_at: string;
  event_type: string;
  input_surprise_z: number;
  spot_xauusd: number;
  spot_us30?: number;
  spot_price?: number;
  target_asset?: "XAUUSD" | "US30";
  market_conditions: Record<string, number>;
  horizons: Record<"5m" | "30m" | "4h" | "1d", HorizonReaction>;
  historical_analogs: {
    event_date: string;
    event_type: string;
    surprise_z: number;
    xau_ret_1d_pct: number;
    real10y_level: number | null;
    vix_level: number | null;
    similarity: number;
  }[];
}

export interface Model4Output {
  model: string;
  generated_at: string;
  as_of_date: string;
  primary_asset: string;
  spot_xauusd: number;
  spot_us30?: number;
  spot_price?: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  bias_score: number;
  confidence_pct: number;
  uncertainty: number;
  uncertainty_breakdown: {
    cross_model_disagreement: number;
    news_ambiguity: number;
    regime_entropy: number;
  };
  regime: {
    dominant_regime: string;
    probabilities: Record<string, number>;
    historical_xau_avg_4w_pct: number | null;
    historical_xau_4w_win_rate: number | null;
  };
  component_scores: {
    transparent_macro_rules: number;
    statistical_regime_ml: number;
    ml_prob_up_4w: number;
    model1_economic_surprise: number;
    model2_news_intelligence: number;
    model3_market_reaction: number;
  };
  cross_asset_biases: Record<string, { bias: string; score: number }>;
  supporting_evidence: {
    factor: string;
    key: string;
    current_value: string;
    z_score: number;
    weight: number;
    xauusd_contribution: number;
    signal: string;
  }[];
  invalidation_triggers: {
    trigger: string;
    condition: string;
    current: string;
  }[];
  metrics: {
    weekly_samples: number;
    oof_weeks: number;
    oof_4w_directional_accuracy: number;
    oof_4w_roc_auc: number;
    oof_4w_brier: number;
    oof_strategy_sharpe: number;
    oof_buy_hold_sharpe: number;
    oof_strategy_cum_return_pct: number;
    oof_buy_hold_cum_return_pct: number;
    regime_stats: Record<
      string,
      { weeks: number; avg_xau_fwd_4w_pct: number; xau_4w_win_rate: number }
    >;
  };
}

export interface Phase8MacroReasoning {
  asset: "XAUUSD";
  overall_bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number | null;
  macro_regime: {
    current_regime: string;
    regime_probability: number | null;
    transition_risk: string | number | null;
    historical_stability: string | number | null;
  };
  inflation_outlook: string | Record<string, unknown>;
  growth_outlook: string | Record<string, unknown>;
  fed_policy_outlook: string | Record<string, unknown>;
  real_yield_outlook: string | Record<string, unknown>;
  usd_outlook: string | Record<string, unknown>;
  upcoming_events: Array<Record<string, unknown>>;
  economic_forecasts: Array<Record<string, unknown>>;
  news_evidence: Array<Record<string, unknown>>;
  market_reaction_scenarios: Array<Record<string, unknown>>;
  supporting_evidence: Array<Record<string, unknown>>;
  conflicting_evidence: Array<Record<string, unknown>>;
  risk_factors: Array<string | Record<string, unknown>>;
  data_quality_status: string | Record<string, unknown>;
  prediction_cutoff: string;
  model_versions: {
    economic_forecast: string;
    news_intelligence: string;
    market_reaction: string;
    macro_regime: string;
  };
}

export interface AiModelsSnapshot {
  generated_at: string;
  target_asset?: "XAUUSD" | "US30";
  scenario_inputs?: {
    event_type: string;
    surprise_z: number;
    custom_news_supplied: boolean;
    consensus_overrides: Record<string, number>;
  };
  data_diagnostics?: Record<string, unknown>;
  phase8_macro_reasoning?: Phase8MacroReasoning;
  model1_economic_forecast: Model1Output;
  model2_news_intelligence: Model2Output;
  model3_market_reaction: Model3Output;
  model4_macro_regime_bias: Model4Output;
  // Dual-asset intelligence
  us30_model4?: Model4Output;
  us30_model3?: Model3Output;
  xauusd_model4?: Model4Output;
  xauusd_model3?: Model3Output;
}
