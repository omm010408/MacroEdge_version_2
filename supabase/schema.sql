-- MacroEdge Institutional Terminal — Supabase PostgreSQL Schema
-- Run this in your Supabase SQL editor (or apply supabase/migrations/001_autonomous_macro_sync.sql).

-- ============================================================================
-- User Workspace Persistence (Preferences, Watchlists, Daily Pre-Market Checks)
-- ============================================================================

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  announcement_dismissed boolean not null default false,
  default_timeframe text not null default '1Y',
  compact_density boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  name text not null,
  category text not null,
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  check_date date not null,
  overall_regime text not null,
  net_score integer not null default 0,
  pillars jsonb not null,
  summary_note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, check_date)
);

alter table public.user_preferences enable row level security;
alter table public.watchlists enable row level security;
alter table public.daily_checks enable row level security;

drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own watchlists" on public.watchlists;
create policy "Users manage own watchlists"
  on public.watchlists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own daily checks" on public.daily_checks;
create policy "Users manage own daily checks"
  on public.daily_checks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- Autonomous Macro Data Synchronization Swarm Schema (Migration 001)
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.data_sources (
  id text primary key,
  name text not null,
  category text not null check (category in ('macro', 'market', 'positioning', 'liquidity', 'ai')),
  transport text not null check (transport in ('rest', 'websocket', 'ai')),
  cadence text not null check (cadence in ('LIVE', 'DELAYED', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY')),
  expected_interval_seconds integer not null check (expected_interval_seconds > 0),
  stale_after_seconds integer not null check (stale_after_seconds >= expected_interval_seconds),
  rate_limit_rpm integer not null default 60 check (rate_limit_rpm > 0),
  timeout_ms integer not null default 5000 check (timeout_ms > 0),
  max_retries integer not null default 3 check (max_retries >= 0),
  requires_api_key boolean not null default false,
  env_var_name text,
  base_url text not null,
  attribution text not null,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_observations (
  id uuid primary key default gen_random_uuid(),
  series_key text not null,
  source_id text not null references public.data_sources (id) on delete restrict,
  external_series_id text not null,
  observation_date date not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  value numeric not null,
  previous_value numeric,
  unit text not null,
  cadence text not null check (cadence in ('LIVE', 'DELAYED', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY')),
  revision_number integer not null default 1 check (revision_number >= 1),
  is_latest boolean not null default false,
  validation_status text not null default 'VALIDATED' check (validation_status in ('VALIDATED', 'SUSPECT', 'REJECTED')),
  checksum text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (series_key, source_id, observation_date, revision_number)
);

create unique index if not exists idx_data_observations_latest_vintage
  on public.data_observations (series_key, source_id, observation_date)
  where is_latest = true;

create index if not exists idx_data_observations_series_date
  on public.data_observations (series_key, observation_date desc, published_at desc);

create index if not exists idx_data_observations_source_fetched
  on public.data_observations (source_id, fetched_at desc);

create table if not exists public.latest_values (
  series_key text primary key,
  source_id text not null references public.data_sources (id) on delete restrict,
  external_series_id text not null,
  latest_observation_id uuid references public.data_observations (id) on delete set null,
  observation_date date not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  value numeric not null,
  previous_value numeric,
  change_value numeric,
  change_pct numeric,
  unit text not null,
  cadence text not null check (cadence in ('LIVE', 'DELAYED', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY')),
  status text not null default 'CURRENT' check (status in ('LIVE', 'CURRENT', 'DELAYED', 'STALE', 'FAILED', 'DISCONNECTED')),
  revision_number integer not null default 1 check (revision_number >= 1),
  source_attribution text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_latest_values_source_date
  on public.latest_values (source_id, observation_date desc);

create index if not exists idx_latest_values_status_updated
  on public.latest_values (status, updated_at desc);

create table if not exists public.market_quotes (
  symbol text primary key,
  source_id text not null references public.data_sources (id) on delete restrict,
  external_symbol text not null,
  asset_class text not null,
  price numeric not null,
  bid numeric,
  ask numeric,
  previous_close numeric,
  change_value numeric not null default 0,
  change_pct numeric not null default 0,
  volume numeric,
  unit text not null default '',
  tick_seq bigint not null default 0,
  quote_timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'LIVE' check (status in ('LIVE', 'CURRENT', 'DELAYED', 'STALE', 'FAILED', 'DISCONNECTED')),
  dedup_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_quotes_source_ts
  on public.market_quotes (source_id, quote_timestamp desc);

create index if not exists idx_market_quotes_status_updated
  on public.market_quotes (status, updated_at desc);

create table if not exists public.market_bars (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  source_id text not null references public.data_sources (id) on delete restrict,
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h', '4h', '1d')),
  bar_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  tick_count integer not null default 1 check (tick_count >= 0),
  is_closed boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (symbol, timeframe, bar_time)
);

create index if not exists idx_market_bars_symbol_tf_time
  on public.market_bars (symbol, timeframe, bar_time desc);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null check (worker_id in ('orchestrator', 'market-engine', 'macro-engine', 'positioning-engine', 'liquidity-risk-engine', 'validation-recovery', 'ai-supervisor')),
  source_id text references public.data_sources (id) on delete set null,
  job_name text not null,
  trigger_type text not null default 'scheduled' check (trigger_type in ('scheduled', 'manual', 'recovery', 'startup')),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'DEAD_LETTER')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  records_fetched integer not null default 0 check (records_fetched >= 0),
  records_validated integer not null default 0 check (records_validated >= 0),
  records_upserted integer not null default 0 check (records_upserted >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  attempt integer not null default 1 check (attempt >= 1),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  dead_lettered boolean not null default false,
  error_code text,
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_sync_runs_worker_started
  on public.sync_runs (worker_id, started_at desc);

create index if not exists idx_sync_runs_source_started
  on public.sync_runs (source_id, started_at desc);

create index if not exists idx_sync_runs_dlq
  on public.sync_runs (dead_lettered, started_at desc);

create table if not exists public.data_health (
  id text primary key,
  entity_type text not null check (entity_type in ('source', 'worker')),
  source_id text references public.data_sources (id) on delete cascade,
  worker_id text,
  status text not null check (status in ('LIVE', 'CURRENT', 'DELAYED', 'STALE', 'FAILED', 'DISCONNECTED')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_scheduled_at timestamptz,
  freshness_seconds integer,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  latency_ms integer,
  last_error text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_data_health_entity_status
  on public.data_health (entity_type, status, updated_at desc);

create table if not exists public.data_anomalies (
  id uuid primary key default gen_random_uuid(),
  series_key text not null,
  source_id text references public.data_sources (id) on delete set null,
  worker_id text not null,
  severity text not null check (severity in ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  anomaly_type text not null,
  message text not null,
  observed_value text,
  expected_range text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);

create index if not exists idx_data_anomalies_resolved_detected
  on public.data_anomalies (resolved, detected_at desc);

create index if not exists idx_data_anomalies_series_detected
  on public.data_anomalies (series_key, detected_at desc);

create table if not exists public.sync_checkpoints (
  checkpoint_key text primary key,
  worker_id text not null,
  source_id text references public.data_sources (id) on delete cascade,
  cursor_value text,
  last_observation_date date,
  last_published_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sync_checkpoints_worker_updated
  on public.sync_checkpoints (worker_id, updated_at desc);

create table if not exists public.macro_insights (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  model_id text not null,
  title text not null,
  summary text not null,
  key_drivers jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  source_observation_ids uuid[] not null default '{}',
  source_series_keys text[] not null default '{}',
  based_on_latest_at timestamptz not null,
  confidence_note text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_macro_insights_scope_generated
  on public.macro_insights (scope, generated_at desc);

create or replace function public.upsert_macro_observation(
  p_series_key text,
  p_source_id text,
  p_external_series_id text,
  p_observation_date date,
  p_published_at timestamptz,
  p_value numeric,
  p_previous_value numeric,
  p_unit text,
  p_cadence text,
  p_source_attribution text,
  p_checksum text,
  p_status text default 'CURRENT',
  p_raw_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_obs public.data_observations%rowtype;
  v_next_revision integer := 1;
  v_obs_id uuid;
  v_latest_updated boolean := false;
  v_change_value numeric;
  v_change_pct numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_series_key || ':' || p_source_id));

  select *
    into v_existing_obs
    from public.data_observations
   where series_key = p_series_key
     and source_id = p_source_id
     and observation_date = p_observation_date
     and is_latest = true
   limit 1;

  if found then
    if p_published_at < v_existing_obs.published_at then
      return jsonb_build_object(
        'accepted', false,
        'status', 'REJECTED_OLDER_VINTAGE',
        'observation_id', v_existing_obs.id,
        'latest_updated', false,
        'revision_number', v_existing_obs.revision_number
      );
    end if;

    if p_checksum = v_existing_obs.checksum and p_value = v_existing_obs.value then
      update public.data_observations
         set fetched_at = now()
       where id = v_existing_obs.id;

      v_obs_id := v_existing_obs.id;
      v_next_revision := v_existing_obs.revision_number;
    else
      v_next_revision := v_existing_obs.revision_number + 1;

      update public.data_observations
         set is_latest = false
       where id = v_existing_obs.id;

      insert into public.data_observations (
        series_key, source_id, external_series_id, observation_date, published_at,
        fetched_at, value, previous_value, unit, cadence, revision_number,
        is_latest, validation_status, checksum, raw_payload
      ) values (
        p_series_key, p_source_id, p_external_series_id, p_observation_date, p_published_at,
        now(), p_value, p_previous_value, p_unit, p_cadence, v_next_revision,
        true, 'VALIDATED', p_checksum, coalesce(p_raw_payload, '{}'::jsonb)
      )
      returning id into v_obs_id;
    end if;
  else
    insert into public.data_observations (
      series_key, source_id, external_series_id, observation_date, published_at,
      fetched_at, value, previous_value, unit, cadence, revision_number,
      is_latest, validation_status, checksum, raw_payload
    ) values (
      p_series_key, p_source_id, p_external_series_id, p_observation_date, p_published_at,
      now(), p_value, p_previous_value, p_unit, p_cadence, 1,
      true, 'VALIDATED', p_checksum, coalesce(p_raw_payload, '{}'::jsonb)
    )
    returning id into v_obs_id;
  end if;

  v_change_value := case
    when p_previous_value is not null then p_value - p_previous_value
    else null
  end;
  v_change_pct := case
    when p_previous_value is not null and p_previous_value <> 0
      then round(((p_value - p_previous_value) / p_previous_value) * 100.0, 4)
    else null
  end;

  insert into public.latest_values (
    series_key, source_id, external_series_id, latest_observation_id,
    observation_date, published_at, fetched_at, value, previous_value,
    change_value, change_pct, unit, cadence, status, revision_number,
    source_attribution, raw_payload, updated_at
  ) values (
    p_series_key, p_source_id, p_external_series_id, v_obs_id,
    p_observation_date, p_published_at, now(), p_value, p_previous_value,
    v_change_value, v_change_pct, p_unit, p_cadence, p_status, v_next_revision,
    p_source_attribution, coalesce(p_raw_payload, '{}'::jsonb), now()
  )
  on conflict (series_key) do update set
    source_id = excluded.source_id,
    external_series_id = excluded.external_series_id,
    latest_observation_id = excluded.latest_observation_id,
    observation_date = excluded.observation_date,
    published_at = excluded.published_at,
    fetched_at = excluded.fetched_at,
    value = excluded.value,
    previous_value = excluded.previous_value,
    change_value = excluded.change_value,
    change_pct = excluded.change_pct,
    unit = excluded.unit,
    cadence = excluded.cadence,
    status = excluded.status,
    revision_number = excluded.revision_number,
    source_attribution = excluded.source_attribution,
    raw_payload = excluded.raw_payload,
    updated_at = now()
  where (
    excluded.observation_date > public.latest_values.observation_date
    or (
      excluded.observation_date = public.latest_values.observation_date
      and excluded.published_at >= public.latest_values.published_at
    )
  );

  get diagnostics v_latest_updated = row_count;

  return jsonb_build_object(
    'accepted', true,
    'status', case when v_latest_updated then 'UPSERTED' else 'VINTAGE_ONLY_OLDER_THAN_LATEST' end,
    'observation_id', v_obs_id,
    'latest_updated', v_latest_updated,
    'revision_number', v_next_revision
  );
end;
$$;

create or replace function public.upsert_market_quote(
  p_symbol text,
  p_source_id text,
  p_external_symbol text,
  p_asset_class text,
  p_price numeric,
  p_bid numeric,
  p_ask numeric,
  p_previous_close numeric,
  p_change_value numeric,
  p_change_pct numeric,
  p_volume numeric,
  p_unit text,
  p_tick_seq bigint,
  p_quote_timestamp timestamptz,
  p_status text,
  p_dedup_hash text,
  p_raw_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean := false;
begin
  insert into public.market_quotes (
    symbol, source_id, external_symbol, asset_class, price, bid, ask,
    previous_close, change_value, change_pct, volume, unit, tick_seq,
    quote_timestamp, received_at, status, dedup_hash, raw_payload, updated_at
  ) values (
    p_symbol, p_source_id, p_external_symbol, p_asset_class, p_price, p_bid, p_ask,
    p_previous_close, p_change_value, p_change_pct, p_volume, p_unit, p_tick_seq,
    p_quote_timestamp, now(), p_status, p_dedup_hash, coalesce(p_raw_payload, '{}'::jsonb), now()
  )
  on conflict (symbol) do update set
    source_id = excluded.source_id,
    external_symbol = excluded.external_symbol,
    asset_class = excluded.asset_class,
    price = excluded.price,
    bid = excluded.bid,
    ask = excluded.ask,
    previous_close = excluded.previous_close,
    change_value = excluded.change_value,
    change_pct = excluded.change_pct,
    volume = excluded.volume,
    unit = excluded.unit,
    tick_seq = excluded.tick_seq,
    quote_timestamp = excluded.quote_timestamp,
    received_at = now(),
    status = excluded.status,
    dedup_hash = excluded.dedup_hash,
    raw_payload = excluded.raw_payload,
    updated_at = now()
  where (
    excluded.dedup_hash <> public.market_quotes.dedup_hash
    and (
      excluded.quote_timestamp > public.market_quotes.quote_timestamp
      or (
        excluded.quote_timestamp = public.market_quotes.quote_timestamp
        and excluded.tick_seq >= public.market_quotes.tick_seq
      )
    )
  );

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'accepted', v_updated,
    'symbol', p_symbol
  );
end;
$$;

alter table public.data_sources enable row level security;
alter table public.data_observations enable row level security;
alter table public.latest_values enable row level security;
alter table public.market_quotes enable row level security;
alter table public.market_bars enable row level security;
alter table public.sync_runs enable row level security;
alter table public.data_health enable row level security;
alter table public.data_anomalies enable row level security;
alter table public.sync_checkpoints enable row level security;
alter table public.macro_insights enable row level security;

drop policy if exists "Public read data_sources" on public.data_sources;
create policy "Public read data_sources"
  on public.data_sources for select to anon, authenticated using (enabled = true);

drop policy if exists "Public read validated data_observations" on public.data_observations;
create policy "Public read validated data_observations"
  on public.data_observations for select to anon, authenticated using (validation_status = 'VALIDATED');

drop policy if exists "Public read latest_values" on public.latest_values;
create policy "Public read latest_values"
  on public.latest_values for select to anon, authenticated using (true);

drop policy if exists "Public read market_quotes" on public.market_quotes;
create policy "Public read market_quotes"
  on public.market_quotes for select to anon, authenticated using (true);

drop policy if exists "Public read market_bars" on public.market_bars;
create policy "Public read market_bars"
  on public.market_bars for select to anon, authenticated using (true);

drop policy if exists "Public read sync_runs" on public.sync_runs;
create policy "Public read sync_runs"
  on public.sync_runs for select to anon, authenticated using (true);

drop policy if exists "Public read data_health" on public.data_health;
create policy "Public read data_health"
  on public.data_health for select to anon, authenticated using (true);

drop policy if exists "Public read data_anomalies" on public.data_anomalies;
create policy "Public read data_anomalies"
  on public.data_anomalies for select to anon, authenticated using (true);

drop policy if exists "Service role only sync_checkpoints" on public.sync_checkpoints;
create policy "Service role only sync_checkpoints"
  on public.sync_checkpoints for all to service_role using (true) with check (true);

drop policy if exists "Public read macro_insights" on public.macro_insights;
create policy "Public read macro_insights"
  on public.macro_insights for select to anon, authenticated using (true);

drop policy if exists "Service role manage data_sources" on public.data_sources;
create policy "Service role manage data_sources"
  on public.data_sources for all to service_role using (true) with check (true);

drop policy if exists "Service role manage data_observations" on public.data_observations;
create policy "Service role manage data_observations"
  on public.data_observations for all to service_role using (true) with check (true);

drop policy if exists "Service role manage latest_values" on public.latest_values;
create policy "Service role manage latest_values"
  on public.latest_values for all to service_role using (true) with check (true);

drop policy if exists "Service role manage market_quotes" on public.market_quotes;
create policy "Service role manage market_quotes"
  on public.market_quotes for all to service_role using (true) with check (true);

drop policy if exists "Service role manage market_bars" on public.market_bars;
create policy "Service role manage market_bars"
  on public.market_bars for all to service_role using (true) with check (true);

drop policy if exists "Service role manage sync_runs" on public.sync_runs;
create policy "Service role manage sync_runs"
  on public.sync_runs for all to service_role using (true) with check (true);

drop policy if exists "Service role manage data_health" on public.data_health;
create policy "Service role manage data_health"
  on public.data_health for all to service_role using (true) with check (true);

drop policy if exists "Service role manage data_anomalies" on public.data_anomalies;
create policy "Service role manage data_anomalies"
  on public.data_anomalies for all to service_role using (true) with check (true);

drop policy if exists "Service role manage macro_insights" on public.macro_insights;
create policy "Service role manage macro_insights"
  on public.macro_insights for all to service_role using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.latest_values;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.market_quotes;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.data_health;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sync_runs;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.macro_insights;
exception when duplicate_object or undefined_object then null;
end $$;

-- =============================================================================
-- Phase 3: Autonomous Debugger & Incident Response Schema (002_incident_response)
-- =============================================================================

create table if not exists public.system_incidents (
  id text primary key,
  fingerprint text unique not null,
  severity text not null check (severity in ('Critical', 'High', 'Medium', 'Low')),
  domain text not null check (domain in ('frontend', 'backend', 'database', 'sync')),
  affected_component text not null,
  affected_dataset text,
  worker_id text,
  provider_id text,
  status text not null default 'open' check (
    status in ('open', 'investigating', 'remediating', 'awaiting_approval', 'resolved', 'dismissed')
  ),
  approval_status text not null default 'not_required' check (
    approval_status in ('not_required', 'pending_approval', 'approved', 'rejected')
  ),
  requires_human_approval boolean not null default false,
  safe_idempotent_action text,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  error_description text not null,
  redacted_trace text,
  root_cause text,
  root_cause_verified boolean not null default false,
  investigation_source text not null default 'insufficient_evidence' check (
    investigation_source in ('deterministic', 'ai_gemini', 'insufficient_evidence')
  ),
  recommended_fix text,
  regression_test_ref text,
  recovery_verification jsonb,
  timeline jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_incidents_status_severity_last
  on public.system_incidents (status, severity, last_detected_at desc);

create index if not exists idx_system_incidents_domain_last
  on public.system_incidents (domain, last_detected_at desc);

create index if not exists idx_system_incidents_approval_last
  on public.system_incidents (approval_status, requires_human_approval, last_detected_at desc);

create table if not exists public.runtime_telemetry_samples (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  source_component text not null,
  metric_type text not null,
  latency_ms numeric,
  memory_rss_mb numeric,
  heap_used_mb numeric,
  event_loop_lag_ms numeric,
  ok boolean not null default true,
  detail text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_runtime_telemetry_recorded
  on public.runtime_telemetry_samples (recorded_at desc);

create index if not exists idx_runtime_telemetry_metric_recorded
  on public.runtime_telemetry_samples (metric_type, recorded_at desc);

create index if not exists idx_runtime_telemetry_component_recorded
  on public.runtime_telemetry_samples (source_component, recorded_at desc);

create or replace function public.set_incident_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_incidents_updated_at on public.system_incidents;
create trigger trg_system_incidents_updated_at
  before update on public.system_incidents
  for each row execute function public.set_incident_updated_at();

alter table public.system_incidents enable row level security;
alter table public.runtime_telemetry_samples enable row level security;

drop policy if exists "Public read system_incidents" on public.system_incidents;
create policy "Public read system_incidents"
  on public.system_incidents for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read runtime_telemetry_samples" on public.runtime_telemetry_samples;
create policy "Public read runtime_telemetry_samples"
  on public.runtime_telemetry_samples for select
  to anon, authenticated
  using (true);

drop policy if exists "Service role manage system_incidents" on public.system_incidents;
create policy "Service role manage system_incidents"
  on public.system_incidents for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manage runtime_telemetry_samples" on public.runtime_telemetry_samples;
create policy "Service role manage runtime_telemetry_samples"
  on public.runtime_telemetry_samples for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  alter publication supabase_realtime add table public.system_incidents;
exception when duplicate_object or undefined_object then null;
end $$;
