# MacroEdge Current State Audit (Phase 1 — Read-Only)

**Audit Date:** 2026-11-20  
**Repository:** `MacroEdge` (Root: `/Users/ommroshan/Downloads/MacroEdge`)  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  
**Mode:** Strict Read-Only Audit (No schema modifications, no dependency changes, no migrations applied)

---

## 1. Directory Tree & Infrastructure Configuration

### 1.1 Directory Tree (Depth 3)
```text
MacroEdge/
├── CALIBRATION_REPORT.md
├── METHODOLOGY_MAP.md
├── MODEL_READINESS_REPORT.md
├── PRE_REGISTRATION.md
├── REPORT.md
├── VALIDATION_REPORT.md
├── next-env.d.ts
├── next.config.ts
├── package.json
├── package-lock.json
├── postcss.config.mjs
├── tsconfig.json
├── vercel.json
├── render.yaml
├── .env.example
├── .env.local
├── .macroedge-incidents-state.json
├── .macroedge-sync-state.json
├── artifacts/ -> ml/artifacts/
├── gold_vol_replica/
│   ├── config.yaml
│   ├── constant_maturity.py
│   ├── expiry_selection.py
│   ├── filters.py
│   ├── forward_strikes.py
│   ├── pipeline.py
│   ├── publish.py
│   ├── rates.py
│   └── variance.py
├── ml/
│   ├── api.py
│   ├── config.py
│   ├── data_contracts.py
│   ├── data_pipeline.py
│   ├── generate_reports.py
│   ├── infer.py
│   ├── registry.py
│   ├── requirements.txt
│   ├── shadow_deployment.py
│   ├── train_all.py
│   ├── verify_all.py
│   ├── yfinance_service.py
│   ├── artifacts/ (models, metrics, reports, latest_inference.json)
│   ├── data/ (historical CSVs, JSON archives)
│   ├── models/ (economic_forecast.py, macro_regime_bias.py, market_reaction.py, news_intelligence.py)
│   └── validation/ (leakage_checks.py, statistical_tests.py, stress_tests.py, test_point_in_time.py)
├── public/ (static dashboards, icons, logos)
├── scripts/
│   ├── sync-worker.ts
│   ├── verify-agent7-incidents.mjs
│   ├── verify-autosync-debug.mjs
│   ├── verify-daily-check-calculation.mjs
│   ├── verify-forex-factory-calendar.mjs
│   └── verify-sync-acceptance.mjs
├── src/
│   ├── app/
│   │   ├── api/ (ai-models, calendar, incidents, macro, news, sync)
│   │   ├── macrodashboard/ (credit-risk, economy, liquidity, positioning, tools)
│   │   ├── community/, dashboard/, leaderboard/, partner-offers/, ranks/, student-area/
│   │   ├── layout.tsx, page.tsx, globals.css, error.tsx, loading.tsx, not-found.tsx
│   ├── components/
│   │   ├── cards/, charts/, dashboard/, navigation/, providers/, sidebar/, tables/, views/
│   ├── config/ (navigation.ts)
│   ├── lib/ (ai-models, incidents, realtime, storage, supabase, sync, types.ts, utils.ts)
│   └── services/
│       ├── ai-models/, bea/, bls/, cftc/, data/, fred/, incidents/, marketaux/, sync/, treasury/, yfinance/
├── supabase/
│   ├── schema.sql
│   └── migrations/ (001_autonomous_macro_sync.sql, 002_incident_response.sql)
└── tests/
    ├── test_a_worked_example.py
    ├── test_b_synthetic.py
    └── test_c_point_in_time.py
```

### 1.2 Build & Runtime Configuration
- **Package Manager & Scripts (`package.json#L8-L21`):**
  - `dev`: `next dev` (Next.js 15.3.0, React 19.0.0)
  - `build`: `next build`
  - `typecheck`: `tsc --noEmit`
  - `lint`: `next lint`
  - `sync:worker`: `npx tsx scripts/sync-worker.ts`
  - `ml:train`: `.venv/bin/python -m ml.train_all`
  - `ml:infer`: `.venv/bin/python -m ml.infer`
- **Next.js Config (`next.config.ts#L4-L19`):**
  - `reactStrictMode: true`
  - `output`: Standalone mode if `process.env.FIGMA` is set; otherwise default serverless bundle.
  - Webpack resolution alias for client bundling: `{ buffer: false }`.

