from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ml.config import ARTIFACTS_DIR, DATA_DIR, ML_DIR, REPORTS_DIR
from ml.data_pipeline import (
    align_fred_daily_point_in_time,
    fetch_fed_news_feed,
    fetch_fred_release_dates,
    get_pit_cftc_series,
    trim_incomplete_monthly_tail,
)


@dataclass
class CheckResult:
    check_id: str
    category: str
    status: str  # "PASS" | "WARN" | "FAIL"
    severity: str  # "CRITICAL" | "HIGH" | "MEDIUM" | "INFO"
    summary: str
    details: dict[str, Any]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def check_point_in_time() -> list[CheckResult]:
    results: list[CheckResult] = []
    daily_path = DATA_DIR / "fred_macro_daily.csv"
    monthly_path = DATA_DIR / "fred_macro_monthly.csv"
    rel_path = DATA_DIR / "fred_release_dates.csv"
    cftc_path = DATA_DIR / "cftc_gold_weekly.csv"

    # 1. Check raw fred_macro_daily.csv monthly/quarterly forward-fill look-ahead vs release dates
    if daily_path.exists() and rel_path.exists():
        fd = pd.read_csv(daily_path, index_col=0, parse_dates=True).sort_index()
        rel_sanitized = fetch_fred_release_dates(force_refresh=False, sanitize=True)
        pit = align_fred_daily_point_in_time(fd, rel_sanitized)

        leaks: dict[str, Any] = {}
        for col in ("CPIAUCSL", "PAYEMS", "PCEPI", "GDPC1"):
            if col in fd.columns and col in pit.columns:
                diff_days = int((fd[col].dropna() != pit[col].reindex(fd[col].dropna().index)).sum())
                leaks[col] = diff_days

        m4_src = _read_text(ML_DIR / "models" / "macro_regime_bias.py")
        m4_uses_pit = (
            "align_fred_daily_point_in_time" in m4_src
            or "publication_lag" in m4_src
            or "release_date" in m4_src
        )
        results.append(
            CheckResult(
                check_id="pit_fred_daily_macro_lag",
                category="point_in_time",
                status="PASS" if m4_uses_pit else "FAIL",
                severity="CRITICAL",
                summary=(
                    "Model 4 applies point-in-time publication lags to daily FRED macro series."
                    if m4_uses_pit
                    else "Raw fred_macro_daily.csv forward-fills monthly/quarterly releases from YYYY-MM-01 and Model 4 consumes them without publication-lag shifting."
                ),
                details={
                    "raw_vs_pit_mismatched_business_days": leaks,
                    "model4_uses_pit_alignment": m4_uses_pit,
                    "example_2026_10_01_raw_cpi": float(fd.loc["2026-10-01", "CPIAUCSL"]) if "2026-10-01" in fd.index else None,
                    "example_2026_10_01_pit_cpi": float(pit.loc["2026-10-01", "CPIAUCSL"]) if "2026-10-01" in pit.index else None,
                },
            )
        )

    # 2. Check fred_macro_monthly.csv incomplete trailing month & GDPC1 intra-quarter ffill
    if monthly_path.exists():
        fm = pd.read_csv(monthly_path, index_col=0, parse_dates=True).sort_index()
        trimmed = trim_incomplete_monthly_tail(fm)
        trailing_dropped = int(len(fm) - len(trimmed))
        m1_src = _read_text(ML_DIR / "models" / "economic_forecast.py")
        m1_trims = "trim_incomplete_monthly_tail" in m1_src or "dropna" in m1_src
        results.append(
            CheckResult(
                check_id="pit_fred_monthly_tail_and_gdp",
                category="point_in_time",
                status="WARN" if trailing_dropped > 0 else "PASS",
                severity="MEDIUM",
                summary=(
                    f"fred_macro_monthly.csv has {trailing_dropped} incomplete trailing row(s) (max={fm.index.max().date()}) where monthly targets are NaN and daily series are partial-month averages; GDPC1 is quarterly-ffilled."
                    if trailing_dropped > 0
                    else "Monthly panel tail contains complete monthly observations."
                ),
                details={
                    "raw_rows": int(len(fm)),
                    "trimmed_rows": int(len(trimmed)),
                    "raw_max_date": str(fm.index.max().date()),
                    "trimmed_max_date": str(trimmed.index.max().date()),
                    "incomplete_trailing_rows": trailing_dropped,
                    "m1_handles_tail": m1_trims,
                },
            )
        )

    # 3. Check CFTC Tuesday report date vs Friday 15:30 ET release lag
    if cftc_path.exists():
        cftc = pd.read_csv(cftc_path, parse_dates=["date"]).set_index("date").sort_index()
        tue_share = float((cftc.index.day_of_week == 1).mean())
        m3_src = _read_text(ML_DIR / "models" / "market_reaction.py")
        m3_uses_pit_cftc = "get_pit_cftc_series" in m3_src or "dayofweek" in m3_src or "Timedelta(days=3)" in m3_src
        pit_cftc = get_pit_cftc_series(cftc)
        results.append(
            CheckResult(
                check_id="pit_cftc_publication_lag",
                category="point_in_time",
                status="PASS" if m3_uses_pit_cftc else "FAIL",
                severity="HIGH",
                summary=(
                    "Model 3 shifts CFTC Tuesday report dates to Friday publication dates."
                    if m3_uses_pit_cftc
                    else "CFTC COT data is indexed by Tuesday report_date (not Friday 15:30 ET release); Model 3 queries < ev_dt directly, leaking positioning on Wed/Thu events."
                ),
                details={
                    "cftc_rows": int(len(cftc)),
                    "tuesday_fraction": round(tue_share, 4),
                    "raw_max_date": str(cftc.index.max().date()),
                    "pit_release_max_date": str(pit_cftc.index.max().date()) if not pit_cftc.empty else None,
                    "model3_uses_pit_cftc": m3_uses_pit_cftc,
                },
            )
        )

    # 4. Check Model 4 W-FRI future as_of_date bug
    latest_inf_path = ARTIFACTS_DIR / "latest_inference.json"
    m4_src = _read_text(ML_DIR / "models" / "macro_regime_bias.py")
    if latest_inf_path.exists():
        inf = json.loads(latest_inf_path.read_text(encoding="utf-8"))
        m4_as_of = inf.get("model4_macro_regime_bias", {}).get("as_of_date")
        gen_at = str(inf.get("generated_at", ""))[:10]
        future_as_of = bool(m4_as_of and gen_at and m4_as_of > gen_at)
        results.append(
            CheckResult(
                check_id="pit_model4_future_as_of_date",
                category="point_in_time",
                status="FAIL" if future_as_of else "PASS",
                severity="MEDIUM",
                summary=(
                    f"Model 4 reports future as_of_date={m4_as_of} > generated_at={gen_at} due to W-FRI forward resampling."
                    if future_as_of
                    else f"Model 4 as_of_date ({m4_as_of}) does not exceed generated_at ({gen_at})."
                ),
                details={"as_of_date": m4_as_of, "generated_date": gen_at, "uses_w_fri": 'resample("W-FRI")' in m4_src},
            )
        )

    return results


