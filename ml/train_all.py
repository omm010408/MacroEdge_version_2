from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from ml.config import ARTIFACTS_DIR, REPORTS_DIR
from ml.data_pipeline import (
    fetch_all_fred_data,
    fetch_cftc_gold_history,
    fetch_fed_news_feed,
    fetch_fred_release_dates,
    fetch_market_data,
    sync_all_datasets,
)
from ml.infer import build_phase8_reasoning
from ml.models.economic_forecast import predict_economic_forecasts, train_all_economic_models
from ml.models.macro_regime_bias import predict_macro_regime_bias, train_macro_regime_model
from ml.models.market_reaction import predict_xauusd_reaction, train_market_reaction_models
from ml.models.news_intelligence import analyze_news_items, train_news_intelligence_model
from ml.validation.leakage_checks import run_all_checks


def main() -> None:
    parser = argparse.ArgumentParser(description="Train all 4 MacroEdge AI/ML models on real data.")
    parser.add_argument("--refresh-data", action="store_true", help="Force re-fetch of FRED/Market/CFTC/RSS data.")
    parser.add_argument("--skip-finbert", action="store_true", help="Skip downloading/running ProsusAI/finbert during smoke test.")
    args = parser.parse_args()

    print("=== [0/6] Running Mandatory Point-in-Time & Leakage Pre-Training Gate ===")
    leakage_report = run_all_checks()
    print(f"Leakage Audit Status: {leakage_report['overall_status']} | Counts: {leakage_report['counts']}")
    if leakage_report["counts"]["FAIL"] > 0:
        fails = [c["check_id"] for c in leakage_report["checks"] if c["status"] == "FAIL"]
        raise RuntimeError(f"ABORTING TRAINING: {len(fails)} critical leakage failure(s) detected: {fails}")

    print("=== [1/6] Syncing Real Macro, Release-Date, Market, CFTC & Fed News Data ===")
    data_diag = sync_all_datasets(force_refresh=args.refresh_data)
    print(json.dumps(data_diag, indent=2))

    fred_data = fetch_all_fred_data(force_refresh=False)
    release_dates = fetch_fred_release_dates(force_refresh=False)
    market_data = fetch_market_data(force_refresh=False)
    cftc_df = fetch_cftc_gold_history(force_refresh=False)
    fed_news = fetch_fed_news_feed(force_refresh=False)

    print("=== [2/6] Training Model 1: Economic Forecast Model (XGBoost + scikit-learn) ===")
    m1_report = train_all_economic_models(fred_data["monthly"])
    print(json.dumps({k: v["metrics"] for k, v in m1_report.items()}, indent=2))

    print("=== [3/6] Training Model 2: News Intelligence Model (FinBERT + Macro NLP) ===")
    m2_report = train_news_intelligence_model()
    print(json.dumps(m2_report, indent=2))

    print("=== [4/6] Training Model 3: Market Reaction Model (XAUUSD 5m/30m/4h/1d XGBoost) ===")
    m3_report = train_market_reaction_models(
        fred_data["daily"], market_data, release_dates, cftc_df
    )
    print(json.dumps(m3_report, indent=2))

    print("=== [5/6] Training Model 4: Macro Regime + Bias Engine (GMM + ML Ensemble) ===")
    m4_report = train_macro_regime_model(fred_data["daily"], market_data, cftc_df)
    print(json.dumps(m4_report, indent=2))

    print("=== [6/6] Running Full End-to-End Inference Snapshot ===")
    m1_out = predict_economic_forecasts(fred_data["monthly"])
    m2_out = analyze_news_items(fed_news, use_finbert=not args.skip_finbert)
    # Feed Model 1's CPI expected surprise z-score into Model 3 by default
    cpi_z = float(m1_out["forecasts"].get("CPI", {}).get("surprise_zscore", 0.0))
    m3_out = predict_xauusd_reaction(
        fred_data["daily"], market_data, cftc_df, event_type="CPI", surprise_z=cpi_z
    )
    m4_out = predict_macro_regime_bias(
        fred_data["daily"], market_data, cftc_df, m1_out, m2_out, m3_out
    )

    prediction_cutoff = f"{m4_out.get('as_of_date', datetime.now(timezone.utc).strftime('%Y-%m-%d'))}T23:59:59Z"
    phase8 = build_phase8_reasoning(m1_out, m2_out, m3_out, m4_out, prediction_cutoff=prediction_cutoff)

    full_snapshot = {
        **phase8,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "phase8_macro_reasoning": phase8,
        "data_diagnostics": data_diag,
        "model1_economic_forecast": m1_out,
        "model2_news_intelligence": m2_out,
        "model3_market_reaction": m3_out,
        "model4_macro_regime_bias": m4_out,
    }
    (ARTIFACTS_DIR / "latest_inference.json").write_text(
        json.dumps(full_snapshot, indent=2), encoding="utf-8"
    )
    training_summary = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "leakage_audit_gate": leakage_report["counts"],
        "data_diagnostics": data_diag,
        "model1": m1_report,
        "model2": m2_report,
        "model3": m3_report,
        "model4": m4_report,
    }
    (REPORTS_DIR / "training_summary.json").write_text(
        json.dumps(training_summary, indent=2), encoding="utf-8"
    )

    print(
        f"\nDONE! Primary XAUUSD Bias: {m4_out['bias']} "
        f"(Score: {m4_out['bias_score']}, Confidence: {m4_out['confidence_pct']}%, "
        f"Regime: {m4_out['regime']['dominant_regime']})"
    )


if __name__ == "__main__":
    main()
