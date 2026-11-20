# Implementation Roadmap & Phase Gate Plan (Phase 1 — Read-Only)

**System:** MacroEdge Institutional Terminal × Day Trading Strategy System  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  
**Constraint Reminder:** Proposal only. No phase execution begins until explicit user sign-off.

---

## Phase Overview & Dependency Hierarchy

```text
P0: Foundation (Data Adapters, Instrument Specs, Schema, Attribution)
 ├── P1: XAUUSD Setup Engine (Headless SMC State Machine & Fixture Tests)
 │    └── P2: Macro & Technical Confluence View (Terminal UI Integration)
 ├── P3: Trade Planner & Position Sizing (Multi-Asset Contract Math)
 │    └── P4: Risk Manager & Prop-Firm Rule Engine (Safety Gatekeeper)
 └── P5: Quantitative Backtester & Replay (Durable Worker, Holdout Split)
      ├── P6: Alerts & Trade Journal (Notification & Reflective Ledger)
      └── P7: UI Integration & Institutional Hardening (Full Release)
```

---

## Detailed Phase Breakdown

### P0: Foundation & Data Infrastructure
* **Deliverables:**
  - TypeScript & Python Provider Adapter interfaces (`MarketDataProviderAdapter`).
  - Twelve Data client adapter with rate-limit scheduler (8 calls/min sliding window).
  - Multi-asset instrument specifications table and versioned loader (`XAUUSD`, `US30`, `SPX500`, `BTCUSD`).
  - Proposed SQL migration `003_trading_strategy_integration.sql` reviewed and staged.
  - Third-party attribution component in terminal footer (`Twelve Data`, `FRED`, `MIT / Jake Schincariol`).
* **Tests:**
  - Unit tests verifying Twelve Data rate-limit queuing and mock bar fetching.
  - Contract specification arithmetic unit tests (point value, tick size, margin).
  - Schema migration dry-run on local/isolated staging database.
* **Exit Criteria:**
  - Zero TypeScript compile errors (`npm run typecheck`).
  - Provider adapters return standardized `MarketBar` and `LatestQuote` objects with verified UTC timestamps.
* **Blockers:**
  - Twelve Data API key tier confirmation; decision on whether historical intraday backfill will be purchased or incrementally cached.

---

### P1: Headless XAUUSD Setup Engine
* **Deliverables:**
  - Algorithmic implementation of the 4-stage SMC sequence:
    1. 1D/4H 5-bar fractal swing detection and HTF structural bias evaluator.
    2. 15M Key Zone / Order Block / Fair Value Gap detector with volatility width clamp.
    3. Liquidity sweep evaluator (strict wick pierce with body close inside).
    4. 5M/1M Change of Character (CHOCH) and proximal FVG retest confirmation.
  - Headless strategy execution runner (no UI components).
* **Tests:**
  - Comprehensive unit test suite with deterministic synthetic candle arrays for all 7 strategy rules.
  - Edge case tests: candle body close above swing high (BOS vs Sweep), confirmation timeout expiration (60m).
* **Exit Criteria:**
  - 100% test pass rate across synthetic strategy fixtures.
  - Deterministic state machine emits correct status (`MONITORING`, `PENDING_CONFIRMATION`, `TRIGGERED`, `EXPIRED`, `INVALIDATED`).
* **Blockers:**
  - P0 completion; user sign-off on default strategy rules defined in `06_strategy_definitions.md`.

---

### P2: Macro & Technical Confluence View
* **Deliverables:**
  - Real-time Macro & Technical Confluence Panel in the MacroEdge terminal.
  - Bridge connecting Model 4 Macro Regime Bias score (`latest_inference.json`), 10Y Real Yield (`DFII10`), and DXY trend to the technical setup quality score.
  - Visual setup inspector showing active 1D/4H bias, 15M zone boundaries, sweep level, and 5M/1M CHOCH status.
* **Tests:**
  - Integration test verifying that counter-trend technical setups are downgraded or flagged when macro regime is opposing.
  - Visual rendering and responsiveness test of the setup inspector card.
* **Exit Criteria:**
  - Terminal displays live setup status with explicit macro confluence grading (`A+`, `A`, `B`, `REJECTED`).
* **Blockers:**
  - P1 completion.

---