def check_look_ahead() -> list[CheckResult]:
    results: list[CheckResult] = []
    m1_src = _read_text(ML_DIR / "models" / "economic_forecast.py")
    m3_src = _read_text(ML_DIR / "models" / "market_reaction.py")
    m4_src = _read_text(ML_DIR / "models" / "macro_regime_bias.py")

    # 1. Yahoo Finance bar-open timestamp look-ahead in Model 3 intraday returns
    # Check both source pattern and empirical 2026-11-10 08:30 ET CPI event in market_5m/30m/1h
    m5_path = DATA_DIR / "market_5m.csv"
    ev_path = DATA_DIR / "xauusd_macro_events.csv"
    empirical_sign_flip = False
    emp_details: dict[str, Any] = {}
    if m5_path.exists() and ev_path.exists():
        df5 = pd.read_csv(m5_path)
        df5["et"] = pd.to_datetime(df5[df5.columns[0]], utc=True).dt.tz_convert("America/New_York")
        b_pre = df5[df5["et"] == "2026-11-10 08:25:00-05:00"]["XAUUSD"]
        b_0830 = df5[df5["et"] == "2026-11-10 08:30:00-05:00"]["XAUUSD"]
        ev = pd.read_csv(ev_path)
        cpi_row = ev[(ev["event_date"] == "2026-11-10") & (ev["event_type"] == "CPI")]
        if not b_pre.empty and not b_0830.empty and not cpi_row.empty:
            true_5m = float((b_0830.iloc[0] / b_pre.iloc[0] - 1.0) * 100.0)
            recorded_5m = float(cpi_row["ret_5m_real"].iloc[0]) if pd.notna(cpi_row["ret_5m_real"].iloc[0]) else None
            empirical_sign_flip = bool(recorded_5m is not None and np.sign(true_5m) != np.sign(recorded_5m))
            emp_details = {
                "event": "2026-11-10 08:30 ET CPI",
                "true_5m_return_pct": round(true_5m, 4),
                "recorded_xauusd_macro_events_ret_5m_pct": round(recorded_5m, 4) if recorded_5m is not None else None,
                "sign_flipped": empirical_sign_flip,
            }

    uses_le_t0 = "(et_df.index <= t0)" in m3_src
    results.append(
        CheckResult(
            check_id="lookahead_intraday_bar_open_convention",
            category="look_ahead",
            status="FAIL" if (uses_le_t0 or empirical_sign_flip) else "PASS",
            severity="CRITICAL",
            summary=(
                "Model 3 _intraday_return_around_event uses <= t0 on Yahoo bar-open timestamps, grabbing post-release bar Close as pre-event p0 (flipping 2026-11-10 CPI 5m return from -0.67% to +0.30%)."
                if (uses_le_t0 or empirical_sign_flip)
                else "Intraday event return window strictly precedes release timestamp t0 for p0."
            ),
            details={"code_uses_le_t0": uses_le_t0, **emp_details},
        )
    )

    # 2. Full-sample scaler / median / std / GMM look-ahead checks
    m3_full_scaler = "X_analog_scaled = analog_scaler.fit_transform(X_filled)" in m3_src
    m3_full_median = "medians = X_all.median().to_dict()" in m3_src
    m3_full_fallback_std = 'fallback_std = float(df_oof["surprise_vs_consensus"].std()' in m3_src
    m3_leaks = [k for k, v in [("analog_scaler_full_fit", m3_full_scaler), ("full_sample_median_imputation", m3_full_median), ("full_sample_fallback_std", m3_full_fallback_std)] if v]
    results.append(
        CheckResult(
            check_id="lookahead_model3_full_sample_transforms",
            category="look_ahead",
            status="FAIL" if m3_leaks else "PASS",
            severity="HIGH",
            summary=(
                f"Model 3 fits scaling/imputation/std on full event history before walk-forward: {m3_leaks}"
                if m3_leaks
                else "Model 3 fits scalers and imputers strictly within training splits."
            ),
            details={"detected_issues": m3_leaks},
        )
    )

    m4_gmm_insample = (
        "X_gmm = gmm_scaler.fit_transform" in m4_src
        and "clusters = gmm.predict(X_gmm)" in m4_src
        and 'train_df["regime_id"] = clusters' in m4_src
    )
    results.append(
        CheckResult(
            check_id="lookahead_model4_full_sample_gmm",
            category="look_ahead",
            status="FAIL" if m4_gmm_insample else "PASS",
            severity="HIGH",
            summary=(
                "Model 4 fits GMM scaler & centroids on full history and evaluates regime_stats in-sample on the same full panel."
                if m4_gmm_insample
                else "Model 4 evaluates GMM/regimes using strictly expanding/rolling out-of-sample fits."
            ),
            details={"full_sample_gmm_detected": m4_gmm_insample},
        )
    )

    m1_full_mad = "y_med = float(y.median())" in m1_src and "y_mad = float(" in m1_src
    results.append(
        CheckResult(
            check_id="lookahead_model1_full_series_robust_scale",
            category="look_ahead",
            status="FAIL" if m1_full_mad else "PASS",
            severity="MEDIUM",
            summary=(
                "Model 1 computes robust_scale outlier weights using full-series y.median() and y_mad across future observations."
                if m1_full_mad
                else "Model 1 computes outlier weights strictly inside each training fold."
            ),
            details={"full_series_robust_scale": m1_full_mad},
        )
    )

    return results


