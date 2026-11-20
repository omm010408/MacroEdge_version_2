-- ============================================================================
-- MacroEdge Institutional Terminal × Day Trading Strategy System
-- SCHEMA PROPOSAL: Migration 003_trading_strategy_integration.sql (PROPOSAL ONLY)
-- Mode: Strict Read-Only Audit. DO NOT EXECUTE DIRECTLY IN PRODUCTION.
-- ============================================================================

-- Proposed Migration Order:
-- 1. Setup Extensions & Custom Types
-- 2. Reference Foundations: provider_sources, instrument_specs
-- 3. Market & Macro Data Core: market_bars, macro_snapshots
-- 4. Strategy & Signal Engine: setups, setup_components
-- 5. Trade Planning & Execution: risk_profiles, prop_firm_rules, trade_plans, executions, journal_entries
-- 6. Alerts & Monitoring: alert_rules, alert_events
-- 7. Quantitative Research & Backtesting: backtest_runs, backtest_trades
-- 8. Governance & Security: audit_log, RLS policies, indexing

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. Reference Foundations
-- ============================================================================

-- 1.1 Provider Sources
create table if not exists public.provider_sources (
  id text primary key, -- e.g. 'twelve_data', 'cboe', 'fred', 'synthetic'
  name text not null,
  vendor text not null,
  is_official boolean not null default true,
  api_tier text not null default 'free',
  rate_limit_rpm integer not null default 60,
  requires_auth boolean not null default true,
  attribution_label text not null,
  website_url text,
  created_at timestamptz not null default now()
);

-- 1.2 Instrument Specifications (Versioned by broker, symbol, and effective date)
create table if not exists public.instrument_specs (
  id uuid primary key default gen_random_uuid(),
  symbol text not null, -- e.g. 'XAUUSD', 'US30', 'SPX500', 'BTCUSD'
  broker_venue text not null default 'STANDARD_CFD',
  spec_version text not null default 'v1.0',
  asset_class text not null check (asset_class in ('COMMODITY', 'INDEX', 'CRYPTO', 'FX', 'EQUITY')),
  base_currency text not null default 'USD',
  quote_currency text not null default 'USD',
  contract_size numeric not null, -- e.g. 100 for XAUUSD (100 oz per lot)
  tick_size numeric not null,     -- e.g. 0.01 for XAUUSD
  tick_value numeric not null,    -- e.g. $1.00 per standard lot
  min_lot_size numeric not null default 0.01,
  max_lot_size numeric not null default 50.0,
  lot_step numeric not null default 0.01,
  typical_spread_points numeric not null default 0.18,
  margin_requirement_pct numeric not null default 1.0, -- 1:100 leverage = 1.0%
  effective_from_utc timestamptz not null default now(),
  effective_to_utc timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (symbol, broker_venue, spec_version)
);

create index if not exists idx_instrument_specs_symbol_active
  on public.instrument_specs (symbol, is_active, effective_from_utc desc);

-- ============================================================================
-- 2. Market & Macro Data Core
-- ============================================================================

-- 2.1 Multi-Timeframe Market Bars (With Provenance & Simulation Flag)
create table if not exists public.market_bars (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h', '4h', '1d')),
  bar_time_utc timestamptz not null, -- Bar open timestamp
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  tick_count integer not null default 1 check (tick_count >= 0),
  is_closed boolean not null default true,
  is_simulated boolean not null default false, -- Explicit flag for backtest/Monte Carlo data
  provider_id text not null references public.provider_sources (id) on delete restrict,
  fetched_at_utc timestamptz not null default now(),
  checksum text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (symbol, timeframe, bar_time_utc, is_simulated)
);

create index if not exists idx_market_bars_lookup
  on public.market_bars (symbol, timeframe, is_simulated, bar_time_utc desc);

