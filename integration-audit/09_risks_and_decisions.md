# Risks, Compliance, Legal & Decisions Register (Phase 1 — Read-Only)

**System:** MacroEdge Institutional Terminal × Day Trading Strategy System  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Dependencies & Third-Party Licensing (Task H)

### 1.1 Dependency Mapping

| Dependency | Ecosystem | Target Module | Technical Necessity |
|---|---|---|---|
| `@supabase/supabase-js` (Installed: `^2.49.0`) | npm | Database & Realtime | Manages relational tables, RLS user isolation, and realtime price/setup subscriptions. |
| `lightweight-charts` (Installed: `^5.3.0`) | npm | Strategy Charting | TradingView canvas charting for multi-timeframe candles, 15M key zone boxes, and sweep levels. |
| `lucide-react` (Installed: `^0.475.0`) | npm | UI Elements | Institutional icons for risk statuses, setup badges, and alert triggers. |
| `clsx` & `tailwind-merge` (Installed) | npm | UI Styling | Dynamic class styling for Dark Institutional UI themes. |
| `scipy` / `numpy` (Installed in `.venv`) | Python | Backtester & Simulation | Vectorized fractal detection, rolling ATR calculation, and Monte Carlo barrier sampling. |
| `pandas` (Installed in `.venv`) | Python | Time Series Alignment | Point-in-time timestamp alignment, resampler (1m -> 5m -> 15m -> 4h), and OOS splits. |
| **New Required Dependencies:** | — | — | **Zero new runtime dependencies required.** All proposed strategy logic, risk checks, and position sizing can be implemented with existing packages and standard library modules. |

### 1.2 Licensing & Intellectual Property Governance
- **MacroEdge License:** Root `LICENSE` remains strictly untouched.
- **Upstream License:** `github.com/Jakeschincariol/day-trader-skill` is licensed under the permissive **MIT License** (Copyright (c) Jake Schincariol).
- **Proposed `THIRD_PARTY_NOTICES.md`:** Any file incorporating ported or derived algorithmic logic (e.g. Monte Carlo barrier pathing from `trader-timemachine` or R-multiple clamping from `trader-exit`) will retain the standard MIT attribution header:
  ```text
  Portions of this software are derived from day-trader-skill (MIT License)
  Copyright (c) Jake Schincariol
  ```
- **UI Attribution:** An attribution note will be permanently rendered in the terminal's Dataset & Methodology Footer (`src/components/cards/DatasetFooter.tsx`).

### 1.3 Third-Party Terms of Service Compliance
- **Yahoo Finance:** Unofficial, non-SLA endpoints (`query1.finance.yahoo.com`) are **barred from production**.
- **SEC EDGAR:** If ever queried, requires strict adherence to the SEC Fair Access Policy (declared `User-Agent: Sample App Name Contact@domain.com` with request rates $\le 10$ requests/sec).
- **Twelve Data:** Commercial API tier with explicit terms. MacroEdge respects the 8 calls/min limit via a sliding window queue in `market-engine.ts`.
- **FRED / ALFRED:** Fully compliant; public domain St. Louis Fed data accessed with a configured API key.

---

## 2. Security, Privacy & Regulatory Compliance (Task I)

