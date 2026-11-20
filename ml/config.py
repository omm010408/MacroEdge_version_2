from __future__ import annotations

import os
from pathlib import Path

# Safeguard against macOS OpenMP duplicate runtime deadlock between PyTorch and XGBoost
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

ROOT_DIR = Path(__file__).resolve().parent.parent
ML_DIR = ROOT_DIR / "ml"
DATA_DIR = ML_DIR / "data"
ARTIFACTS_DIR = ML_DIR / "artifacts"
REPORTS_DIR = ARTIFACTS_DIR / "reports"

for d in (DATA_DIR, ARTIFACTS_DIR, REPORTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Load .env.local first, then .env safely without requiring external packages
for env_name in (".env.local", ".env"):
    env_path = ROOT_DIR / env_name
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as _f:
                for _line in _f:
                    _line = _line.strip()
                    if _line and not _line.startswith("#") and "=" in _line:
                        _k, _v = _line.split("=", 1)
                        _k = _k.strip()
                        _v = _v.strip().strip("'").strip('"')
                        if _k not in os.environ:
                            os.environ[_k] = _v
        except Exception:
            pass

FRED_API_KEY = os.getenv("FRED_API_KEY", "").strip()
BLS_API_KEY = os.getenv("BLS_API_KEY", "").strip()
BEA_API_KEY = os.getenv("BEA_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
API_NINJAS_API_KEY = os.getenv("API_NINJAS_API_KEY", "HYkCvAgukUoScnKdHtdZ98OyxpFGrbfiQJt4NP22").strip()
API_NINJAS_GOLD_URL = "https://api.api-ninjas.com/v1/goldprice"
MARKETAUX_API_KEY = os.getenv("MARKETAUX_API_KEY", "Z8H8vDZtxqZLBuEEGR0q3pUvacjL6TTgvmM9K97g").strip()
MARKETAUX_BASE_URL = "https://api.marketaux.com/v1"

# Core FRED Series to pull from 1995-01-01 onward
FRED_MACRO_SERIES = {
    # Inflation & Price Pipeline
    "CPIAUCSL": {"name": "US Headline CPI Index", "freq": "M"},
    "CPILFESL": {"name": "US Core CPI Index", "freq": "M"},
    "PCEPI": {"name": "US Headline PCE Price Index", "freq": "M"},
    "PCEPILFE": {"name": "US Core PCE Price Index", "freq": "M"},
    "PPIFIS": {"name": "US PPI Final Demand", "freq": "M"},
    "PPIACO": {"name": "US PPI All Commodities", "freq": "M"},
    "CUSR0000SAH1": {"name": "US CPI Shelter", "freq": "M"},
    "CUSR0000SASLE": {"name": "US CPI Services Less Energy", "freq": "M"},
    "GASREGW": {"name": "US Regular Gas Price", "freq": "W"},
    # Labor & Growth
    "PAYEMS": {"name": "Total Nonfarm Payrolls (K)", "freq": "M"},
    "UNRATE": {"name": "Unemployment Rate (%)", "freq": "M"},
    "ICSA": {"name": "Initial Jobless Claims", "freq": "W"},
    "CCSA": {"name": "Continued Jobless Claims", "freq": "W"},
    "CES0500000003": {"name": "Average Hourly Earnings ($)", "freq": "M"},
    "JTSJOL": {"name": "JOLTS Job Openings", "freq": "M"},
    "INDPRO": {"name": "Industrial Production Index", "freq": "M"},
    "RSAFS": {"name": "Advance Retail Sales", "freq": "M"},
    "UMCSENT": {"name": "UMich Consumer Sentiment", "freq": "M"},
    "GDPC1": {"name": "Real GDP", "freq": "Q"},
    # Rates, Breakevens, Liquidity, Credit
    "DFF": {"name": "Effective Federal Funds Rate", "freq": "D"},
    "DGS2": {"name": "US 2Y Treasury Yield", "freq": "D"},
    "DGS10": {"name": "US 10Y Treasury Yield", "freq": "D"},
    "DGS30": {"name": "US 30Y Treasury Yield", "freq": "D"},
    "DFII10": {"name": "US 10Y TIPS Real Yield", "freq": "D"},
    "T10Y2Y": {"name": "US 10Y-2Y Yield Spread", "freq": "D"},
    "T10YIE": {"name": "10Y Breakeven Inflation", "freq": "D"},
    "T5YIE": {"name": "5Y Breakeven Inflation", "freq": "D"},
    "T5YIFR": {"name": "5Y5Y Forward Inflation Expectation", "freq": "D"},
    "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "freq": "D"},
    "BAMLC0A0CM": {"name": "ICE BofA US IG Corporate OAS", "freq": "D"},
    "VIXCLS": {"name": "CBOE VIX Index (FRED)", "freq": "D"},
    "DCOILWTICO": {"name": "WTI Crude Oil Spot", "freq": "D"},
    "DTWEXBGS": {"name": "Trade Weighted Broad USD Index", "freq": "D"},
    "WALCL": {"name": "Fed Total Assets ($M)", "freq": "W"},
    "WTREGEN": {"name": "Treasury General Account ($M)", "freq": "W"},
    "RRPONTSYD": {"name": "ON RRP Facility ($B)", "freq": "D"},
    "M2SL": {"name": "M2 Money Supply ($B)", "freq": "M"},
}

# Official FRED Release IDs for real historical event release timestamps
FRED_RELEASE_IDS = {
    "CPI": 10,       # Consumer Price Index (CPI & Core CPI)
    "NFP": 50,       # Employment Situation (NFP & Unemployment)
    "PCE": 54,       # Personal Income and Outlays (PCE & Core PCE)
    "PPI": 46,       # Producer Price Index
    "FOMC": 101,     # FOMC Press Release / Policy Rate
}

# Market tickers on Yahoo Finance
MARKET_TICKERS = {
    "XAUUSD": "GC=F",
    "DXY": "DX-Y.NYB",
    "US10Y": "^TNX",
    "US3M": "^IRX",
    "VIX": "^VIX",
    "SPX": "^GSPC",
    "WTI": "CL=F",
    "EURUSD": "EURUSD=X",
}

FED_RSS_FEEDS = {
    "fomc_press": "https://www.federalreserve.gov/feeds/press_monetary.xml",
    "fed_speeches": "https://www.federalreserve.gov/feeds/speeches.xml",
}

CFTC_GOLD_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
CFTC_GOLD_CONTRACT_CODE = "088691"
