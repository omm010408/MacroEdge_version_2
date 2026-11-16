from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from ml.config import DATA_DIR, MARKET_TICKERS


# Canonical mapping from MacroEdge Symbol to Yahoo Finance Ticker
YFINANCE_MAP: dict[str, str] = {
    # Dollar & Currencies
    "DXY": "DX-Y.NYB",          # US Dollar Index (ICE)
    "EURUSD": "EURUSD=X",       # Euro / US Dollar
    "USDJPY": "JPY=X",          # US Dollar / Japanese Yen
    "GBPUSD": "GBPUSD=X",       # British Pound / US Dollar
    "AUDUSD": "AUDUSD=X",       # Australian Dollar / US Dollar
    "USDCAD": "CAD=X",          # US Dollar / Canadian Dollar
    "USDCHF": "CHF=X",          # US Dollar / Swiss Franc
    # Equities & Volatility
    "SPX500": "^GSPC",          # S&P 500 Index
    "US30": "^DJI",             # Dow Jones Industrial Average
    "NASDAQ": "^IXIC",          # Nasdaq Composite
    "VIX": "^VIX",              # CBOE Volatility Index
    # Fixed Income & Rates
    "US10Y": "^TNX",            # 10-Year Treasury Yield (e.g. 5.10%)
    "US30Y": "^TYX",            # 30-Year Treasury Yield (e.g. 5.43%)
    "US5Y": "^FVX",             # 5-Year Treasury Yield
    "US2Y": "^IRX",             # 13-Week Treasury Bill Yield / Short Rate
    # Commodities & Precious Metals
    "XAUUSD": "GC=F",           # COMEX Gold Futures
    "SILVER": "SI=F",           # COMEX Silver Futures
    "WTI": "CL=F",              # Light Sweet Crude Oil Futures
    "BRENT": "BZ=F",            # Brent Crude Oil Futures
    "COPPER": "HG=F",           # Copper Futures
    # Crypto
    "BTCUSD": "BTC-USD",        # Bitcoin / USD
    "ETHUSD": "ETH-USD",        # Ethereum / USD
}

REVERSE_YFINANCE_MAP: dict[str, str] = {v: k for k, v in YFINANCE_MAP.items()}
YFINANCE_QUOTES_CACHE_PATH = DATA_DIR / "yfinance_quotes.json"


