from __future__ import annotations

import json
from ml.config import ARTIFACTS_DIR, DATA_DIR, REPORTS_DIR
from ml.infer import run_inference


def main() -> None:
    required_data = [
        "fred_macro_daily.csv",
        "fred_macro_monthly.csv",
        "fred_release_dates.csv",
        "market_daily.csv",
        "market_1h.csv",
        "market_30m.csv",
        "market_5m.csv",
        "cftc_gold_weekly.csv",
        "fed_news.json",
        "xauusd_macro_events.csv",
    ]
    for name in required_data:
        p = DATA_DIR / name
        assert p.exists() and p.stat().st_size > 0, f"Missing or empty dataset: {p}"

    required_models = [
        ARTIFACTS_DIR / "model1_economic_forecast" / "cpi.joblib",
        ARTIFACTS_DIR / "model1_economic_forecast" / "core_cpi.joblib",
        ARTIFACTS_DIR / "model1_economic_forecast" / "pce.joblib",
        ARTIFACTS_DIR / "model1_economic_forecast" / "core_pce.joblib",
        ARTIFACTS_DIR / "model1_economic_forecast" / "nfp.joblib",
        ARTIFACTS_DIR / "model2_news_intelligence" / "macro_nlp.joblib",
        ARTIFACTS_DIR / "model3_market_reaction" / "xauusd_reaction.joblib",
        ARTIFACTS_DIR / "model4_macro_regime" / "macro_regime_bias.joblib",
        ARTIFACTS_DIR / "latest_inference.json",
        REPORTS_DIR / "training_summary.json",
    ]
    for p in required_models:
        assert p.exists() and p.stat().st_size > 0, f"Missing trained artifact: {p}"

    # Verify live inference end-to-end
    out = run_inference({"event_type": "CPI"})
    m1 = out["model1_economic_forecast"]["forecasts"]
    assert set(["CPI", "CORE_CPI", "PCE", "CORE_PCE", "NFP"]).issubset(m1.keys())
    for k, v in m1.items():
        d = v["distribution"]
        assert d["p10"] <= d["p25"] <= d["p50"] <= d["p75"] <= d["p90"], f"Non-monotonic quantiles for {k}"

    m2 = out["model2_news_intelligence"]
    assert m2["items_analyzed"] > 0 and m2["finbert_active"] is True
    assert len(m2["affected_channels"]) >= 4

    m3 = out["model3_market_reaction"]
    for h in ("5m", "30m", "4h", "1d"):
        hr = m3["horizons"][h]
        if hr.get("available") and hr.get("status") != "BLOCKED":
            assert hr["prob_up"] is not None and hr["prob_flat"] is not None and hr["prob_down"] is not None
            prob_sum = hr["prob_up"] + hr["prob_flat"] + hr["prob_down"]
            assert 0.98 <= prob_sum <= 1.02, f"Prob sum mismatch on {h}: {prob_sum}"
        else:
            assert hr.get("status") == "BLOCKED", f"Expected BLOCKED status on {h}"
            assert hr.get("direction") == "UNAVAILABLE", f"Expected UNAVAILABLE direction on {h}"
            assert hr.get("prob_up") is None, f"Expected null prob_up on {h}"

    m4 = out["model4_macro_regime_bias"]
    assert m4["bias"] in ("BULLISH", "BEARISH", "NEUTRAL")
    assert -100.0 <= m4["bias_score"] <= 100.0
    assert 0.0 <= m4["uncertainty"] <= 1.0
    assert len(m4["supporting_evidence"]) == 7

    print(
        json.dumps(
            {
                "status": "PASS",
                "models_verified": 4,
                "m1_indicators": list(m1.keys()),
                "m2_finbert_active": m2["finbert_active"],
                "m3_horizons": list(m3["horizons"].keys()),
                "m4_bias": m4["bias"],
                "m4_score": m4["bias_score"],
                "m4_regime": m4["regime"]["dominant_regime"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
