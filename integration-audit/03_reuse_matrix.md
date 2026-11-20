# Module Reuse & Adaptation Matrix (Phase 1 — Read-Only)

**Context:** Integration of Day Trader Skill capabilities into the MacroEdge Institutional Terminal  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Evaluation of Starting Hypotheses

| Hypothesis | Starting Assumption | Audit Verdict | Detailed Finding & File References |
|---|---|---|---|
| **1. Macro Intelligence** | REWRITE | **CONFIRMED** | `day-trader-skill` has zero macroeconomic logic. MacroEdge already possesses an advanced 4-model research pipeline (`ml/models/economic_forecast.py`, `ml/models/news_intelligence.py`, `ml/models/macro_regime_bias.py`, and `ml/artifacts/latest_inference.json`). Consuming these outputs to establish the 1D/4H macro directional bias must be built natively in MacroEdge. |
| **2. Technical Setup Engine** | REWRITE | **CONFIRMED** | `day-trader-skill` contains zero market structure concepts (no BOS, CHOCH, FVG, Order Blocks, or Liquidity Sweeps; verified in `trader-scanner/scan.py` and `trader-entry/entry.py`). The required XAUUSD SMC setup sequence must be written entirely from scratch with deterministic algorithmic definitions. |
| **3. Trade Planner** | ADAPT `trader-exit` | **CONFIRMED** | `trader-exit/exit.py` provides clean mathematical models for R-multiples, partial targets, and invalidation boundaries, but assumes per-share US equity pricing and a 15:55 ET close. Must be adapted to instrument-aware contract specifications (contract size, tick value, point spread). |
| **4. Backtesting Engine** | ADAPT `trader-timemachine` | **CONFIRMED** | `trader-timemachine/timemachine.py` provides an empirical Monte Carlo barrier hit simulation concept (10,000 iterations against historical 5m bars). However, true historical multi-year backtesting, walk-forward OOS validation, regime breakdown, and execution friction are absent and must be newly engineered. |
| **5. Position Sizing** | REWRITE / ADAPT `trader-budget` | **CONFIRMED** | The percentage-risk-to-dollar-risk arithmetic in `trader-budget/size.py` is sound, but its share-quantity formula (`dollar_risk / (entry - stop)`) fails on CFDs, commodities, indices, and crypto. It must be rewritten to support broker-specific contract specifications (`lot_size`, `tick_size`, `tick_value`). |
| **6. Risk Manager** | ADAPT `trader-risk` | **CONFIRMED** | `trader-risk/check.py` has an excellent deterministic `PASS`/`BLOCK` pipeline with machine-readable error reasons. However, PDT rules must be stripped out for 24/5 FX/CFDs, and a specialized Prop-Firm Rule Engine (trailing drawdown, daily pause, equity high-water mark) must be built from scratch. |
| **7. Alert Engine** | ADAPT `trader-alerts` | **CONFIRMED** | `trader-alerts/alerts.py` provides level-monitoring data structures. The equity 09:30/16:00 ET opening bell logic must be replaced with multi-session awareness (London open 07:00 UTC, New York open 12:30 UTC) and economic news blackout windows. |
| **8. Trade Journal** | NEW | **CONFIRMED** | `day-trader-skill` stores raw JSON files on disk (`trader/fills.json`), not an institutional journal. A full PostgreSQL schema with audit trails, tagging, execution tracking, and performance analytics must be constructed newly. |

---

## 2. Complete Module Classification Matrix