### 1.3 Vercel Configuration (`vercel.json#L1-L36`)
- **Schema:** `https://openapi.vercel.sh/vercel.json`
- **Multi-Service Definition:**
  - Service `app`: root `.`, framework `nextjs`. Binds to service `ml` via environment variable `ML_SERVICE_URL`.
  - Service `ml`: root `ml`, runtime `python`, entrypoint `api.py:app`.
- **Rewrites:** Directs `/(.*)` to service `app`.
- **Crons (`vercel.json#L30-L35`):**
  - Path: `/api/sync/cron`
  - Schedule: `*/5 * * * *` (runs every 5 minutes).
- **Vercel Execution Limits & Scope Analysis:**
  - *Regions:* Not explicitly defined in `vercel.json` (defaults to `iad1` Washington, D.C.).
  - *Function Duration / Memory:* Unset in `vercel.json`. Defaults to 10s timeout on Hobby plan, or 15s–60s on Pro plan. Heavy quantitative backtesting or Monte Carlo simulations *cannot* run inside standard Vercel serverless request paths without timing out.

---

## 2. Pages & Views Inventory

| Route / File | Purpose | Primary Data Read | Reusable in Day Trading |
|---|---|---|---|
| `src/app/macrodashboard/page.tsx` (`MacroOverviewView.tsx`) | Institutional terminal home; cross-asset ticker ribbon, macro radar pentagon, key releases | `/api/macro/overview`, latest quotes, sync health | **Yes** (Top-level market context & session telemetry) |
| `src/app/macrodashboard/tools/ai-bias/page.tsx` (`AiBiasEngineView.tsx`) | 4-Model AI macro regime, FinBERT news intelligence, and conditional reaction model | `ml/artifacts/latest_inference.json`, `/api/ai-models/simulate` | **Yes** (Direct input for 1D/4H macro directional bias) |
| `src/app/macrodashboard/tools/daily-check/page.tsx` (`DailyCheckView.tsx`) | Morning pre-market checklist across yields, dollar, liquidity, and risk pillars | Supabase `daily_checks` table, local sync state | **Yes** (Adaptable for session opening checklist) |
| `src/app/macrodashboard/tools/comparator/page.tsx` (`ComparatorView.tsx`) | Multi-asset macro comparison tool | `/api/macro/overview`, historical FRED series | **Partial** (Correlation & relative strength analysis) |
| `src/app/macrodashboard/tools/data-ops/page.tsx` (`DataOpsView.tsx`) | Data synchronization dashboard, provider health, anomalies, and manual triggers | `/api/sync/status`, `/api/sync/insights`, `/api/sync/trigger` | **Yes** (Provider health monitoring & rate-limit telemetry) |
| `src/app/macrodashboard/tools/incidents/page.tsx` (`IncidentDashboardView.tsx`) | Self-healing autonomous incident response dashboard | `/api/incidents`, `/api/incidents/sweep` | **Yes** (Operational anomaly detection & alert circuit breakers) |
| `src/app/macrodashboard/tools/watch-list/page.tsx` (`WatchListView.tsx`) | User watch list of monitored instruments | Supabase `watchlists` table | **Yes** (Base for day trader active instrument focus) |
| `src/app/macrodashboard/economy/inflation/page.tsx` (`InflationView.tsx`) | US CPI, Core CPI, PCE, PPI inflation breakdown | FRED & BLS inflation observations | **No** (Specialized macro research view) |
| `src/app/macrodashboard/economy/economy-labor/page.tsx` (`EconomyLaborView.tsx`) | NFP, unemployment rate, claims, GDP growth | FRED & BLS labor series | **No** (Macro research view) |
| `src/app/macrodashboard/economy/fixed-income-rates/page.tsx` (`FixedIncomeView.tsx`) | Treasury yields (2Y, 10Y, 30Y), TIPS real yields, breakevens | FRED & US Treasury yield curve | **Partial** (Real yield tracking for gold bias) |
| `src/app/macrodashboard/liquidity/monetary-policy/page.tsx` (`MonetaryPolicyView.tsx`) | Fed balance sheet (WALCL, TGA, ON RRP), EFFR, net liquidity | FRED daily liquidity series | **Partial** (Net liquidity filter for macro risk) |
| `src/app/macrodashboard/positioning/commitments-of-traders/page.tsx` (`CotView.tsx`) | CFTC Commitment of Traders (COT) net speculative positioning | CFTC API & `ml/data/cftc_gold_weekly.csv` | **Partial** (Secondary positioning sentiment) |
| `src/app/macrodashboard/positioning/correlation-matrix/page.tsx` (`CorrelationMatrixView.tsx`) | Rolling 30D/90D cross-asset correlation matrix | Historical daily market closes | **Partial** (Intermarket confluence checks) |

