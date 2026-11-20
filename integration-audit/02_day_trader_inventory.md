# Day Trader Skill Inventory & Forensic Analysis (Phase 1 — Read-Only)

**Source Repository:** `github.com/Jakeschincariol/day-trader-skill`  
**Licence:** MIT Licence (Copyright (c) Jake Schincariol)  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Executive Verification of Repository Claims

| Repository Claim | Code Verification Status | Audit Finding & Forensic Evidence |
|---|---|---|
| **MIT Licence, Jake Schincariol** | **VERIFIED** | Present in root `LICENSE` file. |
| **Eleven skill folders with `SKILL.md` + Python scripts** | **VERIFIED** | Folders: `trader-scanner`, `trader-news`, `trader-entry`, `trader-exit`, `trader-timemachine`, `trader-risk`, `trader-budget`, `trader-broker`, `trader-alerts`, `trader-analyst`, `trader-pelosi`. |
| **Python 3.8+ using only standard library** | **VERIFIED** | Confirmed. All utilities use standard modules (`urllib.request`, `json`, `math`, `argparse`, `datetime`, `re`, `csv`, `xml.etree.ElementTree`, `unittest`). No external `pip` dependencies. |
| **Data sources: Yahoo Finance, Nasdaq Trader, SEC EDGAR, House Clerk** | **VERIFIED** | Uses Yahoo Finance chart API (unofficial), Nasdaq FTP/HTTP symbol lists, SEC EDGAR submissions API, and US House Clerk disclosure ZIP/PDFs. |
| **State stored as JSON files in `trader/`** | **VERIFIED** | Reads/writes `trader/config.json`, `watchlist.json`, `plan.json`, `active_trade.json`, `fills.json`, `alerts.json`. |
| **Broker path through Alpaca MCP server** | **VERIFIED** | `trader-broker` interfaces via Alpaca Model Context Protocol (MCP) server, configured to paper trading by default. |
| **Scanner setups: ORB, flags, oversold bounces (~5,900 US stocks)** | **VERIFIED** | Scans US common stocks, ordinary shares, and ADRs listed on NASDAQ, NYSE, and AMEX. |
| **Time Machine: 10,000 simulated sessions from 5m candles** | **VERIFIED** | Monte Carlo historical path replay using 60-day 5-minute historical bars at matching time-of-day. |
| **No order-block, BOS, CHOCH, FVG or liquidity-sweep logic** | **CONFIRMED (REFUTES SMC)** | **Forensic Confirmation:** The codebase contains **zero** Smart Money Concepts (SMC) algorithms. There is no logic for market structure (BOS, CHOCH), fair value gaps (FVG), unmitigated order blocks (OB), or liquidity pool sweeps. Setups are solely based on opening range breakouts (ORB) and simple moving average bands. |

---

## 2. Eleven Skills Master Inventory Table

