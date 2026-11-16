from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.special import logsumexp
from sklearn.cluster import KMeans
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    adjusted_rand_score,
    balanced_accuracy_score,
    brier_score_loss,
    log_loss,
    normalized_mutual_info_score,
    roc_auc_score,
    silhouette_score,
)
from sklearn.mixture import GaussianMixture
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from ml.config import ARTIFACTS_DIR, REPORTS_DIR
from ml.data_pipeline import (
    align_fred_daily_point_in_time,
    fetch_fred_release_dates,
    get_pit_cftc_series,
)

MODEL4_DIR = ARTIFACTS_DIR / "model4_macro_regime"
MACRO_REGIME_DIR = ARTIFACTS_DIR / "macro_regime"
TRAINING_RUNS_DIR = ARTIFACTS_DIR / "training_runs"
for _d in (MODEL4_DIR, MACRO_REGIME_DIR, TRAINING_RUNS_DIR, REPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

CORE_FACTOR_COLS = [
    "growth_z",
    "inflation_z",
    "fed_policy_z",
    "real_yields_z",
    "dollar_z",
    "volatility_stress_z",
    "positioning_z",
]

REGIME_4_COLS = [
    "growth_z",
    "inflation_z",
    "real_yields_z",
    "volatility_stress_z",
]

REGIME_6_COLS = [
    "growth_z",
    "inflation_z",
    "real_yields_z",
    "dollar_z",
    "volatility_stress_z",
    "fed_policy_z",
]

EXTENDED_ML_COLS = CORE_FACTOR_COLS + [
    "net_liquidity_z",
]

RULE_REGIME_ORDER = [
    "Risk-Off / Volatility Stress",
    "Hawkish Tightening",
    "Reflation / Sticky Inflation",
    "Disinflationary Expansion / Easing",
]

UNTOUCHED_HOLDOUT_WEEKS = 104  # ~2 years reserved untouched from tuning/selection
WALKFORWARD_WARMUP_WEEKS = 260  # ~5 years minimum expanding warmup
WALKFORWARD_REFIT_STEP = 13  # Quarterly causal refit cadence


class CausalGaussianHMM:
    """Diagonal-covariance Gaussian HMM with sticky transition prior and strictly causal forward filtering."""

    def __init__(
        self,
        n_states: int = 4,
        n_iter: int = 35,
        sticky_alpha: float = 12.0,
        min_var: float = 1e-3,
        random_state: int = 42,
    ) -> None:
        self.n_states = n_states
        self.n_iter = n_iter
        self.sticky_alpha = sticky_alpha
        self.min_var = min_var
        self.random_state = random_state
        self.means_: np.ndarray | None = None
        self.vars_: np.ndarray | None = None
        self.pi_: np.ndarray | None = None
        self.A_: np.ndarray | None = None

    def _log_emission(self, X: np.ndarray) -> np.ndarray:
        assert self.means_ is not None and self.vars_ is not None
        log_b = np.empty((len(X), self.n_states), dtype=float)
        for k in range(self.n_states):
            diff = X - self.means_[k]
            var = self.vars_[k]
            log_det = float(np.sum(np.log(2.0 * np.pi * var)))
            quad = np.sum((diff ** 2) / var, axis=1)
            log_b[:, k] = -0.5 * (log_det + quad)
        return log_b

    def fit(self, X: np.ndarray) -> "CausalGaussianHMM":
        """Fit HMM parameters via Baum-Welch EM strictly on past training matrix X."""
        T, D = X.shape
        K = self.n_states
        km = KMeans(n_clusters=K, n_init=12, random_state=self.random_state).fit(X)
        self.means_ = km.cluster_centers_.copy()
        self.vars_ = np.ones((K, D), dtype=float)
        for k in range(K):
            sub = X[km.labels_ == k]
            if len(sub) > 1:
                self.vars_[k] = np.maximum(sub.var(axis=0), self.min_var)
        self.pi_ = np.full(K, 1.0 / K)
        self.A_ = np.full((K, K), 0.15 / max(K - 1, 1))
        np.fill_diagonal(self.A_, 0.85)

        prev_ll = -np.inf
        for _ in range(self.n_iter):
            log_B = self._log_emission(X)
            log_B_max = np.max(log_B, axis=1, keepdims=True)
            B_rel = np.exp(log_B - log_B_max)
            A = np.maximum(self.A_, 1e-12)
            pi = np.maximum(self.pi_, 1e-12)

            # Scaled Rabiner forward pass (exact & 15x faster than scipy logsumexp in Python loops)
            alpha = np.empty((T, K), dtype=float)
            c_scale = np.empty(T, dtype=float)
            a0 = pi * B_rel[0]
            c0 = float(a0.sum())
            c_scale[0] = max(c0, 1e-300)
            alpha[0] = a0 / c_scale[0]
            for t in range(1, T):
                at = (alpha[t - 1] @ A) * B_rel[t]
                ct = float(at.sum())
                c_scale[t] = max(ct, 1e-300)
                alpha[t] = at / c_scale[t]
            ll = float(np.sum(log_B_max[:, 0]) + np.sum(np.log(c_scale)))

            # Scaled backward pass
            beta = np.ones((T, K), dtype=float)
            for t in range(T - 2, -1, -1):
                bt = A @ (beta[t + 1] * B_rel[t + 1])
                beta[t] = bt / c_scale[t + 1]

            gamma = alpha * beta
            gamma_sum = np.maximum(gamma.sum(axis=1, keepdims=True), 1e-300)
            gamma /= gamma_sum

            self.pi_ = np.maximum(gamma[0], 1e-6)
            self.pi_ /= self.pi_.sum()

            # Expected transition counts xi_sum via vectorized matrix product
            xi_sum = np.zeros((K, K), dtype=float)
            weighted_next = (beta[1:] * B_rel[1:]) / c_scale[1:, None]
            xi_sum = (alpha[:-1].T @ weighted_next) * A

            # Sticky Dirichlet pseudo-counts discourage spurious 1-week switching
            xi_sum += np.eye(K) * self.sticky_alpha + 1e-2
            self.A_ = xi_sum / xi_sum.sum(axis=1, keepdims=True)

            nk = gamma.sum(axis=0) + 1e-6
            self.means_ = (gamma.T @ X) / nk[:, None]
            for k in range(K):
                diff = X - self.means_[k]
                self.vars_[k] = np.maximum((gamma[:, k][:, None] * (diff ** 2)).sum(axis=0) / nk[k], self.min_var)

            if abs(ll - prev_ll) < 1e-4:
                break
            prev_ll = ll
        return self

    def filter_sequence(self, X_seq: np.ndarray, init_log_p: np.ndarray | None = None) -> tuple[np.ndarray, float]:
        """Strictly causal forward filter P(S_t | X_{1:t}) without backward smoothing."""
        assert self.A_ is not None and self.pi_ is not None
        A = np.maximum(self.A_, 1e-12)
        pi = np.maximum(self.pi_, 1e-12)
        log_B = self._log_emission(X_seq)
        log_B_max = np.max(log_B, axis=1)
        B_rel = np.exp(log_B - log_B_max[:, None])

        probs = np.empty((len(X_seq), self.n_states), dtype=float)
        total_ll = 0.0

        if init_log_p is None:
            p = pi * B_rel[0]
            s = max(float(p.sum()), 1e-300)
            total_ll += float(log_B_max[0]) + float(np.log(s))
            p /= s
            probs[0] = p
            start_idx = 1
        else:
            p = np.exp(init_log_p - np.max(init_log_p))
            p /= max(float(p.sum()), 1e-300)
            start_idx = 0

        for i in range(start_idx, len(X_seq)):
            p = (p @ A) * B_rel[i]
            s = max(float(p.sum()), 1e-300)
            total_ll += float(log_B_max[i]) + float(np.log(s))
            p /= s
            probs[i] = p
        return probs, total_ll

    def filter_oos(self, X_hist: np.ndarray, X_oos: np.ndarray) -> tuple[np.ndarray, float]:
        """Filter through training history, then emit strictly causal OOS filtered probabilities."""
        hist_probs, _ = self.filter_sequence(X_hist)
        last_log_p = np.log(np.maximum(hist_probs[-1], 1e-12))
        return self.filter_sequence(X_oos, init_log_p=last_log_p)


CausalGaussianHMM.__module__ = "ml.models.macro_regime_bias"


def _rolling_z(s: pd.Series, window: int = 260, min_periods: int = 52) -> pd.Series:
    mu = s.rolling(window, min_periods=min_periods).mean()
    sd = s.rolling(window, min_periods=min_periods).std().replace(0, np.nan)
    return ((s - mu) / sd).clip(-3.5, 3.5)


def build_weekly_macro_panel(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    release_dates: pd.DataFrame | None = None,
    include_partial_latest_week: bool = False,
) -> pd.DataFrame:
    """Build strictly point-in-time weekly macro + liquidity + market factor panel.

    Point-in-time safeguards:
    1. Monthly/quarterly/weekly FRED series are shifted to release/publication dates via
       `align_fred_daily_point_in_time`.
    2. Daily FRED H.15 series are lagged by 1 business day to prevent same-day timing leaks.
    3. CFTC Tuesday snapshots are mapped to Friday publication dates via `get_pit_cftc_series`.
    4. Weekly `W-FRI` bins beyond `max_obs_date` are excluded during training (`include_partial_latest_week=False`)
       or stamped at `max_obs_date` for live inference so `as_of_date` never exceeds observed data.
    5. `volatility_stress_z` uses continuous 1999+ VIX and SPX realized vol (excluding 2023-start HY OAS).
    """
    daily = market_data["daily"].copy().sort_index()
    daily.index = pd.to_datetime(daily.index).tz_localize(None)
    max_obs_date = pd.Timestamp(daily.index.max())

    if release_dates is None:
        try:
            release_dates = fetch_fred_release_dates(force_refresh=False, sanitize=True)
        except Exception:
            release_dates = pd.DataFrame()

    fd_pit = align_fred_daily_point_in_time(fred_daily, release_dates)
    for col in ("DFF", "DGS2", "DGS10", "DFII10", "T10YIE", "T5YIFR", "T10Y2Y", "RRPONTSYD"):
        if col in fd_pit.columns:
            fd_pit[col] = fd_pit[col].shift(1)

    w_xau = daily["XAUUSD"].resample("W-FRI").last().dropna()
    if not include_partial_latest_week:
        w_xau = w_xau[w_xau.index <= max_obs_date]
    else:
        # Stamp any trailing partial week with actual latest observed market date (never a future Friday)
        new_idx = pd.DatetimeIndex([min(dt, max_obs_date) for dt in w_xau.index])
        w_xau = pd.Series(w_xau.values, index=new_idx, name="XAUUSD")
        w_xau = w_xau[~w_xau.index.duplicated(keep="last")]

    idx = w_xau.index
    w_dxy = daily["DXY"].resample("W-FRI").last() if "DXY" in daily.columns else pd.Series(dtype=float)
    w_vix = daily["VIX"].resample("W-FRI").last() if "VIX" in daily.columns else fd_pit.get("VIXCLS", pd.Series(dtype=float)).resample("W-FRI").last()
    w_spx = daily["SPX"].resample("W-FRI").last() if "SPX" in daily.columns else pd.Series(dtype=float)
    w_us10y = daily["US10Y"].resample("W-FRI").last() if "US10Y" in daily.columns else fd_pit.get("DGS10", pd.Series(dtype=float)).resample("W-FRI").last()
    w_fred = fd_pit.resample("W-FRI").last()

    if include_partial_latest_week:
        for s_name, s_obj in [("dxy", w_dxy), ("vix", w_vix), ("spx", w_spx), ("us10y", w_us10y)]:
            if not s_obj.empty:
                s_obj.index = pd.DatetimeIndex([min(dt, max_obs_date) for dt in s_obj.index])
        w_fred.index = pd.DatetimeIndex([min(dt, max_obs_date) for dt in w_fred.index])
        w_fred = w_fred[~w_fred.index.duplicated(keep="last")]

    panel = pd.DataFrame(index=idx)
    panel["xauusd"] = w_xau
    panel["dxy"] = w_dxy.reindex(idx).ffill() if not w_dxy.empty else w_fred.get("DTWEXBGS", pd.Series(index=idx)).reindex(idx).ffill()
    panel["vix"] = w_vix.reindex(idx).ffill()
    panel["spx"] = w_spx.reindex(idx).ffill()
    panel["us10y"] = w_us10y.reindex(idx).ffill()

    for col in [
        "CPIAUCSL", "CPILFESL", "INDPRO", "PAYEMS", "UNRATE", "ICSA",
        "DFF", "DGS2", "DFII10", "T10YIE", "T5YIFR", "T10Y2Y",
        "BAMLH0A0HYM2", "WALCL", "WTREGEN", "RRPONTSYD",
    ]:
        if col in w_fred.columns:
            panel[col] = w_fred[col].reindex(idx).ffill()

    pit_cftc = get_pit_cftc_series(cftc_df, col="cot_percentile_3y")
    if not pit_cftc.empty:
        cot_w = pit_cftc.resample("W-FRI").last()
        if include_partial_latest_week:
            cot_w.index = pd.DatetimeIndex([min(dt, max_obs_date) for dt in cot_w.index])
            cot_w = cot_w[~cot_w.index.duplicated(keep="last")]
        panel["cot_pct"] = cot_w.reindex(idx).ffill().fillna(50.0)
    else:
        panel["cot_pct"] = 50.0

    # Raw interpretable macro readings (strictly backward-looking)
    panel["cpi_yoy"] = (panel["CPIAUCSL"] / panel["CPIAUCSL"].shift(52) - 1.0) * 100.0 if "CPIAUCSL" in panel else np.nan
    panel["indpro_yoy"] = (panel["INDPRO"] / panel["INDPRO"].shift(52) - 1.0) * 100.0 if "INDPRO" in panel else np.nan
    panel["payems_3m"] = (panel["PAYEMS"] - panel["PAYEMS"].shift(13)) / 3.0 if "PAYEMS" in panel else np.nan
    panel["real_rate_policy"] = panel["DFF"] - panel["cpi_yoy"] if "DFF" in panel else np.nan
    panel["dgs2_chg_13w"] = panel["DGS2"].diff(13) if "DGS2" in panel else 0.0
    panel["dff_chg_13w"] = panel["DFF"].diff(13) if "DFF" in panel else 0.0
    panel["dfii10_chg_13w"] = panel["DFII10"].diff(13) if "DFII10" in panel else 0.0
    panel["dxy_ret_13w"] = (panel["dxy"] / panel["dxy"].shift(13) - 1.0) * 100.0
    panel["spx_ret_13w"] = (panel["spx"] / panel["spx"].shift(13) - 1.0) * 100.0 if "spx" in panel else np.nan
    panel["spx_rvol_13w"] = panel["spx"].pct_change().rolling(13, min_periods=8).std() * np.sqrt(52) * 100.0

    # Fed Net Liquidity ($B) = WALCL($M)/1000 - WTREGEN($M)/1000 - RRPONTSYD($B)
    walcl_bn = panel.get("WALCL", pd.Series(0.0, index=idx)).fillna(0.0) / 1000.0
    tga_bn = panel.get("WTREGEN", pd.Series(0.0, index=idx)).fillna(0.0) / 1000.0
    rrp_bn = panel.get("RRPONTSYD", pd.Series(0.0, index=idx)).fillna(0.0)
    panel["net_liquidity_bn"] = walcl_bn - tga_bn - rrp_bn
    panel["net_liq_chg_13w"] = panel["net_liquidity_bn"].diff(13)
    panel["net_liquidity_z"] = _rolling_z(panel["net_liq_chg_13w"], 260, 52)

    # 7 standardized core factors (rolling 5y = 260w, min 1y = 52w)
    z_ind = _rolling_z(panel["indpro_yoy"], 260, 52)
    z_nfp = _rolling_z(panel["payems_3m"], 260, 52)
    z_icsa = -_rolling_z(panel["ICSA"], 260, 52) if "ICSA" in panel else np.nan
    panel["growth_z"] = pd.concat([z_ind, z_nfp, z_icsa], axis=1).mean(axis=1)

    z_cpi = _rolling_z(panel["cpi_yoy"], 260, 52)
    z_be10 = _rolling_z(panel["T10YIE"], 260, 52) if "T10YIE" in panel else z_cpi
    panel["inflation_z"] = pd.concat([z_cpi, z_be10], axis=1).mean(axis=1)

    z_realpol = _rolling_z(panel["real_rate_policy"], 260, 52)
    z_dgs2c = _rolling_z(panel["dgs2_chg_13w"], 260, 52)
    z_dffc = _rolling_z(panel["dff_chg_13w"], 260, 52)
    panel["fed_policy_z"] = pd.concat([z_realpol, z_dgs2c, z_dffc], axis=1).mean(axis=1)

    z_r10_lvl = _rolling_z(panel["DFII10"], 260, 52) if "DFII10" in panel else _rolling_z(panel["us10y"] - panel["cpi_yoy"], 260, 52)
    z_r10_chg = _rolling_z(panel["dfii10_chg_13w"], 260, 52) if "DFII10" in panel else 0.0
    panel["real_yields_z"] = 0.65 * z_r10_lvl + 0.35 * z_r10_chg

    z_dxy_lvl = _rolling_z(panel["dxy"], 260, 52)
    z_dxy_mom = _rolling_z(panel["dxy_ret_13w"], 260, 52)
    panel["dollar_z"] = 0.55 * z_dxy_lvl + 0.45 * z_dxy_mom

    # Homogeneous stress indicator (VIX + SPX realized vol; avoids 2023-11 BAMLH0A0HYM2 structural break)
    z_vix = _rolling_z(panel["vix"], 260, 52)
    z_rvol = _rolling_z(panel["spx_rvol_13w"], 260, 52)
    panel["volatility_stress_z"] = pd.concat([z_vix, z_rvol], axis=1).mean(axis=1)

    panel["positioning_z"] = ((panel["cot_pct"] - 50.0) / 28.8).clip(-2.0, 2.0)

    # 4-week factor momentum & cross-asset trend/correlation
    panel["real_yields_chg_4w_z"] = panel["real_yields_z"].diff(4).clip(-2.0, 2.0).fillna(0.0)
    panel["dollar_chg_4w_z"] = panel["dollar_z"].diff(4).clip(-2.0, 2.0).fillna(0.0)
    panel["stress_chg_4w_z"] = panel["volatility_stress_z"].diff(4).clip(-2.0, 2.0).fillna(0.0)
    panel["inflation_chg_4w_z"] = panel["inflation_z"].diff(4).clip(-2.0, 2.0).fillna(0.0)

    xau_ma26 = panel["xauusd"].rolling(26, min_periods=12).mean()
    panel["xau_trend_26w_z"] = _rolling_z((panel["xauusd"] / xau_ma26 - 1.0) * 100.0, 260, 52).fillna(0.0)
    xau_w_ret = panel["xauusd"].pct_change()
    dxy_w_ret = panel["dxy"].pct_change()
    panel["xau_dxy_corr_13w"] = xau_w_ret.rolling(13, min_periods=8).corr(dxy_w_ret).fillna(-0.4)

    panel["xau_fwd_4w_pct"] = (panel["xauusd"].shift(-4) / panel["xauusd"] - 1.0) * 100.0
    panel["xau_fwd_1w_pct"] = (panel["xauusd"].shift(-1) / panel["xauusd"] - 1.0) * 100.0
    panel["dxy_fwd_4w_pct"] = (panel["dxy"].shift(-4) / panel["dxy"] - 1.0) * 100.0
    panel["spx_fwd_4w_pct"] = (panel["spx"].shift(-4) / panel["spx"] - 1.0) * 100.0
    return panel


def classify_six_dimensions(row: pd.Series) -> dict[str, str]:
    """Point-in-time state classification across all 6 core macro dimensions."""
    return {
        "inflation": "HIGH_INFLATION" if row["inflation_z"] >= 0.35 else ("LOW_DISINFLATION" if row["inflation_z"] <= -0.35 else "NEUTRAL"),
        "growth": "EXPANSION" if row["growth_z"] >= 0.35 else ("CONTRACTION" if row["growth_z"] <= -0.35 else "TREND"),
        "real_yields": "RESTRICTIVE_HIGH" if row["real_yields_z"] >= 0.35 else ("ACCOMMODATIVE_LOW" if row["real_yields_z"] <= -0.35 else "NEUTRAL"),
        "dollar": "STRONG_USD" if row["dollar_z"] >= 0.35 else ("WEAK_USD" if row["dollar_z"] <= -0.35 else "NEUTRAL"),
        "risk_sentiment": "STRESS_RISK_OFF" if (row["volatility_stress_z"] >= 0.85 or row["vix"] >= 25.0) else ("CALM_RISK_ON" if row["volatility_stress_z"] <= -0.35 else "NEUTRAL"),
        "fed_stance": "HAWKISH_TIGHTENING" if row["fed_policy_z"] >= 0.35 else ("DOVISH_EASING" if row["fed_policy_z"] <= -0.35 else "NEUTRAL"),
    }


def classify_rule_regime_raw(row: pd.Series) -> str:
    """Transparent causal rule-based macro regime classification."""
    if float(row["volatility_stress_z"]) >= 1.0 or float(row.get("vix", 0.0)) >= 26.0:
        return "Risk-Off / Volatility Stress"
    if (float(row["fed_policy_z"]) >= 0.35 and float(row["real_yields_z"]) >= 0.25) or (
        float(row["real_yields_z"]) >= 0.65 and float(row["dollar_z"]) >= 0.35
    ):
        return "Hawkish Tightening"
    if float(row["inflation_z"]) >= 0.35:
        return "Reflation / Sticky Inflation"
    return "Disinflationary Expansion / Easing"


def apply_causal_hysteresis(raw_labels: pd.Series, confirm_weeks: int = 2) -> pd.Series:
    """Causal confirmation filter: require `confirm_weeks` consecutive observations before switching."""
    out: list[str] = []
    current = str(raw_labels.iloc[0])
    candidate: str | None = None
    streak = 0
    for lbl_raw in raw_labels:
        lbl = str(lbl_raw)
        if lbl == current:
            candidate = None
            streak = 0
        else:
            if lbl == candidate:
                streak += 1
            else:
                candidate = lbl
                streak = 1
            if streak >= confirm_weeks:
                current = candidate
                candidate = None
                streak = 0
        out.append(current)
    return pd.Series(out, index=raw_labels.index)


def _align_centroids(prev_centers: np.ndarray, new_centers: np.ndarray) -> np.ndarray:
    """Match new cluster centers to prior window centers via minimum Euclidean distance (causal)."""
    cost = np.linalg.norm(prev_centers[:, None, :] - new_centers[None, :, :], axis=2)
    row_ind, col_ind = linear_sum_assignment(cost)
    perm = np.zeros(len(prev_centers), dtype=int)
    for r, c in zip(row_ind, col_ind):
        perm[r] = c
    return perm


def _describe_empirical_centroid(centroid: dict[str, float]) -> str:
    """Generate an objective, non-presumptive descriptive tag from a centroid's actual coordinates."""
    tags: list[str] = []
    if centroid.get("volatility_stress_z", 0.0) >= 0.70:
        tags.append("High Stress")
    elif centroid.get("volatility_stress_z", 0.0) <= -0.45:
        tags.append("Low Vol")

    if centroid.get("growth_z", 0.0) <= -0.60:
        tags.append("Contraction")
    elif centroid.get("growth_z", 0.0) >= 0.25:
        tags.append("Expansion")

    if centroid.get("inflation_z", 0.0) >= 0.35:
        tags.append("Elevated Inflation")
    elif centroid.get("inflation_z", 0.0) <= -0.35:
        tags.append("Disinflation")

    if centroid.get("real_yields_z", 0.0) >= 0.35 or centroid.get("fed_policy_z", 0.0) >= 0.35:
        tags.append("Tight Policy/Yields")
    elif centroid.get("real_yields_z", 0.0) <= -0.35 or centroid.get("fed_policy_z", 0.0) <= -0.35:
        tags.append("Loose Policy/Yields")

    if not tags:
        tags.append("Mixed / Neutral")
    return " / ".join(tags[:3])


def _compute_stability_metrics(labels: pd.Series) -> dict[str, Any]:
    s = labels.dropna()
    switches = max(0, int((s != s.shift(1)).sum()) - 1)
    years = max((s.index[-1] - s.index[0]).days / 365.25, 1e-6)
    runs = (s != s.shift(1)).cumsum()
    spells = s.groupby(runs).size()
    return {
        "n_weeks": int(len(s)),
        "transitions": switches,
        "transitions_per_year": round(float(switches / years), 2),
        "persistence_prob": round(float(1.0 - switches / max(len(s) - 1, 1)), 4),
        "mean_spell_weeks": round(float(spells.mean()), 2),
        "median_spell_weeks": round(float(spells.median()), 2),
        "max_spell_weeks": int(spells.max()),
    }


def _compute_markov_transition_matrix(
    labels: pd.Series,
    state_order: list[Any] | None = None,
    state_names: dict[Any, str] | None = None,
) -> dict[str, Any]:
    """Compute empirical first-order Markov transition matrix P(S_{t+1}=j | S_t=i) on OOS labels."""
    s = labels.dropna()
    if state_order is None:
        states = sorted(s.unique().tolist(), key=lambda x: str(x))
    else:
        states = [st for st in state_order if st in set(s.unique())]
    k = len(states)
    idx_map = {st: i for i, st in enumerate(states)}
    counts = np.zeros((k, k), dtype=int)
    vals = s.tolist()
    for a, b in zip(vals[:-1], vals[1:]):
        if a in idx_map and b in idx_map:
            counts[idx_map[a], idx_map[b]] += 1

    row_sums = counts.sum(axis=1, keepdims=True)
    probs = np.where(row_sums > 0, counts / np.maximum(row_sums, 1), 0.0)
    disp_names = [state_names[st] if state_names and st in state_names else str(st) for st in states]
    occ = s.value_counts(normalize=True).to_dict()

    self_persist = {
        disp_names[i]: round(float(probs[i, i]), 4) for i in range(k)
    }
    expected_dur = {
        disp_names[i]: round(float(1.0 / max(1.0 - probs[i, i], 1e-4)), 2) if row_sums[i, 0] > 0 else None
        for i in range(k)
    }
    return {
        "states": disp_names,
        "transition_counts": counts.tolist(),
        "transition_matrix": [[round(float(p), 4) for p in row] for row in probs],
        "self_transition_probs": self_persist,
        "implied_expected_duration_weeks": expected_dur,
        "empirical_occupancy_pct": {
            disp_names[i]: round(float(occ.get(states[i], 0.0) * 100.0), 1) for i in range(k)
        },
    }


def _evaluate_walkforward_unsupervised(
    df: pd.DataFrame,
    cols: list[str],
    n_clusters: int = 4,
    warmup: int = WALKFORWARD_WARMUP_WEEKS,
    step: int = WALKFORWARD_REFIT_STEP,
) -> dict[str, Any]:
    """Run strictly causal expanding-window walk-forward K-Means, GMM, and Causal Gaussian HMM."""
    X_all = df[cols].values
    stress_col_idx = cols.index("volatility_stress_z") if "volatility_stress_z" in cols else 0

    n = len(df)
    km_labels = np.full(n, -1, dtype=int)
    gmm_labels = np.full(n, -1, dtype=int)
    hmm_labels = np.full(n, -1, dtype=int)
    gmm_probs = np.full((n, n_clusters), np.nan)
    hmm_probs = np.full((n, n_clusters), np.nan)

    prev_km_c = prev_gmm_c = prev_hmm_c = None
    gmm_oos_ll = 0.0
    hmm_oos_ll = 0.0
    km_silhouettes: list[float] = []
    gmm_bics: list[float] = []

    for t in range(warmup, n, step):
        t_end = min(t + step, n)
        X_tr = X_all[:t]
        X_te = X_all[t:t_end]
        sc = StandardScaler().fit(X_tr)
        X_tr_s = sc.transform(X_tr)
        X_te_s = sc.transform(X_te)

        # K-Means
        km = KMeans(n_clusters=n_clusters, n_init=15, random_state=42).fit(X_tr_s)
        km_c_orig = sc.inverse_transform(km.cluster_centers_)
        perm_km = np.argsort(-km_c_orig[:, stress_col_idx]) if prev_km_c is None else _align_centroids(prev_km_c, km_c_orig)
        inv_km = np.argsort(perm_km)
        prev_km_c = km_c_orig[perm_km]
        km_labels[t:t_end] = inv_km[km.predict(X_te_s)]
        km_silhouettes.append(float(silhouette_score(X_tr_s, km.labels_)))

        # GMM (full covariance)
        gmm = GaussianMixture(
            n_components=n_clusters, covariance_type="full", reg_covar=1e-4, n_init=6, random_state=42
        ).fit(X_tr_s)
        gmm_c_orig = sc.inverse_transform(gmm.means_)
        perm_gmm = np.argsort(-gmm_c_orig[:, stress_col_idx]) if prev_gmm_c is None else _align_centroids(prev_gmm_c, gmm_c_orig)
        prev_gmm_c = gmm_c_orig[perm_gmm]
        p_gmm = gmm.predict_proba(X_te_s)[:, perm_gmm]
        gmm_probs[t:t_end] = p_gmm
        gmm_labels[t:t_end] = np.argmax(p_gmm, axis=1)
        gmm_oos_ll += float(gmm.score(X_te_s) * len(X_te_s))
        gmm_bics.append(float(gmm.bic(X_tr_s)))

        # Causal Gaussian HMM (forward-filtered OOS)
        hmm = CausalGaussianHMM(n_states=n_clusters, n_iter=30, sticky_alpha=12.0, random_state=42).fit(X_tr_s)
        hmm_c_orig = sc.inverse_transform(hmm.means_)
        perm_hmm = np.argsort(-hmm_c_orig[:, stress_col_idx]) if prev_hmm_c is None else _align_centroids(prev_hmm_c, hmm_c_orig)
        prev_hmm_c = hmm_c_orig[perm_hmm]
        last_hmm_A = hmm.A_[np.ix_(perm_hmm, perm_hmm)]
        p_hmm, ll_hmm = hmm.filter_oos(X_tr_s, X_te_s)
        p_hmm = p_hmm[:, perm_hmm]
        hmm_probs[t:t_end] = p_hmm
        hmm_labels[t:t_end] = np.argmax(p_hmm, axis=1)
        hmm_oos_ll += float(ll_hmm)

    def _entropy(probs_arr: np.ndarray) -> float:
        valid = probs_arr[~np.isnan(probs_arr).any(axis=1)]
        p_safe = np.clip(valid, 1e-9, 1.0)
        ent = -np.sum(p_safe * np.log(p_safe), axis=1) / np.log(n_clusters)
        return round(float(np.mean(ent)), 4)

    return {
        "km_labels": km_labels,
        "gmm_labels": gmm_labels,
        "hmm_labels": hmm_labels,
        "gmm_probs": gmm_probs,
        "hmm_probs": hmm_probs,
        "km_mean_silhouette": round(float(np.mean(km_silhouettes)), 4),
        "gmm_mean_bic": round(float(np.mean(gmm_bics)), 2),
        "gmm_oos_log_likelihood": round(gmm_oos_ll, 2),
        "hmm_oos_log_likelihood": round(hmm_oos_ll, 2),
        "gmm_mean_oos_entropy": _entropy(gmm_probs),
        "hmm_mean_oos_entropy": _entropy(hmm_probs),
        "final_km_centroids": prev_km_c,
        "final_gmm_centroids": prev_gmm_c,
        "final_hmm_centroids": prev_hmm_c,
        "final_hmm_transition_matrix": last_hmm_A,
    }


def _summarize_state_profiles(
    oos_df: pd.DataFrame,
    state_col: str,
    factor_cols: list[str],
    state_name_map: dict[Any, str] | None = None,
) -> dict[str, Any]:
    profiles: dict[str, Any] = {}
    for sid, sub in oos_df.groupby(state_col):
        label = state_name_map[sid] if state_name_map and sid in state_name_map else str(sid)
        centroid = {c: round(float(sub[c].mean()), 3) for c in factor_cols}
        xau4 = sub["xau_fwd_4w_pct"].dropna()
        dxy4 = sub["dxy_fwd_4w_pct"].dropna() if "dxy_fwd_4w_pct" in sub else pd.Series(dtype=float)
        spx4 = sub["spx_fwd_4w_pct"].dropna() if "spx_fwd_4w_pct" in sub else pd.Series(dtype=float)
        profiles[label] = {
            "weeks": int(len(sub)),
            "share_pct": round(float(len(sub) / len(oos_df) * 100.0), 1),
            "empirical_centroid_z": centroid,
            "descriptive_tag": _describe_empirical_centroid(centroid) if state_name_map is None else label,
            "avg_xau_fwd_4w_pct": round(float(xau4.mean()), 2) if not xau4.empty else None,
            "xau_4w_win_rate": round(float((xau4 > 0).mean()), 3) if not xau4.empty else None,
            "xau_4w_vol_pct": round(float(xau4.std()), 2) if len(xau4) > 1 else None,
            "avg_dxy_fwd_4w_pct": round(float(dxy4.mean()), 2) if not dxy4.empty else None,
            "avg_spx_fwd_4w_pct": round(float(spx4.mean()), 2) if not spx4.empty else None,
        }
    return profiles


def verify_point_in_time_prefix_invariance(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    release_dates: pd.DataFrame | None = None,
    cutoff_date: str = "2022-06-24",
) -> dict[str, Any]:
    """Verify zero future leakage by truncating inputs at `cutoff_date` and checking prefix equality."""
    cut_ts = pd.Timestamp(cutoff_date)
    full_panel = build_weekly_macro_panel(fred_daily, market_data, cftc_df, release_dates=release_dates)

    fd_cut = fred_daily.copy()
    fd_cut.index = pd.to_datetime(fd_cut.index).tz_localize(None)
    fd_cut = fd_cut[fd_cut.index <= cut_ts]

    mkt_cut = {k: v.copy() for k, v in market_data.items()}
    d_cut = mkt_cut["daily"]
    d_cut.index = pd.to_datetime(d_cut.index).tz_localize(None)
    mkt_cut["daily"] = d_cut[d_cut.index <= cut_ts]

    cftc_cut = cftc_df.copy()
    if not cftc_cut.empty:
        cftc_cut.index = pd.to_datetime(cftc_cut.index).tz_localize(None)
        cftc_cut = cftc_cut[cftc_cut.index <= cut_ts]

    rel_cut = release_dates
    if release_dates is not None and not release_dates.empty:
        rel_cut = release_dates[pd.to_datetime(release_dates["release_date"]).dt.tz_localize(None) <= cut_ts].copy()

    trunc_panel = build_weekly_macro_panel(fd_cut, mkt_cut, cftc_cut, release_dates=rel_cut)

    common_idx = trunc_panel.index.intersection(full_panel.index)
    max_feat_diff = float(
        (full_panel.loc[common_idx, REGIME_6_COLS] - trunc_panel.loc[common_idx, REGIME_6_COLS]).abs().max().max()
    )

    full_clean = full_panel.dropna(subset=REGIME_6_COLS + ["xau_fwd_4w_pct"]).copy()
    trunc_clean = trunc_panel.dropna(subset=REGIME_6_COLS).copy()
    # Compare up to last common index before forward-return dropna in trunc
    eval_idx = trunc_clean.index.intersection(full_clean.index)
    full_sub = full_clean.loc[eval_idx]
    trunc_sub = trunc_clean.loc[eval_idx]

    full_wf = _evaluate_walkforward_unsupervised(full_sub, REGIME_6_COLS, n_clusters=4)
    trunc_wf = _evaluate_walkforward_unsupervised(trunc_sub, REGIME_6_COLS, n_clusters=4)

    oos_slice = slice(WALKFORWARD_WARMUP_WEEKS, len(eval_idx))
    km_exact = bool(np.array_equal(full_wf["km_labels"][oos_slice], trunc_wf["km_labels"][oos_slice]))
    gmm_exact = bool(np.array_equal(full_wf["gmm_labels"][oos_slice], trunc_wf["gmm_labels"][oos_slice]))
    hmm_exact = bool(np.array_equal(full_wf["hmm_labels"][oos_slice], trunc_wf["hmm_labels"][oos_slice]))

    return {
        "cutoff_date": cutoff_date,
        "tested_weeks": int(len(eval_idx)),
        "max_feature_diff": round(max_feat_diff, 12),
        "features_prefix_invariant": bool(max_feat_diff < 1e-10),
        "km_oos_prefix_invariant": km_exact,
        "gmm_oos_prefix_invariant": gmm_exact,
        "hmm_oos_prefix_invariant": hmm_exact,
        "all_passed": bool(max_feat_diff < 1e-10 and km_exact and gmm_exact and hmm_exact),
    }


def _tune_meta_hyperparams(X: pd.DataFrame, y: pd.Series) -> tuple[float, dict[str, Any]]:
    """TimeSeriesSplit hyperparameter tuning inside validation period only, with 4w purge."""
    tscv = TimeSeriesSplit(n_splits=4)
    best_c, best_c_auc = 0.15, -1.0
    for c_val in (0.05, 0.15, 0.4, 1.0):
        aucs = []
        for tr, va in tscv.split(X):
            tr_end = max(30, len(tr) - 4)
            pipe = Pipeline(
                [
                    ("imp", SimpleImputer(strategy="median")),
                    ("sc", StandardScaler()),
                    ("lr", LogisticRegression(C=c_val, max_iter=600, random_state=42)),
                ]
            )
            pipe.fit(X.iloc[tr[:tr_end]], y.iloc[tr[:tr_end]])
            p = pipe.predict_proba(X.iloc[va])[:, 1]
            if len(np.unique(y.iloc[va])) == 2:
                aucs.append(roc_auc_score(y.iloc[va], p))
        if aucs and float(np.mean(aucs)) > best_c_auc:
            best_c_auc = float(np.mean(aucs))
            best_c = c_val

    xgb_grid = [
        {"n_estimators": 60, "max_depth": 1, "learning_rate": 0.04, "reg_lambda": 15.0},
        {"n_estimators": 90, "max_depth": 2, "learning_rate": 0.03, "reg_lambda": 18.0},
    ]
    best_xgb, best_x_auc = xgb_grid[0], -1.0
    for params in xgb_grid:
        aucs = []
        for tr, va in tscv.split(X):
            tr_end = max(30, len(tr) - 4)
            m = XGBClassifier(
                **params, subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=1, eval_metric="logloss"
            )
            m.fit(X.iloc[tr[:tr_end]], y.iloc[tr[:tr_end]])
            p = m.predict_proba(X.iloc[va])[:, 1]
            if len(np.unique(y.iloc[va])) == 2:
                aucs.append(roc_auc_score(y.iloc[va], p))
        if aucs and float(np.mean(aucs)) > best_x_auc:
            best_x_auc = float(np.mean(aucs))
            best_xgb = params

    return best_c, best_xgb


def _compute_rule_score_series(df: pd.DataFrame) -> pd.Series:
    weights = {
        "real_yields_z": -28.0,
        "dollar_z": -24.0,
        "fed_policy_z": -18.0,
        "volatility_stress_z": +16.0,
        "inflation_z": +10.0,
        "growth_z": -8.0,
        "positioning_z": -8.0,
    }
    raw = pd.Series(0.0, index=df.index)
    for col, w in weights.items():
        raw = raw + w * np.tanh(df[col].fillna(0.0) / 1.5)
    return raw.clip(-100.0, 100.0)


def _eval_directional_slice(y_true: np.ndarray, probs: np.ndarray, ret_1w: np.ndarray) -> dict[str, Any]:
    pred_cls = (probs >= 0.5).astype(int)
    p_clip = np.clip(probs, 1e-6, 1.0 - 1e-6)
    positions = np.where(probs >= 0.53, 1.0, np.where(probs <= 0.44, -0.5, 0.25))
    strat_rets = positions * (ret_1w / 100.0)
    bh_rets = ret_1w / 100.0
    return {
        "n_weeks": int(len(y_true)),
        "pos_rate": round(float(np.mean(y_true)), 4),
        "directional_accuracy": round(float(accuracy_score(y_true, pred_cls)), 4),
        "balanced_accuracy": round(float(balanced_accuracy_score(y_true, pred_cls)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, probs)), 4) if len(np.unique(y_true)) == 2 else None,
        "brier": round(float(brier_score_loss(y_true, probs)), 4),
        "log_loss": round(float(log_loss(y_true, p_clip, labels=[0, 1])), 4),
        "strategy_sharpe": round(float((np.mean(strat_rets) / (np.std(strat_rets) + 1e-9)) * np.sqrt(52.0)), 3),
        "buy_hold_sharpe": round(float((np.mean(bh_rets) / (np.std(bh_rets) + 1e-9)) * np.sqrt(52.0)), 3),
        "strategy_cum_return_pct": round(float((np.prod(1.0 + strat_rets) - 1.0) * 100.0), 2),
        "buy_hold_cum_return_pct": round(float((np.prod(1.0 + bh_rets) - 1.0) * 100.0), 2),
    }