---

## 3. API Routes Inventory

| Route Path | Method | Auth Required | Data Source | Caching | Error Handling |
|---|---|---|---|---|---|
| `/api/ai-models` | `GET` | None | `ml/artifacts/latest_inference.json` or fallback | `force-dynamic` | Returns fallback snapshot or 500 JSON |
| `/api/ai-models/simulate` | `POST` | None | Spawns `python3 -m ml.infer` or `ML_SERVICE_URL` | `force-dynamic` | 90s timeout kill, falls back to disk artifact |
| `/api/calendar` | `GET` | None | ForexFactory RSS or API Ninjas fallback | `revalidate: 1800` | Fallback static calendar events on failure |
| `/api/incidents` | `GET` | None (Public) | Supabase `system_incidents` or local JSON | `force-dynamic` | Recovers from disk if DB connection fails |
| `/api/incidents/ingest` | `POST` | None | Telemetry payload from client/worker | `force-dynamic` | Validates fingerprint, writes DB or local JSON |
| `/api/incidents/sweep` | `POST` | Optional Admin | Autonomous diagnostic engine sweep | `force-dynamic` | Structured incident status return |
| `/api/macro/overview` | `GET` | None | Aggregated FRED, YFinance, CFTC latest values | `force-dynamic` | Returns cached demo snapshot if providers fail |
| `/api/macro/inflation` | `GET` | None | FRED inflation series (`CPIAUCSL`, etc.) | `revalidate: 3600` | Safe fallback structures |
| `/api/macro/rates` | `GET` | None | FRED yield curve (`DGS2`, `DGS10`, `DFII10`) | `revalidate: 3600` | Safe fallback structures |
| `/api/macro/positioning` | `GET` | None | CFTC weekly reports | `revalidate: 86400` | Safe fallback structures |
| `/api/news/gold-us30` | `GET` | None | Marketaux API / local news cache | `revalidate: 900` | Serves cached snapshot if rate-limited |
| `/api/sync/cron` | `GET` | `CRON_SECRET` (if configured) | Autonomous sync orchestrator | `force-dynamic` | Logs sync run to DB/disk, returns status |
| `/api/sync/trigger` | `POST` | `SYNC_ADMIN_TOKEN` (if configured) | Targeted worker sync execution | `force-dynamic` | Rate-limited per source, returns execution stats |
| `/api/sync/status` | `GET` | None | `data_health` & `sync_runs` tables | `force-dynamic` | Serves telemetry metrics or local JSON |

---

## 4. Supabase Architecture & Persistence

### 4.1 Schema Structure (`supabase/schema.sql`)
1. **User Workspace Tables:**
   - `user_preferences` (`user_id` PK references `auth.users`, `default_timeframe`, `compact_density`, `updated_at`).
   - `watchlists` (`id` PK UUID, `user_id` FK, `symbol`, `name`, `category`, `sort_order`).
   - `daily_checks` (`id` PK UUID, `user_id` FK, `check_date`, `overall_regime`, `net_score`, `pillars` JSONB).
2. **Autonomous Data & Market Infrastructure:**
   - `data_sources` (`id` PK, `category`, `cadence`, `expected_interval_seconds`, `stale_after_seconds`, `rate_limit_rpm`).
   - `data_observations` (`id` PK UUID, `series_key`, `source_id`, `observation_date`, `published_at`, `fetched_at`, `value`, `revision_number`, `is_latest`, `checksum`).
   - `latest_values` (`series_key` PK, `observation_date`, `published_at`, `value`, `status`, `source_attribution`).
   - `market_quotes` (`symbol` PK, `price`, `bid`, `ask`, `quote_timestamp`, `status`, `dedup_hash`).
   - `market_bars` (`id` PK UUID, `symbol`, `timeframe`, `bar_time`, `open`, `high`, `low`, `close`, `volume`, `is_closed`).
   - `sync_runs` (`id` PK UUID, `worker_id`, `started_at`, `finished_at`, `status`, `records_fetched`, `dead_lettered`).
   - `data_health` (`id` PK, `entity_type`, `status`, `last_success_at`, `freshness_seconds`, `consecutive_failures`).
   - `system_incidents` (`id` PK, `fingerprint` UNIQUE, `severity`, `status`, `requires_human_approval`).