| Skill Name | Purpose | Entry Points | Inputs | Outputs | State Files Read/Written | Network Endpoints | Hard-Coded Market Assumptions | Reusable Algorithm | Test Coverage | Licence Header Present |
|---|---|---|---|---|---|---|---|---|---|---|
| **`trader-scanner`** | Pre-market & intraday technical scanning across US equity universe | `trader-scanner/scan.py` (`/trader-scanner`) | Scan type (`--orb`, `--flags`, `--bounce`), symbol filters | `trader/watchlist.json` | Reads `trader/config.json`; Writes `trader/watchlist.json` | `query1.finance.yahoo.com/v8/finance/chart/{ticker}`, `ftp.nasdaqtrader.com/symboldirectory/` | US equities only; 09:30–16:00 ET; whole share units; PDT equity capital assumptions | **No** (Equity ORBs irrelevant to 24/5 OTC gold) | Unit tests in `tests/test_scanner.py` with mock JSON fixtures | **No** (Missing SPDX/header in script) |
| **`trader-news`** | Catalyst identification & regulatory disclosure tracking | `trader-news/news.py` (`/trader-news`) | Ticker symbol(s), watchlist | Structured catalyst list, `trader/catalysts.json` | Reads `trader/watchlist.json`; Writes `trader/catalysts.json` | `query2.finance.yahoo.com/v1/finance/search`, `data.sec.gov/submissions/CIK{cik}.json` | US corporate issuers; SEC CIK mappings; English news; single-stock equity focus | **No** (MacroEdge already has FinBERT & Fed RSS feeds) | Unit tests with mock SEC/Yahoo responses | **No** |
| **`trader-entry`** | Bar-by-bar entry timing & breakout trigger confirmation | `trader-entry/entry.py` (`/trader-entry`) | Setup ticker, trigger price, interval (`1m`/`5m`) | Entry status (`WAITING`, `TRIGGERED`, `EXPIRED`) | Reads `trader/watchlist.json`, `trader/plan.json`; Writes `trader/active_trade.json` | `query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1m` | 09:30 ET session open; high/low of first 5m/15m/30m; no structure confirmation | **No** (XAUUSD requires HTF bias, sweep & CHOCH) | Unit tests with synthetic candle arrays | **No** |
| **`trader-exit`** | Pre-trade stop, target, R:R mapping & flat-by time exit planning | `trader-exit/exit.py` (`/trader-exit`) | Entry price, stop distance, target distance | `trader/plan.json` (Entry, SL, TP, R-multiple, flat-by) | Reads `trader/watchlist.json`; Writes `trader/plan.json` | None (Local arithmetic, or Yahoo quote if price unsupplied) | Mandatory 15:55 ET "flat by close" rule; cent/dollar per-share arithmetic | **Partial** (R-multiple math is sound; needs lot/pip adaptation) | Unit tests verifying R:R and time boundary clamping | **No** |
| **`trader-timemachine`** | 10,000-iteration Monte Carlo path simulation from historical 5m bars | `trader-timemachine/timemachine.py` (`/trader-timemachine`) | Setup parameters (Entry, SL, TP, time of day), ticker | `P(Target First)` win probability, drawdown dist, trade duration | Reads `trader/plan.json`; Writes stdout or `trader/simulation.json` | `query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=5m&range=60d` | 60-day lookback limit; 09:30–16:00 ET session; zero spread, zero slippage, zero commission | **Partial** (Empirical barrier simulation concept is valuable) | Unit tests with deterministic synthetic bar arrays | **No** |
| **`trader-risk`** | Deterministic pre-trade safety gate checking loss limits & PDT rules | `trader-risk/check.py` (`/trader-risk`) | Proposed trade plan, daily P&L, open trade count | `PASS` or `BLOCK` verdict with machine-readable error code | Reads `trader/config.json`, `trader/account.json`, `trader/plan.json`; Writes `trader/risk_verdict.json` | None (Local validation) | US FINRA PDT 3-day-trade / 5-day rolling rule; $25k margin floor; 09:30 ET daily reset | **Partial** (Hard-coded safety gate architecture is reusable) | Unit tests checking all block conditions | **No** |
| **`trader-budget`** | Position sizing based on account equity, risk % and stop distance | `trader-budget/size.py` (`/trader-budget`) | Account equity, risk % (e.g. 1%), entry, stop-loss | Share quantity, allocated capital, dollar risk at stop | Reads `trader/config.json`, `trader/plan.json`; Writes `trader/sizing.json` | None (Local arithmetic) | Share sizing: `floor(dollar_risk / (entry - stop))`; whole shares; USD only | **Partial** (Sizing arithmetic reusable; must use contract specs) | Unit tests for rounding, zero division, budget cap | **No** |
| **`trader-broker`** | Order ticket construction & submission via Alpaca MCP | `trader-broker/ticket.py` (`/trader-broker`) | Sized order parameters (ticker, qty, side, SL, TP) | Order ticket JSON, fill record in `trader/fills.json` | Reads `trader/sizing.json`, `trader/plan.json`; Writes `trader/order.json`, `trader/fills.json` | Alpaca MCP Server / REST API (`paper-api.alpaca.markets`) | Alpaca brokerage API; day orders expiring 16:00 ET; paper mode default | **EXCLUDE** (Hard Constraint 6: no live order routing permitted) | Mocked order submission tests | **No** |
| **`trader-alerts`** | Technical level, stop loss & session bell price alerts | `trader-alerts/alerts.py` (`/trader-alerts`) | Ticker, condition (`above`/`below`), target level | Active alert list in `trader/alerts.json`, terminal alert | Reads/writes `trader/alerts.json` | `query1.finance.yahoo.com/v8/finance/chart/{ticker}` | NYSE/NASDAQ 09:30 open and 16:00 close bell triggers | **Partial** (Alert schema reusable; replace bell with London/NY) | Unit tests evaluating threshold trigger logic | **No** |
| **`trader-analyst`** | Fundamental earnings & financial performance metrics extraction | `trader-analyst/analyst.py` (`/trader-analyst`) | Ticker symbol, fiscal period | Revenue, net income, EPS, margins table in `trader/analyst_{ticker}.json` | Writes `trader/analyst_{ticker}.json` | `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` | US GAAP / IFRS SEC XBRL filings; corporate equity issuers | **EXCLUDE** (Irrelevant for sovereign macro assets & commodities) | Unit tests with sample XBRL company facts JSON | **No** |
| **`trader-pelosi`** | US Congressional stock trade disclosures monitor | `trader-pelosi/pelosi.py` (`/trader-pelosi`) | Lookback window, politician name | Parsed transaction records in `trader/disclosures.json` | Writes `trader/disclosures.json` | `disclosures-clerk.house.gov/public_disc/financial-pdfs/` | US House PTR disclosure filings; up to 45-day statutory filing lag | **EXCLUDE** (Irrelevant for intraday macro & XAUUSD trading) | Unit tests with sample disclosure PDF text | **No** |

---

## 3. Deep-Dive Security & Isolation Analysis

### 3.1 Filesystem Access Audit
- **Standard Storage Root:** The skill tools read and write state strictly inside a `trader/` subfolder relative to the working directory.
- **Outside Paths:** None identified. No attempts to write to `/etc`, `~/.ssh`, or system roots. However, in serverless environments like Vercel, any write to `trader/*.json` will fail due to read-only container root environments.

### 3.2 Network Endpoints Inventory
1. `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}` (Unofficial, unauthenticated, rate-limited, no SLA).
2. `https://query2.finance.yahoo.com/v1/finance/search` (Unofficial search).
3. `https://data.sec.gov/submissions/` and `/api/xbrl/companyfacts/` (Requires custom `User-Agent: Sample Company Name AdminContact@<sample company domain>.com` header per SEC fair access rules).
4. `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/` (US Government public records).
5. `ftp://ftp.nasdaqtrader.com/symboldirectory/` (Unencrypted FTP or HTTP mirror).
6. `https://paper-api.alpaca.markets/v2/orders` (Alpaca trading API).

### 3.3 Order Placement Isolation Audit
- **Code Path Isolation:** Order execution is strictly confined to `trader-broker/ticket.py`.
- **Safety Mechanism:** The script explicitly requires a terminal confirmation argument or interactive confirmation prompt (`"yes"`) before invoking the Alpaca MCP tool.
- **Compliance Status:** In accordance with **Hard Constraint 6**, `trader-broker` is marked as **EXCLUDED**. No order routing, broker connection, or automated execution code will be incorporated into the MacroEdge architecture.