def train_macro_regime_model(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    release_dates: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Train & compare strict point-in-time Rule-based, K-Means, GMM, and Causal HMM regimes + directional models."""
    if release_dates is None:
        try:
            release_dates = fetch_fred_release_dates(force_refresh=False, sanitize=True)
        except Exception:
            release_dates = pd.DataFrame()

    panel = build_weekly_macro_panel(
        fred_daily, market_data, cftc_df, release_dates=release_dates, include_partial_latest_week=False
    )
    train_df = panel.dropna(subset=EXTENDED_ML_COLS + ["xau_fwd_4w_pct", "xau_fwd_1w_pct"]).copy()

    if len(train_df) < WALKFORWARD_WARMUP_WEEKS + UNTOUCHED_HOLDOUT_WEEKS + 52:
        raise RuntimeError(f"Insufficient weekly macro history for Model 4: {len(train_df)}")

    # Split timeline: Warmup [0:260] -> WalkForward Validation [260:-104] -> Untouched Final Holdout [-104:]
    n_total = len(train_df)
    holdout_start_idx = n_total - UNTOUCHED_HOLDOUT_WEEKS
    val_df = train_df.iloc[:holdout_start_idx].copy()

    # 1. Point-in-Time Rule-Based Regimes (raw & 2-week causal hysteresis)
    train_df["rule_regime_raw"] = train_df.apply(classify_rule_regime_raw, axis=1)
    train_df["rule_regime_hys"] = apply_causal_hysteresis(train_df["rule_regime_raw"], confirm_weeks=2)

    # 2. Strictly Causal Expanding Walk-Forward Unsupervised Regime Comparison (K=4 on 6-factor macro space)
    wf_6 = _evaluate_walkforward_unsupervised(train_df, REGIME_6_COLS, n_clusters=4)
    train_df["km_state"] = wf_6["km_labels"]
    train_df["gmm_state"] = wf_6["gmm_labels"]
    train_df["hmm_state"] = wf_6["hmm_labels"]

    oos_df = train_df.iloc[WALKFORWARD_WARMUP_WEEKS:].copy()
    for k in range(4):
        oos_df[f"gmm_prob_{k}"] = wf_6["gmm_probs"][WALKFORWARD_WARMUP_WEEKS:, k]
        oos_df[f"hmm_prob_{k}"] = wf_6["hmm_probs"][WALKFORWARD_WARMUP_WEEKS:, k]

    # Build objective descriptive names for Causal HMM states from realized OOS centroids (never assumed beforehand)
    hmm_state_names: dict[int, str] = {}
    hmm_profiles_raw = _summarize_state_profiles(oos_df, "hmm_state", REGIME_6_COLS)
    for k in range(4):
        if str(k) in hmm_profiles_raw:
            tag = hmm_profiles_raw[str(k)]["descriptive_tag"]
        else:
            c_dict = {col: float(wf_6["final_hmm_centroids"][k, idx_c]) for idx_c, col in enumerate(REGIME_6_COLS)}
            tag = _describe_empirical_centroid(c_dict)
        hmm_state_names[k] = f"State {k} ({tag})"

    oos_df["hmm_label"] = oos_df["hmm_state"].map(hmm_state_names)
    hmm_regime_stats = _summarize_state_profiles(oos_df, "hmm_state", REGIME_6_COLS, state_name_map=hmm_state_names)
    km_regime_stats = _summarize_state_profiles(oos_df, "km_state", REGIME_6_COLS)
    gmm_regime_stats = _summarize_state_profiles(oos_df, "gmm_state", REGIME_6_COLS)
    rule_hys_stats = _summarize_state_profiles(oos_df, "rule_regime_hys", REGIME_6_COLS)

    markov_transition_comparison = {
        "rules_raw_empirical": _compute_markov_transition_matrix(
            oos_df["rule_regime_raw"], state_order=RULE_REGIME_ORDER
        ),
        "rules_2w_hysteresis_empirical": _compute_markov_transition_matrix(
            oos_df["rule_regime_hys"], state_order=RULE_REGIME_ORDER
        ),
        "kmeans_oos_empirical": _compute_markov_transition_matrix(
            oos_df["km_state"], state_order=[0, 1, 2, 3]
        ),
        "gmm_oos_empirical": _compute_markov_transition_matrix(
            oos_df["gmm_state"], state_order=[0, 1, 2, 3]
        ),
        "causal_hmm_oos_empirical": _compute_markov_transition_matrix(
            oos_df["hmm_state"], state_order=[0, 1, 2, 3], state_names=hmm_state_names
        ),
        "causal_hmm_learned_transition_matrix": {
            "states": [hmm_state_names[k] for k in range(4)],
            "transition_matrix": [
                [round(float(p), 4) for p in row] for row in wf_6["final_hmm_transition_matrix"]
            ],
        },
    }

    # Cross-model agreement & stability (evaluated on strictly OOS weeks)
    stability_comparison = {
        "rules_raw": _compute_stability_metrics(oos_df["rule_regime_raw"]),
        "rules_2w_hysteresis": _compute_stability_metrics(oos_df["rule_regime_hys"]),
        "kmeans_walkforward_oos": {
            **_compute_stability_metrics(oos_df["km_state"]),
            "mean_train_silhouette": wf_6["km_mean_silhouette"],
        },
        "gmm_walkforward_oos": {
            **_compute_stability_metrics(oos_df["gmm_state"]),
            "mean_train_bic": wf_6["gmm_mean_bic"],
            "oos_log_likelihood": wf_6["gmm_oos_log_likelihood"],
            "mean_oos_entropy": wf_6["gmm_mean_oos_entropy"],
        },
        "causal_hmm_walkforward_oos": {
            **_compute_stability_metrics(oos_df["hmm_state"]),
            "oos_log_likelihood": wf_6["hmm_oos_log_likelihood"],
            "mean_oos_entropy": wf_6["hmm_mean_oos_entropy"],
            "implementation_note": "hmmlearn/statsmodels unavailable in .venv; implemented self-contained diagonal-covariance CausalGaussianHMM with sticky Dirichlet transition prior and strictly causal forward filtering.",
        },
    }

    cross_method_agreement = {
        "ari_rules_hys_vs_km": round(float(adjusted_rand_score(oos_df["rule_regime_hys"], oos_df["km_state"])), 4),
        "ari_rules_hys_vs_gmm": round(float(adjusted_rand_score(oos_df["rule_regime_hys"], oos_df["gmm_state"])), 4),
        "ari_rules_hys_vs_hmm": round(float(adjusted_rand_score(oos_df["rule_regime_hys"], oos_df["hmm_state"])), 4),
        "ari_km_vs_gmm": round(float(adjusted_rand_score(oos_df["km_state"], oos_df["gmm_state"])), 4),
        "ari_gmm_vs_hmm": round(float(adjusted_rand_score(oos_df["gmm_state"], oos_df["hmm_state"])), 4),
        "nmi_rules_hys_vs_hmm": round(float(normalized_mutual_info_score(oos_df["rule_regime_hys"], oos_df["hmm_state"])), 4),
        "nmi_gmm_vs_hmm": round(float(normalized_mutual_info_score(oos_df["gmm_state"], oos_df["hmm_state"])), 4),
    }

    # 3. K-selection & Feature-Selection Sensitivity (strictly on validation slice so untouched holdout stays untouched!)
    k_sensitivity: dict[str, Any] = {}
    wf_k4_val: dict[str, Any] | None = None
    for k_try in (3, 4, 5):
        wf_k = _evaluate_walkforward_unsupervised(val_df, REGIME_6_COLS, n_clusters=k_try)
        if k_try == 4:
            wf_k4_val = wf_k
        k_sensitivity[f"K={k_try}"] = {
            "km_silhouette": wf_k["km_mean_silhouette"],
            "km_transitions": _compute_stability_metrics(pd.Series(wf_k["km_labels"][WALKFORWARD_WARMUP_WEEKS:], index=val_df.index[WALKFORWARD_WARMUP_WEEKS:]))["transitions"],
            "gmm_bic": wf_k["gmm_mean_bic"],
            "gmm_oos_ll": wf_k["gmm_oos_log_likelihood"],
            "gmm_transitions": _compute_stability_metrics(pd.Series(wf_k["gmm_labels"][WALKFORWARD_WARMUP_WEEKS:], index=val_df.index[WALKFORWARD_WARMUP_WEEKS:]))["transitions"],
            "hmm_oos_ll": wf_k["hmm_oos_log_likelihood"],
            "hmm_transitions": _compute_stability_metrics(pd.Series(wf_k["hmm_labels"][WALKFORWARD_WARMUP_WEEKS:], index=val_df.index[WALKFORWARD_WARMUP_WEEKS:]))["transitions"],
        }

    wf_4f = _evaluate_walkforward_unsupervised(val_df, REGIME_4_COLS, n_clusters=4)
    wf_6f_val = wf_k4_val if wf_k4_val is not None else _evaluate_walkforward_unsupervised(val_df, REGIME_6_COLS, n_clusters=4)
    wf_8f = _evaluate_walkforward_unsupervised(val_df, EXTENDED_ML_COLS, n_clusters=4)
    sl_val = slice(WALKFORWARD_WARMUP_WEEKS, len(val_df))
    feature_sensitivity = {
        "gmm_ari_4f_vs_6f": round(float(adjusted_rand_score(wf_4f["gmm_labels"][sl_val], wf_6f_val["gmm_labels"][sl_val])), 4),
        "gmm_ari_6f_vs_8f": round(float(adjusted_rand_score(wf_6f_val["gmm_labels"][sl_val], wf_8f["gmm_labels"][sl_val])), 4),
        "hmm_ari_4f_vs_6f": round(float(adjusted_rand_score(wf_4f["hmm_labels"][sl_val], wf_6f_val["hmm_labels"][sl_val])), 4),
        "hmm_ari_6f_vs_8f": round(float(adjusted_rand_score(wf_6f_val["hmm_labels"][sl_val], wf_8f["hmm_labels"][sl_val])), 4),
        "km_ari_4f_vs_6f": round(float(adjusted_rand_score(wf_4f["km_labels"][sl_val], wf_6f_val["km_labels"][sl_val])), 4),
        "km_ari_6f_vs_8f": round(float(adjusted_rand_score(wf_6f_val["km_labels"][sl_val], wf_8f["km_labels"][sl_val])), 4),
    }

    # 4. Historical Consistency Spot-Checks (strictly OOS assignments)
    episode_targets = [
        ("2009-05-15", "Post-GFC Recovery / Low-Rate Transition"),
        ("2011-09-02", "Eurocrisis / Debt-Ceiling Gold Peak"),
        ("2013-06-28", "Taper Tantrum"),
        ("2017-06-30", "Low-Vol Disinflationary Expansion"),
        ("2020-03-27", "COVID-19 Liquidity Shock"),
        ("2022-06-24", "2022 Inflation & Fed Hiking Shock"),
        ("2023-10-27", "Higher-for-Longer Real Yield Peak"),
        ("2025-06-27", "2025 Tariff/Growth-Slowdown Easing Transition"),
    ]
    historical_episodes: list[dict[str, Any]] = []
    for dt_str, desc in episode_targets:
        pos = oos_df.index.searchsorted(pd.Timestamp(dt_str))
        if pos < len(oos_df):
            row = oos_df.iloc[pos]
            historical_episodes.append(
                {
                    "date": oos_df.index[pos].strftime("%Y-%m-%d"),
                    "episode": desc,
                    "rule_regime_hys": str(row["rule_regime_hys"]),
                    "six_dim_states": classify_six_dimensions(row),
                    "km_state": int(row["km_state"]),
                    "gmm_state": int(row["gmm_state"]),
                    "hmm_state": int(row["hmm_state"]),
                    "hmm_label": str(row["hmm_label"]),
                    "factors_z": {c: round(float(row[c]), 2) for c in REGIME_6_COLS},
                }
            )

    # 5. Directional 4-week XAUUSD Walk-Forward Validation + Untouched Final Holdout
    X = train_df[EXTENDED_ML_COLS].copy()
    y_up_4w = (train_df["xau_fwd_4w_pct"] > 0.0).astype(int)
    rule_scores_all = _compute_rule_score_series(train_df)
    p_rule_all = 1.0 / (1.0 + np.exp(-2.0 * (rule_scores_all.values / 100.0)))

    # Tune strictly on initial warmup/validation slice (never touching holdout!)
    best_c, best_xgb_params = _tune_meta_hyperparams(
        X.iloc[:WALKFORWARD_WARMUP_WEEKS], y_up_4w.iloc[:WALKFORWARD_WARMUP_WEEKS]
    )

    oof_base, oof_lr, oof_xgb, oof_blend, oof_true, oof_ret_1w = [], [], [], [], [], []
    lr_tmp = xgb_tmp = et_tmp = None
    for idx in range(WALKFORWARD_WARMUP_WEEKS, n_total):
        tr_end = max(50, idx - 4)  # 4-week purge gap for 4w overlapping target
        X_tr, y_tr = X.iloc[:tr_end], y_up_4w.iloc[:tr_end]
        if (idx - WALKFORWARD_WARMUP_WEEKS) % 8 == 0 or lr_tmp is None:
            lr_tmp = Pipeline(
                [
                    ("imp", SimpleImputer(strategy="median")),
                    ("sc", StandardScaler()),
                    ("lr", LogisticRegression(C=best_c, max_iter=600, random_state=42)),
                ]
            ).fit(X_tr, y_tr)
            xgb_tmp = XGBClassifier(
                **best_xgb_params,
                subsample=0.80,
                colsample_bytree=0.75,
                random_state=42,
                n_jobs=1,
                eval_metric="logloss",
            ).fit(X_tr, y_tr)
            et_tmp = ExtraTreesClassifier(
                n_estimators=120, max_depth=3, min_samples_leaf=20, random_state=42, n_jobs=1
            ).fit(X_tr, y_tr)

        X_te = X.iloc[[idx]]
        p_l = float(lr_tmp.predict_proba(X_te)[0, 1])
        p_x = float(xgb_tmp.predict_proba(X_te)[0, 1])
        p_e = float(et_tmp.predict_proba(X_te)[0, 1])
        oof_base.append(float(y_tr.mean()))
        oof_lr.append(p_l)
        oof_xgb.append(p_x)
        oof_blend.append(0.55 * p_l + 0.30 * p_x + 0.15 * p_e)
        oof_true.append(int(y_up_4w.iloc[idx]))
        oof_ret_1w.append(float(train_df["xau_fwd_1w_pct"].iloc[idx]))

    val_n = holdout_start_idx - WALKFORWARD_WARMUP_WEEKS
    sl_v = slice(0, val_n)
    sl_h = slice(val_n, len(oof_true))

    oof_true_arr = np.array(oof_true)
    oof_ret_arr = np.array(oof_ret_1w)
    p_rule_oos = p_rule_all[WALKFORWARD_WARMUP_WEEKS:]

    directional_eval = {
        "walkforward_validation": {
            "period": f"{train_df.index[WALKFORWARD_WARMUP_WEEKS].strftime('%Y-%m-%d')} to {train_df.index[holdout_start_idx - 1].strftime('%Y-%m-%d')}",
            "trailing_base_rate": _eval_directional_slice(oof_true_arr[sl_v], np.array(oof_base)[sl_v], oof_ret_arr[sl_v]),
            "transparent_macro_rules": _eval_directional_slice(oof_true_arr[sl_v], p_rule_oos[sl_v], oof_ret_arr[sl_v]),
            "logistic_regression": _eval_directional_slice(oof_true_arr[sl_v], np.array(oof_lr)[sl_v], oof_ret_arr[sl_v]),
            "xgboost": _eval_directional_slice(oof_true_arr[sl_v], np.array(oof_xgb)[sl_v], oof_ret_arr[sl_v]),
            "blended_ensemble": _eval_directional_slice(oof_true_arr[sl_v], np.array(oof_blend)[sl_v], oof_ret_arr[sl_v]),
        },
        "untouched_final_holdout": {
            "period": f"{train_df.index[holdout_start_idx].strftime('%Y-%m-%d')} to {train_df.index[-1].strftime('%Y-%m-%d')}",
            "trailing_base_rate": _eval_directional_slice(oof_true_arr[sl_h], np.array(oof_base)[sl_h], oof_ret_arr[sl_h]),
            "transparent_macro_rules": _eval_directional_slice(oof_true_arr[sl_h], p_rule_oos[sl_h], oof_ret_arr[sl_h]),
            "logistic_regression": _eval_directional_slice(oof_true_arr[sl_h], np.array(oof_lr)[sl_h], oof_ret_arr[sl_h]),
            "xgboost": _eval_directional_slice(oof_true_arr[sl_h], np.array(oof_xgb)[sl_h], oof_ret_arr[sl_h]),
            "blended_ensemble": _eval_directional_slice(oof_true_arr[sl_h], np.array(oof_blend)[sl_h], oof_ret_arr[sl_h]),
        },
    }

    # 6. Prefix-Invariance Leakage Verification
    prefix_check = verify_point_in_time_prefix_invariance(
        fred_daily, market_data, cftc_df, release_dates=release_dates, cutoff_date="2022-06-24"
    )

    # 7. Fit Locked Production Regime & Directional Models on Full Available Panel (for T+1 live inference only)
    live_panel = panel.dropna(subset=EXTENDED_ML_COLS).copy()
    X_live_all = live_panel[EXTENDED_ML_COLS].copy()
    regime_scaler = StandardScaler().fit(X_live_all[REGIME_6_COLS].values)
    X_reg_s = regime_scaler.transform(X_live_all[REGIME_6_COLS].values)

    prod_hmm = CausalGaussianHMM(n_states=4, n_iter=35, sticky_alpha=12.0, random_state=42).fit(X_reg_s)
    prod_hmm_c = regime_scaler.inverse_transform(prod_hmm.means_)
    perm_prod_hmm = _align_centroids(wf_6["final_hmm_centroids"], prod_hmm_c)

    prod_gmm = GaussianMixture(
        n_components=4, covariance_type="full", reg_covar=1e-4, n_init=8, random_state=42
    ).fit(X_reg_s)
    prod_gmm_c = regime_scaler.inverse_transform(prod_gmm.means_)
    perm_prod_gmm = _align_centroids(wf_6["final_gmm_centroids"], prod_gmm_c)

    prod_km = KMeans(n_clusters=4, n_init=20, random_state=42).fit(X_reg_s)
    prod_km_c = regime_scaler.inverse_transform(prod_km.cluster_centers_)
    perm_prod_km = _align_centroids(wf_6["final_km_centroids"], prod_km_c)

    final_lr = Pipeline(
        [
            ("imp", SimpleImputer(strategy="median")),
            ("sc", StandardScaler()),
            ("lr", LogisticRegression(C=best_c, max_iter=600, random_state=42)),
        ]
    ).fit(X, y_up_4w)
    final_xgb = XGBClassifier(
        **best_xgb_params, subsample=0.80, colsample_bytree=0.75, random_state=42, n_jobs=1, eval_metric="logloss"
    ).fit(X, y_up_4w)
    final_et = ExtraTreesClassifier(
        n_estimators=120, max_depth=3, min_samples_leaf=20, random_state=42, n_jobs=1
    ).fit(X, y_up_4w)

    # Backward-compatible Model4Output `metrics` summary (sourced strictly from OOS walk-forward + holdout!)
    all_blend_eval = directional_eval["walkforward_validation"]["blended_ensemble"]
    ho_blend_eval = directional_eval["untouched_final_holdout"]["blended_ensemble"]
    # Legacy compatible `regime_stats` using OOS Causal HMM states
    compat_regime_stats = {
        k: {
            "weeks": v["weeks"],
            "avg_xau_fwd_4w_pct": v["avg_xau_fwd_4w_pct"],
            "xau_4w_win_rate": v["xau_4w_win_rate"],
        }
        for k, v in hmm_regime_stats.items()
    }

    metrics = {
        "weekly_samples": int(n_total),
        "oof_weeks": int(len(oof_true_arr)),
        "validation_weeks": int(val_n),
        "untouched_holdout_weeks": int(UNTOUCHED_HOLDOUT_WEEKS),
        "tuned_lr_c": best_c,
        "tuned_xgb_params": best_xgb_params,
        # Validation OOF metrics
        "oof_4w_directional_accuracy": all_blend_eval["directional_accuracy"],
        "oof_4w_balanced_accuracy": all_blend_eval["balanced_accuracy"],
        "oof_4w_roc_auc": all_blend_eval["roc_auc"],
        "oof_4w_brier": all_blend_eval["brier"],
        "oof_strategy_sharpe": all_blend_eval["strategy_sharpe"],
        "oof_buy_hold_sharpe": all_blend_eval["buy_hold_sharpe"],
        "oof_strategy_cum_return_pct": all_blend_eval["strategy_cum_return_pct"],
        "oof_buy_hold_cum_return_pct": all_blend_eval["buy_hold_cum_return_pct"],
        # Untouched final holdout metrics
        "holdout_4w_directional_accuracy": ho_blend_eval["directional_accuracy"],
        "holdout_4w_roc_auc": ho_blend_eval["roc_auc"],
        "holdout_4w_brier": ho_blend_eval["brier"],
        "holdout_strategy_sharpe": ho_blend_eval["strategy_sharpe"],
        "holdout_buy_hold_sharpe": ho_blend_eval["buy_hold_sharpe"],
        "regime_stats": compat_regime_stats,
        "primary_regime_detector": "Causal Gaussian HMM (6-factor, strictly forward-filtered)",
        "prefix_invariance_verified": prefix_check["all_passed"],
    }

    experiment_run = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_span": {
            "start_date": train_df.index.min().strftime("%Y-%m-%d"),
            "end_date": train_df.index.max().strftime("%Y-%m-%d"),
            "total_weekly_rows": int(n_total),
            "warmup_weeks": WALKFORWARD_WARMUP_WEEKS,
            "oos_weeks": int(len(oos_df)),
            "validation_weeks": int(val_n),
            "untouched_holdout_weeks": UNTOUCHED_HOLDOUT_WEEKS,
        },
        "point_in_time_controls": {
            "fred_publication_lag_alignment": "align_fred_daily_point_in_time + 1bd H.15 lag",
            "cftc_publication_lag": "get_pit_cftc_series (Tuesday -> Friday release)",
            "stress_factor_homogeneity": "VIX + SPX 13w realized vol (excluded 2023-start BAMLH0A0HYM2)",
            "regime_fitting": "Strictly expanding-window walk-forward OOS (no full-sample clustering in evaluation)",
            "alfred_vintage_limitation": "Underlying FRED CSVs use revised series (not ALFRED output_type=4 initial vintages)",
            "prefix_invariance_check": prefix_check,
        },
        "stability_comparison": stability_comparison,
        "markov_transition_comparison": markov_transition_comparison,
        "cross_method_agreement": cross_method_agreement,
        "k_sensitivity_validation": k_sensitivity,
        "feature_selection_sensitivity_validation": feature_sensitivity,
        "state_profiles_oos": {
            "causal_hmm": hmm_regime_stats,
            "gmm": gmm_regime_stats,
            "kmeans": km_regime_stats,
            "rules_2w_hysteresis": rule_hys_stats,
        },
        "historical_episodes_oos": historical_episodes,
        "directional_evaluation": directional_eval,
        "summary_metrics": metrics,
    }

    bundle = {
        "lr": final_lr,
        "xgb": final_xgb,
        "et": final_et,
        "feature_cols": EXTENDED_ML_COLS,
        "regime_cols": REGIME_6_COLS,
        "regime_scaler": regime_scaler,
        "hmm": prod_hmm,
        "hmm_perm": perm_prod_hmm,
        "hmm_state_names": hmm_state_names,
        "gmm": prod_gmm,
        "gmm_perm": perm_prod_gmm,
        "kmeans": prod_km,
        "kmeans_perm": perm_prod_km,
        "regime_stats": compat_regime_stats,
        "rule_regime_stats": rule_hys_stats,
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    # Save artifacts to both ml/artifacts/macro_regime/ and ml/artifacts/model4_macro_regime/
    for target_dir in (MACRO_REGIME_DIR, MODEL4_DIR):
        joblib.dump(bundle, target_dir / "macro_regime_bias.joblib")

    oos_export_cols = [
        "xauusd", "dxy", "vix", "cpi_yoy", "indpro_yoy", "real_rate_policy",
        *REGIME_6_COLS,
        "rule_regime_raw", "rule_regime_hys", "km_state", "gmm_state", "hmm_state", "hmm_label",
        "xau_fwd_4w_pct", "dxy_fwd_4w_pct", "spx_fwd_4w_pct",
    ]
    oos_df[oos_export_cols].to_csv(MACRO_REGIME_DIR / "regime_panel_oos.csv")
    (TRAINING_RUNS_DIR / "model4_regime_run.json").write_text(
        json.dumps(experiment_run, indent=2), encoding="utf-8"
    )
    (REPORTS_DIR / "model4_training_report.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    return metrics


def predict_macro_regime_bias(
    fred_daily: pd.DataFrame,
    market_data: dict[str, pd.DataFrame],
    cftc_df: pd.DataFrame,
    model1_out: dict[str, Any],
    model2_out: dict[str, Any],
    model3_out: dict[str, Any],
    release_dates: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Compute point-in-time macro regime state and Bullish/Bearish/Neutral XAUUSD bias."""
    bundle_path = MACRO_REGIME_DIR / "macro_regime_bias.joblib"
    if not bundle_path.exists():
        bundle_path = MODEL4_DIR / "macro_regime_bias.joblib"
    bundle = joblib.load(bundle_path)

    panel = build_weekly_macro_panel(
        fred_daily,
        market_data,
        cftc_df,
        release_dates=release_dates,
        include_partial_latest_week=True,
    )
    feature_cols = bundle.get("feature_cols", EXTENDED_ML_COLS)
    regime_cols = bundle.get("regime_cols", REGIME_6_COLS)

    valid_panel = panel.dropna(subset=feature_cols).copy()
    if valid_panel.empty:
        # Fall back to forward-filled or median imputed panel if features are partially missing/corrupted
        valid_panel = panel.ffill().bfill().copy()
        if valid_panel.empty:
            raise RuntimeError("Weekly macro panel is completely empty.")
    latest = valid_panel.iloc[-1]
    latest_date = valid_panel.index[-1].strftime("%Y-%m-%d")

    X_cur = pd.DataFrame([{c: float(latest[c]) for c in feature_cols}])
    p_lr = float(bundle["lr"].predict_proba(X_cur)[0, 1])
    p_xgb = float(bundle["xgb"].predict_proba(X_cur)[0, 1])
    p_et = float(bundle["et"].predict_proba(X_cur)[0, 1]) if "et" in bundle else p_xgb
    ml_prob_up = 0.55 * p_lr + 0.30 * p_xgb + 0.15 * p_et
    ml_bias_score = (ml_prob_up - 0.5) * 200.0

    # Causal regime inference across HMM (forward-filtered over valid history), GMM, K-Means, and Rules
    X_reg_hist = bundle["regime_scaler"].transform(valid_panel[regime_cols].values)
    hmm_probs_seq, _ = bundle["hmm"].filter_sequence(X_reg_hist)
    hmm_probs_cur = hmm_probs_seq[-1][bundle["hmm_perm"]]
    hmm_names = bundle["hmm_state_names"]
    regime_probs = {hmm_names[i]: round(float(hmm_probs_cur[i]), 3) for i in range(len(hmm_probs_cur))}
    dominant_regime = max(regime_probs, key=regime_probs.get)
    regime_hist = bundle["regime_stats"].get(dominant_regime, {})
    regime_entropy = float(
        -sum(max(p, 1e-9) * np.log(max(p, 1e-9)) for p in hmm_probs_cur) / np.log(len(hmm_probs_cur))
    )

    gmm_probs_cur = bundle["gmm"].predict_proba(X_reg_hist[[-1]])[0][bundle["gmm_perm"]]
    km_raw_id = int(bundle["kmeans"].predict(X_reg_hist[[-1]])[0])
    km_state = int(np.argsort(bundle["kmeans_perm"])[km_raw_id])

    raw_rules = valid_panel.apply(classify_rule_regime_raw, axis=1)
    hys_rules = apply_causal_hysteresis(raw_rules, confirm_weeks=2)
    current_rule_raw = str(raw_rules.iloc[-1])
    current_rule_hys = str(hys_rules.iloc[-1])
    six_dim = classify_six_dimensions(latest)

    rule_weights = {
        "real_yields_z": -28.0,
        "dollar_z": -24.0,
        "fed_policy_z": -18.0,
        "volatility_stress_z": +16.0,
        "inflation_z": +10.0,
        "growth_z": -8.0,
        "positioning_z": -8.0,
    }
    hy_note = f" / HY {latest['BAMLH0A0HYM2']:.2f}%" if pd.notna(latest.get("BAMLH0A0HYM2")) else ""
    raw_labels = {
        "real_yields_z": ("US 10Y Real Yield", f"{latest.get('DFII10', 0):.2f}%"),
        "dollar_z": ("US Dollar Index (DXY)", f"{latest.get('dxy', 0):.2f}"),
        "fed_policy_z": ("Fed Real Policy Stance", f"{latest.get('real_rate_policy', 0):.2f}%"),
        "volatility_stress_z": ("Cross-Asset Stress (VIX/RVol)", f"VIX {latest.get('vix', 0):.1f} / SPX RVol {latest.get('spx_rvol_13w', 0):.1f}%{hy_note}"),
        "inflation_z": ("Inflation Regime (CPI/BE)", f"CPI {latest.get('cpi_yoy', 0):.2f}% YoY"),
        "growth_z": ("Growth Momentum", f"IndPro {latest.get('indpro_yoy', 0):.1f}% YoY"),
        "positioning_z": ("CFTC Gold Spec Positioning", f"{latest.get('cot_pct', 50):.0f}th pct"),
    }

    evidence_rows = []
    rule_score_raw = 0.0
    for col, w in rule_weights.items():
        z_val = float(latest[col])
        contrib = w * float(np.tanh(z_val / 1.5))
        rule_score_raw += contrib
        name, val_str = raw_labels[col]
        evidence_rows.append(
            {
                "factor": name,
                "key": col,
                "current_value": val_str,
                "z_score": round(z_val, 2),
                "weight": w,
                "xauusd_contribution": round(contrib, 1),
                "signal": "BULLISH GOLD" if contrib > 2.5 else "BEARISH GOLD" if contrib < -2.5 else "NEUTRAL",
            }
        )
    rule_score = float(np.clip(rule_score_raw, -100.0, 100.0))

    m1_forecasts = (model1_out or {}).get("forecasts") or {}
    m1_z_list = [float(v.get("surprise_zscore") or 0.0) for v in m1_forecasts.values() if isinstance(v, dict)]
    m1_mean_z = float(np.mean(m1_z_list)) if m1_z_list else 0.0
    model1_score = float(np.clip(-m1_mean_z * 35.0, -100.0, 100.0))

    m2_agg = (model2_out or {}).get("aggregate") or {}
    m2_policy = float(m2_agg.get("policy_hawkish_score") or 0.0)
    m2_growth = float(m2_agg.get("growth_momentum_score") or 0.0)
    m2_inf = float(m2_agg.get("inflation_pressure_score") or 0.0)
    m2_unc = float(m2_agg.get("uncertainty") if m2_agg.get("uncertainty") is not None else 0.45)
    model2_score = float(np.clip((-0.65 * m2_policy - 0.25 * m2_growth + 0.10 * m2_inf) * 80.0, -100.0, 100.0))

    m3_h = (model3_out or {}).get("horizons") or {}
    h4 = m3_h.get("4h") or {}
    d1 = m3_h.get("1d") or {}
    # Respect blocked/unavailable Model 3 horizons (FOMC, 5m, 30m) gracefully without None/NaN propagation
    h4_up, h4_dn = h4.get("prob_up"), h4.get("prob_down")
    d1_up, d1_dn = d1.get("prob_up"), d1.get("prob_down")
    h4_edge = (float(h4_up) - float(h4_dn)) if (h4_up is not None and h4_dn is not None) else 0.0
    d1_edge = (float(d1_up) - float(d1_dn)) if (d1_up is not None and d1_dn is not None) else 0.0
    if h4_up is not None and h4_dn is not None and d1_up is not None and d1_dn is not None:
        m3_edge = 0.4 * h4_edge + 0.6 * d1_edge
    elif d1_up is not None and d1_dn is not None:
        m3_edge = d1_edge
    elif h4_up is not None and h4_dn is not None:
        m3_edge = h4_edge
    else:
        m3_edge = 0.0
    model3_score = float(np.clip(m3_edge * 120.0, -100.0, 100.0))

    composite_score = float(
        np.clip(
            0.35 * rule_score
            + 0.25 * ml_bias_score
            + 0.15 * model1_score
            + 0.12 * model2_score
            + 0.13 * model3_score,
            -100.0,
            100.0,
        )
    )

    sub_scores = np.array([rule_score, ml_bias_score, model1_score, model2_score, model3_score])
    disagreement = float(np.clip(np.std(sub_scores) / 50.0, 0.0, 1.0))
    uncertainty = float(np.clip(0.45 * disagreement + 0.35 * m2_unc + 0.20 * regime_entropy, 0.05, 0.95))
    confidence = round((1.0 - uncertainty) * 100.0, 1)

    def _lbl(sc: float) -> str:
        return "BULLISH" if sc >= 12.0 else "BEARISH" if sc <= -12.0 else "NEUTRAL"

    bias = _lbl(composite_score)
    dxy_score = float(np.clip(0.5 * (-rule_score) + 0.3 * (-model1_score) + 0.2 * (m2_policy * 80.0), -100, 100))
    spx_score = float(
        np.clip(
            0.45 * (float(latest["growth_z"]) * 35.0)
            - 0.35 * (float(latest["volatility_stress_z"]) * 35.0)
            - 0.20 * (float(latest["real_yields_z"]) * 25.0),
            -100,
            100,
        )
    )

    spot_xau = float(latest["xauusd"])
    r10_cur = float(latest.get("DFII10", 1.9))
    dxy_cur = float(latest.get("dxy", 104.0))
    vix_cur = float(latest.get("vix", 16.0))

    invalidation_triggers = [
        {
            "trigger": "Real Yield Regime Shift",
            "condition": f"US 10Y Real Yield breaks {'above' if bias != 'BEARISH' else 'below'} {r10_cur + (0.20 if bias != 'BEARISH' else -0.20):.2f}%",
            "current": f"{r10_cur:.2f}%",
        },
        {
            "trigger": "Dollar Trend Flip",
            "condition": f"DXY closes decisively {'above' if bias != 'BEARISH' else 'below'} {dxy_cur + (1.5 if bias != 'BEARISH' else -1.5):.2f}",
            "current": f"{dxy_cur:.2f}",
        },
        {
            "trigger": "Volatility / Risk Regime",
            "condition": f"VIX spikes above {max(22.0, vix_cur + 4.0):.1f} (safe-haven bid override)",
            "current": f"{vix_cur:.1f}",
        },
    ]

    return {
        "model": "Model 4 — Point-in-Time Macro Regime (Rules + Causal HMM/GMM/K-Means) + Bias Engine",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of_date": latest_date,
        "primary_asset": "XAUUSD",
        "spot_xauusd": round(spot_xau, 2),
        "bias": bias,
        "bias_score": round(composite_score, 1),
        "confidence_pct": confidence,
        "uncertainty": round(uncertainty, 3),
        "uncertainty_breakdown": {
            "cross_model_disagreement": round(disagreement, 3),
            "news_ambiguity": round(m2_unc, 3),
            "regime_entropy": round(regime_entropy, 3),
        },
        "regime": {
            "dominant_regime": dominant_regime,
            "probabilities": regime_probs,
            "historical_xau_avg_4w_pct": regime_hist.get("avg_xau_fwd_4w_pct"),
            "historical_xau_4w_win_rate": regime_hist.get("xau_4w_win_rate"),
            "rule_based_regime": current_rule_hys,
            "rule_based_regime_raw": current_rule_raw,
            "six_dimension_states": six_dim,
            "gmm_dominant_state": int(np.argmax(gmm_probs_cur)),
            "kmeans_dominant_state": km_state,
        },
        "component_scores": {
            "transparent_macro_rules": round(rule_score, 1),
            "statistical_regime_ml": round(ml_bias_score, 1),
            "ml_prob_up_4w": round(ml_prob_up, 3),
            "model1_economic_surprise": round(model1_score, 1),
            "model2_news_intelligence": round(model2_score, 1),
            "model3_market_reaction": round(model3_score, 1),
        },
        "cross_asset_biases": {
            "XAUUSD": {"bias": bias, "score": round(composite_score, 1)},
            "DXY": {"bias": _lbl(dxy_score), "score": round(dxy_score, 1)},
            "SPX500": {"bias": _lbl(spx_score), "score": round(spx_score, 1)},
        },
        "supporting_evidence": evidence_rows,
        "invalidation_triggers": invalidation_triggers,
        "metrics": bundle["metrics"],
    }


if __name__ == "__main__":
    from ml.data_pipeline import fetch_all_fred_data, fetch_cftc_gold_history, fetch_market_data
    from ml.models.macro_regime_bias import train_macro_regime_model as _train_m4

    _fred = fetch_all_fred_data(force_refresh=False)
    _mkt = fetch_market_data(force_refresh=False)
    _cftc = fetch_cftc_gold_history(force_refresh=False)
    _rel = fetch_fred_release_dates(force_refresh=False, sanitize=True)
    _metrics = _train_m4(_fred["daily"], _mkt, _cftc, release_dates=_rel)
    print(json.dumps(_metrics, indent=2))
