from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.compose import TransformedTargetRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import HuberRegressor, Ridge
from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from ml.config import ARTIFACTS_DIR, REPORTS_DIR
from ml.data_pipeline import trim_incomplete_monthly_tail

# Preserve compatibility with existing inference & verify_all.py while also
# writing the canonical Phase 3/7 artifacts under ml/artifacts/economic_forecast/.
MODEL1_DIR = ARTIFACTS_DIR / "model1_economic_forecast"
ECON_ARTIFACTS_DIR = ARTIFACTS_DIR / "economic_forecast"
TRAINING_RUNS_DIR = ARTIFACTS_DIR / "training_runs"
for _d in (MODEL1_DIR, ECON_ARTIFACTS_DIR, TRAINING_RUNS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

MIN_FEATURE_COVERAGE_MONTHS = 120  # Exclude ultra-short series (e.g. 2023+ OAS) to avoid future-median imputer breaks
MONTHLY_HOLDOUT_PERIODS = 24
QUARTERLY_HOLDOUT_PERIODS = 8


@dataclass(frozen=True)
class IndicatorSpec:
    key: str
    fred_series: str
    label: str
    transform: str  # "mom_pct" | "diff" | "diff_to_level" | "qoq_ann_pct"
    unit: str
    yoy_unit: str | None
    freq: str = "M"  # "M" | "Q"


INDICATOR_SPECS: dict[str, IndicatorSpec] = {
    "CPI": IndicatorSpec("CPI", "CPIAUCSL", "US Headline CPI", "mom_pct", "% MoM", "% YoY", "M"),
    "CORE_CPI": IndicatorSpec("CORE_CPI", "CPILFESL", "US Core CPI", "mom_pct", "% MoM", "% YoY", "M"),
    "PCE": IndicatorSpec("PCE", "PCEPI", "US Headline PCE", "mom_pct", "% MoM", "% YoY", "M"),
    "CORE_PCE": IndicatorSpec("CORE_PCE", "PCEPILFE", "US Core PCE", "mom_pct", "% MoM", "% YoY", "M"),
    "NFP": IndicatorSpec("NFP", "PAYEMS", "US Nonfarm Payrolls", "diff", "K jobs", None, "M"),
    "UNRATE": IndicatorSpec("UNRATE", "UNRATE", "US Unemployment Rate", "diff_to_level", "%", None, "M"),
    "GDPC1": IndicatorSpec("GDPC1", "GDPC1", "US Real GDP", "qoq_ann_pct", "% QoQ Ann.", "% YoY", "Q"),
}

PRICE_PIPELINE_SERIES = [
    "DCOILWTICO", "GASREGW", "PPIFIS", "PPIACO",
    "CUSR0000SAH1", "CUSR0000SASLE", "CPIAUCSL", "CPILFESL",
]
LABOR_REAL_SERIES = ["ICSA", "CCSA", "CES0500000003", "JTSJOL", "INDPRO", "RSAFS", "M2SL"]
RATES_MARKET_SERIES = ["T10YIE", "T5YIE", "T5YIFR", "DGS2", "DGS10", "DFII10", "T10Y2Y", "VIXCLS"]


def _safe_pct(s: pd.Series, periods: int = 1) -> pd.Series:
    return (s / s.shift(periods) - 1.0) * 100.0


def _compute_target_series(raw_series: pd.Series, spec: IndicatorSpec) -> tuple[pd.Series, pd.Series]:
    """Compute target series on a regular calendar grid (never dropping internal NaNs before shifting)."""
    if spec.transform == "mom_pct":
        y = _safe_pct(raw_series, 1)
        yoy = _safe_pct(raw_series, 12)
    elif spec.transform == "qoq_ann_pct":
        y = ((raw_series / raw_series.shift(1)) ** 4 - 1.0) * 100.0
        yoy = _safe_pct(raw_series, 4)
    elif spec.transform in ("diff", "diff_to_level"):
        y = raw_series.diff(1)
        yoy = raw_series
    else:
        raise ValueError(f"Unsupported transform: {spec.transform}")
    return y.rename("target"), yoy.rename("yoy")


def _build_feature_frame(
    panel_df: pd.DataFrame,
    spec: IndicatorSpec,
    next_period: pd.Timestamp | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.Series, dict[str, list[str]]]:
    """Build strictly lagged feature matrix (100% shared between training and live inference)."""
    if spec.freq == "Q":
        base_df = panel_df.sort_index().resample("QS").mean()
        if spec.fred_series in panel_df.columns:
            base_df[spec.fred_series] = panel_df[spec.fred_series].resample("QS").first()
        if next_period is not None:
            base_df = base_df.reindex(base_df.index.union([next_period])).sort_index()
        raw_target = base_df[spec.fred_series]
        y, yoy = _compute_target_series(raw_target, spec)
        ar_lags = (1, 2, 3, 4)
        ma_windows = ((4, 2),)
    else:
        base_df = trim_incomplete_monthly_tail(panel_df).sort_index().asfreq("MS")
        if next_period is not None:
            base_df = base_df.reindex(base_df.index.union([next_period])).sort_index()
        raw_target = base_df[spec.fred_series]
        y, yoy = _compute_target_series(raw_target, spec)
        ar_lags = (1, 2, 3, 4, 6, 12)
        ma_windows = ((3, 1), (6, 2), (12, 4))

    # Exclude ultra-short series (e.g. 37-month BAML OAS) to prevent structural imputer shift
    eligible_cols = {
        c for c in base_df.columns
        if int(base_df[c].notna().sum()) >= (MIN_FEATURE_COVERAGE_MONTHS // (3 if spec.freq == "Q" else 1))
    }

    feats = pd.DataFrame(index=base_df.index)
    groups: dict[str, list[str]] = {
        "ar_seasonal": [],
        "price_pipeline": [],
        "labor_real": [],
        "rates_markets": [],
    }

    def _add(group: str, col_name: str, series: pd.Series) -> None:
        feats[col_name] = series
        groups[group].append(col_name)

    for lag in ar_lags:
        _add("ar_seasonal", f"target_lag_{lag}", y.shift(lag))
    for win, min_p in ma_windows:
        _add("ar_seasonal", f"target_ma_{win}", y.shift(1).rolling(win, min_periods=min_p).mean())
    std_win, std_min = (4, 2) if spec.freq == "Q" else (6, 3)
    _add("ar_seasonal", f"target_std_{std_win}", y.shift(1).rolling(std_win, min_periods=std_min).std())
    if spec.freq == "M":
        _add("ar_seasonal", "target_mom_accel", feats["target_ma_3"] - feats["target_ma_12"])
    _add("ar_seasonal", "target_diff_1_2", feats["target_lag_1"] - feats["target_lag_2"])

    if spec.freq == "Q":
        q_num = feats.index.quarter
        _add("ar_seasonal", "period_sin", pd.Series(np.sin(2.0 * np.pi * q_num / 4.0), index=feats.index))
        _add("ar_seasonal", "period_cos", pd.Series(np.cos(2.0 * np.pi * q_num / 4.0), index=feats.index))

        for sid in ["DCOILWTICO", "PPIACO", "CPIAUCSL"]:
            if sid in eligible_cols and sid != spec.fred_series:
                _add("price_pipeline", f"{sid}_qoq_1", _safe_pct(base_df[sid], 1).shift(1))
                _add("price_pipeline", f"{sid}_yoy_1", _safe_pct(base_df[sid], 4).shift(1))

        for sid in ["INDPRO", "RSAFS", "PAYEMS", "ICSA", "M2SL"]:
            if sid in eligible_cols:
                _add("labor_real", f"{sid}_qoq_1", _safe_pct(base_df[sid], 1).shift(1))
                _add("labor_real", f"{sid}_yoy_1", _safe_pct(base_df[sid], 4).shift(1))
        for sid in ["UNRATE", "UMCSENT"]:
            if sid in eligible_cols:
                _add("labor_real", f"{sid}_lvl_1", base_df[sid].shift(1))
                _add("labor_real", f"{sid}_chg_1", base_df[sid].diff(1).shift(1))

        for sid in ["DGS2", "DGS10", "DFII10", "T10Y2Y", "VIXCLS"]:
            if sid in eligible_cols:
                _add("rates_markets", f"{sid}_lvl_1", base_df[sid].shift(1))
                _add("rates_markets", f"{sid}_chg_1", base_df[sid].diff(1).shift(1))
    else:
        month = feats.index.month
        _add("ar_seasonal", "month_sin", pd.Series(np.sin(2.0 * np.pi * month / 12.0), index=feats.index))
        _add("ar_seasonal", "month_cos", pd.Series(np.cos(2.0 * np.pi * month / 12.0), index=feats.index))

        for sid in PRICE_PIPELINE_SERIES:
            if sid in eligible_cols and sid != spec.fred_series:
                _add("price_pipeline", f"{sid}_mom_1", _safe_pct(base_df[sid], 1).shift(1))
                _add("price_pipeline", f"{sid}_mom_3", _safe_pct(base_df[sid], 3).shift(1))

        if "UNRATE" in eligible_cols:
            _add("labor_real", "UNRATE_lvl_1", base_df["UNRATE"].shift(1))
            _add("labor_real", "UNRATE_chg_1", base_df["UNRATE"].diff(1).shift(1))
            _add("labor_real", "UNRATE_chg_3", base_df["UNRATE"].diff(3).shift(1))
        for sid in LABOR_REAL_SERIES:
            if sid in eligible_cols:
                _add("labor_real", f"{sid}_mom_1", _safe_pct(base_df[sid], 1).shift(1))
                _add("labor_real", f"{sid}_mom_3", _safe_pct(base_df[sid], 3).shift(1))
                _add("labor_real", f"{sid}_yoy_1", _safe_pct(base_df[sid], 12).shift(1))
        if "UMCSENT" in eligible_cols:
            _add("labor_real", "UMCSENT_lvl_1", base_df["UMCSENT"].shift(1))
            _add("labor_real", "UMCSENT_chg_1", base_df["UMCSENT"].diff(1).shift(1))

        for sid in RATES_MARKET_SERIES:
            if sid in eligible_cols:
                _add("rates_markets", f"{sid}_lvl_1", base_df[sid].shift(1))
                _add("rates_markets", f"{sid}_chg_1", base_df[sid].diff(1).shift(1))
                _add("rates_markets", f"{sid}_chg_3", base_df[sid].diff(3).shift(1))
        if "DTWEXBGS" in eligible_cols:
            _add("rates_markets", "DXY_broad_mom_1", _safe_pct(base_df["DTWEXBGS"], 1).shift(1))
            _add("rates_markets", "DXY_broad_mom_3", _safe_pct(base_df["DTWEXBGS"], 3).shift(1))

    prev_level = raw_target.shift(1).rename("prev_level")
    return feats, y, yoy, prev_level, groups


def build_monthly_features(
    monthly_df: pd.DataFrame,
    spec: IndicatorSpec,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Build strictly lagged feature matrix X (available prior to release t) and target y_t."""
    feats, y, yoy, _, _ = _build_feature_frame(monthly_df, spec)
    if spec.freq == "Q":
        valid_mask = y.notna() & feats["target_lag_1"].notna() & feats["target_lag_2"].notna()
    else:
        valid_mask = y.notna() & feats["target_lag_1"].notna() & feats["target_ma_3"].notna()
    return feats.loc[valid_mask], y.loc[valid_mask], yoy


def _causal_sample_weights(y_tr: pd.Series, half_life_periods: float = 108.0) -> np.ndarray:
    """Compute recency + outlier dampening weights strictly inside a training fold (zero look-ahead)."""
    n = len(y_tr)
    ages = np.arange(n - 1, -1, -1, dtype=float)
    recency = np.exp(-np.log(2.0) * ages / half_life_periods)
    tr_med = float(y_tr.median())
    tr_mad = float(max(1.4826 * np.median(np.abs(y_tr - tr_med)), 1e-4))
    outlier_scale = np.where(np.abs(y_tr - tr_med) > 6.0 * tr_mad, 0.20, 1.0)
    return recency * outlier_scale


def _make_ridge_pipe(alpha: float) -> Pipeline:
    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scaler", StandardScaler()),
            ("ridge", Ridge(alpha=alpha)),
        ]
    )


def _make_huber_pipe(alpha: float, epsilon: float) -> TransformedTargetRegressor:
    return TransformedTargetRegressor(
        regressor=Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                ("scaler", StandardScaler()),
                ("huber", HuberRegressor(alpha=alpha, epsilon=epsilon, max_iter=2000, tol=1e-4)),
            ]
        ),
        transformer=StandardScaler(),
    )


def _make_xgb_point(params: dict[str, Any]) -> XGBRegressor:
    return XGBRegressor(
        **params,
        reg_alpha=0.8,
        min_child_weight=3,
        random_state=42,
        n_jobs=4,
    )


def _make_xgb_quantile(alpha: float, params: dict[str, Any]) -> XGBRegressor:
    return XGBRegressor(
        max_depth=params["max_depth"],
        learning_rate=params["learning_rate"],
        n_estimators=max(100, params["n_estimators"] - 20),
        reg_lambda=params["reg_lambda"],
        subsample=params["subsample"],
        colsample_bytree=params["colsample_bytree"],
        reg_alpha=0.6,
        min_child_weight=3,
        objective="reg:quantileerror",
        quantile_alpha=alpha,
        random_state=42,
        n_jobs=4,
    )


def _tune_models_in_dev(
    X_dev: pd.DataFrame,
    y_dev: pd.Series,
    half_life: float,
) -> dict[str, Any]:
    """Tune Ridge, Huber, and XGBoost strictly inside the development split via TimeSeriesSplit."""
    tscv = TimeSeriesSplit(n_splits=4)

    ridge_grid = [25.0, 75.0, 150.0, 350.0, 750.0]
    best_ridge_alpha, best_ridge_mae = 150.0, float("inf")
    for alpha in ridge_grid:
        maes = []
        for tr_idx, va_idx in tscv.split(X_dev):
            w_tr = _causal_sample_weights(y_dev.iloc[tr_idx], half_life)
            m = _make_ridge_pipe(alpha)
            m.fit(X_dev.iloc[tr_idx], y_dev.iloc[tr_idx], ridge__sample_weight=w_tr)
            maes.append(mean_absolute_error(y_dev.iloc[va_idx], m.predict(X_dev.iloc[va_idx])))
        avg = float(np.mean(maes))
        if avg < best_ridge_mae:
            best_ridge_mae, best_ridge_alpha = avg, alpha

    huber_grid = [(a, e) for a in (5.0, 20.0, 60.0) for e in (1.25, 1.35, 1.5)]
    best_huber_params, best_huber_mae = (20.0, 1.35), float("inf")
    for alpha, eps in huber_grid:
        maes = []
        for tr_idx, va_idx in tscv.split(X_dev):
            m = _make_huber_pipe(alpha, eps)
            m.fit(X_dev.iloc[tr_idx], y_dev.iloc[tr_idx])
            maes.append(mean_absolute_error(y_dev.iloc[va_idx], m.predict(X_dev.iloc[va_idx])))
        avg = float(np.mean(maes))
        if avg < best_huber_mae:
            best_huber_mae, best_huber_params = avg, (alpha, eps)

    xgb_grid = [
        {"max_depth": 2, "learning_rate": 0.03, "n_estimators": 120, "reg_lambda": 6.0, "subsample": 0.80, "colsample_bytree": 0.70},
        {"max_depth": 2, "learning_rate": 0.04, "n_estimators": 180, "reg_lambda": 10.0, "subsample": 0.85, "colsample_bytree": 0.75},
        {"max_depth": 3, "learning_rate": 0.03, "n_estimators": 160, "reg_lambda": 10.0, "subsample": 0.80, "colsample_bytree": 0.70},
        {"max_depth": 3, "learning_rate": 0.04, "n_estimators": 220, "reg_lambda": 14.0, "subsample": 0.75, "colsample_bytree": 0.65},
    ]
    best_xgb_params, best_xgb_mae = xgb_grid[0], float("inf")
    for params in xgb_grid:
        maes = []
        for tr_idx, va_idx in tscv.split(X_dev):
            w_tr = _causal_sample_weights(y_dev.iloc[tr_idx], half_life)
            m = _make_xgb_point(params)
            m.fit(X_dev.iloc[tr_idx], y_dev.iloc[tr_idx], sample_weight=w_tr)
            maes.append(mean_absolute_error(y_dev.iloc[va_idx], m.predict(X_dev.iloc[va_idx])))
        avg = float(np.mean(maes))
        if avg < best_xgb_mae:
            best_xgb_mae, best_xgb_params = avg, params

    return {
        "ridge_alpha": best_ridge_alpha,
        "ridge_tscv_mae": round(best_ridge_mae, 4),
        "huber_alpha": best_huber_params[0],
        "huber_epsilon": best_huber_params[1],
        "huber_tscv_mae": round(best_huber_mae, 4),
        "xgb_params": best_xgb_params,
        "xgb_tscv_mae": round(best_xgb_mae, 4),
    }


def _compute_regression_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    mase_denom: float,
    last_value_mae: float | None = None,
) -> dict[str, float]:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(root_mean_squared_error(y_true, y_pred))
    bias = float(np.mean(y_pred - y_true))
    mase = float(mae / max(mase_denom, 1e-6))
    out: dict[str, float] = {
        "n": int(len(y_true)),
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "mase": round(mase, 4),
        "forecast_bias": round(bias, 4),
    }
    if last_value_mae is not None and last_value_mae > 1e-9:
        out["mae_ratio_vs_last_value"] = round(mae / last_value_mae, 4)
    return out


def _pinball_loss(y_true: np.ndarray, y_q: np.ndarray, q: float) -> float:
    err = y_true - y_q
    return float(np.mean(np.maximum(q * err, (q - 1.0) * err)))


def _run_feature_ablation(
    X_dev: pd.DataFrame,
    y_dev: pd.Series,
    groups: dict[str, list[str]],
    tuned: dict[str, Any],
    min_train: int,
    half_life: float,
    mase_denom: float,
    refit_stride: int,
) -> dict[str, Any]:
    """Run chronological walk-forward feature ablation strictly inside the development window."""
    ar_cols = [c for c in groups["ar_seasonal"] if c in X_dev.columns]
    ablation_sets = {
        "ar_seasonal_only": ar_cols,
        "ar_plus_price_pipeline": ar_cols + [c for c in groups["price_pipeline"] if c in X_dev.columns],
        "ar_plus_labor_real": ar_cols + [c for c in groups["labor_real"] if c in X_dev.columns],
        "ar_plus_rates_markets": ar_cols + [c for c in groups["rates_markets"] if c in X_dev.columns],
        "all_features": X_dev.columns.tolist(),
    }

    ablation_out: dict[str, Any] = {}
    for name, cols in ablation_sets.items():
        if not cols:
            continue
        X_sub = X_dev[cols]
        preds_ridge, preds_xgb, actuals = [], [], []
        m_r, m_x = None, None
        for idx in range(min_train, len(X_sub)):
            if (idx - min_train) % refit_stride == 0 or m_r is None:
                X_tr, y_tr = X_sub.iloc[:idx], y_dev.iloc[:idx]
                w_tr = _causal_sample_weights(y_tr, half_life)
                m_r = _make_ridge_pipe(tuned["ridge_alpha"])
                m_r.fit(X_tr, y_tr, ridge__sample_weight=w_tr)
                m_x = _make_xgb_point(tuned["xgb_params"]).fit(X_tr, y_tr, sample_weight=w_tr)
            X_te = X_sub.iloc[[idx]]
            y_lo, y_hi = float(y_dev.iloc[:idx].min()), float(y_dev.iloc[:idx].max())
            preds_ridge.append(float(np.clip(m_r.predict(X_te)[0], y_lo, y_hi)))
            preds_xgb.append(float(m_x.predict(X_te)[0]))
            actuals.append(float(y_dev.iloc[idx]))

        y_arr = np.asarray(actuals)
        ablation_out[name] = {
            "n_features": len(cols),
            "ridge": _compute_regression_metrics(y_arr, np.asarray(preds_ridge), mase_denom),
            "xgboost": _compute_regression_metrics(y_arr, np.asarray(preds_xgb), mase_denom),
        }
    return ablation_out


def _build_causal_regime_labels(monthly_df: pd.DataFrame, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Assign strictly lagged (known prior to t) inflation and growth regime labels."""
    df = trim_incomplete_monthly_tail(monthly_df).sort_index().asfreq("MS")
    cpi_yoy_lag = _safe_pct(df["CPIAUCSL"], 12).shift(1) if "CPIAUCSL" in df.columns else pd.Series(np.nan, index=df.index)
    indpro_yoy_lag = _safe_pct(df["INDPRO"], 12).shift(1) if "INDPRO" in df.columns else pd.Series(np.nan, index=df.index)
    unrate_chg_lag = df["UNRATE"].diff(12).shift(1) if "UNRATE" in df.columns else pd.Series(np.nan, index=df.index)

    reg = pd.DataFrame(index=df.index)
    reg["cpi_yoy_lag"] = cpi_yoy_lag
    reg["indpro_yoy_lag"] = indpro_yoy_lag
    reg["unrate_12m_chg_lag"] = unrate_chg_lag

    def _inf_label(v: float) -> str:
        if pd.isna(v):
            return "unknown"
        if v < 2.0:
            return "low_inflation_lt_2pct"
        if v <= 3.5:
            return "moderate_inflation_2_to_3.5pct"
        return "high_inflation_gt_3.5pct"

    def _growth_label(row: pd.Series) -> str:
        ip = row["indpro_yoy_lag"]
        ur = row["unrate_12m_chg_lag"]
        if pd.isna(ip) and pd.isna(ur):
            return "unknown"
        if (pd.notna(ip) and ip < 0.0) or (pd.notna(ur) and ur >= 0.5):
            return "contraction_or_recession"
        if pd.notna(ip) and ip < 1.5:
            return "slowdown_0_to_1.5pct_ip"
        return "expansion"

    reg["inflation_regime"] = reg["cpi_yoy_lag"].apply(_inf_label)
    reg["growth_regime"] = reg.apply(_growth_label, axis=1)
    return reg.reindex(index)


def _evaluate_by_regime(
    oof_df: pd.DataFrame,
    regimes: pd.DataFrame,
    mase_denom: float,
) -> dict[str, dict[str, Any]]:
    """Compute OOF error, bias, and 80% coverage segmented by inflation & growth regimes."""
    joined = oof_df.join(regimes[["inflation_regime", "growth_regime"]], how="left")
    out: dict[str, dict[str, Any]] = {"inflation_regime": {}, "growth_regime": {}}
    for col in ("inflation_regime", "growth_regime"):
        for reg_name, grp in joined.groupby(col):
            if reg_name == "unknown" or len(grp) < 5:
                continue
            y_t = grp["actual"].to_numpy()
            y_p = grp["model_forecast"].to_numpy()
            y_lv = grp["last_value_baseline"].to_numpy()
            lv_mae = float(mean_absolute_error(y_t, y_lv))
            m = _compute_regression_metrics(y_t, y_p, mase_denom, lv_mae)
            m["last_value_mae"] = round(lv_mae, 4)
            m["interval_80_coverage"] = round(float(grp["covered_80"].mean()), 4)
            out[col][str(reg_name)] = m
    return out


def _select_point_prediction(
    model_name: str,
    preds: dict[str, float],
) -> float:
    return preds[model_name]


def train_indicator_model(monthly_df: pd.DataFrame, spec: IndicatorSpec) -> dict[str, Any]:
    """Train & validate Economic Value Forecast model with untouched final holdout and strict causal calibration."""
    feats, y, yoy, prev_level, groups = _build_feature_frame(monthly_df, spec)
    if spec.freq == "Q":
        valid_mask = y.notna() & feats["target_lag_1"].notna() & feats["target_lag_2"].notna()
        holdout_n = QUARTERLY_HOLDOUT_PERIODS
        min_train = 44
        half_life = 36.0  # ~9 years in quarters
        refit_stride = 1
        seasonal_col = "target_lag_4"
        ma_fallback_col = "target_ma_4"
    else:
        valid_mask = y.notna() & feats["target_lag_1"].notna() & feats["target_ma_3"].notna()
        holdout_n = MONTHLY_HOLDOUT_PERIODS
        min_train = 84
        half_life = 108.0
        refit_stride = 3
        seasonal_col = "target_lag_12"
        ma_fallback_col = "target_ma_12"

    X = feats.loc[valid_mask]
    y = y.loc[valid_mask]
    prev_lvl_valid = prev_level.loc[valid_mask]
    ar_cols = [c for c in groups["ar_seasonal"] if c in X.columns]

    if len(X) <= min_train + holdout_n + 12:
        raise RuntimeError(f"Insufficient observations for {spec.key}: {len(X)}")

    X_dev, y_dev = X.iloc[:-holdout_n], y.iloc[:-holdout_n]
    X_hold, y_hold = X.iloc[-holdout_n:], y.iloc[-holdout_n:]

    # In-sample 1-step naive scale from development split only (Hyndman-Koehler MASE denominator)
    mase_denom = float(y_dev.diff().abs().dropna().mean()) if spec.transform != "diff_to_level" else float(y_dev.abs().mean())
    mase_denom = max(mase_denom, 1e-6)

    # Tune strictly inside X_dev, y_dev (holdout untouched)
    tuned = _tune_models_in_dev(X_dev, y_dev, half_life=half_life)

    # Expanding chronological walk-forward across dev_wf AND untouched holdout
    candidate_names = ["last_value", "seasonal_naive", "ar_ridge", "ridge", "huber", "xgboost", "ensemble"]
    oof_preds: dict[str, list[float]] = {k: [] for k in candidate_names}
    oof_dates: list[pd.Timestamp] = []
    oof_actual: list[float] = []
    oof_prev_lvl: list[float] = []
    oof_raw_p10: list[float] = []
    oof_raw_p50: list[float] = []
    oof_raw_p90: list[float] = []
    oof_cal_p10: list[float] = []
    oof_cal_p90: list[float] = []
    past_nonconformity: list[float] = []

    cached: dict[str, Any] = {}
    for idx in range(min_train, len(X)):
        if (idx - min_train) % refit_stride == 0 or not cached:
            X_tr, y_tr = X.iloc[:idx], y.iloc[:idx]
            w_tr = _causal_sample_weights(y_tr, half_life)
            cached["ar"] = _make_ridge_pipe(35.0).fit(X_tr[ar_cols], y_tr)
            cached["ridge"] = _make_ridge_pipe(tuned["ridge_alpha"]).fit(X_tr, y_tr, ridge__sample_weight=w_tr)
            cached["huber"] = _make_huber_pipe(tuned["huber_alpha"], tuned["huber_epsilon"]).fit(X_tr, y_tr)
            cached["xgb"] = _make_xgb_point(tuned["xgb_params"]).fit(X_tr, y_tr, sample_weight=w_tr)
            cached["q10"] = _make_xgb_quantile(0.10, tuned["xgb_params"]).fit(X_tr, y_tr, sample_weight=w_tr)
            cached["q50"] = _make_xgb_quantile(0.50, tuned["xgb_params"]).fit(X_tr, y_tr, sample_weight=w_tr)
            cached["q90"] = _make_xgb_quantile(0.90, tuned["xgb_params"]).fit(X_tr, y_tr, sample_weight=w_tr)

        X_te = X.iloc[[idx]]
        y_lo, y_hi = float(y.iloc[:idx].min()), float(y.iloc[:idx].max())
        p_ridge = float(np.clip(cached["ridge"].predict(X_te)[0], y_lo, y_hi))
        p_huber = float(np.clip(cached["huber"].predict(X_te)[0], y_lo, y_hi))
        p_xgb = float(cached["xgb"].predict(X_te)[0])
        p_ar = float(np.clip(cached["ar"].predict(X_te[ar_cols])[0], y_lo, y_hi))
        p_ens = 0.45 * p_xgb + 0.30 * p_huber + 0.25 * p_ridge

        p_last = 0.0 if spec.transform == "diff_to_level" else float(X_te["target_lag_1"].iloc[0])
        seas_val = X_te[seasonal_col].iloc[0]
        p_seas = float(seas_val) if pd.notna(seas_val) else float(X_te[ma_fallback_col].iloc[0])

        q10 = float(cached["q10"].predict(X_te)[0])
        q50 = float(cached["q50"].predict(X_te)[0])
        q90 = float(cached["q90"].predict(X_te)[0])
        lo, mid, hi = sorted([q10, q50, q90])

        # Strictly causal conformal pad computed ONLY from past OOF residuals strictly prior to idx
        pad_t = float(max(0.0, np.quantile(past_nonconformity[-60:], 0.80))) if len(past_nonconformity) >= 12 else 0.0
        actual_t = float(y.iloc[idx])
        past_nonconformity.append(max(lo - actual_t, actual_t - hi))

        oof_dates.append(X.index[idx])
        oof_actual.append(actual_t)
        oof_prev_lvl.append(float(prev_lvl_valid.iloc[idx]) if pd.notna(prev_lvl_valid.iloc[idx]) else np.nan)
        oof_preds["last_value"].append(p_last)
        oof_preds["seasonal_naive"].append(p_seas)
        oof_preds["ar_ridge"].append(p_ar)
        oof_preds["ridge"].append(p_ridge)
        oof_preds["huber"].append(p_huber)
        oof_preds["xgboost"].append(p_xgb)
        oof_preds["ensemble"].append(p_ens)
        oof_raw_p10.append(lo)
        oof_raw_p50.append(mid)
        oof_raw_p90.append(hi)
        oof_cal_p10.append(lo - pad_t)
        oof_cal_p90.append(hi + pad_t)

    n_total_oof = len(oof_dates)
    dev_wf_n = n_total_oof - holdout_n
    dev_slice = slice(0, dev_wf_n)
    hold_slice = slice(dev_wf_n, n_total_oof)

    # Select best model family strictly on development walk-forward MAE (never using holdout!)
    selectable = ["ridge", "huber", "xgboost", "ensemble"]
    y_dev_wf = np.asarray(oof_actual[dev_slice])
    dev_wf_maes = {
        m: float(mean_absolute_error(y_dev_wf, np.asarray(oof_preds[m][dev_slice])))
        for m in selectable
    }
    selected_model = min(dev_wf_maes, key=lambda k: dev_wf_maes[k])

    def _eval_split(sl: slice) -> dict[str, Any]:
        y_arr = np.asarray(oof_actual[sl])
        lv_arr = np.asarray(oof_preds["last_value"][sl])
        lv_mae = float(mean_absolute_error(y_arr, lv_arr))
        models_eval = {
            m: _compute_regression_metrics(y_arr, np.asarray(oof_preds[m][sl]), mase_denom, lv_mae)
            for m in candidate_names
        }
        p10_c = np.asarray(oof_cal_p10[sl])
        p90_c = np.asarray(oof_cal_p90[sl])
        p10_r = np.asarray(oof_raw_p10[sl])
        p50_r = np.asarray(oof_raw_p50[sl])
        p90_r = np.asarray(oof_raw_p90[sl])
        cov_raw = float(np.mean((y_arr >= p10_r) & (y_arr <= p90_r)))
        cov_cal = float(np.mean((y_arr >= p10_c) & (y_arr <= p90_c)))
        return {
            "start_date": str(oof_dates[sl][0].date()),
            "end_date": str(oof_dates[sl][-1].date()),
            "n_samples": int(len(y_arr)),
            "selected_model": selected_model,
            "selected_metrics": models_eval[selected_model],
            "model_comparison": models_eval,
            "calibration": {
                "raw_80_coverage": round(cov_raw, 4),
                "calibrated_80_coverage": round(cov_cal, 4),
                "mean_80_interval_width": round(float(np.mean(p90_c - p10_c)), 4),
                "pinball_loss_p10": round(_pinball_loss(y_arr, p10_r, 0.10), 4),
                "pinball_loss_p50": round(_pinball_loss(y_arr, p50_r, 0.50), 4),
                "pinball_loss_p90": round(_pinball_loss(y_arr, p90_r, 0.90), 4),
            },
        }

    dev_eval = _eval_split(dev_slice)
    holdout_eval = _eval_split(hold_slice)
    all_oos_eval = _eval_split(slice(0, n_total_oof))

    selected_oof = oof_preds[selected_model]
    oof_df = pd.DataFrame(
        {
            "date": oof_dates,
            "split": ["dev_walk_forward"] * dev_wf_n + ["untouched_holdout"] * holdout_n,
            "actual": oof_actual,
            "prev_level": oof_prev_lvl,
            "model_forecast": selected_oof,
            "last_value_baseline": oof_preds["last_value"],
            "seasonal_baseline": oof_preds["seasonal_naive"],
            "ar_ridge_baseline": oof_preds["ar_ridge"],
            "ridge_forecast": oof_preds["ridge"],
            "huber_forecast": oof_preds["huber"],
            "xgboost_forecast": oof_preds["xgboost"],
            "ensemble_forecast": oof_preds["ensemble"],
            "p10": oof_cal_p10,
            "p90": oof_cal_p90,
        }
    ).set_index("date")
    oof_df["covered_80"] = (oof_df["actual"] >= oof_df["p10"]) & (oof_df["actual"] <= oof_df["p90"])
    oof_df["forecast_error"] = oof_df["actual"] - oof_df["model_forecast"]
    oof_df["diff_vs_ar_baseline"] = oof_df["model_forecast"] - oof_df["ar_ridge_baseline"]

    # Feature ablation inside development split
    ablation = _run_feature_ablation(
        X_dev, y_dev, groups, tuned, min_train=min_train,
        half_life=half_life, mase_denom=mase_denom, refit_stride=refit_stride,
    )

    # Regime evaluation (inflation & growth regimes)
    regimes = _build_causal_regime_labels(monthly_df, oof_df.index)
    regime_eval = _evaluate_by_regime(oof_df, regimes, mase_denom)

    # Final live production fit on full history using dev-locked hyperparams & model choice
    full_weights = _causal_sample_weights(y, half_life)
    final_ar = _make_ridge_pipe(35.0).fit(X[ar_cols], y)
    final_ridge = _make_ridge_pipe(tuned["ridge_alpha"]).fit(X, y, ridge__sample_weight=full_weights)
    final_huber = _make_huber_pipe(tuned["huber_alpha"], tuned["huber_epsilon"]).fit(X, y)
    final_xgb = _make_xgb_point(tuned["xgb_params"]).fit(X, y, sample_weight=full_weights)
    final_quantiles = {
        q: _make_xgb_quantile(q, tuned["xgb_params"]).fit(X, y, sample_weight=full_weights)
        for q in (0.10, 0.25, 0.50, 0.75, 0.90)
    }

    # Causal conformal pad for next future release = 80th pct of trailing 60 OOF nonconformity scores
    conformal_pad_live = float(max(0.0, np.quantile(past_nonconformity[-60:], 0.80)))

    importances = sorted(
        zip(X.columns.tolist(), [float(v) for v in final_xgb.feature_importances_]),
        key=lambda item: item[1],
        reverse=True,
    )[:8]

    residuals = oof_df["forecast_error"].dropna()
    recent_res = residuals.tail(48 if spec.freq == "M" else 16)
    mad_std = float(1.4826 * np.median(np.abs(recent_res - np.median(recent_res)))) if len(recent_res) > 0 else float(residuals.std())
    robust_std = max(mad_std, float(recent_res.std()) if len(recent_res) > 5 else 1e-4, 1e-4)

    # Backward-compatible metrics summary + rich holdout/WF metrics
    recent_36 = oof_df.tail(36 if spec.freq == "M" else 12)
    dir_acc_vs_ar_36 = float(
        np.mean(
            np.sign(recent_36["model_forecast"] - recent_36["ar_ridge_baseline"])
            == np.sign(recent_36["actual"] - recent_36["ar_ridge_baseline"])
        )
    )

    metrics_summary = {
        "oof_samples": int(len(oof_df)),
        "mae_all": all_oos_eval["selected_metrics"]["mae"],
        "rmse_all": all_oos_eval["selected_metrics"]["rmse"],
        "mase_all": all_oos_eval["selected_metrics"]["mase"],
        "forecast_bias_all": all_oos_eval["selected_metrics"]["forecast_bias"],
        "consensus_mae_all": all_oos_eval["model_comparison"]["ar_ridge"]["mae"],  # AR benchmark (NOT real consensus)
        "mae_36m": round(float(mean_absolute_error(recent_36["actual"], recent_36["model_forecast"])), 4),
        "rmse_36m": round(float(root_mean_squared_error(recent_36["actual"], recent_36["model_forecast"])), 4),
        "consensus_mae_36m": round(float(mean_absolute_error(recent_36["actual"], recent_36["ar_ridge_baseline"])), 4),
        "beat_consensus_dir_acc_36m": round(dir_acc_vs_ar_36, 4),
        "interval_80_coverage": holdout_eval["calibration"]["calibrated_80_coverage"],
        "holdout_samples": holdout_eval["n_samples"],
        "holdout_mae": holdout_eval["selected_metrics"]["mae"],
        "holdout_rmse": holdout_eval["selected_metrics"]["rmse"],
        "holdout_mase": holdout_eval["selected_metrics"]["mase"],
        "holdout_bias": holdout_eval["selected_metrics"]["forecast_bias"],
        "holdout_last_value_mae": holdout_eval["model_comparison"]["last_value"]["mae"],
        "holdout_ar_ridge_mae": holdout_eval["model_comparison"]["ar_ridge"]["mae"],
        "dev_wf_mae": dev_eval["selected_metrics"]["mae"],
        "selected_model": selected_model,
    }

    bundle = {
        "spec": spec,
        "feature_cols": X.columns.tolist(),
        "ar_cols": ar_cols,
        "selected_model": selected_model,
        "tuned_params": tuned,
        "xgb": final_xgb,
        "huber": final_huber,
        "ridge": final_ridge,
        "ar_model": final_ar,
        "quantiles": final_quantiles,
        "conformal_pad": conformal_pad_live,
        "y_bounds": (float(y.min()), float(y.max())),
        "oof_std": robust_std,
        "metrics": metrics_summary,
        "top_features": [{"feature": f, "importance": round(imp, 4)} for f, imp in importances],
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    for out_dir in (MODEL1_DIR, ECON_ARTIFACTS_DIR):
        joblib.dump(bundle, out_dir / f"{spec.key.lower()}.joblib")
        oof_df.to_csv(out_dir / f"{spec.key.lower()}_oof.csv")

    return {
        "indicator": spec.key,
        "label": spec.label,
        "fred_series": spec.fred_series,
        "frequency": spec.freq,
        "unit": spec.unit,
        "forecast_scope": "value_forecast_only",
        "historical_consensus_available": False,
        "readiness": "CONDITIONALLY_READY_LOW_SAMPLE" if spec.freq == "Q" else "READY_WITH_REVISED_FRED_CAVEAT",
        "dataset_span": {
            "total_valid_samples": int(len(X)),
            "start_date": str(X.index.min().date()),
            "end_date": str(X.index.max().date()),
            "dev_samples": int(len(X_dev)),
            "dev_wf_samples": int(dev_wf_n),
            "holdout_samples": int(holdout_n),
            "holdout_start": str(X_hold.index.min().date()),
            "holdout_end": str(X_hold.index.max().date()),
        },
        "selected_model": selected_model,
        "tuned_params": tuned,
        "dev_walk_forward": dev_eval,
        "untouched_holdout": holdout_eval,
        "all_oof": all_oos_eval,
        "feature_ablation_dev_wf": ablation,
        "regime_evaluation": regime_eval,
        "metrics": metrics_summary,
        "top_features": bundle["top_features"],
    }


def train_all_economic_models(monthly_df: pd.DataFrame) -> dict[str, Any]:
    """Train & evaluate all Model 1 economic value forecast indicators and save reports."""
    indicators_report: dict[str, Any] = {}
    for key, spec in INDICATOR_SPECS.items():
        if spec.fred_series in monthly_df.columns:
            indicators_report[key] = train_indicator_model(monthly_df, spec)

    run_metadata = {
        "model": "Model 1 — Economic Value Forecast",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "forecast_scope": "value_forecast_only",
        "historical_consensus_available": False,
        "surprise_forecast_validated": False,
        "surprise_limitation_note": (
            "Free FRED/BLS/BEA data provides realized series only, not historical survey consensus expectations. "
            "No historical consensus or surprise backtest is fabricated. An AR+seasonal Ridge baseline is tracked "
            "solely as an econometric benchmark (ar_seasonal_proxy), never as historical market consensus. "
            "Live surprise outputs require user- or calendar-supplied consensus_overrides."
        ),
        "alfred_initial_vintage_caveat": (
            "Training and backtest series come from latest-revised FRED observations (fred_macro_monthly.csv), "
            "not ALFRED output_type=4 initial-release vintages. High-revision series (PAYEMS, GDPC1, PCEPI, "
            "PCEPILFE, INDPRO, RSAFS) reflect post-revision history."
        ),
        "validation_design": {
            "monthly_holdout_periods": MONTHLY_HOLDOUT_PERIODS,
            "quarterly_holdout_periods": QUARTERLY_HOLDOUT_PERIODS,
            "tuning_scope": "TimeSeriesSplit(n_splits=4) strictly inside development split prior to holdout",
            "model_selection_rule": "Minimum development walk-forward MAE (untouched holdout never inspected during selection)",
            "conformal_calibration": "Strictly causal trailing-60 OOF nonconformity quantiles prior to each step t",
            "outlier_weighting": "Causal recency + MAD dampening computed strictly from y_tr inside each fold",
        },
        "indicators": indicators_report,
    }

    run_path = TRAINING_RUNS_DIR / "model1_run.json"
    run_path.write_text(json.dumps(run_metadata, indent=2), encoding="utf-8")

    # Compact compatibility report in ml/artifacts/reports/model1_training_report.json
    compact_report = {
        k: {
            "indicator": v["indicator"],
            "label": v["label"],
            "frequency": v["frequency"],
            "selected_model": v["selected_model"],
            "tuned_params": v["tuned_params"],
            "metrics": v["metrics"],
            "top_features": v["top_features"],
        }
        for k, v in indicators_report.items()
    }
    (REPORTS_DIR / "model1_training_report.json").write_text(
        json.dumps(compact_report, indent=2), encoding="utf-8"
    )
    (ECON_ARTIFACTS_DIR / "model1_run.json").write_text(
        json.dumps(run_metadata, indent=2), encoding="utf-8"
    )
    return compact_report


def _build_next_period_feature_row(
    monthly_df: pd.DataFrame,
    spec: IndicatorSpec,
    feature_cols: list[str],
) -> tuple[pd.DataFrame, pd.Timestamp, float | None, float]:
    """Construct feature row for the next unreleased period using the exact training feature builder."""
    if spec.freq == "Q":
        q_raw = monthly_df[spec.fred_series].resample("QS").first().dropna()
        last_obs_date = q_raw.index.max()
        next_period = last_obs_date + pd.DateOffset(months=3)
        latest_yoy = float((q_raw.iloc[-1] / q_raw.iloc[-5] - 1.0) * 100.0) if len(q_raw) >= 5 else None
        last_level = float(q_raw.iloc[-1])
    else:
        trimmed = trim_incomplete_monthly_tail(monthly_df).sort_index().asfreq("MS")
        raw_target = trimmed[spec.fred_series].dropna()
        last_obs_date = raw_target.index.max()
        next_period = last_obs_date + pd.DateOffset(months=1)
        latest_yoy = None
        if spec.transform == "mom_pct":
            yoy_series = _safe_pct(trimmed[spec.fred_series], 12)
            if pd.notna(yoy_series.loc[last_obs_date]):
                latest_yoy = float(yoy_series.loc[last_obs_date])
        last_level = float(raw_target.iloc[-1])

    feats, _, _, _, _ = _build_feature_frame(monthly_df, spec, next_period=next_period)
    row = feats.loc[next_period]
    X_next = pd.DataFrame([{col: row.get(col, np.nan) for col in feature_cols}], index=[next_period])
    return X_next, next_period, latest_yoy, last_level


def predict_economic_forecasts(
    monthly_df: pd.DataFrame,
    consensus_overrides: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Run live economic value forecasts (and surprise vs consensus only when consensus_overrides are provided)."""
    consensus_overrides = consensus_overrides or {}
    forecasts: dict[str, Any] = {}
    trimmed = trim_incomplete_monthly_tail(monthly_df).sort_index().asfreq("MS")

    for key, spec in INDICATOR_SPECS.items():
        model_path = ECON_ARTIFACTS_DIR / f"{key.lower()}.joblib"
        if not model_path.exists():
            model_path = MODEL1_DIR / f"{key.lower()}.joblib"
        if not model_path.exists() or spec.fred_series not in trimmed.columns:
            continue

        bundle = joblib.load(model_path)
        X_next, next_period, latest_yoy, last_level = _build_next_period_feature_row(
            monthly_df, spec, bundle["feature_cols"]
        )

        y_lo, y_hi = bundle.get("y_bounds", (-1e6, 1e6))
        pred_xgb = float(bundle["xgb"].predict(X_next)[0])
        pred_huber = float(np.clip(bundle["huber"].predict(X_next)[0], y_lo, y_hi)) if "huber" in bundle else pred_xgb
        pred_ridge = float(np.clip(bundle["ridge"].predict(X_next)[0], y_lo, y_hi))
        pred_ens = 0.45 * pred_xgb + 0.30 * pred_huber + 0.25 * pred_ridge

        model_preds = {
            "xgboost": pred_xgb,
            "huber": pred_huber,
            "ridge": pred_ridge,
            "ensemble": pred_ens,
        }
        selected_name = bundle.get("selected_model", "ensemble")
        raw_point = _select_point_prediction(selected_name, model_preds)

        ar_cols = bundle.get("ar_cols") or bundle.get("consensus_cols", [])
        ar_model = bundle.get("ar_model") or bundle.get("consensus_model")
        ar_raw = float(ar_model.predict(X_next[ar_cols])[0])

        pad = float(bundle.get("conformal_pad", 0.0))
        q_vals = sorted([float(bundle["quantiles"][q].predict(X_next)[0]) for q in (0.10, 0.25, 0.50, 0.75, 0.90)])
        q_band = [q_vals[0] - pad, q_vals[1] - 0.5 * pad, q_vals[2], q_vals[3] + 0.5 * pad, q_vals[4] + pad]

        # Reconstruct UNRATE level from stationary diff prediction
        if spec.transform == "diff_to_level":
            point_forecast = last_level + raw_point
            ar_benchmark = last_level + ar_raw
            q_band = [last_level + v for v in q_band]
            last_actual = last_level
            last_obs_date = trimmed[spec.fred_series].dropna().index.max()
        elif spec.freq == "Q":
            q_raw = monthly_df[spec.fred_series].resample("QS").first().dropna()
            last_obs_date = q_raw.index.max()
            last_actual = float(((q_raw.iloc[-1] / q_raw.iloc[-2]) ** 4 - 1.0) * 100.0)
            point_forecast = raw_point
            ar_benchmark = ar_raw
        else:
            raw_series = trimmed[spec.fred_series]
            last_obs_date = raw_series.dropna().index.max()
            y_hist, _ = _compute_target_series(raw_series, spec)
            last_actual = float(y_hist.dropna().iloc[-1])
            point_forecast = raw_point
            ar_benchmark = ar_raw

        p10, p25, p50, p75, p90 = q_band
        spread = max((p90 - p10) / 2.563, bundle["oof_std"] * 0.75, 1e-4)

        has_override = key in consensus_overrides
        if has_override:
            consensus_val = float(consensus_overrides[key])
            consensus_source = "user_or_calendar"
            expected_surprise = point_forecast - consensus_val
            surprise_z = expected_surprise / spread
            prob_above = float(1.0 - norm.cdf((consensus_val - point_forecast) / spread))
        else:
            # Never pretend an AR baseline or historical proxy is real market consensus.
            consensus_val = point_forecast
            consensus_source = "unavailable_no_free_consensus"
            expected_surprise = 0.0
            surprise_z = 0.0
            prob_above = 0.5

        implied_yoy = None
        if spec.transform == "mom_pct":
            raw_series = trimmed[spec.fred_series]
            lag_11_dt = last_obs_date - pd.DateOffset(months=11)
            if lag_11_dt in raw_series.index and pd.notna(raw_series.loc[lag_11_dt]):
                projected_level = last_level * (1.0 + point_forecast / 100.0)
                implied_yoy = round(((projected_level / float(raw_series.loc[lag_11_dt])) - 1.0) * 100.0, 2)
        elif spec.transform == "qoq_ann_pct":
            q_raw = monthly_df[spec.fred_series].resample("QS").first().dropna()
            if len(q_raw) >= 4:
                projected_q = last_level * ((1.0 + point_forecast / 100.0) ** 0.25)
                implied_yoy = round(((projected_q / float(q_raw.iloc[-4])) - 1.0) * 100.0, 2)

        dec = 1 if key == "NFP" else 2
        target_period_str = (
            f"{next_period.year}-Q{next_period.quarter}"
            if spec.freq == "Q"
            else next_period.strftime("%Y-%m")
        )

        forecasts[key] = {
            "indicator": key,
            "label": spec.label,
            "fred_series": spec.fred_series,
            "frequency": spec.freq,
            "unit": spec.unit,
            "forecast_type": "value_forecast",
            "historical_consensus_available": False,
            "surprise_forecast_available": has_override,
            "selected_model": selected_name,
            "last_observation_date": last_obs_date.strftime("%Y-%m-%d"),
            "last_actual": round(last_actual, dec),
            "last_actual_yoy": round(latest_yoy, 2) if latest_yoy is not None else None,
            "target_period": target_period_str,
            "forecast": round(point_forecast, dec),
            "ar_benchmark_forecast": round(ar_benchmark, dec),
            "implied_yoy": implied_yoy,
            "consensus": round(consensus_val, dec),
            "consensus_source": consensus_source,
            "expected_surprise": round(expected_surprise, dec),
            "surprise_zscore": round(surprise_z, 2),
            "prob_above_consensus": round(prob_above, 3),
            "distribution": {
                "p10": round(p10, dec),
                "p25": round(p25, dec),
                "p50": round(p50, dec),
                "p75": round(p75, dec),
                "p90": round(p90, dec),
                "std_est": round(spread, dec + 1),
            },
            "metrics": bundle["metrics"],
            "top_features": bundle["top_features"][:5],
        }

    return {
        "model": "Model 1 — Economic Value Forecast (Walk-Forward Selected Ridge/Huber/XGBoost + Causal Conformal Quantiles)",
        "forecast_scope": "value_forecast_only",
        "historical_consensus_available": False,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "forecasts": forecasts,
    }