3. **Database Functions:**
   - `upsert_macro_observation(...)`: Atomically handles observation revisions, vintage sequencing, and advisory locking (`pg_advisory_xact_lock`).
   - `upsert_market_quote(...)`: Deduplicates quotes using hash and tick sequence ordering.

### 4.2 Row Level Security (RLS) Analysis
- **User Tables (`user_preferences`, `watchlists`, `daily_checks`):**
  - RLS Enabled (`schema.sql#L39-L41`).
  - Strict user-isolation policy: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`.
- **System & Market Tables (`data_sources`, `market_bars`, `market_quotes`, `data_observations`):**
  - RLS Enabled (`schema.sql#L526-L535`).
  - Read access: Publicly readable by `anon` and `authenticated`.
  - Write access: Restricted strictly to `service_role` (`schema.sql#L577-L612`).
- **Client Key Scoping Audit:**
  - Client-side code instantiates Supabase via `src/lib/supabase/client.ts` using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - The `SUPABASE_SERVICE_ROLE_KEY` is loaded exclusively in `src/lib/supabase/admin.ts`.
  - Safety check in `src/lib/supabase/admin.ts#L34-L38` throws an explicit runtime error if `window !== "undefined"`.
  - *Audit Finding:* No client-side code has access to the service-role key.

---

## 5. FRED & Macro Integration Audit

1. **Call Sites:**
   - Primary: `src/services/fred/client.ts#L121` (`fetchFredSeries`).
   - Sync Worker: `src/services/sync/workers/macro-engine.ts#L120`.
   - ML Pipeline: `ml/data_pipeline.py#L120` (`fetch_all_fred_data`).
2. **Execution Environment:**
   - `fetchFredSeries` is strictly server-only (`src/services/fred/client.ts#L131`).
3. **Core Series IDs Monitored:**
   - *Inflation:* `CPIAUCSL`, `CPILFESL`, `PCEPI`, `PCEPILFE`, `PPIFIS`, `T10YIE`, `T5YIE`.
   - *Yields & Rates:* `DGS2`, `DGS5`, `DGS10`, `DGS30`, `DFII10` (10Y Real), `DFF` (EFFR), `SOFR`.
   - *Liquidity & Stress:* `WALCL`, `WTREGEN`, `RRPONTSYD`, `BAMLH0A0HYM2` (HY OAS), `VIXCLS`.
   - *Labor & Growth:* `PAYEMS` (NFP), `UNRATE`, `ICSA`, `A191RL1Q225SBEA` (Real GDP).
   - *Dollar:* `DTWEXBGS`.
4. **Caching & Rate Limiting:**
   - Next.js fetch cache: `next: { revalidate: 3600 }`.
   - Database cache: Falls back to `data_observations` in Supabase if API key is absent or rate-limited.
5. **Vintage & Publication Lag Handling:**
   - **Critical Audit Finding:** In `src/services/fred/client.ts#L177`, `releaseDate` is hardcoded to `latestObsDate`! It does *not* query ALFRED vintage release dates for frontend display. In contrast, the Python pipeline (`ml/data_pipeline.py#L350`) pulls real historical release dates from FRED Release IDs (`FRED_RELEASE_IDS`) to enforce point-in-time cutoffs.

---

## 6. Environment Variables Audit