### P3: Trade Planner & Multi-Asset Position Sizing
* **Deliverables:**
  - Multi-asset Position Sizing Calculator (`src/services/trading/position-sizing.ts`):
    $$\text{Lots} = \frac{\text{Account Equity} \times \text{Risk \%}}{\text{Stop Distance Points} \times \text{Tick Value per Lot}}$$
  - Trade Plan generator: computes Entry, Stop Loss, TP1 (2.0R), TP2 (Opposing Liquidity), and R-multiple.
  - Support for Gold (100 oz), US30 (\$1/pt), SPX500 (\$50/pt), and BTCUSD.
* **Tests:**
  - Unit tests verifying exact lot sizing across account balances (\$10k, \$50k, \$100k, \$200k) with fractional lot clamping.
  - Zero-division and negative-risk input guard tests.
* **Exit Criteria:**
  - Sizing calculations match broker contract values to 4 decimal places.
* **Blockers:**
  - P0 instrument specs.

---

### P4: Risk Manager & Prop-Firm Rule Engine
* **Deliverables:**
  - Deterministic pre-trade Risk Gatekeeper (`src/services/trading/risk-manager.ts`).
  - Prop-Firm Rule Engine supporting:
    - Maximum Daily Loss (e.g. 5% of starting or daily high-water equity).
    - Maximum Trailing Drawdown (e.g. 10% trailing high-water mark).
    - Daily roll loss reset (e.g. 21:00 UTC broker rollover).
    - Weekend hold prohibition and economic news blackout window locks (15m before/after high-impact releases).
* **Tests:**
  - Unit tests verifying `BLOCK` verdicts for: daily loss breach, trailing drawdown breach, news blackout window, stale market data.
* **Exit Criteria:**
  - Every proposed trade plan receives an immutable `PASS` or `BLOCK` verdict with an explicit reason code.
* **Blockers:**
  - P3 completion; user selection of initial prop firms to support.

---

### P5: Quantitative Backtester & Time Machine Simulation
* **Deliverables:**
  - Standalone Python backtesting daemon running in the durable worker environment.
  - Historical OHLC bar-by-bar walk-forward replay engine with strict point-in-time causal isolation.
  - Monte Carlo Time Machine: 10,000-session empirical path replay estimating probability of target hit before stop.
  - Untouched holdout split: final 20% of data locked until hyperparameter freeze.
  - Performance metrics: Win rate, Profit Factor, Expectancy R, Max Drawdown, Sharpe/Sortino, and regime breakdown.
* **Tests:**
  - Validation test confirming lookahead bias / future data leakage is mathematically impossible.
  - Holdout integrity audit test.
* **Exit Criteria:**
  - Backtester outputs verified metrics breakdown across Low Vol, High Vol, Inflationary, and Easing regimes.
  - All simulated outputs tagged `is_simulated = true`.
* **Blockers:**
  - Dedicated Python worker environment configured; intraday historical bar cache available.

---

### P6: Alerts & Reflective Trade Journal
* **Deliverables:**
  - Multi-session alert dispatcher (London Open 07:00 UTC, NY Open 12:30 UTC, News Blackout, Price Cross).
  - Relational PostgreSQL Trade Journal: manual execution entry, setup attribution, screenshot uploads, mistake tags, psychological notes, and realized equity curve.
* **Tests:**
  - Webhook and UI alert delivery tests.
  - Journal entry CRUD tests with RLS verification.
* **Exit Criteria:**
  - Users can record and analyze manual trades, linking executions to pre-computed trade plans.
* **Blockers:**
  - P4 completion.

---

### P7: UI Integration & Institutional Hardening
* **Deliverables:**
  - Seamless Next.js 15 Institutional Dark UI integration across the entire MacroEdge terminal.
  - Charting integration via TradingView Lightweight Charts (`lightweight-charts`), plotting 15M zones, sweep wicks, and entry/SL/TP levels.
  - Clear UI disclaimers: Research & Simulation Tool, Not Financial Advice, Manual Execution Only.
  - Error boundaries, telemetry monitoring, and end-to-end acceptance tests.
* **Tests:**
  - End-to-end Cypress/Playwright regression testing of all trading workflows.
  - Complete TypeScript compile and production build verification.
* **Exit Criteria:**
  - System fully hardened, auditable, and operational in production.
* **Blockers:**
  - All preceding phases completed.