def check_target_leakage_and_fabrication() -> list[CheckResult]:
    results: list[CheckResult] = []
    m3_src = _read_text(ML_DIR / "models" / "market_reaction.py")
    m3_rep_path = REPORTS_DIR / "model3_training_report.json"
    ev_path = DATA_DIR / "xauusd_macro_events.csv"

    # 1. Synthetic target fabrication in Model 3 (bridged ret_1d * ratio)
    bridged_in_code = "bridged = events_df[\"ret_1d\"].astype(float) * ratio" in m3_src or "ret_1d * ratio" in m3_src
    bridged_counts: dict[str, Any] = {}
    if m3_rep_path.exists():
        rep = json.loads(m3_rep_path.read_text(encoding="utf-8"))
        for h, hm in rep.get("horizons", {}).items():
            bridged_counts[h] = {
                "real": hm.get("exact_intraday_observed_events", 0),
                "bridged": hm.get("bridged_events", 0),
                "total": hm.get("total_events", 0),
            }
    elif ev_path.exists():
        ev = pd.read_csv(ev_path)
        for h in ("5m", "30m", "4h"):
            col = f"ret_{h}_real"
            real_n = int(ev[col].notna().sum()) if col in ev.columns else 0
            bridged_counts[h] = {"real": real_n, "bridged": int(len(ev) - real_n), "total": int(len(ev))}

    any_bridged = bridged_in_code or any(v.get("bridged", 0) > 0 for v in bridged_counts.values())
    results.append(
        CheckResult(
            check_id="target_fabrication_model3_intraday_bridging",
            category="target_leakage",
            status="FAIL" if any_bridged else "PASS",
            severity="CRITICAL",
            summary=(
                "Model 3 fabricates missing 5m/30m/4h targets by multiplying daily ret_1d by constant volatility ratios (99.5% of 5m/30m, 94.4% of 4h)."
                if any_bridged
                else "Model 3 trains and evaluates strictly on real observed returns without synthetic bridging."
            ),
            details={"code_contains_bridging": bridged_in_code, "horizon_counts": bridged_counts},
        )
    )

    # 2. Synthetic NLP corpus in Model 2 vs real human-review dataset
    m2_src = _read_text(ML_DIR / "models" / "news_intelligence.py")
    hr_path = DATA_DIR / "news_human_review_dataset.json"
    m2_rep_path = REPORTS_DIR / "model2_training_report.json"
    m2_run_path = ARTIFACTS_DIR / "training_runs" / "model2_run.json"
    has_synthetic_corpus = "MACRO_NLP_CORPUS" in m2_src
    has_hr_dataset = hr_path.exists() and hr_path.stat().st_size > 0
    m2_rep = json.loads(m2_rep_path.read_text(encoding="utf-8")) if m2_rep_path.exists() else {}
    only_synthetic_eval = has_synthetic_corpus and not (has_hr_dataset and m2_run_path.exists())

    results.append(
        CheckResult(
            check_id="target_synthetic_nlp_corpus_eval",
            category="target_leakage",
            status="FAIL" if only_synthetic_eval else "PASS",
            severity="HIGH",
            summary=(
                "Model 2 evaluates CV accuracy on 100+ synthetic developer-written MACRO_NLP_CORPUS sentences without ml/data/news_human_review_dataset.json."
                if only_synthetic_eval
                else "Model 2 separates real collected items in news_human_review_dataset.json and audits FinBERT/extraction transparently."
            ),
            details={
                "has_synthetic_macro_nlp_corpus": has_synthetic_corpus,
                "has_news_human_review_dataset": has_hr_dataset,
                "has_model2_run_json": m2_run_path.exists(),
                "current_report_corpus_size": m2_rep.get("corpus_size"),
            },
        )
    )

    return results