def fetch_yfinance_quotes(
    symbols: list[str] | None = None,
    timeout: int = 15,
) -> dict[str, dict[str, Any]]:
    """Fetch live real-time quotes using yfinance fast_info and history.

    Args:
        symbols: Optional list of MacroEdge symbols. Defaults to all in YFINANCE_MAP.
        timeout: Timeout in seconds for remote calls.

    Returns:
        Dictionary mapping MacroEdge symbol to quote details.
    """
    selected_symbols = symbols or list(YFINANCE_MAP.keys())
    target_map = {s: YFINANCE_MAP[s] for s in selected_symbols if s in YFINANCE_MAP}

    if not target_map:
        return {}

    results: dict[str, dict[str, Any]] = {}
    tickers_str = " ".join(target_map.values())

    try:
        tickers_obj = yf.Tickers(tickers_str)
    except Exception as exc:
        print(f"[yfinance_service] Warning: Tickers instantiation failed: {exc}", file=sys.stderr)
        return results

    now_utc = datetime.now(timezone.utc).isoformat()

    for sym, yf_sym in target_map.items():
        try:
            ticker = tickers_obj.tickers.get(yf_sym)
            if ticker is None:
                continue

            fi = getattr(ticker, "fast_info", None)
            price = None
            prev_close = None
            day_high = None
            day_low = None
            currency = "USD"
            volume = None
            year_high = None
            year_low = None

            if fi is not None:
                try:
                    price = getattr(fi, "last_price", None)
                    prev_close = getattr(fi, "previous_close", None)
                    day_high = getattr(fi, "day_high", None)
                    day_low = getattr(fi, "day_low", None)
                    currency = getattr(fi, "currency", "USD") or "USD"
                    volume = getattr(fi, "last_volume", None)
                    year_high = getattr(fi, "year_high", None)
                    year_low = getattr(fi, "year_low", None)
                except Exception:
                    pass

            # Fallback to history if fast_info has no price
            if price is None or not np.isfinite(price):
                hist = ticker.history(period="5d", interval="1d")
                if not hist.empty:
                    if isinstance(hist.columns, pd.MultiIndex):
                        hist.columns = [c[0] for c in hist.columns]
                    close_col = "Close" if "Close" in hist.columns else hist.columns[0]
                    series = hist[close_col].dropna()
                    if not series.empty:
                        price = float(series.iloc[-1])
                        if len(series) >= 2:
                            prev_close = float(series.iloc[-2])
                    if "High" in hist.columns and not hist["High"].dropna().empty:
                        day_high = float(hist["High"].dropna().iloc[-1])
                    if "Low" in hist.columns and not hist["Low"].dropna().empty:
                        day_low = float(hist["Low"].dropna().iloc[-1])
                    if "Volume" in hist.columns and not hist["Volume"].dropna().empty:
                        volume = float(hist["Volume"].dropna().iloc[-1])

            if price is None or not np.isfinite(price):
                continue

            price_val = float(price)
            prev_val = float(prev_close) if (prev_close is not None and np.isfinite(prev_close)) else None
            change = (price_val - prev_val) if prev_val is not None else 0.0
            change_pct = (change / prev_val * 100.0) if (prev_val is not None and prev_val != 0) else 0.0

            decimals = 4 if sym in ("EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "USDCHF") else 2

            results[sym] = {
                "symbol": sym,
                "externalSymbol": yf_sym,
                "providerId": "yfinance",
                "price": round(price_val, decimals),
                "previousClose": round(prev_val, decimals) if prev_val is not None else None,
                "change": round(change, decimals),
                "changePercent": round(change_pct, 2),
                "dayHigh": round(float(day_high), decimals) if (day_high is not None and np.isfinite(day_high)) else None,
                "dayLow": round(float(day_low), decimals) if (day_low is not None and np.isfinite(day_low)) else None,
                "yearHigh": round(float(year_high), decimals) if (year_high is not None and np.isfinite(year_high)) else None,
                "yearLow": round(float(year_low), decimals) if (year_low is not None and np.isfinite(year_low)) else None,
                "volume": int(volume) if (volume is not None and np.isfinite(volume) and volume > 0) else None,
                "currency": currency,
                "quoteTimestamp": now_utc,
                "receivedAt": now_utc,
            }
        except Exception as exc:
            print(f"[yfinance_service] Notice: failed to parse {sym} ({yf_sym}): {exc}", file=sys.stderr)

    return results


def fetch_yfinance_bars(
    symbol: str,
    period: str = "1mo",
    interval: str = "1d",
) -> list[dict[str, Any]]:
    """Fetch OHLCV historical bars for a symbol using yfinance.

    Args:
        symbol: MacroEdge symbol (e.g. 'DXY', 'SPX500', 'XAUUSD').
        period: Period string ('5d', '1mo', '3mo', '1y', '2y', 'max').
        interval: Bar interval ('1m', '5m', '15m', '1h', '1d').

    Returns:
        List of bar dictionaries sorted chronologically.
    """
    yf_sym = YFINANCE_MAP.get(symbol, symbol)
    try:
        hist = yf.download(yf_sym, period=period, interval=interval, progress=False, auto_adjust=False)
        if hist is None or hist.empty:
            return []

        if isinstance(hist.columns, pd.MultiIndex):
            hist.columns = [c[0] for c in hist.columns]

        hist.index = pd.to_datetime(hist.index, utc=True)
        hist = hist[~hist.index.duplicated(keep="last")].sort_index()

        bars: list[dict[str, Any]] = []
        decimals = 4 if symbol in ("EURUSD", "GBPUSD", "AUDUSD", "USDCAD", "USDCHF") else 2

        for ts, row in hist.iterrows():
            c_val = row.get("Close")
            if pd.isna(c_val) or not np.isfinite(c_val):
                continue
            o_val = row.get("Open", c_val)
            h_val = row.get("High", c_val)
            l_val = row.get("Low", c_val)
            v_val = row.get("Volume", 0)

            bars.append(
                {
                    "barTime": ts.isoformat(),
                    "open": round(float(o_val), decimals),
                    "high": round(float(h_val), decimals),
                    "low": round(float(l_val), decimals),
                    "close": round(float(c_val), decimals),
                    "volume": int(v_val) if pd.notna(v_val) and np.isfinite(v_val) else 0,
                }
            )
        return bars
    except Exception as exc:
        print(f"[yfinance_service] Error downloading bars for {symbol} ({yf_sym}): {exc}", file=sys.stderr)
        return []


def sync_yfinance_cache(symbols: list[str] | None = None) -> dict[str, Any]:
    """Fetch live quotes and update local persistent cache file."""
    quotes = fetch_yfinance_quotes(symbols=symbols)
    if not quotes:
        print("[yfinance_service] Warning: No quotes fetched to cache.", file=sys.stderr)
        return {"ok": False, "count": 0, "quotes": {}}

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "yfinance",
        "count": len(quotes),
        "quotes": quotes,
    }

    try:
        YFINANCE_QUOTES_CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"[yfinance_service] Successfully synced {len(quotes)} quotes to {YFINANCE_QUOTES_CACHE_PATH}")
    except Exception as exc:
        print(f"[yfinance_service] Error saving cache: {exc}", file=sys.stderr)

    # Also update market_daily.csv latest values for ML features if present
    daily_path = DATA_DIR / "market_daily.csv"
    if daily_path.exists():
        try:
            daily_df = pd.read_csv(daily_path, index_col=0, parse_dates=True)
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            today_ts = pd.to_datetime(today_str)

            col_map = {
                "DXY": "DXY",
                "XAUUSD": "XAUUSD",
                "SPX500": "SPX",
                "US10Y": "US10Y",
                "US2Y": "US3M",
                "VIX": "VIX",
                "WTI": "WTI",
                "EURUSD": "EURUSD",
            }
            updates: dict[str, float] = {}
            for me_sym, col_name in col_map.items():
                if me_sym in quotes and col_name in daily_df.columns:
                    updates[col_name] = quotes[me_sym]["price"]

            if updates:
                for col_name, val in updates.items():
                    daily_df.loc[today_ts, col_name] = val
                daily_df = daily_df.sort_index()
                daily_df.to_csv(daily_path)
                print(f"[yfinance_service] Updated {len(updates)} columns in {daily_path}")
        except Exception as exc:
            print(f"[yfinance_service] Notice: daily CSV update skipped: {exc}", file=sys.stderr)

    return {"ok": True, "count": len(quotes), "quotes": quotes}


