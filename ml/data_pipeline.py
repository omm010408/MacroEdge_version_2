from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import feedparser
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from bs4 import BeautifulSoup

from ml.config import (
    API_NINJAS_API_KEY,
    API_NINJAS_GOLD_URL,
    CFTC_GOLD_CONTRACT_CODE,
    CFTC_GOLD_URL,
    DATA_DIR,
    FED_RSS_FEEDS,
    FRED_API_KEY,
    FRED_MACRO_SERIES,
    FRED_RELEASE_IDS,
    MARKETAUX_API_KEY,
    MARKETAUX_BASE_URL,
    MARKET_TICKERS,
)

FRED_OBS_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_RELEASE_DATES_URL = "https://api.stlouisfed.org/fred/release/dates"

# Conservative calendar-day publication lags from FRED observation start date (YYYY-MM-01)
# when exact historical release dates are unavailable (e.g., GDPC1, INDPRO, RSAFS, JTSJOL).
CONSERVATIVE_PUBLICATION_LAG_DAYS: dict[str, int] = {
    "CPIAUCSL": 43,
    "CPILFESL": 43,
    "CUSR0000SAH1": 43,
    "CUSR0000SASLE": 43,
    "PCEPI": 60,
    "PCEPILFE": 60,
    "PPIFIS": 45,
    "PPIACO": 45,
    "PAYEMS": 36,
    "UNRATE": 36,
    "CES0500000003": 36,
    "JTSJOL": 65,
    "INDPRO": 47,
    "RSAFS": 47,
    "UMCSENT": 30,
    "M2SL": 55,
    "GDPC1": 120,  # Quarter start YYYY-MM-01 -> advance GDP released ~30d after quarter end
    "ICSA": 5,     # Week-ending Saturday -> released following Thursday
    "CCSA": 12,    # Continued claims lag 1 additional week
    "GASREGW": 1,
    "WALCL": 1,    # Wednesday level -> released Thursday 16:30 ET
    "WTREGEN": 1,
}