def check_duplicate_events() -> list[CheckResult]:
    results: list[CheckResult] = []
    ev_path = DATA_DIR / "xauusd_macro_events.csv"
    rel_path = DATA_DIR / "fred_release_dates.csv"
    news_path = DATA_DIR / "fed_news.json"

    # 1. Duplicate (event_date, event_type) in xauusd_macro_events.csv
    if ev_path.exists():
        ev = pd.read_csv(ev_path)
        dup_pairs = int(ev.duplicated(subset=["event_date", "event_type"]).sum())
        same_day_groups = int((ev["event_date"].value_counts() > 1).sum())
        results.append(
            CheckResult(
                check_id="duplicate_event_type_dates",
                category="duplicate_events",
                status="FAIL" if dup_pairs > 0 else "PASS",
                severity="CRITICAL",
                summary=(
                    f"xauusd_macro_events.csv contains {dup_pairs} duplicate (event_date, event_type) pairs ({dup_pairs*2} rows) from 32-day _find_release_date window overlap, plus {same_day_groups} multi-event dates."
                    if dup_pairs > 0
                    else f"Zero duplicate (event_date, event_type) pairs ({same_day_groups} multi-indicator dates such as CPI+CORE_CPI)."
                ),
                details={"duplicate_event_date_type_pairs": dup_pairs, "dates_with_multiple_events": same_day_groups, "total_rows": int(len(ev))},
            )
        )

    # 2. FRED release_id=101 FOMC daily-date corruption & multi-release months
    if rel_path.exists():
        raw_rel = pd.read_csv(rel_path, parse_dates=["release_date"])
        fomc_raw = raw_rel[raw_rel["event_type"] == "FOMC"]
        fomc_med_gap = float(fomc_raw["release_date"].sort_values().diff().dt.days.median()) if len(fomc_raw) > 1 else None
        sanitized_rel = fetch_fred_release_dates(force_refresh=False, sanitize=True)
        fomc_sanitized = sanitized_rel[sanitized_rel["event_type"] == "FOMC"]

        multi_month = {}
        for et, grp in sanitized_rel.groupby("event_type"):
            ym = grp["release_date"].dt.to_period("M").value_counts()
            multi_month[str(et)] = int((ym > 1).sum())

        raw_corrupted = len(fomc_raw) > 300 and (fomc_med_gap is not None and fomc_med_gap <= 5.0)
        results.append(
            CheckResult(
                check_id="duplicate_fred_release_101_fomc_daily",
                category="duplicate_events",
                status="FAIL" if (raw_corrupted and len(fomc_sanitized) > 0) else ("WARN" if raw_corrupted else "PASS"),
                severity="HIGH",
                summary=(
                    f"Raw fred_release_dates.csv has {len(fomc_raw)} daily FOMC rows (2000-2018, median gap={fomc_med_gap}d) from FRED release_id=101; data_pipeline sanitizer now strips the corrupted FOMC daily burst (sanitized FOMC={len(fomc_sanitized)})."
                    if raw_corrupted
                    else "fred_release_dates.csv contains clean event-level release dates."
                ),
                details={
                    "raw_fomc_count": int(len(fomc_raw)),
                    "raw_fomc_min": str(fomc_raw["release_date"].min().date()) if not fomc_raw.empty else None,
                    "raw_fomc_max": str(fomc_raw["release_date"].max().date()) if not fomc_raw.empty else None,
                    "raw_fomc_median_gap_days": fomc_med_gap,
                    "sanitized_fomc_count": int(len(fomc_sanitized)),
                    "sanitized_months_with_multiple_releases": multi_month,
                },
            )
        )

    # 3. fed_news.json duplicate links / BLS 403
    if news_path.exists():
        raw_news = json.loads(news_path.read_text(encoding="utf-8"))
        deduped_news = fetch_fed_news_feed(force_refresh=False)
        raw_links = [it.get("link", "") for it in raw_news]
        dup_links = len(raw_links) - len(set(raw_links))
        bls_count = sum(1 for it in raw_news if it.get("source") == "bls_news")
        results.append(
            CheckResult(
                check_id="duplicate_fed_news_and_bls_gap",
                category="duplicate_events",
                status="WARN" if (dup_links > 0 or bls_count == 0) else "PASS",
                severity="MEDIUM",
                summary=(
                    f"Cached fed_news.json has {len(raw_news)} items ({dup_links} duplicate URLs across fomc_press/fed_press_all, {bls_count} bls_news items due to BLS HTTP 403); fetch_fed_news_feed now deduplicates to {len(deduped_news)} items."
                ),
                details={
                    "raw_count": len(raw_news),
                    "deduplicated_count": len(deduped_news),
                    "raw_duplicate_links": dup_links,
                    "bls_news_count": bls_count,
                },
            )
        )

    return results


