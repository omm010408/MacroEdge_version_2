// Shared contracts for MacroEdge Phase 3 Autonomous Debugger & Incident Response.
// Strictly client- and server-safe (zero Node built-ins or secret imports).

export type IncidentSeverity = "Critical" | "High" | "Medium" | "Low";

export type IncidentDomain = "frontend" | "backend" | "database" | "sync";

export type IncidentStatus =
  | "open"
  | "investigating"
  | "remediating"
  | "awaiting_approval"
  | "resolved"
  | "dismissed";

export type ApprovalStatus =
  | "not_required"
  | "pending_approval"
  | "approved"
  | "rejected";

export type InvestigationSource =
  | "deterministic"
  | "ai_gemini"
  | "insufficient_evidence";

export type SafeRemediationAction =
  | "retry_sync_run"
  | "evaluate_staleness"
  | "recompute_derived_metrics"
  | "reconnect_market_daemon"
  | "run_backfill_series"
  | "refresh_ai_insights"
  | "clear_stale_locks"
  | "reset_provider_backoff"
  | "none";

export interface RecoveryCheckItem {
  name: string;
  passed: boolean;
  detail: string;
  checkedAt: string;
}

export interface RecoveryVerification {
  verified: boolean;
  verifiedAt: string;
  summary: string;
  checks: RecoveryCheckItem[];
}

export interface IncidentTimelineEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface SystemIncidentRecord {
  id: string;
  fingerprint: string;
  severity: IncidentSeverity;
  domain: IncidentDomain;
  affectedComponent: string;
  affectedDataset: string | null;
  workerId: string | null;
  providerId: string | null;
  status: IncidentStatus;
  approvalStatus: ApprovalStatus;
  requiresHumanApproval: boolean;
  safeIdempotentAction: SafeRemediationAction | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;
  errorDescription: string;
  redactedTrace: string | null;
  rootCause: string | null;
  rootCauseVerified: boolean;
  investigationSource: InvestigationSource;
  recommendedFix: string | null;
  regressionTestRef: string | null;
  recoveryVerification: RecoveryVerification | null;
  timeline: IncidentTimelineEvent[];
  metadata: Record<string, unknown>;
  resolvedAt: string | null;
  updatedAt: string;
}

export type RuntimeTelemetryMetricType =
  | "api_latency"
  | "worker_tick"
  | "memory_rss"
  | "event_loop_lag"
  | "db_query"
  | "realtime_disconnect"
  | "ui_error"
  | "hydration_error";

export interface RuntimeTelemetryRecord {
  id: string;
  recordedAt: string;
  sourceComponent: string;
  metricType: RuntimeTelemetryMetricType;
  latencyMs: number | null;
  memoryRssMb: number | null;
  heapUsedMb: number | null;
  eventLoopLagMs: number | null;
  ok: boolean;
  detail: string | null;
  metadata: Record<string, unknown>;
}

export interface IncidentCountsSummary {
  total: number;
  open: number;
  investigating: number;
  remediating: number;
  awaitingApproval: number;
  resolved: number;
  dismissed: number;
  criticalOpen: number;
  byDomain: Record<IncidentDomain, number>;
}

export interface IncidentDashboardSnapshot {
  persistenceMode: "SUPABASE_POSTGRES" | "LOCAL_DURABLE_STORE";
  generatedAt: string;
  incidents: SystemIncidentRecord[];
  telemetry: RuntimeTelemetryRecord[];
  counts: IncidentCountsSummary;
}

export interface UpsertIncidentInput {
  fingerprint: string;
  severity: IncidentSeverity;
  domain: IncidentDomain;
  affectedComponent: string;
  affectedDataset?: string | null;
  workerId?: string | null;
  providerId?: string | null;
  status?: IncidentStatus;
  approvalStatus?: ApprovalStatus;
  requiresHumanApproval?: boolean;
  safeIdempotentAction?: SafeRemediationAction | null;
  detectedAt?: string;
  errorDescription: string;
  redactedTrace?: string | null;
  rootCause?: string | null;
  rootCauseVerified?: boolean;
  investigationSource?: InvestigationSource;
  recommendedFix?: string | null;
  regressionTestRef?: string | null;
  recoveryVerification?: RecoveryVerification | null;
  metadata?: Record<string, unknown>;
  timelineActor?: string;
  timelineAction?: string;
  timelineDetail?: string;
}

export interface UpsertIncidentResult {
  incident: SystemIncidentRecord;
  deduplicated: boolean;
  reopened: boolean;
}

export interface UpdateIncidentPatch {
  severity?: IncidentSeverity;
  affectedComponent?: string;
  affectedDataset?: string | null;
  workerId?: string | null;
  providerId?: string | null;
  status?: IncidentStatus;
  approvalStatus?: ApprovalStatus;
  requiresHumanApproval?: boolean;
  safeIdempotentAction?: SafeRemediationAction | null;
  lastDetectedAt?: string;
  errorDescription?: string;
  redactedTrace?: string | null;
  rootCause?: string | null;
  rootCauseVerified?: boolean;
  investigationSource?: InvestigationSource;
  recommendedFix?: string | null;
  regressionTestRef?: string | null;
  recoveryVerification?: RecoveryVerification | null;
  metadata?: Record<string, unknown>;
  resolvedAt?: string | null;
}

export interface AppendTimelineEventInput {
  actor: string;
  action: string;
  detail: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordTelemetryInput {
  recordedAt?: string;
  sourceComponent: string;
  metricType: RuntimeTelemetryMetricType;
  latencyMs?: number | null;
  memoryRssMb?: number | null;
  heapUsedMb?: number | null;
  eventLoopLagMs?: number | null;
  ok?: boolean;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListIncidentsOptions {
  status?: IncidentStatus | IncidentStatus[];
  domain?: IncidentDomain;
  severity?: IncidentSeverity;
  includeClosed?: boolean;
  limit?: number;
}

export interface ListTelemetryOptions {
  metricType?: RuntimeTelemetryMetricType;
  sourceComponent?: string;
  limit?: number;
}

export interface IncidentIngestPayload {
  fingerprint?: string;
  severity?: IncidentSeverity;
  domain: IncidentDomain;
  affectedComponent: string;
  affectedDataset?: string | null;
  workerId?: string | null;
  providerId?: string | null;
  errorDescription: string;
  stackTrace?: string | null;
  routePath?: string | null;
  metadata?: Record<string, unknown>;
  telemetry?: RecordTelemetryInput;
}

export type IncidentActionType =
  | "approve"
  | "reject"
  | "dismiss"
  | "remediate"
  | "investigate"
  | "resolve"
  | "reopen";

export interface IncidentActionPayload {
  action: IncidentActionType;
  actor?: string;
  note?: string;
}