def fetch_alfred_initial_vintages(
    series_id: str,
    observation_start: str = "1995-01-01",
    timeout: int = 15,
) -> pd.Series:
    """Fetch initial-release (first vintage) ALFRED observations using output_type=4."""
    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is not configured in .env.local or environment.")

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": observation_start,
        "realtime_start": "1776-07-04",
        "realtime_end": "9999-12-31",
        "output_type": 4,
        "sort_order": "asc",
    }
    resp = requests.get(FRED_OBS_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    obs = resp.json().get("observations", [])
    rows = []
    for item in obs:
        val_str = str(item.get("value", "")).strip()
        if not val_str or val_str == ".":
            continue
        try:
            rows.append((pd.to_datetime(item["date"]), float(val_str)))
        except (ValueError, KeyError):
            continue

    if not rows:
        return pd.Series(dtype=float, name=series_id)

    idx, vals = zip(*rows)
    s = pd.Series(vals, index=pd.DatetimeIndex(idx), name=series_id)
    return s[~s.index.duplicated(keep="last")].sort_index()


def trim_incomplete_monthly_tail(monthly_df: pd.DataFrame) -> pd.DataFrame:
    """Drop trailing month rows where all core monthly macro targets are still NaN."""
    if monthly_df.empty:
        return monthly_df
    core_monthly = [
        c for c in ("CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "PAYEMS", "UNRATE")
        if c in monthly_df.columns
    ]
    if not core_monthly:
        return monthly_df
    out = monthly_df.sort_index().copy()
    while len(out) > 0 and out[core_monthly].iloc[-1].isna().all():
        out = out.iloc[:-1]
    return out


def align_fred_daily_point_in_time(
    fred_daily: pd.DataFrame,
    release_dates: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Shift monthly/quarterly/weekly FRED series in daily panel to their true availability dates.

    FRED assigns monthly observations to YYYY-MM-01 and quarterly observations to quarter-start,
    so raw forward-filling leaks future releases onto earlier days. This helper shifts each
    non-daily series forward to its actual release date (when available in `release_dates`) or a
    conservative publication-lag offset before forward-filling.
    """
    if fred_daily.empty:
        return fred_daily

    df = fred_daily.copy().sort_index()
    df.index = pd.to_datetime(df.index).tz_localize(None)

    # Identify release-date mapping for monthly indicator families
    rel_map: dict[str, pd.DatetimeIndex] = {}
    if release_dates is not None and not release_dates.empty:
        rd = release_dates.copy()
        rd["release_date"] = pd.to_datetime(rd["release_date"]).dt.tz_localize(None)
        for et in ("CPI", "NFP", "PCE", "PPI"):
            sub = rd[rd["event_type"] == et]["release_date"].drop_duplicates().sort_values()
            if not sub.empty:
                rel_map[et] = pd.DatetimeIndex(sub)

    series_to_group = {
        "CPIAUCSL": "CPI",
        "CPILFESL": "CPI",
        "CUSR0000SAH1": "CPI",
        "CUSR0000SASLE": "CPI",
        "PAYEMS": "NFP",
        "UNRATE": "NFP",
        "CES0500000003": "NFP",
        "PCEPI": "PCE",
        "PCEPILFE": "PCE",
        "PPIFIS": "PPI",
        "PPIACO": "PPI",
    }

    pit = pd.DataFrame(index=df.index)
    for col in df.columns:
        meta = FRED_MACRO_SERIES.get(col, {"freq": "D"})
        freq = meta.get("freq", "D")
        s = df[col]
        if freq == "D":
            pit[col] = s
            continue

        lag_days = CONSERVATIVE_PUBLICATION_LAG_DAYS.get(col, 45 if freq == "M" else 120 if freq == "Q" else 7)
        # Extract change points (where observation updates in the ffilled daily panel)
        valid = s.dropna()
        if valid.empty:
            pit[col] = s
            continue

        if freq in ("M", "Q"):
            # Group by month/quarter start timestamps where new period begins
            changed = valid[valid.index.is_month_start | (valid.ne(valid.shift(1)))]
            # Keep first occurrence per calendar month (or quarter)
            if freq == "Q":
                period_key = changed.index.to_period("Q")
            else:
                period_key = changed.index.to_period("M")
            obs = changed[~period_key.duplicated(keep="first")]
        else:
            obs = valid[valid.ne(valid.shift(1))]

        group = series_to_group.get(col)
        new_dates: list[pd.Timestamp] = []
        new_vals: list[float] = []
        for obs_dt, val in obs.items():
            avail_dt = obs_dt + pd.Timedelta(days=lag_days)
            if group and group in rel_map:
                # Primary release for reference month obs_dt falls in the following calendar month
                win_start = (obs_dt + pd.DateOffset(months=1)).replace(day=1)
                win_end = win_start + pd.DateOffset(months=1) - pd.Timedelta(days=1)
                # For PCE, late-month release can occasionally slip to first days of month+2
                if group == "PCE":
                    win_end = win_end + pd.Timedelta(days=5)
                cand = rel_map[group][(rel_map[group] >= win_start) & (rel_map[group] <= win_end)]
                if not cand.empty:
                    avail_dt = pd.Timestamp(cand[0])
            new_dates.append(avail_dt)
            new_vals.append(float(val))

        if new_dates:
            shifted = pd.Series(new_vals, index=pd.DatetimeIndex(new_dates))
            shifted = shifted[~shifted.index.duplicated(keep="last")].sort_index()
            pit[col] = shifted.reindex(df.index.union(shifted.index)).sort_index().ffill().reindex(df.index)
        else:
            pit[col] = np.nan

    return pit


def fetch_fred_series(
    series_id: str,
    observation_start: str = "1995-01-01",
    timeout: int = 15,
) -> pd.Series:
    """Fetch a single FRED time series as a float pd.Series indexed by datetime."""
    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is not configured in .env.local or environment.")

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": observation_start,
        "sort_order": "asc",
    }
    resp = requests.get(FRED_OBS_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    obs = payload.get("observations", [])
    rows = []
    for item in obs:
        val_str = str(item.get("value", "")).strip()
        if not val_str or val_str == ".":
            continue
        try:
            rows.append((pd.to_datetime(item["date"]), float(val_str)))
        except (ValueError, KeyError):
            continue

    if not rows:
        return pd.Series(dtype=float, name=series_id)

    idx, vals = zip(*rows)
    s = pd.Series(vals, index=pd.DatetimeIndex(idx), name=series_id)
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s


def fetch_all_fred_data(
    observation_start: str = "1995-01-01",
    force_refresh: bool = False,
) -> dict[str, pd.DataFrame]:
    """Fetch all configured FRED series and build aligned daily and monthly DataFrames."""
    daily_path = DATA_DIR / "fred_macro_daily.csv"
    monthly_path = DATA_DIR / "fred_macro_monthly.csv"

    # Fast-path: return cached DataFrames if present and not forced
    if not force_refresh and daily_path.exists() and monthly_path.exists():
        daily_df = pd.read_csv(daily_path, index_col=0, parse_dates=True)
        monthly_df = pd.read_csv(monthly_path, index_col=0, parse_dates=True)
        return {"daily": daily_df, "monthly": monthly_df}

    series_map: dict[str, pd.Series] = {}
    for sid in FRED_MACRO_SERIES:
        try:
            s = fetch_fred_series(sid, observation_start=observation_start)
            if not s.empty:
                series_map[sid] = s
        except Exception as exc:
            safe_msg = str(exc).replace(FRED_API_KEY, "***") if FRED_API_KEY else str(exc)
            print(f"[data_pipeline] Warning: failed to fetch FRED {sid}: {safe_msg}")
        time.sleep(0.08)

    if not series_map:
        if daily_path.exists() and monthly_path.exists():
            print("[data_pipeline] Network unavailable; falling back to cached fred_macro_daily.csv and fred_macro_monthly.csv")
            daily_df = pd.read_csv(daily_path, index_col=0, parse_dates=True)
            monthly_df = pd.read_csv(monthly_path, index_col=0, parse_dates=True)
            return {"daily": daily_df, "monthly": monthly_df}
        raise RuntimeError("No FRED series could be fetched.")

    raw_df = pd.concat(series_map.values(), axis=1).sort_index()

    # Business-day forward-filled panel (strictly backward-looking ffill, never bfill)
    bday_idx = pd.date_range(raw_df.index.min(), raw_df.index.max(), freq="B")
    daily_df = raw_df.reindex(raw_df.index.union(bday_idx)).sort_index().ffill().reindex(bday_idx)
    daily_df.index.name = "date"

    # Monthly end-of-month / month-start panel for Model 1 (preserving actual monthly series dates)
    monthly_cols: dict[str, pd.Series] = {}
    for sid, meta in FRED_MACRO_SERIES.items():
        if sid not in series_map:
            continue
        s = series_map[sid]
        if meta["freq"] == "M":
            monthly_cols[sid] = s.resample("MS").last()
        elif meta["freq"] == "Q":
            monthly_cols[sid] = s.resample("MS").ffill()
        else:
            # For weekly/daily predictors, take month-end or prior-month last value
            monthly_cols[sid] = s.resample("MS").mean()

    monthly_df = pd.concat(monthly_cols.values(), axis=1).sort_index()
    monthly_df.index.name = "date"

    daily_df.to_csv(daily_path)
    monthly_df.to_csv(monthly_path)
    return {"daily": daily_df, "monthly": monthly_df}


def _sanitize_release_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Remove corrupted daily-cadence bursts (e.g. FRED release_id 101 daily DFEDTARU dates)."""
    if df.empty:
        return df
    out = df.copy()
    out["release_date"] = pd.to_datetime(out["release_date"]).dt.tz_localize(None)
    out = out.drop_duplicates(subset=["event_type", "release_date"]).sort_values(["event_type", "release_date"])

    # FOMC meets ~8 times/year (12 max including unscheduled). Daily cadence (>15/yr or median gap <= 5d)
    # comes from FRED daily target-rate series attached to release_id=101, not true FOMC meeting dates.
    fomc_mask = out["event_type"] == "FOMC"
    if fomc_mask.any():
        fomc_dates = out.loc[fomc_mask, "release_date"].sort_values()
        med_gap = fomc_dates.diff().dt.days.median()
        max_per_year = int(fomc_dates.dt.year.value_counts().max()) if not fomc_dates.empty else 0
        if (pd.notna(med_gap) and med_gap <= 5.0) or max_per_year > 15:
            out = out.loc[~fomc_mask].copy()
    return out.sort_values("release_date").reset_index(drop=True)


def match_release_dates_to_ref_months(
    release_dates: pd.DataFrame,
    event_type: str,
    ref_months: pd.DatetimeIndex | list[pd.Timestamp],
) -> dict[pd.Timestamp, tuple[pd.Timestamp, str]]:
    """Map each reference month (YYYY-MM-01) 1-to-1 to its unique primary release date in the next month."""
    if release_dates.empty:
        return {}
    rd = release_dates.copy()
    rd["release_date"] = pd.to_datetime(rd["release_date"]).dt.tz_localize(None)
    sub = rd[rd["event_type"] == event_type].sort_values("release_date")
    if sub.empty:
        return {}

    used_dates: set[pd.Timestamp] = set()
    mapping: dict[pd.Timestamp, tuple[pd.Timestamp, str]] = {}
    for rm in sorted(pd.Timestamp(m).replace(day=1) for m in ref_months):
        win_start = (rm + pd.DateOffset(months=1)).replace(day=1)
        win_end = win_start + pd.DateOffset(months=1) - pd.Timedelta(days=1)
        if event_type == "PCE":
            # PCE occasionally releases in the first few days of month+2; exclude already-claimed dates
            win_end = win_end + pd.Timedelta(days=5)
        cands = sub[(sub["release_date"] >= win_start) & (sub["release_date"] <= win_end)]
        cands = cands[~cands["release_date"].isin(used_dates)]
        if cands.empty:
            continue
        # Primary monthly PCE release is near end-of-month; CPI/NFP/PPI primary release is the earliest in month
        row = cands.iloc[-1] if event_type == "PCE" else cands.iloc[0]
        dt = pd.Timestamp(row["release_date"])
        used_dates.add(dt)
        mapping[rm] = (dt, str(row.get("release_time_et", "08:30")))
    return mapping


def fetch_fred_release_dates(force_refresh: bool = False, sanitize: bool = True) -> pd.DataFrame:
    """Fetch official historical release dates for CPI, NFP, PCE, PPI, FOMC from FRED."""
    out_path = DATA_DIR / "fred_release_dates.csv"
    if not force_refresh and out_path.exists():
        cached = pd.read_csv(out_path, parse_dates=["release_date"])
        return _sanitize_release_dates(cached) if sanitize else cached

    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is required to fetch FRED release dates.")

    records: list[dict[str, Any]] = []
    for event_type, release_id in FRED_RELEASE_IDS.items():
        if event_type == "FOMC":
            # FRED release_id 101 emits daily DFEDTAR/DFEDTARU series dates rather than true FOMC meeting dates.
            print("[data_pipeline] Info: skipping FRED release_id=101 for FOMC (contains daily target-rate observations, not meeting calendar).")
            continue
        try:
            offset = 0
            limit = 1000
            while True:
                params = {
                    "release_id": release_id,
                    "api_key": FRED_API_KEY,
                    "file_type": "json",
                    "include_release_dates_with_no_data": "false",
                    "sort_order": "asc",
                    "limit": limit,
                    "offset": offset,
                }
                resp = requests.get(FRED_RELEASE_DATES_URL, params=params, timeout=15)
                resp.raise_for_status()
                dates = resp.json().get("release_dates", [])
                if not dates:
                    break
                for d in dates:
                    dt_str = d.get("date")
                    if not dt_str or dt_str < "2000-01-01":
                        continue
                    records.append(
                        {
                            "event_type": event_type,
                            "release_id": release_id,
                            "release_date": dt_str,
                            "release_time_et": "08:30",
                        }
                    )
                if len(dates) < limit:
                    break
                offset += limit
        except Exception as exc:
            safe_msg = str(exc).replace(FRED_API_KEY, "***") if FRED_API_KEY else str(exc)
            print(f"[data_pipeline] Warning: release_dates {event_type} ({release_id}): {safe_msg}")
        time.sleep(0.1)

    df = pd.DataFrame(records)
    if not df.empty:
        df = _sanitize_release_dates(df) if sanitize else df.drop_duplicates(subset=["event_type", "release_date"]).sort_values("release_date")
        df.to_csv(out_path, index=False)
        return df
    if out_path.exists():
        print("[data_pipeline] Network unavailable; falling back to cached fred_release_dates.csv")
        cached = pd.read_csv(out_path, parse_dates=["release_date"])
        return _sanitize_release_dates(cached) if sanitize else cached
    return df


def _download_yf_close_panel(
    tickers: dict[str, str],
    period: str | None = None,
    start: str | None = None,
    interval: str = "1d",
) -> pd.DataFrame:
    """Download Close (and High/Low/Open for XAUUSD) cleanly via yfinance with UTC index.

    Note: Yahoo Finance intraday bars are timestamped at bar-open (start) time, NOT bar-close.
    """
    frames: dict[str, pd.Series] = {}
    xau_ohlc: pd.DataFrame | None = None

    for name, ticker in tickers.items():
        try:
            kwargs: dict[str, Any] = {
                "interval": interval,
                "auto_adjust": False,
                "progress": False,
                "threads": False,
            }
            if period:
                kwargs["period"] = period
            elif start:
                kwargs["start"] = start

            hist = yf.download(ticker, **kwargs)
            if hist is None or hist.empty:
                continue
            if isinstance(hist.columns, pd.MultiIndex):
                hist.columns = [col[0] for col in hist.columns]

            hist.index = pd.to_datetime(hist.index, utc=True)
            hist = hist[~hist.index.duplicated(keep="last")].sort_index()

            close_col = "Close" if "Close" in hist.columns else hist.columns[0]
            s = hist[close_col].astype(float)
            frames[name] = s

            if name == "XAUUSD":
                keep_cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in hist.columns]
                xau_ohlc = hist[keep_cols].copy()
                xau_ohlc.columns = [f"XAUUSD_{c.lower()}" for c in keep_cols]
        except Exception as exc:
            print(f"[data_pipeline] Warning: yfinance {name} ({ticker}, {interval}) failed: {exc}")

    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames.values(), axis=1)
    df.columns = list(frames.keys())
    if xau_ohlc is not None:
        df = df.join(xau_ohlc, how="left")
    df = df.dropna(how="all")
    return df.sort_index()


def fetch_market_data(force_refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Fetch real daily (25+ yrs), 1h (730d), 30m (60d), and 5m (60d) market data."""
    paths = {
        "daily": DATA_DIR / "market_daily.csv",
        "1h": DATA_DIR / "market_1h.csv",
        "30m": DATA_DIR / "market_30m.csv",
        "5m": DATA_DIR / "market_5m.csv",
    }

    if not force_refresh and all(p.exists() for p in paths.values()):
        return {
            k: pd.read_csv(p, index_col=0, parse_dates=True)
            for k, p in paths.items()
        }

    daily = _download_yf_close_panel(MARKET_TICKERS, start="1999-01-01", interval="1d")
    if not daily.empty:
        daily.index.name = "timestamp"
        daily.to_csv(paths["daily"])
    elif paths["daily"].exists():
        daily = pd.read_csv(paths["daily"], index_col=0, parse_dates=True)

    intraday_tickers = {k: MARKET_TICKERS[k] for k in ["XAUUSD", "DXY", "US10Y", "VIX", "SPX"]}
    h1 = _download_yf_close_panel(intraday_tickers, period="730d", interval="1h")
    if not h1.empty:
        h1.index.name = "timestamp"
        h1.to_csv(paths["1h"])
    elif paths["1h"].exists():
        h1 = pd.read_csv(paths["1h"], index_col=0, parse_dates=True)

    m30_tickers = {k: MARKET_TICKERS[k] for k in ["XAUUSD", "DXY", "VIX"]}
    m30 = _download_yf_close_panel(m30_tickers, period="60d", interval="30m")
    if not m30.empty:
        m30.index.name = "timestamp"
        m30.to_csv(paths["30m"])
    elif paths["30m"].exists():
        m30 = pd.read_csv(paths["30m"], index_col=0, parse_dates=True)

    m5 = _download_yf_close_panel(m30_tickers, period="60d", interval="5m")
    if not m5.empty:
        m5.index.name = "timestamp"
        m5.to_csv(paths["5m"])
    elif paths["5m"].exists():
        m5 = pd.read_csv(paths["5m"], index_col=0, parse_dates=True)

    return {"daily": daily, "1h": h1, "30m": m30, "5m": m5}


def fetch_api_ninjas_gold_price(api_key: str | None = None, timeout: int = 10) -> dict[str, Any] | None:
    """Fetch real-time spot/futures gold price from API Ninjas endpoint."""
    key = (api_key or API_NINJAS_API_KEY or "").strip()
    if not key:
        return None
    try:
        headers = {"X-Api-Key": key}
        resp = requests.get(API_NINJAS_GOLD_URL, headers=headers, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and "price" in data and isinstance(data["price"], (int, float)):
            return data
    except Exception as exc:
        print(f"[data_pipeline] Info: API Ninjas gold fetch: {exc}")
    return None


def get_pit_cftc_series(cftc_df: pd.DataFrame, col: str = "cot_percentile_3y") -> pd.Series:
    """Re-index CFTC COT data from Tuesday report date to Friday publication date (+3d, 15:30 ET).

    CFTC Commitments of Traders positions are measured as of Tuesday close and published
    on the following Friday afternoon (~15:30 ET). Using the Tuesday index directly in
    event studies leaks positioning 1-3 days prior to publication.
    """
    if cftc_df.empty or col not in cftc_df.columns:
        return pd.Series(dtype=float)
    s = cftc_df[col].dropna().copy()
    idx = pd.to_datetime(s.index).tz_localize(None)
    # Shift Tuesday (dayofweek=1) -> Friday (dayofweek=4) of the same week (+3 days);
    # for Monday holiday reports (dayofweek=0) -> +4 days; Wednesday (2) -> +2 days.
    days_to_fri = (4 - idx.day_of_week) % 7
    days_to_fri = np.where(days_to_fri == 0, 3, days_to_fri)
    pub_idx = idx + pd.to_timedelta(days_to_fri, unit="D")
    out = pd.Series(s.values, index=pub_idx, name=col)
    return out[~out.index.duplicated(keep="last")].sort_index()


def fetch_cftc_gold_history(force_refresh: bool = False) -> pd.DataFrame:
    """Fetch weekly CFTC Commitments of Traders Gold positioning history."""
    out_path = DATA_DIR / "cftc_gold_weekly.csv"
    if not force_refresh and out_path.exists():
        return pd.read_csv(out_path, parse_dates=["date"]).set_index("date")

    params = {
        "$where": f"cftc_contract_market_code='{CFTC_GOLD_CONTRACT_CODE}'",
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": 1200,
    }
    try:
        resp = requests.get(CFTC_GOLD_URL, params=params, timeout=15)
        resp.raise_for_status()
        rows = resp.json()
        parsed = []
        for r in rows:
            dt = r.get("report_date_as_yyyy_mm_dd")
            long_p = float(r.get("noncomm_positions_long_all", 0))
            short_p = float(r.get("noncomm_positions_short_all", 0))
            oi = float(r.get("open_interest_all", 1))
            if dt:
                net = long_p - short_p
                parsed.append(
                    {
                        "date": pd.to_datetime(dt),
                        "noncomm_long": long_p,
                        "noncomm_short": short_p,
                        "noncomm_net": net,
                        "open_interest": oi,
                        "net_pct_oi": (net / oi) * 100.0 if oi > 0 else 0.0,
                    }
                )
        df = pd.DataFrame(parsed).drop_duplicates(subset=["date"]).sort_values("date")
        if not df.empty:
            df["cot_percentile_3y"] = (
                df["noncomm_net"]
                .rolling(156, min_periods=26)
                .apply(lambda x: float(pd.Series(x).rank(pct=True).iloc[-1] * 100.0), raw=False)
            )
            df.to_csv(out_path, index=False)
            return df.set_index("date")
    except Exception as exc:
        print(f"[data_pipeline] Warning: CFTC Gold pull failed: {exc}")

    if out_path.exists():
        print("[data_pipeline] Falling back to cached cftc_gold_weekly.csv")
        return pd.read_csv(out_path, parse_dates=["date"]).set_index("date")
    return pd.DataFrame()


def _parse_published_utc(published: str) -> str:
    if not published:
        return ""
    try:
        dt = parsedate_to_datetime(published)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        try:
            dt_pd = pd.to_datetime(published, utc=True)
            return dt_pd.isoformat()
        except Exception:
            return ""


def _dedupe_news_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate RSS items across overlapping feeds (e.g., fomc_press & fed_press_all) by link/title."""
    seen_keys: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for item in items:
        link = str(item.get("link", "")).strip().rstrip("/")
        title = str(item.get("title", "")).strip()
        pub = str(item.get("published", "")).strip()
        key = ("link", link) if link else ("title_pub", f"{title}|{pub}")
        if key in seen_keys:
            continue
        seen_keys.add(key)
        enriched = dict(item)
        if "published_utc" not in enriched or not enriched["published_utc"]:
            enriched["published_utc"] = _parse_published_utc(pub)
        deduped.append(enriched)
    deduped.sort(key=lambda x: x.get("published_utc") or "", reverse=True)
    return deduped


def fetch_fed_news_feed(force_refresh: bool = False, max_items_per_feed: int = 15) -> list[dict[str, Any]]:
    """Fetch live Federal Reserve monetary policy press releases & speeches via RSS (deduplicated)."""
    out_path = DATA_DIR / "fed_news.json"
    if not force_refresh and out_path.exists():
        cached = json.loads(out_path.read_text(encoding="utf-8"))
        if cached:
            return _dedupe_news_items(cached)

    feeds = {
        **FED_RSS_FEEDS,
        "fed_press_all": "https://www.federalreserve.gov/feeds/press_all.xml",
        "bls_news": "https://www.bls.gov/feed/bls_latest.rss",
    }
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MacroEdge/1.0"}
    items: list[dict[str, Any]] = []
    for source_key, url in feeds.items():
        try:
            resp = requests.get(url, headers=headers, timeout=12)
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)
            for entry in feed.entries[:max_items_per_feed]:
                title = BeautifulSoup(entry.get("title", ""), "html.parser").get_text(" ", strip=True)
                summary = BeautifulSoup(entry.get("summary", ""), "html.parser").get_text(" ", strip=True)
                link = entry.get("link", "")
                published = entry.get("published", "") or entry.get("updated", "")
                if title or summary:
                    items.append(
                        {
                            "source": source_key,
                            "title": title,
                            "summary": summary,
                            "link": link,
                            "published": published,
                            "published_utc": _parse_published_utc(published),
                            "fetched_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
        except Exception as exc:
            print(f"[data_pipeline] Warning: RSS {source_key} failed: {exc}")

    if items:
        deduped = _dedupe_news_items(items)
        out_path.write_text(json.dumps(deduped, indent=2), encoding="utf-8")
        return deduped
    elif out_path.exists():
        return _dedupe_news_items(json.loads(out_path.read_text(encoding="utf-8")))
    return items


def fetch_marketaux_news(
    force_refresh: bool = False,
    symbols: str = "GLD,DIA,^DJI,XAU,TLT",
    search: str | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Fetch live macroeconomic & financial market news from Marketaux API.
    Clamps limit to 3 for free tier safety, caches to ml/data/marketaux_news.json.
    """
    out_path = DATA_DIR / "marketaux_news.json"
    if not force_refresh and out_path.exists():
        try:
            cached = json.loads(out_path.read_text(encoding="utf-8"))
            if cached:
                return cached
        except Exception:
            pass

    api_key = MARKETAUX_API_KEY
    if not api_key:
        if out_path.exists():
            return json.loads(out_path.read_text(encoding="utf-8"))
        return []

    params: dict[str, Any] = {
        "api_token": api_key,
        "language": "en",
        "limit": min(limit, 3),
        "sort": "published_desc",
    }
    if symbols:
        params["symbols"] = symbols
    if search:
        params["search"] = search

    try:
        url = f"{MARKETAUX_BASE_URL}/news/all"
        resp = requests.get(url, params=params, timeout=12)
        resp.raise_for_status()
        raw_items = resp.json().get("data", [])
        items: list[dict[str, Any]] = []
        for d in raw_items:
            title = str(d.get("title", "")).strip()
            summary = str(d.get("description") or d.get("snippet") or "").strip()
            pub = str(d.get("published_at", "")).strip()
            sentiment = None
            if d.get("entities"):
                ent_sents = [e.get("sentiment_score") for e in d["entities"] if e.get("sentiment_score") is not None]
                if ent_sents:
                    sentiment = float(np.mean(ent_sents))
            if sentiment is None and d.get("sentiment_score") is not None:
                sentiment = float(d["sentiment_score"])
            items.append({
                "source": "marketaux",
                "title": title,
                "summary": summary,
                "link": str(d.get("url", "")).strip(),
                "published": pub,
                "published_utc": _parse_published_utc(pub),
                "sentiment_score": sentiment,
                "entities": [e.get("symbol") for e in d.get("entities", []) if e.get("symbol")],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            })
        if items:
            out_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
            return items
    except Exception as exc:
        print(f"[data_pipeline] Warning: Marketaux fetch failed: {exc}")

    if out_path.exists():
        try:
            return json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def sync_all_datasets(force_refresh: bool = False) -> dict[str, Any]:
    """Run full data ingestion pipeline and return dataset diagnostics."""
    fred_data = fetch_all_fred_data(force_refresh=force_refresh)
    release_dates = fetch_fred_release_dates(force_refresh=force_refresh)
    market_data = fetch_market_data(force_refresh=force_refresh)
    cftc_df = fetch_cftc_gold_history(force_refresh=force_refresh)
    fed_news = fetch_fed_news_feed(force_refresh=force_refresh)
    marketaux_news = fetch_marketaux_news(force_refresh=force_refresh)

    return {
        "fred_daily_rows": len(fred_data["daily"]),
        "fred_daily_cols": len(fred_data["daily"].columns),
        "fred_monthly_rows": len(fred_data["monthly"]),
        "fred_release_dates": len(release_dates),
        "market_daily_rows": len(market_data["daily"]),
        "market_1h_rows": len(market_data["1h"]),
        "market_30m_rows": len(market_data["30m"]),
        "market_5m_rows": len(market_data["5m"]),
        "cftc_rows": len(cftc_df),
        "fed_news_items": len(fed_news),
        "marketaux_news_items": len(marketaux_news),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def prefetch_finbert_cache() -> bool:
    """Download and cache ProsusAI/finbert weights locally so offline inference works."""
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        AutoTokenizer.from_pretrained("ProsusAI/finbert")
        AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        return True
    except Exception as exc:
        print(f"[data_pipeline] Warning: FinBERT prefetch failed: {exc}")
        return False


if __name__ == "__main__":
    summary = sync_all_datasets(force_refresh=True)
    summary["finbert_cached"] = prefetch_finbert_cache()
    print(json.dumps(summary, indent=2))