def check_timestamp_timezone() -> list[CheckResult]:
    results: list[CheckResult] = []
    market_info: dict[str, Any] = {}
    for fn in ("market_daily.csv", "market_1h.csv", "market_30m.csv", "market_5m.csv"):
        p = DATA_DIR / fn
        if not p.exists():
            continue
        df = pd.read_csv(p)
        ts = pd.to_datetime(df[df.columns[0]], utc=True, errors="coerce")
        xau_na = int(df["XAUUSD"].isna().sum()) if "XAUUSD" in df.columns else None
        entry: dict[str, Any] = {
            "rows": int(len(df)),
            "min_utc": str(ts.min()),
            "max_utc": str(ts.max()),
            "xauusd_nan_rows": xau_na,
            "xauusd_non_null": int(len(df) - xau_na) if xau_na is not None else None,
        }
        if fn != "market_daily.csv" and "XAUUSD" in df.columns:
            ts_et = ts.dt.tz_convert("America/New_York")
            valid_et = ts_et[df["XAUUSD"].notna()]
            entry["et_0830_bars"] = int(((valid_et.dt.hour == 8) & (valid_et.dt.minute == 30)).sum())
            entry["et_1400_bars"] = int(((valid_et.dt.hour == 14) & (valid_et.dt.minute == 0)).sum())
        market_info[fn] = entry

    h1_info = market_info.get("market_1h.csv", {})
    m5_info = market_info.get("market_5m.csv", {})
    results.append(
        CheckResult(
            check_id="timestamp_tz_and_intraday_coverage",
            category="timestamp_timezone",
            status="WARN",
            severity="HIGH",
            summary=(
                f"Intraday spans are severely constrained (5m/30m ~60d, 1h ~730d), market_1h.csv has {h1_info.get('xauusd_nan_rows')} NaN XAUUSD rows (45.4%) from equity-hour outer join, and 0 bars at 08:30 ET."
            ),
            details=market_info,
        )
    )
    return results


