# MacroEdge — Data Quality & Integrity Report
**Generated:** 2026-11-15 10:39:37 UTC  
**Pipeline Status:** Synchronized & Point-in-Time Audited  
**Audit Verdict:** 13 PASS, 6 WARN, 0 FAIL

---

## 1. Historical Dataset Coverage

| Dataset Name | File Path | Observations | Features / Columns | Historical Span | Refresh Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FRED Daily Macro Series** | `ml/data/fred_macro_daily.csv` | 8,312 daily rows | 37 series | 1995-01-01 to 2026-11-12 | Forward-filled with strictly backward-looking lag (1bd H.15 shift) |
| **FRED Monthly Macro Targets** | `ml/data/fred_macro_monthly.csv` | 382 monthly rows | 37 series | 1995-01-01 to 2026-10-01 | Month-start aligned; incomplete trailing partial month trimmed |
| **FRED Official Release Dates** | `ml/data/fred_release_dates.csv` | 1,341 verified releases | `event_type`, `release_date`, `release_time_et` | 2000-01-01 to 2026-11-10 | Sanitized: daily burst release_id=101 stripped (FOMC=0) |
| **XAUUSD & Market Daily** | `ml/data/market_daily.csv` | 7,243 daily rows | 12 market columns | 1999-01-04 to 2026-11-12 | Daily Close, High, Low, Open, Volume (UTC normalized) |
| **Market Intraday 1-Hour** | `ml/data/market_1h.csv` | 25,159 hourly rows | 5 tickers | 730 calendar days | Yahoo bar-open convention; 45.4% non-trading equity NaN rows handled |
| **Market Intraday 30-Minute** | `ml/data/market_30m.csv` | 2,598 30m rows | 3 tickers | 60 calendar days | Insufficient for multi-year walk-forward ML |
| **Market Intraday 5-Minute** | `ml/data/market_5m.csv` | 15,514 5m rows | 3 tickers | 60 calendar days | Insufficient for multi-year walk-forward ML |
| **CFTC Gold Positioning** | `ml/data/cftc_gold_weekly.csv` | 1,200 weekly rows | Spec long, short, net, % OI, 3y pct | 2003-01-01 to 2026-11-03 | Shifted from Tuesday report date to Friday 15:30 ET publication date |
| **Fed News & Releases RSS** | `ml/data/fed_news.json` | 42 deduplicated items | Title, summary, date, link | Recent Fed communications | Deduplicated across fomc_press and fed_press_all feeds |
| **News Human Review Audit** | `ml/data/news_human_review_dataset.json` | 45 real items | 23 audited, 22 pending review | Real communications | Clean separation of model predictions from human ground truth |
| **Constructed Event Panel** | `ml/data/xauusd_macro_events.csv` | 1,450 event rows | 34 aligned macro features | 1999-01-14 to 2026-11-10 | Zero duplicate (event_date, event_type) pairs |

---

## 2. Ingestion Hygiene & Bug Fixes Applied

1. **FRED Release Dates Sanitization (`_sanitize_release_dates`)**:
   - *Discovered*: FRED `release_id=101` in raw data returned 1,000 daily observations from 2000 to 2018 (median gap = 1.0 day). This was daily federal funds rate target revisions, not FOMC meeting statement announcements.
   - *Fix*: Implemented cadence filter removing daily bursts (>15/year or median gap <= 5 days), safely zeroing corrupted FOMC dates and marking FOMC as `BLOCKED`.
2. **Monthly Partial Tail Trimming (`trim_incomplete_monthly_tail`)**:
   - *Discovered*: `fred_macro_monthly.csv` contained a trailing row for `2026-11-01` where official monthly releases (CPI, Core CPI, PCE, NFP, UNRATE) were NaN, but daily series were averaged over a partial 12-day window.
   - *Fix*: Automatically trims the trailing incomplete month where any primary monthly target is unreleased.
3. **Point-in-Time CFTC Shift (`get_pit_cftc_series`)**:
   - *Discovered*: Commitments of Traders data is recorded as of Tuesday close, but published by the CFTC on Friday afternoon (~15:30 ET). Aligning by Tuesday leaks positioning 3 calendar days ahead of public availability.
   - *Fix*: Shifts Tuesday observations to Friday (+3 days, accounting for holiday Mondays/Wednesdays).
4. **Intraday Bar-Open Convention (`lookahead_intraday_bar_open_convention`)**:
   - *Discovered*: Yahoo Finance hourly bars are timestamped at bar-open (e.g. `08:00` bar covers `08:00:00` to `08:59:59`). Measuring 4-hour return from `08:00` bar-open includes pre-release price changes for an `08:30` release.
   - *Fix*: Enforced `p0` close using the pre-release `07:00 ET` bar (closes at `08:00 ET`), strictly prior to the `08:30 ET` announcement.
5. **Model 4 Future Date Fix**:
   - *Discovered*: `resample('W-FRI')` on Thursday `2026-11-12` generated a future index timestamp `2026-11-13`.
   - *Fix*: Clamps the latest partial week timestamp to `max_obs_date` (`2026-11-12`).

---

## 3. Documented Data Limitations & Permanent Caveats

1. **ALFRED Initial Vintages vs Revised FRED**:
   - Current FRED series reflect revised historical values (e.g., benchmark revisions in Nonfarm Payrolls, GDP, and seasonal adjustment revisions in CPI). Models currently operate with vintage hindsight on historical training sets.
2. **Free Historical Consensus Absence**:
   - The free St. Louis Fed FRED API does not provide Bloomberg or Reuters survey consensus numbers. Models explicitly decouple value forecasts from proxy surprises and report `historical_consensus_available = False`.
3. **Yahoo Intraday History Limit**:
   - Yahoo Finance enforces a hard 60-day lookback limit on 5-minute and 30-minute intervals. Intraday models on these horizons cannot be backtested over multi-year macroeconomic cycles without purchasing commercial tick feeds.
