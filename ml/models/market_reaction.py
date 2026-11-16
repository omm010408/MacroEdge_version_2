from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, QuantileRegressor, Ridge
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    log_loss,
    mean_absolute_error,
    precision_recall_fscore_support,
    r2_score,
    roc_auc_score,
    root_mean_squared_error,
)
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier, XGBRegressor

from ml.config import ARTIFACTS_DIR, DATA_DIR, REPORTS_DIR
from ml.data_pipeline import get_pit_cftc_series, match_release_dates_to_ref_months
from ml.models.economic_forecast import MODEL1_DIR

MODEL3_CANONICAL_DIR = ARTIFACTS_DIR / "market_reaction"
MODEL3_COMPAT_DIR = ARTIFACTS_DIR / "model3_market_reaction"
MODEL3_DIR = MODEL3_COMPAT_DIR  # backwards-compatible alias
TRAINING_RUNS_DIR = ARTIFACTS_DIR / "training_runs"

for _d in (MODEL3_CANONICAL_DIR, MODEL3_COMPAT_DIR, TRAINING_RUNS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

TRAINABLE_INDICATORS = ("CPI", "CORE_CPI", "PCE", "CORE_PCE", "NFP")
BLOCKED_EVENT_TYPES = ("FOMC",)

HORIZONS = ("5m", "30m", "4h", "1d")

FLAT_THRESHOLDS = {
    "5m": 0.08,
    "30m": 0.12,
    "4h": 0.20,
    "1d": 0.25,
}

# Minimum real observed sample requirements to train/validate a horizon without bridging.
MIN_REAL_EVENTS_FOR_TRAINING = 50
MIN_UNIQUE_DATES_FOR_TRAINING = 30
EMBARGO_CALENDAR_DAYS = 2
QUANTILE_ALPHAS = (0.10, 0.25, 0.50, 0.75, 0.90)

# Clean feature set with full 2002/2003-2026 historical coverage (BAMLH0A0HYM2 excluded due to
# 2023-11 start date to avoid future-median backfilling onto 2002-2023 events).
FEATURE_COLS = [
    "is_cpi",
    "is_core_cpi",
    "is_pce",
    "is_core_pce",
    "is_nfp",
    "surprise_z",
    "abs_surprise_z",
    "xau_ret_1d",
    "xau_ret_5d",
    "xau_ret_20d",
    "xau_rsi_14",
    "xau_dist_sma50",
    "xau_vol_20d",
    "xau_vol_ratio_5d_20d",
    "dxy_ret_1d",
    "dxy_ret_5d",
    "dxy_z_60d",
    "us10y_level",
    "us10y_chg_5d",
    "real10y_level",
    "real10y_chg_1d",
    "real10y_chg_5d",
    "real10y_z_60d",
    "breakeven_10y_chg_5d",
    "vix_level",
    "vix_chg_5d",
    "spx_ret_5d",
    "yield_curve_2s10s",
    "xau_dxy_corr_20d",
    "xau_real10y_corr_20d",
    "cot_gold_pct",
    "cot_gold_chg_4w",
    "surprise_x_real10y",
    "surprise_x_dxy",
    "surprise_x_vix",
    "surprise_x_vol",
]


def _to_eastern(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    idx = pd.to_datetime(out.index, utc=True)
    out.index = idx.tz_convert("America/New_York")
    return out.sort_index()


def _lookup_prior_value(series: pd.Series, dt: pd.Timestamp) -> float:
    sub = series.loc[series.index < dt].dropna()
    if sub.empty:
        return np.nan
    return float(sub.iloc[-1])


def _compute_rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0).rolling(window).mean()
    loss = (-delta.clip(upper=0.0)).rolling(window).mean().replace(0, np.nan)
    rs = gain / loss
    return 100.0 - (100.0 / (1.0 + rs))


def _intraday_return_around_event(
    et_df: pd.DataFrame,
    event_date: pd.Timestamp,
    release_time_str: str,
    bar_minutes: int,
    minutes_forward: int,
) -> float | None:
    """Compute real post-release XAUUSD return (%) respecting Yahoo bar-open timestamps.

    Yahoo Finance timestamps intraday bars at bar OPEN time (`t_open`), so a bar of width
    `bar_minutes` closes at `t_open + bar_minutes`. To avoid post-release look-ahead:
    - `p0` uses the latest bar whose close `<= t0`, i.e. `t_open <= t0 - bar_minutes`.
    - `p1` uses the latest bar whose close `<= t0 + minutes_forward` and `t_open > p0_open`.
      For 1h bars (`bar_minutes=60`) on an 08:30 ET release, `p0` is the 07:00 ET bar
      (closing 08:00 ET, strictly pre-release) and `p1` is the 11:00 ET bar (closing 12:00 ET),
      defining a clean leak-free [08:00 ET -> 12:00 ET] 4-hour reaction window.
    """
    if et_df.empty or "XAUUSD" not in et_df.columns:
        return None
    hh, mm = [int(x) for x in release_time_str.split(":")]
    tz = et_df.index.tz
    t0 = pd.Timestamp(
        year=event_date.year, month=event_date.month, day=event_date.day, hour=hh, minute=mm, tz=tz
    )
    bar_delta = pd.Timedelta(minutes=bar_minutes)
    max_pre_open = t0 - bar_delta
    min_pre_open = t0 - pd.Timedelta(minutes=180)
    pre_bars = et_df.loc[(et_df.index >= min_pre_open) & (et_df.index <= max_pre_open), "XAUUSD"].dropna()
    if pre_bars.empty:
        return None
    p0_open = pre_bars.index[-1]
    p0 = float(pre_bars.iloc[-1])

    target_close = t0 + pd.Timedelta(minutes=minutes_forward)
    max_post_open = target_close - bar_delta
    post_bars = et_df.loc[(et_df.index > p0_open) & (et_df.index <= max_post_open), "XAUUSD"].dropna()
    if post_bars.empty:
        return None
    p1 = float(post_bars.iloc[-1])
    if p0 <= 0 or not np.isfinite(p0) or not np.isfinite(p1):
        return None
    return float((p1 / p0 - 1.0) * 100.0)


def _prepare_daily_signal_series(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
) -> dict[str, pd.Series]:
    daily = market_data["daily"].copy().sort_index()
    daily.index = pd.to_datetime(daily.index).tz_localize(None)

    fd = fred_daily.copy().sort_index()
    fd.index = pd.to_datetime(fd.index).tz_localize(None)

    xau = daily["XAUUSD"].dropna()
    dxy = daily["DXY"].dropna() if "DXY" in daily.columns else pd.Series(dtype=float)
    spx = daily["SPX"].dropna() if "SPX" in daily.columns else pd.Series(dtype=float)
    us10y = daily["US10Y"].dropna() if "US10Y" in daily.columns else fd.get("DGS10", pd.Series(dtype=float)).dropna()
    vix = daily["VIX"].dropna() if "VIX" in daily.columns else fd.get("VIXCLS", pd.Series(dtype=float)).dropna()

    xau_ret_1d = xau.pct_change(1) * 100.0
    xau_ret_5d = xau.pct_change(5) * 100.0
    xau_ret_20d = xau.pct_change(20) * 100.0
    xau_rsi_14 = _compute_rsi(xau, 14)
    xau_sma50 = xau.rolling(50).mean()
    xau_dist_sma50 = ((xau / xau_sma50) - 1.0) * 100.0
    xau_vol_20d = xau_ret_1d.rolling(20).std() * np.sqrt(252.0)
    xau_vol_5d = xau_ret_1d.rolling(5).std() * np.sqrt(252.0)
    xau_vol_ratio_5d_20d = (xau_vol_5d / xau_vol_20d.replace(0, np.nan)).clip(0.2, 3.0)

    dxy_ret_1d = dxy.pct_change(1) * 100.0 if not dxy.empty else pd.Series(dtype=float)
    dxy_ret_5d = dxy.pct_change(5) * 100.0 if not dxy.empty else pd.Series(dtype=float)
    dxy_z_60d = ((dxy - dxy.rolling(60).mean()) / dxy.rolling(60).std()) if not dxy.empty else pd.Series(dtype=float)
    spx_ret_5d = spx.pct_change(5) * 100.0 if not spx.empty else pd.Series(dtype=float)

    real10y = fd["DFII10"].dropna() if "DFII10" in fd.columns else pd.Series(dtype=float)
    real10y_z_60d = ((real10y - real10y.rolling(60).mean()) / real10y.rolling(60).std()) if not real10y.empty else pd.Series(dtype=float)
    be10 = fd["T10YIE"].dropna() if "T10YIE" in fd.columns else pd.Series(dtype=float)
    yc_2s10s = fd["T10Y2Y"].dropna() if "T10Y2Y" in fd.columns else pd.Series(dtype=float)

    xau_dxy_corr_20d = xau_ret_1d.rolling(20).corr(dxy_ret_1d.reindex(xau_ret_1d.index)) if not dxy_ret_1d.empty else pd.Series(dtype=float)
    r10_chg_1d = real10y.diff(1)
    xau_real10y_corr_20d = xau_ret_1d.rolling(20).corr(r10_chg_1d.reindex(xau_ret_1d.index)) if not r10_chg_1d.empty else pd.Series(dtype=float)

    # Shift CFTC COT from Tuesday report date to Friday publication date (PIT lag)
    cot_pct = get_pit_cftc_series(cftc_df, col="cot_percentile_3y")
    cot_chg_4w = cot_pct.diff(4) if not cot_pct.empty else pd.Series(dtype=float)

    return {
        "xau": xau,
        "xau_ret_1d": xau_ret_1d,
        "xau_ret_5d": xau_ret_5d,
        "xau_ret_20d": xau_ret_20d,
        "xau_rsi_14": xau_rsi_14,
        "xau_dist_sma50": xau_dist_sma50,
        "xau_vol_20d": xau_vol_20d,
        "xau_vol_ratio_5d_20d": xau_vol_ratio_5d_20d,
        "dxy": dxy,
        "dxy_ret_1d": dxy_ret_1d,
        "dxy_ret_5d": dxy_ret_5d,
        "dxy_z_60d": dxy_z_60d,
        "spx_ret_5d": spx_ret_5d,
        "us10y": us10y,
        "us10y_chg_5d": us10y.diff(5),
        "real10y": real10y,
        "real10y_chg_1d": r10_chg_1d,
        "real10y_chg_5d": real10y.diff(5),
        "real10y_z_60d": real10y_z_60d,
        "be10_chg_5d": be10.diff(5),
        "vix": vix,
        "vix_chg_5d": vix.diff(5),
        "yc_2s10s": yc_2s10s,
        "xau_dxy_corr_20d": xau_dxy_corr_20d,
        "xau_real10y_corr_20d": xau_real10y_corr_20d,
        "cot_pct": cot_pct,
        "cot_chg_4w": cot_chg_4w,
    }


def _extract_event_features(
    sigs: dict[str, pd.Series],
    ev_dt: pd.Timestamp,
    event_type: str,
    sz: float,
) -> dict[str, float]:
    r10_lvl = _lookup_prior_value(sigs["real10y"], ev_dt)
    dxy_r5 = _lookup_prior_value(sigs["dxy_ret_5d"], ev_dt)
    vix_lvl = _lookup_prior_value(sigs["vix"], ev_dt)
    vol_20d = _lookup_prior_value(sigs["xau_vol_20d"], ev_dt)
    sigma_pre = vol_20d if (vol_20d is not None and np.isfinite(vol_20d) and vol_20d > 0) else 15.0

    return {
        "is_cpi": 1.0 if event_type == "CPI" else 0.0,
        "is_core_cpi": 1.0 if event_type == "CORE_CPI" else 0.0,
        "is_pce": 1.0 if event_type == "PCE" else 0.0,
        "is_core_pce": 1.0 if event_type == "CORE_PCE" else 0.0,
        "is_nfp": 1.0 if event_type == "NFP" else 0.0,
        "surprise_z": sz,
        "abs_surprise_z": abs(sz),
        "xau_ret_1d": _lookup_prior_value(sigs["xau_ret_1d"], ev_dt),
        "xau_ret_5d": _lookup_prior_value(sigs["xau_ret_5d"], ev_dt),
        "xau_ret_20d": _lookup_prior_value(sigs["xau_ret_20d"], ev_dt),
        "xau_rsi_14": _lookup_prior_value(sigs["xau_rsi_14"], ev_dt),
        "xau_dist_sma50": _lookup_prior_value(sigs["xau_dist_sma50"], ev_dt),
        "xau_vol_20d": vol_20d,
        "sigma_pre": sigma_pre,
        "xau_vol_ratio_5d_20d": _lookup_prior_value(sigs["xau_vol_ratio_5d_20d"], ev_dt),
        "dxy_ret_1d": _lookup_prior_value(sigs["dxy_ret_1d"], ev_dt),
        "dxy_ret_5d": dxy_r5,
        "dxy_z_60d": _lookup_prior_value(sigs["dxy_z_60d"], ev_dt),
        "us10y_level": _lookup_prior_value(sigs["us10y"], ev_dt),
        "us10y_chg_5d": _lookup_prior_value(sigs["us10y_chg_5d"], ev_dt),
        "real10y_level": r10_lvl,
        "real10y_chg_1d": _lookup_prior_value(sigs["real10y_chg_1d"], ev_dt),
        "real10y_chg_5d": _lookup_prior_value(sigs["real10y_chg_5d"], ev_dt),
        "real10y_z_60d": _lookup_prior_value(sigs["real10y_z_60d"], ev_dt),
        "breakeven_10y_chg_5d": _lookup_prior_value(sigs["be10_chg_5d"], ev_dt),
        "vix_level": vix_lvl,
        "vix_chg_5d": _lookup_prior_value(sigs["vix_chg_5d"], ev_dt),
        "spx_ret_5d": _lookup_prior_value(sigs["spx_ret_5d"], ev_dt),
        "yield_curve_2s10s": _lookup_prior_value(sigs["yc_2s10s"], ev_dt),
        "xau_dxy_corr_20d": _lookup_prior_value(sigs["xau_dxy_corr_20d"], ev_dt),
        "xau_real10y_corr_20d": _lookup_prior_value(sigs["xau_real10y_corr_20d"], ev_dt),
        "cot_gold_pct": _lookup_prior_value(sigs["cot_pct"], ev_dt),
        "cot_gold_chg_4w": _lookup_prior_value(sigs["cot_chg_4w"], ev_dt),
        "surprise_x_real10y": sz * (r10_lvl if np.isfinite(r10_lvl) else 0.0),
        "surprise_x_dxy": sz * (dxy_r5 if np.isfinite(dxy_r5) else 0.0),
        "surprise_x_vix": sz * ((vix_lvl if np.isfinite(vix_lvl) else 18.0) / 20.0),
        "surprise_x_vol": sz * ((vol_20d if np.isfinite(vol_20d) else 15.0) / 15.0),
    }


def _resolve_model1_oof_path(key: str) -> Any:
    canonical = ARTIFACTS_DIR / "economic_forecast" / f"{key.lower()}_oof.csv"
    if canonical.exists():
        return canonical
    return MODEL1_DIR / f"{key.lower()}_oof.csv"


def build_event_study_dataset(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    release_dates: pd.DataFrame,
    cftc_df: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Align real FRED release dates & causal Model 1 ar_seasonal_proxy surprises with real XAUUSD returns.

    Historical survey consensus is absent in free FRED/BLS/BEA data; all historical surprises are
    tagged explicitly as `consensus_source="ar_seasonal_proxy"`. Corrupted FRED release_id=101 daily
    FOMC dates are excluded (`FOMC` is BLOCKED). Zero synthetic return bridging is performed.
    """
    daily = market_data["daily"].copy().sort_index()
    daily.index = pd.to_datetime(daily.index).tz_localize(None)
    h1_et = _to_eastern(market_data["1h"])
    m30_et = _to_eastern(market_data["30m"])
    m5_et = _to_eastern(market_data["5m"])

    sigs = _prepare_daily_signal_series(fred_daily, market_data, cftc_df)
    xau = sigs["xau"]

    rel_df = release_dates.copy()
    if not rel_df.empty:
        rel_df["release_date"] = pd.to_datetime(rel_df["release_date"]).dt.tz_localize(None)

    oof_map: dict[str, pd.DataFrame] = {}
    for key in TRAINABLE_INDICATORS:
        p = _resolve_model1_oof_path(key)
        if not p.exists():
            continue
        df_oof = pd.read_csv(p, parse_dates=["date"]).set_index("date").sort_index()
        if "ar_ridge_baseline" in df_oof.columns:
            cons_series = df_oof["ar_ridge_baseline"].astype(float)
            s_raw = df_oof["actual"].astype(float) - cons_series
        elif "consensus_proxy" in df_oof.columns and "surprise_vs_consensus" in df_oof.columns:
            cons_series = df_oof["consensus_proxy"].astype(float)
            s_raw = df_oof["surprise_vs_consensus"].astype(float)
        elif "model_forecast" in df_oof.columns:
            cons_series = df_oof["model_forecast"].astype(float)
            s_raw = df_oof["actual"].astype(float) - cons_series
        else:
            continue
        # Strictly causal standardization: only past surprises (< t) enter the denominator.
        rolling_std = s_raw.rolling(24, min_periods=6).std().shift(1)
        expanding_std = s_raw.expanding(min_periods=3).std().shift(1)
        causal_std = rolling_std.fillna(expanding_std).replace(0.0, np.nan)
        df_oof["surprise_proxy_raw"] = s_raw
        df_oof["consensus_proxy_val"] = cons_series
        df_oof["surprise_z"] = s_raw / causal_std
        df_oof = df_oof.dropna(subset=["surprise_z", "consensus_proxy_val", "surprise_proxy_raw"])
        oof_map[key] = df_oof

    events: list[dict[str, Any]] = []
    unmatched_ref_months = 0
    for key, df_oof in oof_map.items():
        rel_group = "CPI" if key in ("CPI", "CORE_CPI") else "PCE" if key in ("PCE", "CORE_PCE") else "NFP"
        ref_map = match_release_dates_to_ref_months(rel_df, rel_group, df_oof.index.tolist())
        for ref_month, row in df_oof.iterrows():
            rm_key = pd.Timestamp(ref_month).replace(day=1)
            if rm_key not in ref_map:
                unmatched_ref_months += 1
                continue
            ev_dt, ev_time = ref_map[rm_key]
            if ev_dt < xau.index.min() + pd.Timedelta(days=55) or ev_dt > xau.index.max():
                continue

            post_dates = xau.index[xau.index >= ev_dt]
            pre_dates = xau.index[xau.index < ev_dt]
            if post_dates.empty or pre_dates.empty:
                continue
            trade_dt, prev_dt = post_dates[0], pre_dates[-1]
            if (trade_dt - ev_dt).days > 4:
                continue

            ret_1d = float((xau.loc[trade_dt] / xau.loc[prev_dt] - 1.0) * 100.0)
            if not np.isfinite(ret_1d) or abs(ret_1d) > 15.0:
                continue

            sz = float(np.clip(row["surprise_z"], -4.0, 4.0))
            feat_row = _extract_event_features(sigs, ev_dt, key, sz)
            feat_row.update(
                {
                    "event_date": ev_dt.strftime("%Y-%m-%d"),
                    "ref_month": pd.Timestamp(ref_month).strftime("%Y-%m"),
                    "event_type": key,
                    "actual": float(row["actual"]),
                    "consensus_proxy": float(row["consensus_proxy_val"]),
                    "consensus_source": "ar_seasonal_proxy",
                    "surprise_proxy_raw": float(row["surprise_proxy_raw"]),
                    "ret_1d": ret_1d,
                    "ret_4h_real": _intraday_return_around_event(h1_et, ev_dt, ev_time, 60, 240),
                    "ret_30m_real": _intraday_return_around_event(m30_et, ev_dt, ev_time, 30, 30),
                    "ret_5m_real": _intraday_return_around_event(m5_et, ev_dt, ev_time, 5, 5),
                }
            )
            events.append(feat_row)

    events_df = pd.DataFrame(events).sort_values(["event_date", "event_type"]).reset_index(drop=True)
    if not events_df.empty:
        events_df = events_df.drop_duplicates(subset=["event_date", "event_type"], keep="first").reset_index(drop=True)
        events_df.to_csv(DATA_DIR / "xauusd_macro_events.csv", index=False)

    fomc_rows = int((rel_df["event_type"] == "FOMC").sum()) if not rel_df.empty and "event_type" in rel_df.columns else 0
    dataset_meta = {
        "total_events": int(len(events_df)),
        "unique_event_dates": int(events_df["event_date"].nunique()) if not events_df.empty else 0,
        "date_min": str(events_df["event_date"].min()) if not events_df.empty else None,
        "date_max": str(events_df["event_date"].max()) if not events_df.empty else None,
        "unmatched_ref_months_skipped": int(unmatched_ref_months),
        "duplicate_event_date_type_pairs": int(events_df.duplicated(subset=["event_date", "event_type"]).sum()) if not events_df.empty else 0,
        "consensus_source": "ar_seasonal_proxy",
        "historical_consensus_available": False,
        "fomc_valid_dates": fomc_rows,
        "fomc_status": "BLOCKED" if fomc_rows < MIN_UNIQUE_DATES_FOR_TRAINING else "READY",
    }
    return events_df, dataset_meta


def _direction_label(ret: float, threshold: float) -> int:
    if ret > threshold:
        return 2  # UP
    if ret < -threshold:
        return 0  # DOWN
    return 1  # FLAT


def _pinball_loss(y_true: np.ndarray, y_pred: np.ndarray, alpha: float) -> float:
    err = y_true - y_pred
    return float(np.mean(np.maximum(alpha * err, (alpha - 1.0) * err)))


def _calibration_summary(y_bin: np.ndarray, p_pred: np.ndarray, n_bins: int = 5) -> dict[str, Any]:
    """Compute Expected Calibration Error (ECE) and reliability bins."""
    if len(y_bin) == 0:
        return {"ece": None, "bins": []}
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    bins_out = []
    for i in range(n_bins):
        lo, hi = float(edges[i]), float(edges[i + 1])
        mask = (p_pred >= lo) & (p_pred <= hi if i == n_bins - 1 else p_pred < hi)
        cnt = int(mask.sum())
        if cnt == 0:
            continue
        mean_p = float(np.mean(p_pred[mask]))
        emp_f = float(np.mean(y_bin[mask]))
        ece += (cnt / len(y_bin)) * abs(emp_f - mean_p)
        bins_out.append(
            {
                "bin_range": [round(lo, 2), round(hi, 2)],
                "count": cnt,
                "mean_pred_prob": round(mean_p, 4),
                "empirical_freq": round(emp_f, 4),
            }
        )
    return {"ece": round(float(ece), 4), "bins": bins_out}


def evaluate_abstention_curve(p_probs: np.ndarray, y_true: np.ndarray, min_coverage: float = 0.5) -> dict[str, Any]:
    """Compute risk-coverage curves on out-of-fold probability predictions.
    
    Chooses an optimal abstention threshold on |p - 0.5| to minimize Brier score while
    maintaining at least min_coverage on out-of-fold predictions.
    """
    conf = np.abs(p_probs - 0.5)
    thresholds = np.linspace(0.0, 0.40, 41)
    best_thresh = 0.0
    best_brier = float("inf")
    best_cov = 1.0
    curve = []
    for t in thresholds:
        mask = conf >= t
        cov = float(np.mean(mask)) if len(mask) > 0 else 0.0
        if cov >= min_coverage:
            brier = float(np.mean((p_probs[mask] - y_true[mask]) ** 2)) if np.any(mask) else 0.25
            curve.append({"threshold": round(float(t), 3), "coverage": round(cov, 4), "brier": round(brier, 4)})
            if brier < best_brier:
                best_brier = brier
                best_thresh = float(t)
                best_cov = cov
    return {
        "optimal_abstain_threshold": round(best_thresh, 3),
        "abstain_coverage": round(best_cov, 4),
        "abstain_brier": round(best_brier, 4),
        "risk_coverage_curve": curve,
    }


def _compute_regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    if len(y_true) == 0:
        return {"n": 0, "mae": None, "rmse": None, "directional_error": None, "directional_accuracy": None, "r2": None}
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(root_mean_squared_error(y_true, y_pred))
    nz = y_true != 0.0
    if nz.sum() > 0:
        dir_acc = float(np.mean(np.sign(y_pred[nz]) == np.sign(y_true[nz])))
        dir_err = float(1.0 - dir_acc)
    else:
        dir_acc, dir_err = None, None
    r2 = float(r2_score(y_true, y_pred)) if len(y_true) >= 2 and np.var(y_true) > 0 else None
    return {
        "n": int(len(y_true)),
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "directional_error": round(dir_err, 4) if dir_err is not None else None,
        "directional_accuracy": round(dir_acc, 4) if dir_acc is not None else None,
        "r2": round(r2, 4) if r2 is not None else None,
    }


def _compute_classification_metrics(y_true: np.ndarray, probs: np.ndarray) -> dict[str, Any]:
    n = int(len(y_true))
    if n == 0:
        return {"n": 0}
    probs = np.clip(np.asarray(probs, dtype=float), 1e-6, 1.0 - 1e-6)
    probs = probs / probs.sum(axis=1, keepdims=True)
    y_pred = np.argmax(probs, axis=1)

    acc3 = float(accuracy_score(y_true, y_pred))
    present_classes = np.unique(y_true)
    if len(present_classes) >= 2:
        import warnings

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="y_pred contains classes not in y_true")
            bal_acc = float(balanced_accuracy_score(y_true, y_pred))
    else:
        bal_acc = acc3
    prec, rec, f1, sup = precision_recall_fscore_support(
        y_true, y_pred, labels=[0, 1, 2], zero_division=0
    )
    class_names = ("DOWN", "FLAT", "UP")
    per_class = {
        cname: {
            "precision": round(float(prec[i]), 4),
            "recall": round(float(rec[i]), 4),
            "f1": round(float(f1[i]), 4),
            "support": int(sup[i]),
        }
        for i, cname in enumerate(class_names)
    }

    non_flat = y_true != 1
    up_down_acc = (
        float(np.mean((probs[non_flat, 2] > probs[non_flat, 0]) == (y_true[non_flat] == 2)))
        if non_flat.sum() > 0
        else None
    )

    y_up = (y_true == 2).astype(int)
    y_down = (y_true == 0).astype(int)
    brier_up = float(brier_score_loss(y_up, probs[:, 2]))
    y_onehot = np.eye(3)[y_true]
    brier_multi = float(np.mean(np.sum((probs - y_onehot) ** 2, axis=1)))
    ll = float(log_loss(y_true, probs, labels=[0, 1, 2]))

    roc_up = float(roc_auc_score(y_up, probs[:, 2])) if len(np.unique(y_up)) == 2 else None
    pr_up = float(average_precision_score(y_up, probs[:, 2])) if y_up.sum() > 0 else None
    pr_down = float(average_precision_score(y_down, probs[:, 0])) if y_down.sum() > 0 else None

    present_classes = np.unique(y_true)
    if len(present_classes) == 3:
        roc_ovr = float(roc_auc_score(y_true, probs, multi_class="ovr", average="macro", labels=[0, 1, 2]))
    else:
        roc_ovr = None

    if non_flat.sum() > 0 and len(np.unique(y_true[non_flat])) == 2:
        p_up_cond = probs[non_flat, 2] / (probs[non_flat, 2] + probs[non_flat, 0])
        roc_up_vs_down = float(roc_auc_score((y_true[non_flat] == 2).astype(int), p_up_cond))
    else:
        roc_up_vs_down = None

    return {
        "n": n,
        "accuracy_3class": round(acc3, 4),
        "balanced_accuracy": round(bal_acc, 4),
        "up_down_accuracy": round(up_down_acc, 4) if up_down_acc is not None else None,
        "precision_macro": round(float(np.mean(prec)), 4),
        "recall_macro": round(float(np.mean(rec)), 4),
        "f1_macro": round(float(np.mean(f1)), 4),
        "per_class": per_class,
        "roc_auc_ovr": round(roc_ovr, 4) if roc_ovr is not None else None,
        "roc_auc_up": round(roc_up, 4) if roc_up is not None else None,
        "roc_auc_up_vs_down": round(roc_up_vs_down, 4) if roc_up_vs_down is not None else None,
        "pr_auc_up": round(pr_up, 4) if pr_up is not None else None,
        "pr_auc_down": round(pr_down, 4) if pr_down is not None else None,
        "brier_up": round(brier_up, 4),
        "brier_multiclass": round(brier_multi, 4),
        "log_loss": round(ll, 4),
        "calibration_up": _calibration_summary(y_up, probs[:, 2]),
        "calibration_down": _calibration_summary(y_down, probs[:, 0]),
    }


def _compute_quantile_metrics(
    y_true: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
) -> dict[str, Any]:
    if len(y_true) == 0:
        return {"n": 0}
    q_sorted = np.sort(np.column_stack([q10, q50, q90]), axis=1)
    p10, p50, p90 = q_sorted[:, 0], q_sorted[:, 1], q_sorted[:, 2]
    l10 = _pinball_loss(y_true, p10, 0.10)
    l50 = _pinball_loss(y_true, p50, 0.50)
    l90 = _pinball_loss(y_true, p90, 0.90)
    cov80 = float(np.mean((y_true >= p10) & (y_true <= p90)))
    below10 = float(np.mean(y_true < p10))
    above90 = float(np.mean(y_true > p90))
    return {
        "n": int(len(y_true)),
        "pinball_p10": round(l10, 4),
        "pinball_p50": round(l50, 4),
        "pinball_p90": round(l90, 4),
        "mean_quantile_loss": round(float((l10 + l50 + l90) / 3.0), 4),
        "interval_80_coverage": round(cov80, 4),
        "p10_exceedance_rate": round(below10, 4),
        "p90_exceedance_rate": round(above90, 4),
        "mean_interval_width_pct": round(float(np.mean(p90 - p10)), 4),
    }


def _make_event_date_folds(
    event_dates_series: pd.Series,
    n_splits: int = 3,
    embargo_days: int = EMBARGO_CALENDAR_DAYS,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding chronological splits grouped by event_date with calendar-day embargo."""
    unique_dates = sorted(pd.to_datetime(event_dates_series).unique())
    n_d = len(unique_dates)
    if n_d < n_splits + 2:
        return []
    val_size = max(5, n_d // (n_splits + 2))
    folds: list[tuple[np.ndarray, np.ndarray]] = []
    dt_arr = pd.to_datetime(event_dates_series).values
    for k in range(n_splits):
        val_start_idx = n_d - (n_splits - k) * val_size
        val_end_idx = val_start_idx + val_size if k < n_splits - 1 else n_d
        if val_start_idx <= 5:
            continue
        val_dates = unique_dates[val_start_idx:val_end_idx]
        cutoff = pd.Timestamp(val_dates[0]) - pd.Timedelta(days=embargo_days)
        tr_mask = dt_arr <= np.datetime64(cutoff)
        va_mask = np.isin(dt_arr, np.array(val_dates, dtype="datetime64[ns]"))
        if tr_mask.sum() >= 20 and va_mask.sum() >= 3:
            folds.append((np.where(tr_mask)[0], np.where(va_mask)[0]))
    return folds


def _tune_dev_hyperparams(
    df_dev: pd.DataFrame,
    y_reg: np.ndarray,
    y_cls: np.ndarray,
) -> dict[str, Any]:
    """Tune Ridge, LogReg, XGBRegressor, and XGBClassifier strictly inside Development splits."""
    X_dev = df_dev[FEATURE_COLS]
    folds = _make_event_date_folds(df_dev["event_date"], n_splits=3, embargo_days=EMBARGO_CALENDAR_DAYS)

    default_cfg = {
        "ridge_alpha": 50.0,
        "logreg_c": 0.1,
        "xgb_reg": {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 80, "reg_lambda": 15.0, "min_child_weight": 6},
        "xgb_clf": {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 80, "reg_lambda": 15.0, "min_child_weight": 6},
    }
    if not folds:
        return default_cfg

    # 1. Ridge alpha
    best_alpha, best_ridge_rmse = default_cfg["ridge_alpha"], float("inf")
    for alpha in (5.0, 25.0, 100.0, 300.0):
        rmses = []
        for tr, va in folds:
            m = Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", Ridge(alpha=alpha))])
            m.fit(X_dev.iloc[tr], y_reg[tr])
            rmses.append(root_mean_squared_error(y_reg[va], m.predict(X_dev.iloc[va])))
        score = float(np.mean(rmses))
        if score < best_ridge_rmse:
            best_ridge_rmse = score
            best_alpha = alpha

    # 2. LogisticRegression C
    best_c, best_lr_ll = default_cfg["logreg_c"], float("inf")
    for c_val in (0.01, 0.05, 0.25, 1.0):
        lls = []
        for tr, va in folds:
            if len(np.unique(y_cls[tr])) < 3:
                continue
            m = Pipeline(
                [("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", LogisticRegression(C=c_val, max_iter=1000, random_state=42))]
            )
            m.fit(X_dev.iloc[tr], y_cls[tr])
            lls.append(log_loss(y_cls[va], m.predict_proba(X_dev.iloc[va]), labels=[0, 1, 2]))
        if lls and float(np.mean(lls)) < best_lr_ll:
            best_lr_ll = float(np.mean(lls))
            best_c = c_val

    # 3. XGBRegressor
    xgb_reg_grid = [
        {"max_depth": 1, "learning_rate": 0.03, "n_estimators": 60, "reg_lambda": 15.0, "min_child_weight": 6},
        {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 80, "reg_lambda": 20.0, "min_child_weight": 8},
        {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 120, "reg_lambda": 30.0, "min_child_weight": 10},
    ]
    best_xgb_reg, best_xr_rmse = xgb_reg_grid[0], float("inf")
    for params in xgb_reg_grid:
        rmses = []
        for tr, va in folds:
            m = XGBRegressor(**params, subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=4)
            m.fit(X_dev.iloc[tr], y_reg[tr])
            rmses.append(root_mean_squared_error(y_reg[va], m.predict(X_dev.iloc[va])))
        score = float(np.mean(rmses))
        if score < best_xr_rmse:
            best_xr_rmse = score
            best_xgb_reg = params

    # 4. XGBClassifier
    xgb_clf_grid = [
        {"max_depth": 1, "learning_rate": 0.03, "n_estimators": 60, "reg_lambda": 15.0, "min_child_weight": 6},
        {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 80, "reg_lambda": 20.0, "min_child_weight": 8},
        {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 120, "reg_lambda": 30.0, "min_child_weight": 10},
    ]
    best_xgb_clf, best_xc_ll = xgb_clf_grid[0], float("inf")
    for params in xgb_clf_grid:
        lls = []
        for tr, va in folds:
            if len(np.unique(y_cls[tr])) < 3:
                continue
            m = XGBClassifier(**params, subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=4, eval_metric="mlogloss")
            m.fit(X_dev.iloc[tr], y_cls[tr])
            lls.append(log_loss(y_cls[va], m.predict_proba(X_dev.iloc[va]), labels=[0, 1, 2]))
        if lls and float(np.mean(lls)) < best_xc_ll:
            best_xc_ll = float(np.mean(lls))
            best_xgb_clf = params

    return {
        "ridge_alpha": best_alpha,
        "logreg_c": best_c,
        "xgb_reg": best_xgb_reg,
        "xgb_clf": best_xgb_clf,
    }


def _fit_all_horizon_models(
    df_tr: pd.DataFrame,
    y_tr_reg: np.ndarray,
    y_tr_cls: np.ndarray,
    tuned: dict[str, Any],
) -> dict[str, Any]:
    """Fit all 6 model families strictly on a given training fold."""
    X_tr = df_tr[FEATURE_COLS]

    # 1. Unconditional baselines
    uncond_mean = float(np.mean(y_tr_reg))
    uncond_probs = np.bincount(y_tr_cls, minlength=3).astype(float)
    uncond_probs = (uncond_probs + 1.0) / (uncond_probs.sum() + 3.0)
    uncond_quantiles = {q: float(np.quantile(y_tr_reg, q)) for q in QUANTILE_ALPHAS}

    # 2. Event-category baselines (smoothed toward unconditional prior)
    cat_means: dict[str, float] = {}
    cat_probs: dict[str, np.ndarray] = {}
    cat_quantiles: dict[str, dict[float, float]] = {}
    for et, grp in df_tr.groupby("event_type"):
        idx = grp.index.values
        # Positional mask inside df_tr
        pos = df_tr.index.get_indexer(idx)
        yg = y_tr_reg[pos]
        ycg = y_tr_cls[pos]
        cat_means[str(et)] = float(np.mean(yg))
        counts = np.bincount(ycg, minlength=3).astype(float)
        # Dirichlet smoothing with alpha=3 * uncond_probs
        cat_probs[str(et)] = (counts + 3.0 * uncond_probs) / (counts.sum() + 3.0)
        cat_quantiles[str(et)] = {q: float(np.quantile(yg, q)) for q in QUANTILE_ALPHAS} if len(yg) >= 5 else uncond_quantiles

    # 3. Statistical baseline: Ridge + LogisticRegression + linear QuantileRegressor
    ridge = Pipeline(
        [("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", Ridge(alpha=tuned["ridge_alpha"]))]
    ).fit(X_tr, y_tr_reg)

    logreg = Pipeline(
        [
            ("imp", SimpleImputer(strategy="median")),
            ("sc", StandardScaler()),
            ("m", LogisticRegression(C=tuned["logreg_c"], max_iter=1000, random_state=42)),
        ]
    ).fit(X_tr, y_tr_cls)

    lin_quantiles = {
        q: Pipeline(
            [
                ("imp", SimpleImputer(strategy="median")),
                ("sc", StandardScaler()),
                ("m", QuantileRegressor(quantile=q, alpha=0.05)),
            ]
        ).fit(X_tr, y_tr_reg)
        for q in QUANTILE_ALPHAS
    }

    # 4. XGBoost Regressor
    xgb_reg = XGBRegressor(
        **tuned["xgb_reg"], subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=4
    ).fit(X_tr, y_tr_reg)

    # 5. XGBoost Classifier
    xgb_clf = XGBClassifier(
        **tuned["xgb_clf"], subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=4, eval_metric="mlogloss"
    ).fit(X_tr, y_tr_cls)

    # 6. XGBoost Quantile Regressors (p10/p25/p50/p75/p90)
    xgb_quantiles = {
        q: XGBRegressor(
            n_estimators=tuned["xgb_reg"]["n_estimators"],
            max_depth=tuned["xgb_reg"]["max_depth"],
            learning_rate=tuned["xgb_reg"]["learning_rate"],
            reg_lambda=tuned["xgb_reg"]["reg_lambda"],
            min_child_weight=tuned["xgb_reg"]["min_child_weight"],
            subsample=0.80,
            colsample_bytree=0.75,
            objective="reg:quantileerror",
            quantile_alpha=q,
            random_state=42,
            n_jobs=4,
        ).fit(X_tr, y_tr_reg)
        for q in QUANTILE_ALPHAS
    }

    return {
        "uncond_mean": uncond_mean,
        "uncond_probs": uncond_probs,
        "uncond_quantiles": uncond_quantiles,
        "cat_means": cat_means,
        "cat_probs": cat_probs,
        "cat_quantiles": cat_quantiles,
        "ridge": ridge,
        "logreg": logreg,
        "lin_quantiles": lin_quantiles,
        "xgb_reg": xgb_reg,
        "xgb_clf": xgb_clf,
        "xgb_quantiles": xgb_quantiles,
    }


def _predict_all_horizon_models(models: dict[str, Any], df_te: pd.DataFrame) -> dict[str, Any]:
    X_te = df_te[FEATURE_COLS]
    n = len(df_te)
    ets = df_te["event_type"].astype(str).tolist()

    # Align LogReg classes safely onto [0, 1, 2]
    lr_classes = list(models["logreg"].named_steps["m"].classes_)
    lr_raw = models["logreg"].predict_proba(X_te)
    lr_probs = np.full((n, 3), 1e-6, dtype=float)
    for col_i, cls_lbl in enumerate(lr_classes):
        lr_probs[:, int(cls_lbl)] = lr_raw[:, col_i]
    lr_probs = lr_probs / lr_probs.sum(axis=1, keepdims=True)

    xgb_classes = list(models["xgb_clf"].classes_)
    xgb_raw = models["xgb_clf"].predict_proba(X_te)
    xgb_probs = np.full((n, 3), 1e-6, dtype=float)
    for col_i, cls_lbl in enumerate(xgb_classes):
        xgb_probs[:, int(cls_lbl)] = xgb_raw[:, col_i]
    xgb_probs = xgb_probs / xgb_probs.sum(axis=1, keepdims=True)

    return {
        "reg": {
            "unconditional_baseline": np.full(n, models["uncond_mean"], dtype=float),
            "event_category_baseline": np.array([models["cat_means"].get(et, models["uncond_mean"]) for et in ets], dtype=float),
            "ridge_baseline": models["ridge"].predict(X_te).astype(float),
            "xgboost_regressor": models["xgb_reg"].predict(X_te).astype(float),
        },
        "cls": {
            "unconditional_baseline": np.tile(models["uncond_probs"], (n, 1)),
            "event_category_baseline": np.vstack([models["cat_probs"].get(et, models["uncond_probs"]) for et in ets]),
            "logreg_baseline": lr_probs,
            "xgboost_classifier": xgb_probs,
        },
        "quantiles": {
            "unconditional_baseline": {
                q: np.full(n, models["uncond_quantiles"][q], dtype=float) for q in (0.10, 0.50, 0.90)
            },
            "event_category_baseline": {
                q: np.array([models["cat_quantiles"].get(et, models["uncond_quantiles"])[q] for et in ets], dtype=float)
                for q in (0.10, 0.50, 0.90)
            },
            "linear_quantile_baseline": {
                q: models["lin_quantiles"][q].predict(X_te).astype(float) for q in (0.10, 0.50, 0.90)
            },
            "xgboost_quantile": {
                q: models["xgb_quantiles"][q].predict(X_te).astype(float) for q in (0.10, 0.50, 0.90)
            },
        },
    }


def _subgroup_tags(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Assign causal pre-event subgroup tags for granular evaluation."""
    abs_sz = df["abs_surprise_z"].astype(float)
    shock_mag = pd.Series(
        np.where(abs_sz < 0.5, "low_shock_lt_0.5z", np.where(abs_sz < 1.5, "medium_shock_0.5_to_1.5z", "high_shock_ge_1.5z")),
        index=df.index,
    )

    r10 = df["real10y_level"].astype(float)
    macro_reg = pd.Series(
        np.where(r10.isna(), "unknown_real10y", np.where(r10 >= 1.0, "high_real_yields_ge_1pct", "low_or_neg_real_yields_lt_1pct")),
        index=df.index,
    )

    vix = df["vix_level"].astype(float)
    vol_env = pd.Series(
        np.where(vix.isna(), "unknown_vol", np.where(vix < 15.0, "low_vol_vix_lt_15", np.where(vix < 22.0, "normal_vol_15_22", "high_vol_vix_ge_22"))),
        index=df.index,
    )

    return {
        "event_category": df["event_type"].astype(str),
        "shock_magnitude_ar_proxy": shock_mag,
        "macro_regime_real_yield": macro_reg,
        "volatility_environment": vol_env,
    }


def _evaluate_subgroups(
    df_eval: pd.DataFrame,
    y_reg: np.ndarray,
    y_cls: np.ndarray,
    reg_preds: np.ndarray,
    cls_probs: np.ndarray,
    q_preds: dict[float, np.ndarray],
) -> dict[str, Any]:
    tags = _subgroup_tags(df_eval)
    out: dict[str, Any] = {}
    for group_dim, series_tags in tags.items():
        dim_res: dict[str, Any] = {}
        for grp_name, grp_idx in series_tags.groupby(series_tags).groups.items():
            pos = df_eval.index.get_indexer(grp_idx)
            dim_res[str(grp_name)] = {
                "regression": _compute_regression_metrics(y_reg[pos], reg_preds[pos]),
                "classification": _compute_classification_metrics(y_cls[pos], cls_probs[pos]),
                "quantiles": _compute_quantile_metrics(y_reg[pos], q_preds[0.10][pos], q_preds[0.50][pos], q_preds[0.90][pos]),
            }
        out[group_dim] = dim_res
    return out


def _evaluate_horizon_split(
    df_eval: pd.DataFrame,
    y_reg: np.ndarray,
    y_cls: np.ndarray,
    preds_by_family: dict[str, Any],
    selected_reg_name: str,
    selected_cls_name: str,
    selected_q_name: str,
) -> dict[str, Any]:
    reg_comp = {
        name: _compute_regression_metrics(y_reg, p)
        for name, p in preds_by_family["reg"].items()
    }
    cls_comp = {
        name: _compute_classification_metrics(y_cls, p)
        for name, p in preds_by_family["cls"].items()
    }
    q_comp = {
        name: _compute_quantile_metrics(y_reg, qd[0.10], qd[0.50], qd[0.90])
        for name, qd in preds_by_family["quantiles"].items()
    }

    subgroups = _evaluate_subgroups(
        df_eval,
        y_reg,
        y_cls,
        preds_by_family["reg"][selected_reg_name],
        preds_by_family["cls"][selected_cls_name],
        preds_by_family["quantiles"][selected_q_name],
    )
    return {
        "n_events": int(len(df_eval)),
        "unique_event_dates": int(df_eval["event_date"].nunique()),
        "date_range": [str(df_eval["event_date"].min()), str(df_eval["event_date"].max())] if not df_eval.empty else [],
        "regression_comparison": reg_comp,
        "classification_comparison": cls_comp,
        "quantile_comparison": q_comp,
        "selected_models": {
            "regression": selected_reg_name,
            "classification": selected_cls_name,
            "quantile": selected_q_name,
        },
        "subgroups_selected_models": subgroups,
    }


def _fit_analog_index(df_train: pd.DataFrame) -> tuple[SimpleImputer, StandardScaler, np.ndarray]:
    """Fit imputer and scaler strictly on historical analog training matrix."""
    imp = SimpleImputer(strategy="median")
    X_imp = imp.fit_transform(df_train[FEATURE_COLS])
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_imp)
    return imp, scaler, X_scaled


def train_market_reaction_models(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    release_dates: pd.DataFrame,
    cftc_df: pd.DataFrame,
) -> dict[str, Any]:
    """Train & evaluate XAUUSD Market Reaction models strictly on real observed post-event returns.

    Enforces:
    - Zero synthetic return bridging (daily-to-intraday ratio scaling completely removed).
    - Blocked status for 5m/30m (~8 unique dates in 60d Yahoo data) and FOMC (0 valid dates).
    - Event-date grouped purged/embargoed chronological walk-forward validation inside Development.
    - Untouched final holdout period evaluated once with frozen Development-tuned hyperparameters.
    - Full model comparison: Unconditional, Event-Category, Ridge/LogReg/LinearQuantile, XGBoost, Quantile.
    """
    events_df, dataset_meta = build_event_study_dataset(fred_daily, market_data, release_dates, cftc_df)
    if events_df.empty or len(events_df) < MIN_REAL_EVENTS_FOR_TRAINING:
        raise RuntimeError(f"Insufficient aligned macro events for Model 3: {len(events_df)}")

    horizon_bundles: dict[str, Any] = {}
    blocked_horizons: dict[str, Any] = {}
    report_horizons: dict[str, Any] = {}
    run_horizons: dict[str, Any] = {}

    for h in HORIZONS:
        real_col = "ret_1d" if h == "1d" else f"ret_{h}_real"
        df_h = events_df[events_df[real_col].notna()].copy().sort_values(["event_date", "event_type"]).reset_index(drop=True)
        real_count = int(len(df_h))
        unique_dates_h = sorted(df_h["event_date"].unique()) if not df_h.empty else []
        n_unique_dates = int(len(unique_dates_h))

        if real_count < MIN_REAL_EVENTS_FOR_TRAINING or n_unique_dates < MIN_UNIQUE_DATES_FOR_TRAINING:
            reason = (
                f"INSUFFICIENT_DATA: only {n_unique_dates} unique event dates ({real_count} indicator rows) "
                f"observed in free Yahoo Finance {h} history (requires >= {MIN_UNIQUE_DATES_FOR_TRAINING} dates "
                f"and >= {MIN_REAL_EVENTS_FOR_TRAINING} events); synthetic ret_1d bridging disabled."
            )
            blocked_info = {
                "horizon": h,
                "status": "BLOCKED",
                "readiness": "BLOCKED",
                "available": False,
                "reason": reason,
                "total_events": real_count,
                "unique_event_dates": n_unique_dates,
                "exact_intraday_observed_events": real_count,
                "bridged_events": 0,
                "oof_test_events": 0,
                "oof_mae_pct": None,
                "oof_rmse_pct": None,
                "oof_3class_accuracy": None,
                "oof_up_down_accuracy": None,
                "oof_brier_up": None,
                "top_features": [],
            }
            blocked_horizons[h] = blocked_info
            report_horizons[h] = blocked_info
            run_horizons[h] = blocked_info
            continue

        # Partition unique_dates into Development vs Untouched Final Holdout (grouped by event_date!)
        if h == "1d":
            max_dt = pd.Timestamp(unique_dates_h[-1])
            holdout_cutoff_str = (max_dt - pd.DateOffset(months=24)).strftime("%Y-%m-%d")
            holdout_dates = [d for d in unique_dates_h if d >= holdout_cutoff_str]
            if len(holdout_dates) < 30:
                holdout_start_date = unique_dates_h[-max(20, int(n_unique_dates * 0.15))]
            else:
                holdout_start_date = holdout_dates[0]
        else:
            # 4h has ~82 unique dates; reserve last 20% (~16 dates / ~27 rows) as untouched holdout
            holdout_start_date = unique_dates_h[-max(12, int(round(n_unique_dates * 0.20)))]

        embargo_cutoff_date = (pd.Timestamp(holdout_start_date) - pd.Timedelta(days=EMBARGO_CALENDAR_DAYS)).strftime("%Y-%m-%d")
        df_dev = df_h[df_h["event_date"] <= embargo_cutoff_date].copy().reset_index(drop=True)
        df_holdout = df_h[df_h["event_date"] >= holdout_start_date].copy().reset_index(drop=True)

        thresh = FLAT_THRESHOLDS[h]
        y_dev_reg = df_dev[real_col].astype(float).values
        y_dev_cls = np.array([_direction_label(v, thresh) for v in y_dev_reg], dtype=int)
        y_hold_reg = df_holdout[real_col].astype(float).values
        y_hold_cls = np.array([_direction_label(v, thresh) for v in y_hold_reg], dtype=int)

        # Tune strictly inside Development
        tuned = _tune_dev_hyperparams(df_dev, y_dev_reg, y_dev_cls)

        # Event-date grouped purged/embargoed chronological walk-forward inside Development
        event_date_groups = sorted(df_dev["event_date"].unique())
        n_dev_dates = len(event_date_groups)
        wf_start_idx = max(25, int(n_dev_dates * 0.45))
        step_dates = 10 if h == "1d" else 5

        wf_eval_indices: list[int] = []
        oof_store: dict[str, Any] = {
            "reg": {k: [] for k in ("unconditional_baseline", "event_category_baseline", "ridge_baseline", "xgboost_regressor")},
            "cls": {k: [] for k in ("unconditional_baseline", "event_category_baseline", "logreg_baseline", "xgboost_classifier")},
            "quantiles": {
                k: {0.10: [], 0.50: [], 0.90: []}
                for k in ("unconditional_baseline", "event_category_baseline", "linear_quantile_baseline", "xgboost_quantile")
            },
        }

        for start_i in range(wf_start_idx, n_dev_dates, step_dates):
            val_dates = event_date_groups[start_i : start_i + step_dates]
            tr_cutoff = (pd.Timestamp(val_dates[0]) - pd.Timedelta(days=EMBARGO_CALENDAR_DAYS)).strftime("%Y-%m-%d")
            tr_mask = df_dev["event_date"] <= tr_cutoff
            va_mask = df_dev["event_date"].isin(val_dates)
            df_tr = df_dev[tr_mask].reset_index(drop=True)
            df_va = df_dev[va_mask].reset_index(drop=True)
            if len(df_tr) < 25 or df_va.empty:
                continue

            y_tr_reg = df_tr[real_col].astype(float).values
            y_tr_cls = np.array([_direction_label(v, thresh) for v in y_tr_reg], dtype=int)
            fold_models = _fit_all_horizon_models(df_tr, y_tr_reg, y_tr_cls, tuned)
            fold_preds = _predict_all_horizon_models(fold_models, df_va)

            wf_eval_indices.extend(df_dev.index[va_mask].tolist())
            for k, arr in fold_preds["reg"].items():
                oof_store["reg"][k].append(arr)
            for k, arr in fold_preds["cls"].items():
                oof_store["cls"][k].append(arr)
            for k, qd in fold_preds["quantiles"].items():
                for q in (0.10, 0.50, 0.90):
                    oof_store["quantiles"][k][q].append(qd[q])

        df_wf_eval = df_dev.iloc[wf_eval_indices].reset_index(drop=True)
        y_wf_reg = df_wf_eval[real_col].astype(float).values
        y_wf_cls = np.array([_direction_label(v, thresh) for v in y_wf_reg], dtype=int)
        wf_preds = {
            "reg": {k: np.concatenate(v) for k, v in oof_store["reg"].items()},
            "cls": {k: np.vstack(v) for k, v in oof_store["cls"].items()},
            "quantiles": {k: {q: np.concatenate(qd[q]) for q in (0.10, 0.50, 0.90)} for k, qd in oof_store["quantiles"].items()},
        }

        # Select best validated model per task on Development Walk-Forward OOF
        dev_reg_scores = {k: root_mean_squared_error(y_wf_reg, p) for k, p in wf_preds["reg"].items()}
        best_reg_name = min(dev_reg_scores, key=lambda k: dev_reg_scores[k])

        dev_cls_scores = {k: log_loss(y_wf_cls, p, labels=[0, 1, 2]) for k, p in wf_preds["cls"].items()}
        best_cls_name = min(dev_cls_scores, key=lambda k: dev_cls_scores[k])

        dev_q_scores = {
            k: np.mean([_pinball_loss(y_wf_reg, qd[q], q) for q in (0.10, 0.50, 0.90)])
            for k, qd in wf_preds["quantiles"].items()
        }
        best_q_name = min(dev_q_scores, key=lambda k: dev_q_scores[k])

        dev_eval_report = _evaluate_horizon_split(
            df_wf_eval, y_wf_reg, y_wf_cls, wf_preds, best_reg_name, best_cls_name, best_q_name
        )

        # Untouched Final Holdout: fit ONCE on df_dev (strictly <= embargo_cutoff_date) and evaluate ONCE
        dev_final_models = _fit_all_horizon_models(df_dev, y_dev_reg, y_dev_cls, tuned)
        holdout_preds = _predict_all_horizon_models(dev_final_models, df_holdout)
        holdout_eval_report = _evaluate_horizon_split(
            df_holdout, y_hold_reg, y_hold_cls, holdout_preds, best_reg_name, best_cls_name, best_q_name
        )

        # Production inference models fit on full real history for this horizon using frozen tuned params
        y_all_reg = df_h[real_col].astype(float).values
        y_all_cls = np.array([_direction_label(v, thresh) for v in y_all_reg], dtype=int)
        prod_models = _fit_all_horizon_models(df_h, y_all_reg, y_all_cls, tuned)

        top_features = [
            {"feature": f, "importance": round(float(imp), 4)}
            for f, imp in sorted(
                zip(FEATURE_COLS, prod_models["xgb_reg"].feature_importances_),
                key=lambda x: x[1],
                reverse=True,
            )[:6]
        ]

        sel_reg_dev = dev_eval_report["regression_comparison"][best_reg_name]
        sel_cls_dev = dev_eval_report["classification_comparison"][best_cls_name]
        sel_reg_hold = holdout_eval_report["regression_comparison"][best_reg_name]
        sel_cls_hold = holdout_eval_report["classification_comparison"][best_cls_name]

        window_note = (
            "[08:00 ET -> 12:00 ET] via strictly pre-release 07:00 ET 1h bar close (p0) to 11:00 ET 1h bar close (p1); low-N caveat"
            if h == "4h"
            else "Daily settlement close-to-close post-event return; historical consensus absent (ar_seasonal_proxy)"
        )
        metrics_compat = {
            "horizon": h,
            "status": "CONDITIONALLY_READY",
            "readiness": "CONDITIONALLY_READY",
            "available": True,
            "window_definition": window_note,
            "tuned_params": tuned,
            "selected_models": {
                "regression": best_reg_name,
                "classification": best_cls_name,
                "quantile": best_q_name,
            },
            "total_events": real_count,
            "unique_event_dates": n_unique_dates,
            "exact_intraday_observed_events": real_count,
            "bridged_events": 0,
            "oof_test_events": int(len(df_wf_eval)),
            "holdout_events": int(len(df_holdout)),
            "oof_mae_pct": sel_reg_dev["mae"],
            "oof_rmse_pct": sel_reg_dev["rmse"],
            "oof_directional_error": sel_reg_dev["directional_error"],
            "oof_3class_accuracy": sel_cls_dev["accuracy_3class"],
            "oof_balanced_accuracy": sel_cls_dev["balanced_accuracy"],
            "oof_up_down_accuracy": sel_cls_dev["up_down_accuracy"],
            "oof_roc_auc_up": sel_cls_dev["roc_auc_up"],
            "oof_brier_up": sel_cls_dev["brier_up"],
            "oof_log_loss": sel_cls_dev["log_loss"],
            "holdout_mae_pct": sel_reg_hold["mae"],
            "holdout_rmse_pct": sel_reg_hold["rmse"],
            "holdout_up_down_accuracy": sel_cls_hold["up_down_accuracy"],
            "holdout_roc_auc_up": sel_cls_hold["roc_auc_up"],
            "holdout_brier_up": sel_cls_hold["brier_up"],
            "top_features": top_features,
        }

        report_horizons[h] = metrics_compat
        run_horizons[h] = {
            "status": "CONDITIONALLY_READY",
            "window_definition": window_note,
            "total_real_events": real_count,
            "unique_event_dates": n_unique_dates,
            "bridged_events": 0,
            "split_boundaries": {
                "dev_events": int(len(df_dev)),
                "dev_unique_dates": n_dev_dates,
                "dev_date_range": [str(df_dev["event_date"].min()), str(df_dev["event_date"].max())],
                "embargo_calendar_days": EMBARGO_CALENDAR_DAYS,
                "holdout_start_date": holdout_start_date,
                "holdout_events": int(len(df_holdout)),
                "holdout_unique_dates": int(df_holdout["event_date"].nunique()),
                "holdout_date_range": [str(df_holdout["event_date"].min()), str(df_holdout["event_date"].max())],
            },
            "tuned_hyperparameters": tuned,
            "dev_walk_forward_oof": dev_eval_report,
            "untouched_final_holdout": holdout_eval_report,
            "top_xgb_features": top_features,
        }
        horizon_bundles[h] = {
            "status": "CONDITIONALLY_READY",
            "models": prod_models,
            "selected_models": {
                "regression": best_reg_name,
                "classification": best_cls_name,
                "quantile": best_q_name,
            },
            "metrics": metrics_compat,
        }

    analog_imputer, analog_scaler, X_analog_scaled = _fit_analog_index(events_df)

    events_meta = events_df[
        ["event_date", "event_type", "surprise_z", "ret_1d", "real10y_level", "vix_level"]
    ].to_dict(orient="records")

    bundle = {
        "horizons": horizon_bundles,
        "blocked_horizons": blocked_horizons,
        "blocked_event_types": {
            "FOMC": "BLOCKED: 0 valid FOMC meeting dates in ml/data/* (FRED release_id=101 returned daily rate observations)."
        },
        "feature_cols": FEATURE_COLS,
        "analog_imputer": analog_imputer,
        "analog_scaler": analog_scaler,
        "X_analog_scaled": X_analog_scaled,
        "events_meta": events_meta,
        "dataset_meta": dataset_meta,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    for out_dir in (MODEL3_CANONICAL_DIR, MODEL3_COMPAT_DIR):
        joblib.dump(bundle, out_dir / "xauusd_reaction.joblib")

    report_summary = {
        "model": "Model 3 — XAUUSD Market Reaction Model (Honest Real-Return Multi-Horizon Evaluation)",
        "trained_at": bundle["trained_at"],
        "dataset_meta": dataset_meta,
        "blocked_event_types": bundle["blocked_event_types"],
        "horizons": report_horizons,
    }
    (REPORTS_DIR / "model3_training_report.json").write_text(json.dumps(report_summary, indent=2), encoding="utf-8")
    (MODEL3_CANONICAL_DIR / "model3_training_report.json").write_text(json.dumps(report_summary, indent=2), encoding="utf-8")

    run_metadata = {
        "model_id": "model3_market_reaction",
        "phase": "Phase 5 & 7",
        "generated_at": bundle["trained_at"],
        "artifacts": {
            "canonical_dir": "ml/artifacts/market_reaction/",
            "compatible_dir": "ml/artifacts/model3_market_reaction/",
            "event_study_csv": "ml/data/xauusd_macro_events.csv",
            "training_report": "ml/artifacts/reports/model3_training_report.json",
            "run_metadata": "ml/artifacts/training_runs/model3_run.json",
        },
        "dataset_audit": dataset_meta,
        "leakage_and_data_constraints": {
            "synthetic_target_bridging_removed": True,
            "intraday_bar_open_convention_fixed": True,
            "cftc_friday_publication_lag_enforced": True,
            "bamlh0a0hym2_excluded_reason": "Starts 2023-11-13; excluded to avoid backfilling future medians onto 2002-2023 events.",
            "event_date_grouped_walk_forward": True,
            "embargo_calendar_days": EMBARGO_CALENDAR_DAYS,
            "historical_consensus_available": False,
            "surprise_source": "ar_seasonal_proxy",
            "blocked_horizons": list(blocked_horizons.keys()),
            "blocked_event_types": list(BLOCKED_EVENT_TYPES),
        },
        "horizons": run_horizons,
    }
    (TRAINING_RUNS_DIR / "model3_run.json").write_text(json.dumps(run_metadata, indent=2), encoding="utf-8")
    return report_summary


def build_current_market_condition_row(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    event_type: str = "CPI",
    surprise_z: float = 0.0,
) -> tuple[dict[str, float], float]:
    """Build live pre-event market conditioning vector from latest real market + FRED data."""
    sigs = _prepare_daily_signal_series(fred_daily, market_data, cftc_df)
    spot_xau = float(sigs["xau"].iloc[-1])
    ev_dt = sigs["xau"].index[-1] + pd.Timedelta(days=1)
    row = _extract_event_features(sigs, ev_dt, event_type, float(surprise_z))
    return row, spot_xau


def _predict_single_horizon_from_bundle(
    hb: dict[str, Any],
    X_cur: pd.DataFrame,
    event_type: str,
    spot_xau: float,
) -> dict[str, Any]:
    models = hb["models"]
    sel = hb["selected_models"]
    reg_name = sel["regression"]
    cls_name = sel["classification"]

    # Regression expectation from selected validated model
    if reg_name == "unconditional_baseline":
        exp_ret = float(models["uncond_mean"])
    elif reg_name == "event_category_baseline":
        exp_ret = float(models["cat_means"].get(event_type, models["uncond_mean"]))
    elif reg_name == "ridge_baseline":
        exp_ret = float(models["ridge"].predict(X_cur)[0])
    else:
        exp_ret = float(models["xgb_reg"].predict(X_cur)[0])

    # Classification probabilities from selected validated model
    if cls_name == "unconditional_baseline":
        probs = np.array(models["uncond_probs"], dtype=float)
    elif cls_name == "event_category_baseline":
        probs = np.array(models["cat_probs"].get(event_type, models["uncond_probs"]), dtype=float)
    elif cls_name == "logreg_baseline":
        lr_classes = list(models["logreg"].named_steps["m"].classes_)
        raw = models["logreg"].predict_proba(X_cur)[0]
        probs = np.full(3, 1e-6, dtype=float)
        for ci, cl in enumerate(lr_classes):
            probs[int(cl)] = float(raw[ci])
        probs = probs / probs.sum()
    else:
        xgb_classes = list(models["xgb_clf"].classes_)
        raw = models["xgb_clf"].predict_proba(X_cur)[0]
        probs = np.full(3, 1e-6, dtype=float)
        for ci, cl in enumerate(xgb_classes):
            probs[int(cl)] = float(raw[ci])
        probs = probs / probs.sum()

    p_down, p_flat, p_up = float(probs[0]), float(probs[1]), float(probs[2])

    # Quantiles (dispatch strictly to the Dev-selected quantile model family, sorted for monotonicity)
    q_name = sel.get("quantile", "xgboost_quantile")
    if q_name == "unconditional_baseline":
        q_vals = sorted([float(models["uncond_quantiles"][q]) for q in QUANTILE_ALPHAS])
    elif q_name == "event_category_baseline":
        cq = models["cat_quantiles"].get(event_type, models["uncond_quantiles"])
        q_vals = sorted([float(cq[q]) for q in QUANTILE_ALPHAS])
    elif q_name == "linear_quantile_baseline":
        q_vals = sorted([float(models["lin_quantiles"][q].predict(X_cur)[0]) for q in QUANTILE_ALPHAS])
    else:
        q_vals = sorted([float(models["xgb_quantiles"][q].predict(X_cur)[0]) for q in QUANTILE_ALPHAS])
    p10, p25, p50, p75, p90 = q_vals

    direction = "BULLISH" if p_up > p_down + 0.05 else "BEARISH" if p_down > p_up + 0.05 else "NEUTRAL"
    return {
        "horizon": hb["metrics"]["horizon"],
        "status": hb["metrics"].get("status", "CONDITIONALLY_READY"),
        "available": True,
        "selected_models": sel,
        "direction": direction,
        "prob_up": round(p_up, 3),
        "prob_flat": round(p_flat, 3),
        "prob_down": round(p_down, 3),
        "expected_return_pct": round(exp_ret, 3),
        "expected_usd_move": round(spot_xau * (exp_ret / 100.0), 2),
        "distribution_pct": {
            "p10": round(p10, 3),
            "p25": round(p25, 3),
            "p50": round(p50, 3),
            "p75": round(p75, 3),
            "p90": round(p90, 3),
        },
        "metrics": hb["metrics"],
    }


def _blocked_horizon_payload(h: str, reason: str, base_metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    metrics = dict(base_metrics or {})
    metrics.setdefault("horizon", h)
    metrics["status"] = "BLOCKED"
    metrics["readiness"] = "BLOCKED"
    metrics["available"] = False
    metrics["reason"] = reason
    metrics.setdefault("total_events", 0)
    metrics.setdefault("exact_intraday_observed_events", 0)
    metrics["bridged_events"] = 0
    return {
        "horizon": h,
        "status": "BLOCKED",
        "readiness": "BLOCKED",
        "available": False,
        "reason": reason,
        "direction": "UNAVAILABLE",
        "prob_up": None,
        "prob_flat": None,
        "prob_down": None,
        "expected_return_pct": None,
        "expected_usd_move": None,
        "distribution_pct": {"p10": None, "p25": None, "p50": None, "p75": None, "p90": None},
        "metrics": metrics,
    }


def _load_model3_bundle() -> dict[str, Any]:
    canonical = MODEL3_CANONICAL_DIR / "xauusd_reaction.joblib"
    if canonical.exists():
        return joblib.load(canonical)
    return joblib.load(MODEL3_COMPAT_DIR / "xauusd_reaction.joblib")


def predict_xauusd_reaction(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    event_type: str = "CPI",
    surprise_z: float = 0.0,
) -> dict[str, Any]:
    """Predict XAUUSD direction & return distribution across valid horizons (4h, 1d); return BLOCKED/null for 5m, 30m, FOMC."""
    bundle = _load_model3_bundle()
    event_type_norm = str(event_type).upper()
    cond_row, spot_xau = build_current_market_condition_row(
        fred_daily, market_data, cftc_df, event_type=event_type_norm, surprise_z=surprise_z
    )
    X_cur = pd.DataFrame([cond_row])[bundle["feature_cols"]]

    horizons_out: dict[str, Any] = {}
    if event_type_norm in BLOCKED_EVENT_TYPES:
        fomc_reason = bundle.get("blocked_event_types", {}).get(
            event_type_norm,
            f"{event_type_norm} is BLOCKED: no valid historical meeting calendar in dataset.",
        )
        for h in HORIZONS:
            base_m = bundle.get("horizons", {}).get(h, {}).get("metrics") or bundle.get("blocked_horizons", {}).get(h)
            horizons_out[h] = _blocked_horizon_payload(h, fomc_reason, base_m)
    else:
        for h in HORIZONS:
            if h in bundle.get("horizons", {}):
                horizons_out[h] = _predict_single_horizon_from_bundle(
                    bundle["horizons"][h], X_cur, event_type_norm, spot_xau
                )
            else:
                b_info = bundle.get("blocked_horizons", {}).get(h, {})
                reason = b_info.get("reason", f"INSUFFICIENT_DATA: {h} horizon is blocked.")
                horizons_out[h] = _blocked_horizon_payload(h, reason, b_info)

    X_cur_imp = bundle["analog_imputer"].transform(X_cur)
    X_cur_scaled = bundle["analog_scaler"].transform(X_cur_imp)
    sims = cosine_similarity(X_cur_scaled, bundle["X_analog_scaled"])[0]
    top_idx = np.argsort(sims)[::-1][:5]
    analogs = []
    for idx in top_idx:
        meta = bundle["events_meta"][int(idx)]
        analogs.append(
            {
                "event_date": meta["event_date"],
                "event_type": meta["event_type"],
                "surprise_z": round(float(meta["surprise_z"]), 2),
                "xau_ret_1d_pct": round(float(meta["ret_1d"]), 2),
                "real10y_level": round(float(meta["real10y_level"]), 2) if pd.notna(meta["real10y_level"]) else None,
                "vix_level": round(float(meta["vix_level"]), 2) if pd.notna(meta["vix_level"]) else None,
                "similarity": round(float(sims[int(idx)]), 3),
            }
        )

    return {
        "model": "Model 3 — Market Reaction Model (Honest Real-Return Multi-Horizon Evaluation)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "event_type": event_type_norm,
        "event_status": "BLOCKED" if event_type_norm in BLOCKED_EVENT_TYPES else "CONDITIONALLY_READY",
        "surprise_source": "ar_seasonal_proxy",
        "input_surprise_z": round(float(surprise_z), 2),
        "spot_xauusd": round(spot_xau, 2),
        "market_conditions": {k: round(float(v), 3) if np.isfinite(v) else None for k, v in cond_row.items()},
        "horizons": horizons_out,
        "historical_analogs": analogs,
    }