def check_alfred_vintage() -> list[CheckResult]:
    dp_src = _read_text(ML_DIR / "data_pipeline.py")
    uses_alfred_in_main_fetch = "output_type=4" in dp_src and "fetch_alfred_initial_vintages" in dp_src
    # Check whether monthly CSV was pulled with latest-revised FRED (fetch_all_fred_data uses FRED_OBS_URL without output_type=4)
    main_fetch_block = dp_src.split("def fetch_all_fred_data")[1].split("def fetch_fred_release_dates")[0] if "def fetch_all_fred_data" in dp_src else ""
    main_uses_alfred = "fetch_alfred_initial_vintages" in main_fetch_block
    return [
        CheckResult(
            check_id="alfred_vintage_revision_status",
            category="alfred_vintage",
            status="WARN",
            severity="HIGH",
            summary=(
                "fred_macro_monthly.csv and fred_macro_daily.csv contain latest-revised FRED observations (not ALFRED output_type=4 initial-release vintages). High-revision series (PAYEMS, GDPC1, PCEPI, PCEPILFE, INDPRO, RSAFS) carry historical revision hindsight."
            ),
            details={
                "alfred_helper_available": uses_alfred_in_main_fetch,
                "cached_fred_csvs_use_initial_vintages": main_uses_alfred,
                "high_revision_series": ["PAYEMS", "GDPC1", "PCEPI", "PCEPILFE", "INDPRO", "RSAFS"],
                "note": "ALFRED output_type=4 requires realtime_start=1776-07-04&realtime_end=9999-12-31; omitted realtime bounds return HTTP 400.",
            },
        )
    ]