1. **Service-Role Key Security:**
   - As audited in `01_current_state.md`, `SUPABASE_SERVICE_ROLE_KEY` is loaded strictly on the server in `src/lib/supabase/admin.ts`.
   - Browser client instantiation in `src/lib/supabase/client.ts` uses only `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - RLS policies ensure regular users can never query or manipulate other users' risk profiles, trade plans, or journal entries.
2. **Personal Data & Account Redaction:**
   - Broker account numbers, passwords, and API keys are **never stored** in MacroEdge database tables.
   - User journal entries store only user-entered metadata, executed prices, and risk percentages.
3. **Execution & Order Routing Exemption (Hard Constraint 6):**
   - MacroEdge contains **zero** broker execution endpoints, automated order placement, or FIX/REST trading connectors.
   - All executions are entered manually by the user for journaling and analytics (`public.executions`).
4. **Mandatory UI Legal Disclaimers:**
   - All strategy views and trade planner screens will prominently display the following disclaimer:
     > *"MacroEdge is an independent quantitative research and educational analysis platform. It is NOT a registered investment advisor, broker, or financial institution. MacroEdge does not execute trades, manage capital, or provide personalized investment advice. All simulated results, Monte Carlo paths, and technical setups are strictly hypothetical and carries no guarantee of future market performance. Prop-firm parameters are entered manually by the user and are not verified or guaranteed by the application."*

---

## 3. Comprehensive Risk Register (Task K)

| Risk ID | Category | Description | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|---|---|
| **R-01** | Data Quality | Intraday 1M/5M data gaps from Twelve Data free tier rate limits (8 calls/min). | High | High | Implement incremental background caching in PostgreSQL; backfill during off-peak hours; allow user to supply custom CSV bar history. |
| **R-02** | Quantitative | Overfitting strategy rules to historical XAUUSD price action. | High | Critical | Enforce strict walk-forward cross-validation with an untouched 20% holdout split (P5) that is opened only once. |
| **R-03** | Structural | Subjective interpretation of SMC order blocks, liquidity sweeps, and CHOCHs. | Medium | High | Formalize unambiguous, deterministic mathematical definitions (5-bar fractals, strict wick-to-close ratios) as defined in `06_strategy_definitions.md`. |
| **R-04** | Execution | Vercel Serverless Function timeouts (10s–60s) aborting Monte Carlo simulations. | High | Critical | Offload all simulations and backtests to the dedicated Python worker daemon; keep Vercel functions strictly request-scoped (< 500ms). |
| **R-05** | Timezone | Hardcoded local timezones (`Asia/Kolkata`) causing timestamp confusion during market opens. | Medium | Medium | Refactor all timestamp displays to explicit UTC with optional user-selectable local display offset; store everything in UTC ISO 8601. |
| **R-06** | Legal / IP | Accidental omission of MIT copyright attribution for derived algorithms. | Low | Low | Enforce `THIRD_PARTY_NOTICES.md` and automated linting of license headers across derived files. |
| **R-07** | Market Drift | Volatility regime shifts invalidating fixed-pip stop loss parameters during macro crises. | Medium | High | Apply volatility-scaled zone width clamping (`1.5 * ATR(14)`) and integrate Model 4 Macro Regime Bias as a mandatory filter. |

---

## 4. Required Decisions for User Sign-Off (Task K)

Prior to entering Phase P0/P1 implementation, the user must review and confirm the following 6 decisions:

1. **Scope Confirmation (Task C):**
   - Confirm the module reuse matrix: REWRITE Macro Intelligence & Technical Setup Engine; ADAPT Trade Planner, Risk Manager, Alerts, and Time Machine; EXCLUDE Broker Execution, US Equity Scanner, SEC Analyst, and Pelosi Tracker.
2. **Intraday Data Provider for XAUUSD (Task D):**
   - Confirm whether Twelve Data (free tier: 8 credits/min, requiring incremental caching) will be the sole provider, or whether a commercial tier / local intraday CSV archive will be provided for multi-year 1M/5M backtesting.
3. **Durable Worker Architecture (Task F):**
   - Approve the recommendation to use a dedicated Python Worker container (Render / Railway) rather than attempting to force heavy backtests into Vercel Serverless Functions.
4. **Default Strategy Definitions Approval (Task E):**
   - Approve the proposed default rules for:
     - 1D/4H disagreement handling (Wait for 4H CHOCH in 1D direction).
     - 15M Key Zone volatility clamp (`1.5 * ATR(14)`) and 24-hour expiration.
     - Liquidity Sweep condition (wick pierce with candle body close inside).
     - 5M/1M Confirmation timeout (60 minutes).
     - Minimum 2.0R hurdle and 1-pip ($0.10) stop buffer.
     - 15-minute news blackout windows around high-impact US releases.
5. **Initial Prop-Firm Rules Selection (Task J):**
   - Confirm which prop firm specifications to build first (e.g. FTMO Standard: 5% Max Daily Loss, 10% Max Trailing Drawdown, 21:00 UTC Daily Roll Reset).
6. **Instrument Contract Specifications Provenance (Task D & G):**
   - Confirm contract specifications for the 4 target assets (Gold 100 oz, US30 \$1/pt, SPX \$50/pt, BTC 1 coin) and whether broker-specific overrides will be entered via the UI or seed files.