-- 2.2 Macro Snapshots (Point-in-Time Vintage & Cutoff Alignment)
create table if not exists public.macro_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  cutoff_utc timestamptz not null,
  real_yield_10y numeric,
  dollar_index numeric,
  net_liquidity_billions numeric,
  vix_level numeric,
  high_yield_oas numeric,
  fed_funds_rate numeric,
  cpi_yoy_rate numeric,
  dominant_macro_regime text not null,
  regime_probability numeric not null,
  macro_directional_bias text not null check (macro_directional_bias in ('BULLISH', 'BEARISH', 'NEUTRAL')),
  bias_score numeric not null,
  provenance_hash text not null,
  created_at timestamptz not null default now(),
  unique (as_of_date, cutoff_utc)
);

create index if not exists idx_macro_snapshots_date_cutoff
  on public.macro_snapshots (as_of_date desc, cutoff_utc desc);

-- ============================================================================
-- 3. Strategy & Signal Engine
-- ============================================================================

-- 3.1 Setups (Parent Table for Strategy Instances)
create table if not exists public.setups (
  id uuid primary key default gen_random_uuid(),
  instrument text not null,
  strategy_name text not null default 'XAUUSD_SMC_LIQUIDITY_DISPLACEMENT',
  htf_bias text not null check (htf_bias in ('BULLISH', 'BEARISH', 'NEUTRAL')),
  status text not null default 'MONITORING' check (
    status in ('MONITORING', 'PENDING_CONFIRMATION', 'TRIGGERED', 'EXPIRED', 'INVALIDATED')
  ),
  detected_at_utc timestamptz not null default now(),
  expires_at_utc timestamptz not null,
  macro_snapshot_id uuid references public.macro_snapshots (id) on delete set null,
  quality_grade text not null default 'A' check (quality_grade in ('A+', 'A', 'B', 'REJECTED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_setups_instrument_status
  on public.setups (instrument, status, detected_at_utc desc);

-- 3.2 Setup Components (HTF Bias, Key Zone, Sweep, Confirmation Breakdown)
create table if not exists public.setup_components (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.setups (id) on delete cascade,
  stage text not null check (stage in ('HTF_BIAS', '15M_KEY_ZONE', 'LIQUIDITY_SWEEP', 'LTF_CONFIRMATION')),
  timeframe text not null check (timeframe in ('1d', '4h', '15m', '5m', '1m')),
  event_time_utc timestamptz not null,
  status text not null check (status in ('PASSED', 'FAILED', 'PENDING')),
  reference_level numeric,
  zone_top numeric,
  zone_bottom numeric,
  sweep_wick_extreme numeric,
  choch_break_level numeric,
  fvg_top numeric,
  fvg_bottom numeric,
  rationale text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_setup_components_setup_stage
  on public.setup_components (setup_id, stage);

-- ============================================================================
-- 4. Trade Planning & Execution Management
-- ============================================================================

-- 4.1 Risk Profiles (User-Defined Risk Constraints)
create table if not exists public.risk_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_name text not null default 'Default Prop Challenge',
  account_equity numeric not null check (account_equity > 0),
  account_currency text not null default 'USD',
  risk_per_trade_pct numeric not null default 1.0 check (risk_per_trade_pct between 0.1 and 5.0),
  max_open_trades integer not null default 2 check (max_open_trades >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4.2 Prop Firm Rules (Customizable Rule Parameters)
create table if not exists public.prop_firm_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  risk_profile_id uuid not null references public.risk_profiles (id) on delete cascade,
  firm_name text not null, -- e.g. 'FTMO', 'MFF', 'Topstep'
  challenge_phase text not null default 'PHASE_1',
  starting_balance numeric not null check (starting_balance > 0),
  current_equity_hwm numeric not null check (current_equity_hwm > 0),
  max_daily_loss_pct numeric not null default 5.0,
  max_total_loss_pct numeric not null default 10.0,
  daily_loss_reset_utc time not null default '21:00:00', -- Broker roll UTC
  allow_weekend_hold boolean not null default false,
  news_blackout_minutes integer not null default 15,
  is_breached boolean not null default false,
  breach_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4.3 Trade Plans (Deterministic Pre-Trade Specifications)
create table if not exists public.trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  setup_id uuid references public.setups (id) on delete set null,
  risk_profile_id uuid not null references public.risk_profiles (id) on delete restrict,
  instrument text not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  entry_type text not null default 'LIMIT' check (entry_type in ('LIMIT', 'MARKET')),
  planned_entry_price numeric not null,
  stop_loss_price numeric not null,
  take_profit_1 numeric not null,
  take_profit_2 numeric,
  reward_to_risk_ratio numeric not null check (reward_to_risk_ratio >= 1.5),
  stop_distance_points numeric not null check (stop_distance_points > 0),
  calculated_lot_size numeric not null check (calculated_lot_size > 0),
  dollar_risk numeric not null check (dollar_risk > 0),
  gatekeeper_verdict text not null check (gatekeeper_verdict in ('PASS', 'BLOCK')),
  gatekeeper_reason text not null default 'ALL_CONDITIONS_MET',
  status text not null default 'PLANNED' check (
    status in ('PLANNED', 'READY', 'EXECUTED_MANUAL', 'CANCELLED', 'EXPIRED')
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_trade_plans_user_status
  on public.trade_plans (user_id, status, created_at desc);

-- 4.4 Executions (Manual Entry Only - Hard Constraint 6)
create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_plan_id uuid references public.trade_plans (id) on delete set null,
  instrument text not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  executed_entry_price numeric not null,
  executed_lot_size numeric not null,
  executed_at_utc timestamptz not null default now(),
  exit_price numeric,
  exited_at_utc timestamptz,
  gross_pnl numeric,
  commission numeric not null default 0.0,
  swap numeric not null default 0.0,
  net_pnl numeric,
  realized_r_multiple numeric,
  exit_reason text check (exit_reason in ('TP1', 'TP2', 'STOP_LOSS', 'MANUAL_DISCRETION', 'TIME_STOP', 'PROP_PROTECT')),
  entry_slippage_points numeric,
  screenshot_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_executions_user_time
  on public.executions (user_id, executed_at_utc desc);

-- 4.5 Journal Entries (Reflective Post-Trade Performance Ledger)
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  execution_id uuid not null references public.executions (id) on delete cascade,
  macro_alignment text not null check (macro_alignment in ('ALIGNED', 'COUNTER_TREND', 'NEUTRAL')),
  followed_plan boolean not null default true,
  mistake_tag text check (
    mistake_tag in ('NONE', 'FOMO', 'CHASED_PRICE', 'MOVED_STOP', 'OVERSIZED', 'TRADED_DURING_NEWS', 'EARLY_EXIT')
  ),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_journal_entries_user
  on public.journal_entries (user_id, created_at desc);

-- ============================================================================
-- 5. Alerts & Notification Management
-- ============================================================================

-- 5.1 Alert Rules
create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument text not null,
  rule_type text not null check (
    rule_type in ('PRICE_LEVEL', 'SESSION_OPEN', 'NEWS_BLACKOUT', 'SETUP_FORMED', 'PROP_DRAWDOWN_WARNING')
  ),
  trigger_condition jsonb not null, -- e.g. {"threshold": 2650.50, "operator": ">="}
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 5.2 Alert Events
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_rule_id uuid references public.alert_rules (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  triggered_at_utc timestamptz not null default now(),
  message text not null,
  severity text not null check (severity in ('INFO', 'WARN', 'CRITICAL')),
  delivery_status text not null default 'DELIVERED' check (delivery_status in ('DELIVERED', 'FAILED', 'DISMISSED')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_alert_events_user_time
  on public.alert_events (user_id, triggered_at_utc desc);

-- ============================================================================
-- 6. Quantitative Research & Backtesting
-- ============================================================================

-- 6.1 Backtest Runs (Job Specifications & Metrics)
create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_name text not null,
  instrument text not null,
  start_date date not null,
  end_date date not null,
  simulation_mode text not null check (simulation_mode in ('HISTORICAL_OHLC_BAR', 'TIME_MACHINE_MONTE_CARLO')),
  total_trades integer not null default 0,
  win_rate_pct numeric,
  profit_factor numeric,
  expectancy_r numeric,
  max_drawdown_pct numeric,
  sharpe_ratio numeric,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  error_message text,
  parameters jsonb not null default '{}'::jsonb,
  regime_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_backtest_runs_user_status
  on public.backtest_runs (user_id, status, created_at desc);

-- 6.2 Backtest Trades (Individual Replayed Simulated Trades)
create table if not exists public.backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid not null references public.backtest_runs (id) on delete cascade,
  entry_time_utc timestamptz not null,
  exit_time_utc timestamptz not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  entry_price numeric not null,
  exit_price numeric not null,
  stop_loss numeric not null,
  take_profit numeric not null,
  r_multiple numeric not null,
  is_win boolean not null,
  macro_regime text not null,
  time_in_trade_minutes integer not null,
  is_simulated boolean not null default true
);

create index if not exists idx_backtest_trades_run
  on public.backtest_trades (backtest_run_id, entry_time_utc);

-- ============================================================================
-- 7. Governance, Audit Trail & Security Policies (RLS)
-- ============================================================================

-- 7.1 Immutable Audit Log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  event_time_utc timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  action text not null, -- e.g. 'TRADE_PLAN_CREATED', 'RISK_PROFILE_UPDATED', 'BACKTEST_EXECUTED'
  entity_table text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text
);

create index if not exists idx_audit_log_user_time
  on public.audit_log (user_id, event_time_utc desc);

-- 7.2 Enable Row Level Security (RLS) Across All Proposed Tables
alter table public.provider_sources enable row level security;
alter table public.instrument_specs enable row level security;
alter table public.market_bars enable row level security;
alter table public.macro_snapshots enable row level security;
alter table public.setups enable row level security;
alter table public.setup_components enable row level security;
alter table public.risk_profiles enable row level security;
alter table public.prop_firm_rules enable row level security;
alter table public.trade_plans enable row level security;
alter table public.executions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;
alter table public.backtest_runs enable row level security;
alter table public.backtest_trades enable row level security;
alter table public.audit_log enable row level security;

-- 7.3 Reference & Market Tables: Public Read / Service Role Manage
create policy "Public read provider_sources" on public.provider_sources for select to anon, authenticated using (true);
create policy "Public read instrument_specs" on public.instrument_specs for select to anon, authenticated using (is_active = true);
create policy "Public read market_bars" on public.market_bars for select to anon, authenticated using (true);
create policy "Public read macro_snapshots" on public.macro_snapshots for select to anon, authenticated using (true);
create policy "Public read setups" on public.setups for select to anon, authenticated using (true);
create policy "Public read setup_components" on public.setup_components for select to anon, authenticated using (true);

create policy "Service role manage provider_sources" on public.provider_sources for all to service_role using (true) with check (true);
create policy "Service role manage instrument_specs" on public.instrument_specs for all to service_role using (true) with check (true);
create policy "Service role manage market_bars" on public.market_bars for all to service_role using (true) with check (true);
create policy "Service role manage macro_snapshots" on public.macro_snapshots for all to service_role using (true) with check (true);
create policy "Service role manage setups" on public.setups for all to service_role using (true) with check (true);
create policy "Service role manage setup_components" on public.setup_components for all to service_role using (true) with check (true);

-- 7.4 User Workspace Tables: Strict User Isolation (auth.uid() = user_id)
create policy "Users manage own risk_profiles" on public.risk_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own prop_firm_rules" on public.prop_firm_rules for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own trade_plans" on public.trade_plans for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own executions" on public.executions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own journal_entries" on public.journal_entries for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own alert_rules" on public.alert_rules for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own alert_events" on public.alert_events for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own backtest_runs" on public.backtest_runs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own backtest_trades" on public.backtest_trades for all to authenticated using (
  exists (select 1 from public.backtest_runs r where r.id = backtest_trades.backtest_run_id and r.user_id = auth.uid())
);
create policy "Users read own audit_log" on public.audit_log for select to authenticated using (auth.uid() = user_id);