| Target System Module | Classification | Upstream Source Reference | MacroEdge Target Location | Technical Adaptation Required |
|---|---|---|---|---|
| **Macro Directional Bias** | **REWRITE** | None (`day-trader-skill` has no macro) | `src/services/trading/macro-bias.ts` & `ml/models/macro_regime_bias.py` | Bridges Model 4 regime bias score ([-100, +100]) and 10Y real yield (`DFII10`) / DXY signals into a strict daily bias (`BULLISH`, `BEARISH`, `NEUTRAL`). |
| **Technical Setup Engine (XAUUSD)** | **REWRITE** | None (`scan.py`/`entry.py` are stock ORBs) | `src/services/trading/engine/xauusd-strategy.ts` | Multi-timeframe SMC state machine: 1D/4H market structure -> 15M key zone / OB / FVG -> Liquidity Sweep detection -> 5M/1M CHOCH confirmation. |
| **Trade Planner** | **ADAPT** | `trader-exit/exit.py` | `src/services/trading/planner.ts` | Port R-multiple mathematics; replace share math with instrument contract units; replace 15:55 ET exit with 24/5 session expiration. |
| **Empirical Time Machine** | **ADAPT** | `trader-timemachine/timemachine.py` | `src/services/trading/simulation/time-machine.ts` | Retain 10,000-session Monte Carlo barrier simulation; incorporate spread, slippage, and macro regime conditioning. Mark all output with `is_simulated = true`. |
| **Durable Backtester** | **REWRITE** | None (Time Machine is only path-sampling) | External Worker (`worker/backtester.py`) | Full multi-year historical OHLC bar replay, walk-forward splits, untouched holdout validation, Sharpe/Sortino, maximum drawdown, and regime-conditional win rates. |
| **Position Sizing Calculator** | **REWRITE** | `trader-budget/size.py` | `src/services/trading/position-sizing.ts` | Multi-asset formula: `Lots = Dollar_Risk / (Stop_Points * Tick_Value * Contract_Size)`. Supports Gold (100 oz), US30 ($1/pt), SPX500 ($50/pt), BTCUSD. |
| **Risk Manager & Gatekeeper** | **ADAPT** | `trader-risk/check.py` | `src/services/trading/risk-manager.ts` | Preserve deterministic `PASS`/`BLOCK` interface. Remove PDT rules. Build Prop-Firm Rule Engine: max daily drawdown (e.g. 5%), max total trailing drawdown (e.g. 10%), news blackout block. |
| **Session & Price Alert Engine** | **ADAPT** | `trader-alerts/alerts.py` | `src/services/trading/alerts.ts` | Adapt price-cross monitoring; replace stock exchange bells with London Open (07:00 UTC) and NY Open (12:30 UTC); add high-impact news blackout window alerts (CPI, NFP, FOMC). |
| **Trade Journal & Ledger** | **NEW** | None (`fills.json` is a flat raw dump) | `src/app/macrodashboard/trading/journal/` & `supabase/schema.sql` | Relational PostgreSQL ledger for manual trade entries, screenshot attachments, setup attribution, execution slippage, psychological tags, and equity curve tracking. |
| **Equity Scanner (`trader-scanner`)** | **EXCLUDE** | `trader-scanner/scan.py` | N/A | Excluded. Focus is institutional commodities, macro indices, and crypto (XAUUSD, US30, SPX500, BTCUSD), not scanning 5,900 US equities. |
| **Equity News (`trader-news`)** | **EXCLUDE** | `trader-news/news.py` | N/A | Excluded. MacroEdge already features institutional macro news via Marketaux, FinBERT sentiment, and Federal Reserve official RSS feeds. |
| **SEC Analyst (`trader-analyst`)** | **EXCLUDE** | `trader-analyst/analyst.py` | N/A | Excluded. SEC 10-K/10-Q XBRL parsing is irrelevant to sovereign macro indicators and commodities. |
| **Pelosi Tracker (`trader-pelosi`)** | **EXCLUDE** | `trader-pelosi/pelosi.py` | N/A | Excluded. Congressional stock trade disclosures have up to 45 days lag and do not apply to intraday XAUUSD trading. |
| **Broker Execution (`trader-broker`)** | **EXCLUDE** | `trader-broker/ticket.py` | N/A | **Strictly Excluded per Hard Constraint 6.** No live broker integration, order routing, or automated trade execution will be planned or implemented. |