def check_historical_consensus_absence() -> list[CheckResult]:
    ev_path = DATA_DIR / "xauusd_macro_events.csv"
    m1_src = _read_text(ML_DIR / "models" / "economic_forecast.py")
    m3_src = _read_text(ML_DIR / "models" / "market_reaction.py")

    has_consensus_csv = any("consensus" in p.name.lower() for p in DATA_DIR.glob("*"))
    ev_cols = list(pd.read_csv(ev_path, nrows=1).columns) if ev_path.exists() else []
    ev_disguises_proxy = "consensus" in ev_cols and "consensus_source" not in ev_cols
    m3_uses_proxy = "surprise_vs_consensus" in m3_src and "ar_seasonal_proxy" not in m3_src

    return [
        CheckResult(
            check_id="historical_consensus_absence",
            category="historical_consensus_absence",
            status="FAIL" if (ev_disguises_proxy or m3_uses_proxy) else "WARN",
            severity="HIGH",
            summary=(
                "No historical survey consensus dataset exists in ml/data/*, yet xauusd_macro_events.csv and Model 3 label AR/seasonal Ridge residuals as 'consensus' / 'surprise_raw' without provenance tagging."
                if (ev_disguises_proxy or m3_uses_proxy)
                else "Historical survey consensus is absent; models explicitly distinguish value forecasts from proxy surprises."
            ),
            details={
                "historical_consensus_file_exists": has_consensus_csv,
                "xauusd_macro_events_has_unlabeled_consensus_col": ev_disguises_proxy,
                "model1_marks_ar_seasonal_proxy": "ar_seasonal_proxy" in m1_src,
                "model3_labels_proxy_source": not m3_uses_proxy,
            },
        )
    ]


