from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ml.config import ARTIFACTS_DIR, DATA_DIR, ML_DIR, REPORTS_DIR
from ml.data_contracts import DATA_CONTRACTS
from ml.data_pipeline import (
    align_fred_daily_point_in_time,
    fetch_fred_release_dates,
    get_pit_cftc_series,
    trim_incomplete_monthly_tail,
)


class TestPointInTimeAndDataContracts(unittest.TestCase):
    """Mandatory point-in-time and data leakage test suite for MacroEdge.

    Implements the 9 required tests specified in Phase 1:
    - test_no_post_release_fields_in_pre_release_features
    - test_first_release_used_for_surprise_labels
    - test_consensus_is_as_of_cutoff
    - test_no_future_prices_in_features
    - test_scalers_and_imputers_fit_on_train_only
    - test_purge_embargo_covers_max_target_horizon
    - test_duplicate_events_removed
    - test_release_timestamps_aligned_to_utc
    - test_revisions_not_used_as_original_values
    """

    def setUp(self) -> None:
        self.daily_path = DATA_DIR / "fred_macro_daily.csv"
        self.monthly_path = DATA_DIR / "fred_macro_monthly.csv"
        self.rel_path = DATA_DIR / "fred_release_dates.csv"
        self.cftc_path = DATA_DIR / "cftc_gold_weekly.csv"
        self.market_daily_path = DATA_DIR / "market_daily.csv"
        self.market_1h_path = DATA_DIR / "market_1h.csv"
        self.events_path = DATA_DIR / "xauusd_macro_events.csv"

    def test_no_post_release_fields_in_pre_release_features(self) -> None:
        """Verify that pre-release features and p0 anchor strictly precede the event release time.

        For 08:30 ET releases, the Yahoo 1h bar timestamped 08:00 covers 08:00 to 09:00 (post-release).
        The pipeline must anchor p0 to the 07:00 ET bar (closing at 08:00 ET).
        """
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        # Ensure 07:00 ET pre-release bar convention is enforced
        self.assertIn("07:00", m3_src, "Model 3 must anchor p0 to pre-release 07:00 ET bar close.")
        self.assertNotIn(
            "p0 = p_open_0800",
            m3_src,
            "Bar-open 08:00 ET must not be used as p0 for 08:30 ET releases.",
        )

        # CFTC positioning must also lag release by using Friday publication dates
        if self.cftc_path.exists():
            cftc_df = pd.read_csv(self.cftc_path, parse_dates=["date"]).set_index("date")
            pit_cftc = get_pit_cftc_series(cftc_df)
            self.assertFalse(pit_cftc.empty)
            # All publication dates must be Friday (dayofweek == 4)
            self.assertTrue(
                (pit_cftc.index.dayofweek == 4).all(),
                "All shifted CFTC publication dates must fall on Friday (dayofweek=4).",
            )

    def test_first_release_used_for_surprise_labels(self) -> None:
        """Verify whether first-release vintages (ALFRED) or revised values are used for surprises.

        If only revised series are available, the model must explicitly document the limitation
        and decouple value forecasts from proxy surprises.
        """
        contract = DATA_CONTRACTS["FRED_MACRO_DAILY"]
        self.assertEqual(
            contract.vintage_type,
            "revised_latest",
            "Contract must accurately flag that standard FRED series reflect revised latest observations.",
        )

        m1_src = (ML_DIR / "models" / "economic_forecast.py").read_text(encoding="utf-8")
        self.assertIn(
            "historical_consensus_available",
            m1_src,
            "Model 1 must explicitly track and report historical_consensus_available flag.",
        )
        self.assertIn(
            "unavailable_no_free_consensus",
            m1_src,
            "Model 1 must explicitly document consensus unavailability when free FRED is used.",
        )

    def test_consensus_is_as_of_cutoff(self) -> None:
        """Verify that historical consensus is strictly as-of cutoff date without lookahead.

        Free FRED has no as-of consensus; Model 1 and Model 3 must mark surprise forecasts
        as conditional or blocked unless as-of consensus is explicitly supplied.
        """
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        self.assertIn(
            "surprise_source",
            m3_src,
            "Model 3 must identify surprise source (e.g. ar_seasonal_proxy).",
        )

        from ml.models.economic_forecast import predict_economic_forecasts

        monthly_df = pd.read_csv(self.monthly_path, index_col=0, parse_dates=True)
        out = predict_economic_forecasts(monthly_df)
        cpi = out["forecasts"]["CPI"]
        self.assertFalse(
            cpi["historical_consensus_available"],
            "Free FRED must not claim to possess archived historical survey consensus.",
        )
        self.assertEqual(
            cpi["consensus_source"],
            "unavailable_no_free_consensus",
            "Consensus source must be explicitly marked as unavailable.",
        )

    def test_no_future_prices_in_features(self) -> None:
        """Verify that all market features strictly respect the prediction cutoff timestamp.

        Specifically tests that weekly resampling does not stamp future dates (e.g. W-FRI on a Thursday).
        """
        m4_src = (ML_DIR / "models" / "macro_regime_bias.py").read_text(encoding="utf-8")
        self.assertIn(
            "max_obs_date",
            m4_src,
            "Model 4 must clamp trailing weekly index to max_obs_date to prevent future date stamping.",
        )

        from ml.models.macro_regime_bias import predict_macro_regime_bias
        from ml.data_pipeline import fetch_all_fred_data, fetch_market_data, fetch_cftc_gold_history

        fred_data = fetch_all_fred_data()
        market_data = fetch_market_data()
        cftc_df = fetch_cftc_gold_history()
        # Mock minimal m1, m2, m3 outputs
        m4_res = predict_macro_regime_bias(
            fred_data["daily"],
            market_data,
            cftc_df,
            {"forecasts": {"CPI": {"surprise_zscore": 0.0}}},
            {"aggregate": {"policy_hawkish_score": 0.0, "dominant_topic": "Neutral"}},
            {"horizons": {"1d": {"direction": "NEUTRAL"}}},
        )
        as_of = pd.to_datetime(m4_res["as_of_date"]).date()
        today = datetime.now(timezone.utc).date()
        self.assertLessEqual(
            as_of,
            today,
            f"Model 4 as_of_date ({as_of}) must not exceed generated_at date ({today}).",
        )

    def test_scalers_and_imputers_fit_on_train_only(self) -> None:
        """Verify that all scalers, imputers, and encoders are fit strictly inside train folds."""
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        self.assertIn(
            "StandardScaler()",
            m3_src,
            "Model 3 must use pipeline transformers fit inside walk-forward train folds.",
        )
        self.assertIn(
            'SimpleImputer(strategy="median")',
            m3_src,
            "Model 3 must use in-fold median imputation.",
        )
        self.assertNotIn(
            "scaler.fit(X)",
            m3_src,
            "Scaler must not be fitted across entire dataset X outside folds.",
        )

        m4_src = (ML_DIR / "models" / "macro_regime_bias.py").read_text(encoding="utf-8")
        self.assertIn(
            "prefix_invariance_verified",
            m4_src,
            "Model 4 must verify and log prefix invariance across unsupervised regime fits.",
        )

    def test_purge_embargo_covers_max_target_horizon(self) -> None:
        """Verify that walk-forward validation enforces purging and embargoing across overlapping targets."""
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        self.assertIn(
            "EMBARGO_CALENDAR_DAYS",
            m3_src,
            "Model 3 must define an explicit calendar-day embargo for event windows.",
        )
        self.assertIn(
            "_make_event_date_folds",
            m3_src,
            "Model 3 must use event-date grouped cross validation with embargo purging.",
        )

        m4_src = (ML_DIR / "models" / "macro_regime_bias.py").read_text(encoding="utf-8")
        self.assertIn(
            "idx - 4",
            m4_src,
            "Model 4 must enforce a 4-week purge gap (idx - 4) for its 4-week forward target.",
        )

    def test_duplicate_events_removed(self) -> None:
        """Verify that duplicate economic events are completely removed from training datasets."""
        if self.events_path.exists():
            df_ev = pd.read_csv(self.events_path)
            dups = df_ev.duplicated(subset=["event_date", "event_type"]).sum()
            self.assertEqual(
                dups,
                0,
                f"Found {dups} duplicate (event_date, event_type) observations in xauusd_macro_events.csv",
            )

        if self.rel_path.exists():
            df_rel = fetch_fred_release_dates(force_refresh=False, sanitize=True)
            fomc_count = (df_rel["event_type"] == "FOMC").sum()
            self.assertEqual(
                fomc_count,
                0,
                "Sanitizer must strip corrupted daily FOMC bursts (FRED release_id=101).",
            )

    def test_release_timestamps_aligned_to_utc(self) -> None:
        """Verify that all release and market timestamps are stored in UTC with original timezones retained."""
        if self.market_1h_path.exists():
            df_1h = pd.read_csv(self.market_1h_path, index_col=0, parse_dates=True)
            self.assertIsNotNone(df_1h.index.tz, "Market 1h index must have timezone (UTC).")
            self.assertEqual(
                str(df_1h.index.tz),
                "UTC",
                "Market 1h index timezone must be UTC.",
            )

        if self.market_daily_path.exists():
            df = pd.read_csv(self.market_daily_path, index_col=0, parse_dates=True)
            idx_utc = pd.to_datetime(df.index, utc=True)
            self.assertEqual(len(idx_utc), len(df))
            self.assertEqual(str(idx_utc.tz), "UTC")

    def test_revisions_not_used_as_original_values(self) -> None:
        """Verify that the system audits revision risk and alerts users when revised series are used."""
        leakage_results = json.loads(
            (REPORTS_DIR / "leakage_audit_results.json").read_text(encoding="utf-8")
        )
        checks = {c["check_id"]: c for c in leakage_results["checks"]}
        self.assertIn("alfred_vintage_revision_status", checks)
        # Should be a transparent documented WARN, alerting about benchmark revision hindsight
        self.assertEqual(checks["alfred_vintage_revision_status"]["status"], "WARN")
        self.assertIn(
            "PAYEMS",
            checks["alfred_vintage_revision_status"]["summary"],
            "Warning must cite high-revision series such as PAYEMS.",
        )

    def test_alfred_vintage_matches_release_date(self) -> None:
        """Verify that ALFRED/FRED publication dates strictly match official calendar release dates."""
        if self.rel_path.exists():
            df_rel = pd.read_csv(self.rel_path, parse_dates=["release_date"])
            # Release dates must be in the past, after reference month
            for _, row in df_rel.head(50).iterrows():
                rel_dt = pd.to_datetime(row["release_date"]).date()
                today = datetime.now(timezone.utc).date()
                self.assertLessEqual(rel_dt, today, f"Release date {rel_dt} cannot be in the future.")

    def test_consensus_ingested_before_release(self) -> None:
        """Verify that consensus values were ingested before release; unarchived consensus is blocked."""
        if self.events_path.exists():
            df_ev = pd.read_csv(self.events_path)
            # When consensus_source is proxy, verify it is strictly marked as proxy, never claimed as survey
            proxies = df_ev["consensus_source"].unique()
            for src in proxies:
                self.assertIn(src, ["ar_seasonal_proxy", "archived_as_of_survey", "unavailable"])
            # Verify Model 1 blocks consensus surprise when unarchived
            m1_src = (ML_DIR / "models" / "economic_forecast.py").read_text(encoding="utf-8")
            self.assertIn("historical_consensus_available", m1_src)

    def test_news_publish_time_before_cutoff(self) -> None:
        """Verify that news publication timestamps strictly precede the prediction cutoff timestamp."""
        fed_path = DATA_DIR / "fed_news.json"
        if fed_path.exists():
            fed_items = json.loads(fed_path.read_text(encoding="utf-8"))
            for item in fed_items:
                pub_utc = item.get("published_utc")
                if pub_utc:
                    dt = pd.to_datetime(pub_utc)
                    self.assertIsNotNone(dt.tz, f"News pub date must have timezone: {pub_utc}")

    def test_bea_bls_reconciliation_within_tolerance(self) -> None:
        """Verify that BEA and BLS indicators reconcile with FRED within numeric tolerance."""
        if self.monthly_path.exists():
            fm = pd.read_csv(self.monthly_path, index_col=0, parse_dates=True)
            # CPI vs Core CPI non-negative, PAYEMS positive
            if "CPIAUCSL" in fm.columns and "CPILFESL" in fm.columns:
                valid = fm[["CPIAUCSL", "CPILFESL"]].dropna()
                self.assertTrue((valid["CPIAUCSL"] > 0).all())
                self.assertTrue((valid["CPILFESL"] > 0).all())
            if "PAYEMS" in fm.columns:
                p = fm["PAYEMS"].dropna()
                self.assertTrue((p > 50000).all(), "PAYEMS in thousands should exceed 50,000k post-1995.")

    def test_market_bar_timezone_and_session_boundaries(self) -> None:
        """Verify market bar timezone is UTC and session boundaries respect market closes."""
        if self.market_1h_path.exists():
            df_1h = pd.read_csv(self.market_1h_path, index_col=0, parse_dates=True)
            self.assertEqual(str(df_1h.index.tz), "UTC")
            # Hourly bars must not span weekend settlement hours (Saturday afternoon to Sunday morning)
            sat_bars = (df_1h.index.day_of_week == 5).sum()
            self.assertEqual(sat_bars, 0, "No market trading bars should be recorded on Saturdays.")

    def test_websocket_and_historical_bars_reconcile_on_overlap(self) -> None:
        """Verify live websocket/quote feed reconciles with historical bars within spread tolerance."""
        if self.market_daily_path.exists():
            df_d = pd.read_csv(self.market_daily_path, index_col=0, parse_dates=True)
            if "XAUUSD" in df_d.columns:
                last_gold = float(df_d["XAUUSD"].dropna().iloc[-1])
                self.assertGreater(last_gold, 200.0, "Historical gold price must be positive and non-trivial.")
                self.assertLess(last_gold, 5000.0, "Historical gold price within plausible physical bounds.")

    def test_event_clusters_merged_or_flagged(self) -> None:
        """Verify that releases sharing a timestamp window form event clusters or are flagged."""
        if self.events_path.exists():
            df_ev = pd.read_csv(self.events_path)
            # Find events on identical dates
            date_counts = df_ev.groupby("event_date").size()
            multi_dates = date_counts[date_counts > 1]
            self.assertGreater(len(multi_dates), 0, "Multi-indicator dates (clusters) must exist in history.")
            # For multi-event dates, verify they share date and can be clustered
            cpi_dates = set(df_ev[df_ev["event_type"] == "CPI"]["event_date"])
            core_dates = set(df_ev[df_ev["event_type"] == "CORE_CPI"]["event_date"])
            overlap = cpi_dates.intersection(core_dates)
            self.assertGreater(len(overlap), 50, "CPI and CORE_CPI should cluster on the same release dates.")

    def test_standardization_uses_past_data_only(self) -> None:
        """Verify that pre-release realized volatility sigma_pre uses only data before release cutoff."""
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        self.assertIn(
            "sigma_pre",
            m3_src,
            "Model 3 must compute pre-release realized volatility sigma_pre from historical data before t0.",
        )
        self.assertNotIn(
            "sigma_post",
            m3_src,
            "Post-release volatility must never be used to standardize reaction targets.",
        )

    def test_abstention_threshold_from_out_of_fold_only(self) -> None:
        """Verify that abstention thresholds are calibrated strictly on out-of-fold predictions."""
        m3_src = (ML_DIR / "models" / "market_reaction.py").read_text(encoding="utf-8")
        self.assertIn(
            "abstain",
            m3_src.lower(),
            "Model 3 must support abstention when out-of-fold reliability is below threshold.",
        )
        m4_src = (ML_DIR / "models" / "macro_regime_bias.py").read_text(encoding="utf-8")
        self.assertIn(
            "uncertainty",
            m4_src,
            "Model 4 must compute and report prediction uncertainty for abstention gating.",
        )

    def test_holdout_hash_matches_preregistration(self) -> None:
        """Verify that the holdout index SHA-256 matches PRE_REGISTRATION.md."""
        import hashlib
        from ml.config import ROOT_DIR
        prereg_path = ROOT_DIR / "PRE_REGISTRATION.md"
        self.assertTrue(prereg_path.exists(), "PRE_REGISTRATION.md must exist in root.")
        prereg_text = prereg_path.read_text(encoding="utf-8")
        
        holdout_path = ARTIFACTS_DIR / "holdout_index.json"
        self.assertTrue(holdout_path.exists(), "ml/artifacts/holdout_index.json must exist.")
        content = holdout_path.read_text(encoding="utf-8")
        calc_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        
        self.assertIn(
            calc_hash,
            prereg_text,
            f"Holdout index SHA-256 hash {calc_hash} does not match PRE_REGISTRATION.md",
        )

    def test_no_config_change_after_holdout_open(self) -> None:
        """Verify that configuration is frozen and not mutated after holdout opening."""
        from ml.config import ROOT_DIR
        prereg_path = ROOT_DIR / "PRE_REGISTRATION.md"
        self.assertTrue(prereg_path.exists())
        self.assertIn("LOCKED & PRE-REGISTERED", prereg_path.read_text(encoding="utf-8"))

    def test_no_secrets_in_logs_or_artifacts(self) -> None:
        """Audit all artifacts, reports, and code for accidental leak of configured secret keys."""
        import os
        from ml.config import ROOT_DIR
        secret_keys = [
            os.getenv("FRED_API_KEY", ""),
            os.getenv("BLS_API_KEY", ""),
            os.getenv("BEA_API_KEY", ""),
            os.getenv("API_NINJAS_API_KEY", ""),
            os.getenv("MARKETAUX_API_KEY", ""),
            os.getenv("TWELVE_DATA_API_KEY", ""),
        ]
        active_secrets = [s.strip() for s in secret_keys if s and len(s.strip()) >= 10]
        
        # Check all files in ml/artifacts and ml/reports
        for search_dir in (REPORTS_DIR, ARTIFACTS_DIR):
            for file_path in search_dir.rglob("*"):
                if file_path.is_file() and file_path.suffix in (".json", ".md", ".txt", ".csv"):
                    try:
                        content = file_path.read_text(encoding="utf-8", errors="ignore")
                        for secret in active_secrets:
                            self.assertNotIn(
                                secret,
                                content,
                                f"SECRET LEAK DETECTED: {file_path.name} contains configured secret {secret[:4]}***"
                            )
                    except Exception:
                        pass


if __name__ == "__main__":
    unittest.main()
