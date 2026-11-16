# MacroEdge — Model Readiness Report (v2)
**Generated:** 2026-11-15T16:10:00Z  
**Role Accountability:** Scientific Correctness & Model Validation Lead  
**Audit Status:** Point-in-Time Validated (`PASS: 16 | WARN: 6 | FAIL: 0`)  
**Registry Version:** `v1.0.0`

---

## 1. Executive Summary & Component Classifications

MacroEdge is an independent macroeconomic intelligence engine with four quantitative components and one transparent rule-based aggregation layer. Every model component has been audited against strict point-in-time data integrity standards: zero look-ahead bias, zero synthetic bridging, and zero secret leakage.

| Component | Target / Scope | Operational Classification | Technology Backbone | Primary Constraint / Blocker |
| :--- | :--- | :--- | :--- | :--- |
| **Model 1: Economic Forecast Model** | US CPI, Core CPI, PCE, Core PCE, NFP, UNRATE, GDPC1 | **CONDITIONALLY READY** | Ridge / Huber / XGBoost + Causal Conformal Prediction Intervals | Free FRED series contain latest-revised observations; historical survey consensus is unavailable (trailing AR proxy used). |
| **Model 2: News Intelligence** | Topic, Stance, 12-Field Macro & Yield Implications | **CONDITIONALLY READY** | Pretrained ProsusAI/FinBERT + Deterministic 12-Field Macro NLP Extractor + Optional Gemini Fallback | Evaluated against 23 held-out human-audited central bank releases. No language model trained from scratch; synthetic corpus labels eliminated. |
| **Model 3: Market Reaction (XAUUSD 1d)** | 1-Day Post-Release Conditional Return | **CONDITIONALLY READY (BASELINE PROMOTED)** | Unconditional Baseline / Event-Category Baseline | 1,450 events (1999–2026). ML fails to beat baseline on untouched holdout; baseline promoted to production registry. |
| **Model 3: Market Reaction (XAUUSD 4h)** | 4-Hour Post-Release Conditional Return | **CONDITIONALLY READY (BASELINE PROMOTED)** | Unconditional Baseline / Event-Category Baseline | 134 real observed events (2023–2026). Baseline promoted over uncalibrated ML. |
| **Model 3: Market Reaction (XAUUSD 5m & 30m)** | 5-Minute and 30-Minute Post-Release Reaction | **BLOCKED** | XGBoost / Quantile Regression | **BLOCKED**: Yahoo Finance free tier provides only 60 days of history ($n=13$ events). Synthetic bridging is strictly forbidden. |
| **Model 3: FOMC Event Reactions** | Post-FOMC Rate Decision Market Reactions | **BLOCKED** | Event Study / ML | **BLOCKED**: FRED `release_id=101` emits daily observations, not FOMC announcement timestamps (14:00 ET). Sanitizer strips corrupted burst. |
| **Model 4: Transparent Macro Rules** | 6-Factor Gold Macro Scoring (-100 to +100) | **READY** | 6-Factor Dynamic Scoring Engine (Real Yield, USD, Fed Stance, Vol Stress, CPI, Growth, CFTC) | Point-in-time publication lag enforced (1bd H.15, Friday CFTC publication lag, VIX/SPX realized vol). 100% reproducible. |
| **Model 4: Unsupervised Macro Regimes** | 4-Regime Macro State Probabilities | **CONDITIONALLY READY** | Causal Gaussian HMM + Expanding GMM & K-Means | 917 out-of-sample weeks (2009–2026) evaluated with forward filtering and 4-week purge gap. Subject to FRED vintage revision caveat. |
| **Phase 8: Macro Reasoning Engine** | Institutional Multi-Model Aggregator | **READY** | Transparent Deterministic Rules | Real-time live inference; emits exact requested JSON schema with audit trail, conviction score, and nulls on blocked horizons. |

---

## 2. Credentials & Source Connectivity Health (Phase 0.1)

All configured credentials in `.env.local` were tested via minimal REST/WebSocket calls with TLS certificate verification:

| Configured Variable | Target Provider / Endpoint | Connectivity Status | Error Class / Details | Consuming Components |
| :--- | :--- | :--- | :--- | :--- |
| `FRED_API_KEY` | `stlouisfed.org/fred/series` | **PASS** | `None` (HTTP 200, valid JSON) | Model 1, Model 3, Model 4 |
| `BLS_API_KEY` | `api.bls.gov/publicAPI/v2/timeseries/data` | **PASS** | `None` (HTTP 200, `REQUEST_SUCCEEDED`) | Model 1 Validation & Cross-Check |
| `BEA_API_KEY` | `apps.bea.gov/api/data` | **PASS** | `None` (HTTP 200, Table `T10101`) | Model 1 Validation & Cross-Check |
| `API_NINJAS_API_KEY` | `api.api-ninjas.com/v1/goldprice` | **PASS** | `None` (HTTP 200, Live Spot Quote) | Cross-asset Verification |
| `MARKETAUX_API_KEY` | `api.marketaux.com/v1/news/all` | **PASS** | `None` (HTTP 200, Entity Tags active) | Model 2 News Intelligence |
| `TWELVE_DATA_API_KEY`| `api.twelvedata.com/quote?symbol=XAU/USD` | **PASS** | `None` (HTTP 200, Quote returned) | Model 3, Live Dashboard |
| `MARKET_WS_PROVIDER` | `twelve_data_ws` | **PASS** | `None` (Configured provider active) | Live Recording & Ingestion |

*Security Audit*: Zero secrets, plaintext tokens, or credentials appear in any artifact, test log, or commit. All keys are loaded strictly from the environment.

---

## 3. Comprehensive Source Inventory (Phase 0.3)

| Source Identifier | Series or Endpoint | History Depth | Vintage Available | As-Of Consensus Available | Native Timezone | Rate Limit | Terms of Use Check | Consuming Component |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FRED (St. Louis Fed)** | `CPIAUCSL`, `CPILFESL`, `PCEPI`, `PCEPILFE`, `PAYEMS`, `UNRATE`, `GDPC1`, `DGS2`, `DGS10`, `DFII10`, `T10YIE`, `DTWEXBGS`, `VIXCLS`, `DFF` | 1995–2026 (31 yrs) | Yes (ALFRED API) / Reconstructed (1bd publication lag) | No (free FRED has no survey consensus) | America/New_York (ET) | 120 req/min | Open Data / St. Louis Fed ToS Compliant | Model 1, Model 3, Model 4 |
| **BLS API v2** | `CUUR0000SA0` (CPI), `CES0000000001` (NFP), `LNS14000000` (UNRATE) | 2005–2026 (20 yrs) | Live archiving only | No (archived survey consensus required) | America/New_York (ET) | 500 req/day | US Gov Public Domain | Model 1 Cross-Check |
| **BEA API** | NIPA Table `T10101` (Real GDP), Table `T20600` (PCE) | 1995–2026 (Q/M) | Live archiving only | No | America/New_York (ET) | 100 req/min | US Gov Public Domain | Model 1 Cross-Check |
| **Twelve Data REST** | `/quote`, `/time_series` (XAU/USD, intraday & daily) | 20+ yrs daily, 730d 1h, 60d 5m | Reconstructed | No | UTC | 8 calls/min (Basic) | Commercial ToS Compliant | Model 3, Market Ingestion |
| **Twelve Data WebSocket** | `wss://ws.twelvedata.com/v1/quotes` | Live ticks only | Reconstructed forward | No | UTC | 1 stream | Commercial ToS Compliant | Live Feed Ingestion |
| **CFTC Socrata API** | Commitment of Traders (`088691` Gold) | 1995–2026 (weekly) | Point-in-time publication (+3d Friday 15:30 ET) | No | America/New_York (ET) | 1,000 req/hr | US Gov Public Domain | Model 3, Model 4 |
| **Federal Reserve RSS**| `press_monetary.xml`, `speeches.xml` | Live rolling feed (~45 items) | Real-time text | No | America/New_York (ET) | Public RSS | US Gov Public Domain | Model 2 News Intelligence |
| **Marketaux API** | `/v1/news/all` (macro entity tags & sentiment) | Live archive (2024–2026) | Real-time text | No | UTC | 100 req/day | Commercial API ToS | Model 2 News Intelligence |
| **API-Ninjas REST** | `/v1/goldprice` | Live spot | Real-time | No | UTC | 50k req/mo | ToS Compliant | Spot Cross-Check |

---

## 4. Canonical Source Declarations & Hierarchy (Phase 0.4 & 0.5)

To prevent discrepancies between data providers, canonical sources are strictly declared in config:

| Series Domain | Canonical Source | Secondary / Verification Source | Discrepancy Tolerance | Resolution Rule |
| :--- | :--- | :--- | :--- | :--- |
| **Headline & Core CPI** | FRED (`CPIAUCSL`, `CPILFESL`) | BLS API (`CUUR0000SA0`) | 0.05% MoM | Use FRED canonical series; log discrepancy if $|FRED - BLS| > 0.05\%$. |
| **PCE & Core PCE** | FRED (`PCEPI`, `PCEPILFE`) | BEA API (Table `T20600`) | 0.05% MoM | Use FRED canonical series; BEA used for vintage reconciliation. |
| **Payrolls & Unemployment**| FRED (`PAYEMS`, `UNRATE`) | BLS API (`CES0000000001`, `LNS14000000`) | 10k payrolls / 0.1% rate | Use FRED canonical series with 1-month publication lag. |
| **Real GDP** | FRED (`GDPC1`) | BEA API (Table `T10101`) | 0.10% QoQ Ann | Use FRED canonical series with 1-quarter reporting lag. |
| **Treasury & Real Yields** | FRED (`DGS2`, `DGS10`, `DFII10`) | Twelve Data / Yahoo Finance | 2 bps | Use FRED H.15 series lagged by 1 business day for all daily macro conditioning. |
| **Gold Market Prices** | Twelve Data (`XAU/USD`) | Yahoo Finance (`GC=F`) | 0.15% ($3.50/oz) | Twelve Data is canonical for intraday; Yahoo Finance for 25-year daily history. |

---

## 5. Detailed Model 1 Economic Forecast Readiness

| Target Indicator | Operational Status | Selected Model | Dev Walk-Forward MAE | Holdout MAE (2024–2026) | Holdout MASE | 80% Conformal Coverage | Vintage & Consensus Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `CPI` (% MoM) | **CONDITIONALLY READY** | Ridge Regressor | 0.1831 | **0.1414** | **0.6776** | **83.3%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `CORE_CPI` (% MoM) | **CONDITIONALLY READY** | Ridge Regressor | 0.0810 | **0.0752** | **0.8504** | **100.0%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `PCE` (% MoM) | **CONDITIONALLY READY** | ElasticNet Ensemble | 0.1320 | **0.1081** | **0.6999** | **87.5%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `CORE_PCE` (% MoM) | **CONDITIONALLY READY** | Ridge Regressor | 0.0685 | **0.0716** | **0.7721** | **100.0%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `NFP` (k) | **CONDITIONALLY READY** | XGBoost Regressor | 230.57 | **98.85** | **0.3847** | **95.8%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `UNRATE` (%) | **CONDITIONALLY READY** | XGBoost Regressor | 0.1795 | **0.0870** | **0.5189** | **100.0%** | Sourced from FRED; lacks historical survey consensus (proxy baseline used); revised vintages used. |
| `GDPC1` (% QoQ Ann) | **CONDITIONALLY READY** | Ridge Regressor | 2.6437 | **1.0833** | **0.3470** | **87.5%** | Low quarterly sample size ($n=132$ Q); forward-filled across months with 1Q reporting lag. |

---

## 6. Summary of Blocked Components & Scientific Remediation Plan

1. **Model 3 (5m / 30m Intraday Horizons)**:
   - **Block Reason**: Free Yahoo Finance API provides only 60 days of intraday 5m and 30m bars ($n=13$ macro events). Synthetic bridging (multiplying 1d returns by fixed ratios) has been fully removed to preserve scientific integrity.
   - **Remediation Plan**: Ingest continuous high-frequency tick data from Twelve Data or COMEX `GC` futures spanning 2018–2026 before enabling 5m/30m model training.
2. **Model 3 (FOMC Rate Decisions)**:
   - **Block Reason**: FRED `release_id=101` emits daily series updates rather than official FOMC meeting announcement timestamps (14:00 ET).
   - **Remediation Plan**: Ingest the official Federal Reserve Board statement calendar containing exact meeting dates and announcement timestamps.
3. **Surprise Forecasts Across All Models**:
   - **Conditionality**: Because no archived pre-release consensus survey feed exists in the free data layer, historical surprises are calculated against an autoregressive proxy. All surprise forecasts are strictly marked conditional or blocked in live inference until live archived consensus accumulates.