| Variable Name | Exposure Scope | Current State | Risk / Purpose |
|---|---|---|---|
| `FRED_API_KEY` | Server-only | **SET** | St. Louis Fed API access |
| `BLS_API_KEY` | Server-only | **SET** | Bureau of Labor Statistics data |
| `BEA_API_KEY` | Server-only | **SET** | Bureau of Economic Analysis data |
| `API_NINJAS_API_KEY` | Server-only | **SET** | Economic calendar & gold price fallback |
| `MARKETAUX_API_KEY` | Server-only | **SET** | Financial news stream & sentiment |
| `ENABLE_PUBLIC_CFTC_LIVE` | Server-only | **UNSET** | Direct CFTC public endpoint toggle |
| `ENABLE_PUBLIC_TREASURY_LIVE` | Server-only | **UNSET** | Direct US Treasury feed toggle |
| `ENABLE_PUBLIC_MARKET_WS` | Server-only | **UNSET** | Live market websocket worker toggle |
| `MARKET_WS_PROVIDER` | Server-only | **UNSET** | Provider selector (`coinbase_ws`, `twelve_data_ws`, etc.) |
| `TWELVE_DATA_API_KEY` | Server-only | **SET** | Multi-asset market data (8 calls/min tier) |
| `FINNHUB_API_KEY` | Server-only | **UNSET** | Secondary market feed |
| `POLYGON_API_KEY` | Server-only | **UNSET** | Secondary market feed |
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_` (Client) | **SET** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_` (Client) | **SET** | Supabase anonymous public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | **SET** | Supabase database admin bypass |
| `DATABASE_URL` | Server-only | **SET** | Direct PostgreSQL connection string |
| `GEMINI_API_KEY` | Server-only | **UNSET** | Gemini LLM structured news extractor |
| `CRON_SECRET` | Server-only | **UNSET** | Vercel Cron authorization header validation |
| `SYNC_ADMIN_TOKEN` | Server-only | **UNSET** | Admin manual sync authorization |
| `AUTOSYNC_INTERVAL_MS` | Server-only | **UNSET** | Local sync worker polling interval |
| `ML_SERVICE_URL` | Server-only | **UNSET** | Remote Python ML microservice binding |

*Hard Constraint Verification:* Zero secret values are printed or stored in this audit.

---

## 7. Testing, Linting & CI Verification

1. **Linting:** ESLint configured via `eslint.config.mjs` and `.eslintrc.json`. `npm run lint` available.
2. **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passes with 0 errors across all 45 routes.
3. **Unit & Acceptance Tests:**
   - `scripts/verify-sync-acceptance.mjs`: Node.js acceptance suite for sync worker.
   - `scripts/verify-agent7-incidents.mjs`: Autonomous incident response validation suite.
   - `tests/test_a_worked_example.py`: Mathematical proof test for volatility replication.
   - `tests/test_b_synthetic.py`: Synthetic test cases for pipeline verification.
   - `tests/test_c_point_in_time.py`: Validates point-in-time causal integrity.
   - `ml/validation/test_point_in_time.py`: 21/21 passed tests validating vintage lag and cutoff adherence.
4. **Continuous Integration (CI):**
   - **Defect Identified:** No `.github/workflows` directory exists. CI is currently local-only and not enforced on remote Git pushes.

---

## 8. Timestamp & Timezone Audit

1. **Storage Integrity:**
   - PostgreSQL schema enforces `timestamptz` across all timestamp fields (`schema.sql#L94`, `L160`, `L179`).
   - Python ML pipeline standardizes all timestamps to ISO 8601 UTC (`timezone.utc`).
2. **Display Defect Identified:**
   - In `src/components/dashboard/EconomicCalendar.tsx#L47`, date formatting explicitly hardcodes `{ timeZone: "Asia/Kolkata" }`.
   - In `src/components/views/MacroOverviewView.tsx#L138` and `L210`, timestamps are formatted with `"en-IN"` locale and hardcoded `"Asia/Kolkata"` timezone.
   - *Impact:* Institutional traders outside IST (UTC+5:30) receive confusing release timestamps unless normalized to UTC or user-configurable local time.
3. **Chart Tooltips:**
   - `LightweightTerminalChart.tsx` plots time on UTC UNIX timestamps; however, tooltip strings format time using the browser's default local time without labeling the timezone offset.

---

## 9. Security, Local State & Vulnerability Findings

1. **Local State Ephemerality on Vercel:**
   - The files `.macroedge-sync-state.json` and `.macroedge-incidents-state.json` live on local disk. When deployed to Vercel Serverless Functions, writes to the root filesystem are either blocked (read-only filesystem) or discarded across function invocations. If Supabase is offline or unconfigured, state is lost.
2. **Missing Cron Authentication:**
   - `CRON_SECRET` is currently **UNSET**. Anyone can trigger `/api/sync/cron` unless Vercel header verification is enforced in middleware or route code.
3. **Vercel Timeout vs Heavy Tasks:**
   - Vercel functions cannot run long-running historical backtests or 10,000-session Monte Carlo simulations. An external durable worker or queue is mandatory.
