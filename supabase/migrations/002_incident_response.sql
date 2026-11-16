-- MacroEdge Phase 3: Autonomous Debugger & Incident Response Schema
-- Idempotent migration for production incident tracking and runtime telemetry.
-- Preserves all existing user tables and Phase 2 autonomous sync tables.

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

-- Row Level Security: public read-only redacted incident & telemetry view; service_role full write
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

-- Enable Supabase Realtime on system_incidents cleanly & idempotently
do $$
begin
  alter publication supabase_realtime add table public.system_incidents;
exception when duplicate_object or undefined_object then null;
end $$;