def main() -> None:
    parser = argparse.ArgumentParser(description="MacroEdge yfinance Market Integration CLI")
    parser.add_argument("--quotes", action="store_true", help="Fetch and output live JSON quotes")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated list of symbols (e.g. DXY,SPX500,US10Y)")
    parser.add_argument("--bars", action="store_true", help="Fetch OHLCV bars for a symbol")
    parser.add_argument("--symbol", type=str, default="DXY", help="Target symbol for --bars")
    parser.add_argument("--period", type=str, default="1mo", help="Period for --bars (e.g. 5d, 1mo, 1y)")
    parser.add_argument("--interval", type=str, default="1d", help="Interval for --bars (e.g. 1d, 1h, 5m)")
    parser.add_argument("--sync", action="store_true", help="Sync quotes to local cache file")

    args = parser.parse_args()

    symbols_list = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] or None

    if args.sync:
        res = sync_yfinance_cache(symbols=symbols_list)
        print(json.dumps(res, indent=2))
        return

    if args.bars:
        bars = fetch_yfinance_bars(args.symbol.upper(), period=args.period, interval=args.interval)
        print(json.dumps(bars, indent=2))
        return

    # Default action: fetch quotes
    quotes = fetch_yfinance_quotes(symbols=symbols_list)
    print(json.dumps(quotes, indent=2))


if __name__ == "__main__":
    main()