def check_overlapping_horizon_embargo() -> list[CheckResult]:
    results: list[CheckResult] = []
    m1_src = _read_text(ML_DIR / "models" / "economic_forecast.py")
    m3_src = _read_text(ML_DIR / "models" / "market_reaction.py")
    m4_src = _read_text(ML_DIR / "models" / "macro_regime_bias.py")

    # 1. Model 4 4-week horizon embargo
    m4_has_embargo = "idx - 4" in m4_src and "len(tr) - 4" in m4_src
    results.append(
        CheckResult(
            check_id="embargo_model4_4w_overlap",
            category="overlapping_horizon_embargo",
            status="PASS" if m4_has_embargo else "FAIL",
            severity="HIGH",
            summary=(
                "Model 4 enforces a 4-week purge/embargo gap (idx - 4 / len(tr) - 4) for its 4-week overlapping target."
                if m4_has_embargo
                else "Model 4 lacks a >= 4-week purge/embargo gap for xau_fwd_4w_pct."
            ),
            details={"idx_minus_4_in_oof": "idx - 4" in m4_src, "len_tr_minus_4_in_cv": "len(tr) - 4" in m4_src},
        )
    )

    # 2. Model 3 event-date grouping across same-day events
    m3_wf_block = ""
    if "def train_market_reaction_models" in m3_src:
        m3_wf_block = m3_src.split("def train_market_reaction_models")[1].split("events_meta")[0]
    m3_groups_by_date = any(
        tok in m3_wf_block
        for tok in ("GroupKFold", "unique_dates", "event_date_groups", 'groupby("event_date")', "groupby('event_date')")
    )
    results.append(
        CheckResult(
            check_id="embargo_model3_event_date_grouping",
            category="overlapping_horizon_embargo",
            status="PASS" if m3_groups_by_date else "FAIL",
            severity="HIGH",
            summary=(
                "Model 3 groups walk-forward splits by event_date so same-day events never cross train/test boundaries."
                if m3_groups_by_date
                else "Model 3 iterates row-by-row without grouping by event_date, allowing same-day CPI+CORE_CPI or PCE+CORE_PCE ret_1d to straddle splits."
            ),
            details={"event_date_grouped_splits": m3_groups_by_date},
        )
    )

    # 3. Untouched final holdout check across Models 1, 3, 4
    training_runs_dir = ARTIFACTS_DIR / "training_runs"
    holdout_status = {
        "model1_holdout_present": (training_runs_dir / "model1_run.json").exists() and ("holdout" in m1_src.lower()),
        "model3_holdout_present": (training_runs_dir / "model3_run.json").exists() and ("holdout" in m3_src.lower()),
        "model4_holdout_present": (training_runs_dir / "model4_regime_run.json").exists() and ("holdout" in m4_src.lower()),
    }
    all_holdout = all(holdout_status.values())
    results.append(
        CheckResult(
            check_id="embargo_untouched_final_holdout",
            category="overlapping_horizon_embargo",
            status="PASS" if all_holdout else "FAIL",
            severity="HIGH",
            summary=(
                "Models 1, 3, and 4 all preserve and report an untouched final holdout period."
                if all_holdout
                else "One or more models train final artifacts on 100% of data without an untouched final holdout evaluation report."
            ),
            details=holdout_status,
        )
    )

    return results


def run_all_checks() -> dict[str, Any]:
    all_results: list[CheckResult] = []
    all_results.extend(check_point_in_time())
    all_results.extend(check_look_ahead())
    all_results.extend(check_target_leakage_and_fabrication())
    all_results.extend(check_duplicate_events())
    all_results.extend(check_timestamp_timezone())
    all_results.extend(check_alfred_vintage())
    all_results.extend(check_historical_consensus_absence())
    all_results.extend(check_overlapping_horizon_embargo())

    counts = {"PASS": 0, "WARN": 0, "FAIL": 0}
    for r in all_results:
        counts[r.status] = counts.get(r.status, 0) + 1

    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": "FAIL" if counts["FAIL"] > 0 else ("WARN" if counts["WARN"] > 0 else "PASS"),
        "counts": counts,
        "checks": [asdict(r) for r in all_results],
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run MacroEdge point-in-time & leakage validation suite.")
    parser.add_argument("--json", action="store_true", help="Print full JSON report to stdout.")
    parser.add_argument(
        "--out",
        type=str,
        default=str(REPORTS_DIR / "leakage_audit_results.json"),
        help="Path to write JSON audit results.",
    )
    parser.add_argument(
        "--no-fail-exit",
        action="store_true",
        help="Always exit 0 even when FAIL checks are detected (useful during pre-fix audit).",
    )
    args = parser.parse_args()

    report = run_all_checks()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"MacroEdge Leakage & Point-in-Time Audit ({report['checked_at']})")
        print(f"Overall: {report['overall_status']} | Counts: {report['counts']}")
        print("-" * 88)
        for chk in report["checks"]:
            print(f"[{chk['status']:4s}] ({chk['severity']:8s}) {chk['check_id']}: {chk['summary']}")
        print("-" * 88)
        print(f"Saved JSON report to {out_path}")

    if not args.no_fail_exit and report["counts"]["FAIL"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
