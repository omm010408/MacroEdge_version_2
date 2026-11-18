// Agent 7 — Autonomous Debugger & Incident Response Engine for MacroEdge.
// Server-only deterministic monitoring, classification, investigation, safe idempotent recovery,
// human-approval gating, and recovery verification across Frontend, Backend, Database, and Sync.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactObjectSecrets, redactSensitiveText } from "@/lib/incidents/redact";
import type {
  ApprovalStatus,
  IncidentActionPayload,
  IncidentDashboardSnapshot,
  IncidentDomain,
  IncidentIngestPayload,
  IncidentSeverity,
  IncidentStatus,
  InvestigationSource,
  RecoveryCheckItem,
  RecoveryVerification,
  SafeRemediationAction,
  SystemIncidentRecord,
  UpsertIncidentInput,
  UpsertIncidentResult,
} from "@/lib/incidents/types";
import type {
  DataAnomalyRecord,
  DataHealthRecord,
  MarketQuoteRecord,
  ObservationRecord,
  ProviderId,
  SyncRunRecord,
  WorkerId,
} from "@/lib/sync/types";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  getAllProviderStatuses,
  getSeriesMapping,
  isProviderConfigured,
  MACRO_SERIES_MAPPINGS,
} from "@/services/sync/provider-registry";
import {
  getLatestValues,
  getMarketQuotes,
  getObservations,
  getSyncSystemSnapshot,
} from "@/services/sync/store";
import {
  evaluateSourceStaleness,
  retryDeadLetterRun,
  runBackfillJob,
} from "@/services/sync/validation-recovery";
import {
  appendIncidentTimeline,
  getIncidentById,
  getIncidentDashboardSnapshot,
  listIncidents,
  listRuntimeTelemetry,
  recordRuntimeTelemetry,
  updateIncident,
  upsertIncident,
} from "@/services/incidents/store";

export interface SweepCheckItem {
  domain: IncidentDomain;
  name: string;
  ok: boolean;
  detail: string;
  latencyMs: number;
}

export interface MonitorSweepOptions {
  runDbProbe?: boolean;
  autoRemediate?: boolean;
  invokeAi?: boolean;
  includeTelemetry?: boolean;
  actor?: string;
}

export interface MonitorSweepResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  incidentsDetected: number;
  incidentsDeduplicated: number;
  autoRemediatedCount: number;
  awaitingApprovalCount: number;
  resolvedCount: number;
  telemetryRecorded: number;
  checksRun: SweepCheckItem[];
}

export interface TelemetryIngestResult {
  telemetryRecorded: boolean;
  rateLimited?: boolean;
  incidentResult?: UpsertIncidentResult | null;
}

export interface RecoveryExecutionResult {
  ok: boolean;
  blockedReason?: string;
  incident: SystemIncidentRecord | null;
}

export interface RecoveryVerifyResult {
  verified: boolean;
  incident: SystemIncidentRecord | null;
}

export interface IncidentActionOutcome {
  ok: boolean;
  message: string;
  incident: SystemIncidentRecord | null;
  snapshot: IncidentDashboardSnapshot;
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const SLOW_DB_QUERY_MS = 1200;
const SLOW_API_LATENCY_MS = 3000;
const HIGH_MEMORY_RSS_MB = 1536;
const HIGH_EVENT_LOOP_LAG_MS = 250;
const STALE_HEARTBEAT_LAG_SECONDS = 300;
const INGEST_WINDOW_MS = 60_000;
const MAX_INGEST_PER_KEY_PER_WINDOW = 12;

const SAFE_IDEMPOTENT_ACTIONS = new Set<SafeRemediationAction>([
  "retry_sync_run",
  "evaluate_staleness",
  "recompute_derived_metrics",
  "reconnect_market_daemon",
  "run_backfill_series",
  "refresh_ai_insights",
  "clear_stale_locks",
  "reset_provider_backoff",
]);

const ingestRateTracker = new Map<string, { windowStartMs: number; count: number }>();

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/services/incidents/debugger-engine.ts is strictly server-side and cannot run in browser code."
    );
  }
}

export async function measureEventLoopLagMs(): Promise<number> {
  const start = performance.now();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
  const elapsed = performance.now() - start;
  return Math.max(0, Number((elapsed - 10).toFixed(2)));
}

function getProcessMemoryStats(): {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
} {
  const mem = process.memoryUsage();
  return {
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
  };
}

let lastCpuSample: { usage: NodeJS.CpuUsage; atMs: number } | null = null;

function sampleCpuUsagePercent(): number {
  const now = performance.now();
  const usage = process.cpuUsage();
  if (!lastCpuSample) {
    lastCpuSample = { usage, atMs: now };
    return 0;
  }
  const elapsedMs = Math.max(1, now - lastCpuSample.atMs);
  const deltaUs =
    usage.user -
    lastCpuSample.usage.user +
    (usage.system - lastCpuSample.usage.system);
  lastCpuSample = { usage, atMs: now };
  return Math.max(0, Number(((deltaUs / 1000 / elapsedMs) * 100).toFixed(1)));
}

/**
 * Records persistent worker startup & flags unexpected previous termination (no clean stop).
 */
export async function recordWorkerSessionLifecycle(
  workerName: string,
  state: "started" | "stopped"
): Promise<void> {
  assertServerOnly();
  if (state === "started") {
    const prev = await listRuntimeTelemetry({
      sourceComponent: workerName,
      metricType: "worker_tick",
      limit: 5,
    });
    const unclosedPrev = prev.find((t) => t.metadata?.lifecycleState === "started");
    const lastStop = prev.find((t) => t.metadata?.lifecycleState === "stopped");
    if (
      unclosedPrev &&
      (!lastStop || unclosedPrev.recordedAt > lastStop.recordedAt)
    ) {
      await upsertIncident({
        fingerprint: `backend:unexpected-termination:${workerName}`,
        severity: "High",
        domain: "backend",
        affectedComponent: workerName,
        status: "awaiting_approval",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        errorDescription: `Previous ${workerName} session (${unclosedPrev.recordedAt}) exited without a clean SIGINT/SIGTERM stop.`,
        rootCause: `Worker lifecycle telemetry recorded startup at ${unclosedPrev.recordedAt} with no corresponding clean shutdown event.`,
        rootCauseVerified: true,
        investigationSource: "deterministic",
        recommendedFix:
          "Inspect host/Render exit logs (OOM killer, crash signal, or container restart) before re-enabling autonomous loops.",
        regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
      });
    }
  }

  await recordRuntimeTelemetry({
    sourceComponent: workerName,
    metricType: "worker_tick",
    ok: true,
    detail: `Worker ${workerName} ${state} (pid=${process.pid})`,
    metadata: {
      lifecycleState: state,
      pid: process.pid,
    },
  });
}

function buildMetricCheck(
  domain: IncidentDomain,
  name: string,
  ok: boolean,
  detail: string,
  latencyMs: number
): SweepCheckItem {
  return {
    domain,
    name,
    ok,
    detail: redactSensitiveText(detail),
    latencyMs: Math.max(0, Math.round(latencyMs)),
  };
}

/**
 * Wraps a backend DB/repository query with latency & failure telemetry without hiding errors.
 */
export async function measureDbQuery<T>(
  component: string,
  fn: () => Promise<T>
): Promise<T> {
  assertServerOnly();
  const start = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - start;
    await recordRuntimeTelemetry({
      sourceComponent: component,
      metricType: "db_query",
      latencyMs,
      ok: latencyMs <= SLOW_DB_QUERY_MS,
      detail:
        latencyMs > SLOW_DB_QUERY_MS
          ? `Slow query (${latencyMs}ms > ${SLOW_DB_QUERY_MS}ms)`
          : "Query completed",
    }).catch(() => {});

    if (latencyMs > SLOW_DB_QUERY_MS) {
      await upsertIncident({
        fingerprint: `db:slow-query:${component}`,
        severity: latencyMs > 3000 ? "High" : "Medium",
        domain: "database",
        affectedComponent: component,
        status: "awaiting_approval",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        errorDescription: `Slow database query detected on ${component} (${latencyMs}ms > ${SLOW_DB_QUERY_MS}ms threshold).`,
        rootCause: `Read query execution exceeded ${SLOW_DB_QUERY_MS}ms threshold (${latencyMs}ms).`,
        rootCauseVerified: true,
        investigationSource: "deterministic",
        recommendedFix:
          "Inspect query filter selectivity and index coverage on the affected Supabase table; approve indexing/query change before deployment.",
        regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
        timelineActor: "agent-7-monitor",
        timelineAction: "detected",
      }).catch(() => {});
    }

    return result;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    await recordRuntimeTelemetry({
      sourceComponent: component,
      metricType: "db_query",
      latencyMs,
      ok: false,
      detail: redactSensitiveText(message),
    }).catch(() => {});

    await upsertIncident({
      fingerprint: `db:query-failure:${component}`,
      severity: "Critical",
      domain: "database",
      affectedComponent: component,
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Database query failed in ${component}: ${redactSensitiveText(message)}`,
      redactedTrace: err instanceof Error && err.stack ? err.stack : message,
      investigationSource: "deterministic",
      rootCause: `Database operation threw an error on ${component}: ${redactSensitiveText(message)}`,
      rootCauseVerified: true,
      recommendedFix:
        "Verify Supabase connection credentials, RLS/service-role permissions, and table constraints before retrying.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
      timelineActor: "agent-7-monitor",
      timelineAction: "detected",
    }).catch(() => {});

    throw err;
  }
}

interface DeterministicClassification {
  rootCause: string | null;
  rootCauseVerified: boolean;
  investigationSource: InvestigationSource;
  recommendedFix: string;
  requiresHumanApproval: boolean;
  safeIdempotentAction: SafeRemediationAction;
  regressionTestRef: string;
}

function classifyIncidentDeterministically(
  incident: Pick<
    SystemIncidentRecord,
    | "domain"
    | "affectedComponent"
    | "affectedDataset"
    | "workerId"
    | "providerId"
    | "errorDescription"
    | "redactedTrace"
    | "metadata"
  >
): DeterministicClassification {
  const errLower = `${incident.errorDescription} ${incident.redactedTrace ?? ""}`.toLowerCase();
  const anomalyType =
    typeof incident.metadata?.anomalyType === "string"
      ? incident.metadata.anomalyType
      : "";

  // 1. Schema / historical / DB constraint issues strictly require human approval
  if (
    incident.domain === "database" &&
    (errLower.includes("duplicate") ||
      errLower.includes("23505") ||
      errLower.includes("monotonic") ||
      anomalyType === "NON_MONOTONIC_REJECTED" ||
      anomalyType === "SCHEMA_MISMATCH" ||
      anomalyType === "OUTLIER_SPIKE")
  ) {
    return {
      rootCause: `Observed ${incident.errorDescription}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Preserve historical financial rows untouched; inspect upstream provider payload/schema or dedup key with human approval before modifying data or DDL.",
      requiresHumanApproval: true,
      safeIdempotentAction: "none",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
    };
  }

  if (incident.domain === "database" && errLower.includes("slow")) {
    return {
      rootCause: `Database read probe latency exceeded ${SLOW_DB_QUERY_MS}ms threshold.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Review query plan, table indexes, and connection pool health; apply index migration only with human approval.",
      requiresHumanApproval: true,
      safeIdempotentAction: "none",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
    };
  }

  if (
    incident.domain === "database" &&
    (errLower.includes("missing") || errLower.includes("not found"))
  ) {
    return {
      rootCause: `Expected configured dataset observations are missing (${incident.affectedDataset ?? incident.affectedComponent}).`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Run non-destructive series backfill for the missing economic series without altering existing historical vintages.",
      requiresHumanApproval: false,
      safeIdempotentAction: "run_backfill_series",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
    };
  }

  // 2. Frontend / UI / Chart rendering code errors require human-approved code fixes
  if (
    incident.domain === "frontend" &&
    (errLower.includes("hydration") ||
      errLower.includes("typeerror") ||
      errLower.includes("referenceerror") ||
      errLower.includes("cannot read") ||
      errLower.includes("chunkloaderror") ||
      errLower.includes("chart") ||
      errLower.includes("nan"))
  ) {
    return {
      rootCause: `Client runtime/rendering exception observed in ${incident.affectedComponent}: ${incident.errorDescription}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Inspect React error boundary stack trace and guard null/NaN chart inputs in the affected component before deploying fix.",
      requiresHumanApproval: true,
      safeIdempotentAction: "none",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#frontend-ingest",
    };
  }

  // 3. Transient provider HTTP 429 / 5xx / timeout sync failures -> safe retry
  if (
    incident.domain === "sync" &&
    (errLower.includes("429") ||
      errLower.includes("500") ||
      errLower.includes("502") ||
      errLower.includes("503") ||
      errLower.includes("504") ||
      errLower.includes("timeout") ||
      errLower.includes("econn") ||
      errLower.includes("dead_letter") ||
      errLower.includes("dead letter") ||
      Boolean(incident.metadata?.syncRunId))
  ) {
    const providerTag = incident.providerId ?? "provider";
    return {
      rootCause: `Sync execution failed on ${providerTag} due to transient upstream/network error or retry exhaustion (${incident.errorDescription}).`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Retry dead-lettered/failed sync job using idempotent replay and verify data_health recovery.",
      requiresHumanApproval: false,
      safeIdempotentAction: "retry_sync_run",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#safe-recovery",
    };
  }

  // 4. Stale / delayed configured data feeds
  if (
    incident.domain === "sync" &&
    (errLower.includes("stale") || anomalyType === "STALE_DATA")
  ) {
    return {
      rootCause: `Dataset or provider ${incident.providerId ?? incident.affectedComponent} exceeded expected cadence freshness threshold.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Re-evaluate cadence staleness and execute safe idempotent provider sync refresh.",
      requiresHumanApproval: false,
      safeIdempotentAction: "evaluate_staleness",
      regressionTestRef: "scripts/verify-sync-acceptance.mjs#test-7",
    };
  }

  // 5. Data normalization / outlier / schema mismatch -> human review so historical numbers stay safe
  if (
    anomalyType === "OUTLIER_SPIKE" ||
    anomalyType === "SCHEMA_MISMATCH" ||
    anomalyType === "NON_MONOTONIC_REJECTED" ||
    errLower.includes("outlier") ||
    errLower.includes("unit") ||
    errLower.includes("invalid timestamp")
  ) {
    return {
      rootCause: `Validation engine flagged anomalous or malformed observation in ${incident.affectedDataset ?? incident.affectedComponent}.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Verify upstream release unit/timestamp format before accepting or re-normalizing observation; never mutate historical vintages directly.",
      requiresHumanApproval: true,
      safeIdempotentAction: "none",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#sync-anomalies",
    };
  }

  // 6. WebSocket disconnect when active WS provider is configured
  if (
    incident.domain === "backend" &&
    (errLower.includes("websocket") || errLower.includes("ws ") || errLower.includes("heartbeat"))
  ) {
    return {
      rootCause: `Active Market WebSocket stream reported disconnect/heartbeat drop on ${incident.providerId ?? incident.affectedComponent}.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Run safe WebSocket daemon reconnect cycle and confirm healthy quote ingestion.",
      requiresHumanApproval: false,
      safeIdempotentAction: "reconnect_market_daemon",
      regressionTestRef: "scripts/verify-sync-acceptance.mjs#test-1",
    };
  }

  // 7. Memory / Event-loop lag / process crash
  if (
    incident.domain === "backend" &&
    (errLower.includes("memory") ||
      errLower.includes("rss") ||
      errLower.includes("event loop") ||
      errLower.includes("uncaughtexception") ||
      errLower.includes("unhandledrejection"))
  ) {
    return {
      rootCause: `Backend runtime anomaly detected: ${incident.errorDescription}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Review redacted stack trace, active timers/WebSocket buffers, and heap profile; human approval required for code/worker resource fixes.",
      requiresHumanApproval: true,
      safeIdempotentAction: "none",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
    };
  }

  // Insufficient evidence: NEVER invent a root cause!
  return {
    rootCause: null,
    rootCauseVerified: false,
    investigationSource: "insufficient_evidence",
    recommendedFix:
      "Insufficient evidence to confirm root cause. Capture reproducing stack trace or telemetry before applying fixes.",
    requiresHumanApproval: true,
    safeIdempotentAction: "none",
    regressionTestRef: "scripts/verify-agent7-incidents.mjs#honesty-no-fabrication",
  };
}

function classifyIngestActionDefaults(payload: IncidentIngestPayload): {
  severity: IncidentSeverity;
  fingerprint: string;
  classification: DeterministicClassification;
} {
  const errLower = payload.errorDescription.toLowerCase();
  const severity: IncidentSeverity =
    payload.severity ??
    (errLower.includes("crash") ||
    errLower.includes("fatal") ||
    errLower.includes("uncaught") ||
    errLower.includes("database")
      ? "Critical"
      : errLower.includes("500") ||
        errLower.includes("render") ||
        errLower.includes("hydration") ||
        errLower.includes("chart")
      ? "High"
      : "Medium");

  const fingerprint =
    payload.fingerprint?.trim() ||
    `${payload.domain}:${payload.affectedComponent}:${payload.errorDescription.slice(0, 90)}`;

  const classification = classifyIncidentDeterministically({
    domain: payload.domain,
    affectedComponent: payload.affectedComponent,
    affectedDataset: payload.affectedDataset ?? null,
    workerId: payload.workerId ?? null,
    providerId: payload.providerId ?? null,
    errorDescription: payload.errorDescription,
    redactedTrace: payload.stackTrace ?? null,
    metadata: payload.metadata ?? {},
  });

  return { severity, fingerprint, classification };
}

/**
 * Ingests frontend/backend/client telemetry safely (rate-limited, secret-redacted, loop-safe).
 */
export async function ingestTelemetryAndClassify(
  payload: IncidentIngestPayload,
  options?: { sourceKey?: string }
): Promise<TelemetryIngestResult> {
  assertServerOnly();
  const safeComponent = redactSensitiveText(payload.affectedComponent.trim());
  const safeDescription = redactSensitiveText(payload.errorDescription.trim());
  const safeTrace = payload.stackTrace
    ? redactSensitiveText(payload.stackTrace.trim())
    : null;
  const safeMeta = redactObjectSecrets(payload.metadata ?? {});

  // Prevent incident reporting recursion / endpoint storms, and ignore uninformative cross-origin script errors
  if (
    safeComponent.includes("/api/incidents") ||
    safeDescription.includes("/api/incidents/ingest") ||
    ((safeDescription === "Script error." || safeDescription === "Script error") &&
      !safeTrace &&
      (safeComponent === "browser-window" || safeComponent.startsWith("browser:")))
  ) {
    return { telemetryRecorded: false, incidentResult: null };
  }

  const rateKey = `${options?.sourceKey ?? "global"}:${payload.domain}:${safeComponent}:${safeDescription.slice(0, 64)}`;
  const nowMs = Date.now();
  const bucket = ingestRateTracker.get(rateKey);
  if (!bucket || nowMs - bucket.windowStartMs >= INGEST_WINDOW_MS) {
    ingestRateTracker.set(rateKey, { windowStartMs: nowMs, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > MAX_INGEST_PER_KEY_PER_WINDOW) {
      return { telemetryRecorded: false, rateLimited: true, incidentResult: null };
    }
  }

  // Cap tracker growth
  if (ingestRateTracker.size > 500) {
    for (const [k, v] of ingestRateTracker.entries()) {
      if (nowMs - v.windowStartMs >= INGEST_WINDOW_MS) {
        ingestRateTracker.delete(k);
      }
    }
  }

  const telemetryInput = payload.telemetry;
  await recordRuntimeTelemetry({
    recordedAt: telemetryInput?.recordedAt ?? new Date(nowMs).toISOString(),
    sourceComponent: safeComponent,
    metricType:
      telemetryInput?.metricType ??
      (safeDescription.toLowerCase().includes("hydration")
        ? "hydration_error"
        : safeDescription.toLowerCase().includes("/api/")
        ? "api_latency"
        : "ui_error"),
    latencyMs: telemetryInput?.latencyMs ?? null,
    memoryRssMb: telemetryInput?.memoryRssMb ?? null,
    heapUsedMb: telemetryInput?.heapUsedMb ?? null,
    eventLoopLagMs: telemetryInput?.eventLoopLagMs ?? null,
    ok: telemetryInput?.ok ?? false,
    detail: safeDescription,
    metadata: {
      ...safeMeta,
      routePath: payload.routePath ? redactSensitiveText(payload.routePath) : undefined,
      domain: payload.domain,
    },
  });

  const isHealthyTelemetryOnly = telemetryInput?.ok === true && !payload.severity;
  if (isHealthyTelemetryOnly) {
    return { telemetryRecorded: true, incidentResult: null };
  }

  const { severity, fingerprint, classification } = classifyIngestActionDefaults({
    ...payload,
    affectedComponent: safeComponent,
    errorDescription: safeDescription,
    stackTrace: safeTrace,
    metadata: safeMeta,
  });

  const initialStatus: IncidentStatus = classification.requiresHumanApproval
    ? "awaiting_approval"
    : "open";
  const initialApproval: ApprovalStatus = classification.requiresHumanApproval
    ? "pending_approval"
    : "not_required";

  const incidentResult = await upsertIncident({
    fingerprint,
    severity,
    domain: payload.domain,
    affectedComponent: safeComponent,
    affectedDataset: payload.affectedDataset ?? null,
    workerId: payload.workerId ?? null,
    providerId: payload.providerId ?? null,
    status: initialStatus,
    requiresHumanApproval: classification.requiresHumanApproval,
    approvalStatus: initialApproval,
    safeIdempotentAction: classification.safeIdempotentAction,
    errorDescription: safeDescription,
    redactedTrace: safeTrace,
    rootCause:
      classification.rootCause ??
      (classification.investigationSource === "insufficient_evidence"
        ? "Insufficient diagnostic evidence captured; inspect redacted client stack trace."
        : null),
    rootCauseVerified: classification.rootCauseVerified,
    investigationSource: classification.investigationSource,
    recommendedFix: classification.recommendedFix,
    regressionTestRef: classification.regressionTestRef,
    metadata: {
      ...safeMeta,
      routePath: payload.routePath ? redactSensitiveText(payload.routePath) : undefined,
    },
    timelineActor: "frontend-telemetry",
    timelineAction: "ingested",
    timelineDetail: `Telemetry captured from ${safeComponent}: ${safeDescription.slice(0, 180)}`,
  });

  return {
    telemetryRecorded: true,
    incidentResult,
  };
}

interface GeminiInvestigationResponse {
  insufficient_evidence?: boolean;
  root_cause?: string;
  recommended_fix?: string;
  confidence?: "high" | "medium" | "low";
  evidence_cited?: string[];
}

function parseGeminiInvestigationJson(raw: string): GeminiInvestigationResponse | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as GeminiInvestigationResponse;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Step 5: Investigates root cause deterministically first; invokes Gemini AI debugging agent ONLY
 * when evidence is unresolved & `allowAi` is enabled. Never invents root causes.
 */
export async function investigateIncidentRootCause(
  incidentId: string,
  options?: { allowAi?: boolean; actor?: string }
): Promise<SystemIncidentRecord | null> {
  assertServerOnly();
  const existing = await getIncidentById(incidentId);
  if (!existing) return null;

  const actor = options?.actor ?? "agent-7-debugger";
  const deterministic = classifyIncidentDeterministically(existing);

  if (deterministic.rootCauseVerified && deterministic.rootCause) {
    const updated = await updateIncident(existing.id, {
      rootCause: deterministic.rootCause,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix: deterministic.recommendedFix,
      requiresHumanApproval: deterministic.requiresHumanApproval,
      approvalStatus: deterministic.requiresHumanApproval
        ? existing.approvalStatus === "approved"
          ? "approved"
          : "pending_approval"
        : "not_required",
      safeIdempotentAction: deterministic.safeIdempotentAction,
      regressionTestRef: deterministic.regressionTestRef,
    });
    await appendIncidentTimeline(existing.id, {
      actor,
      action: "investigated_deterministic",
      detail: `Confirmed deterministic root cause: ${deterministic.rootCause}`,
    });
    return updated ?? getIncidentById(existing.id);
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!options?.allowAi || !geminiKey) {
    const updated = await updateIncident(existing.id, {
      rootCause:
        existing.rootCause ??
        "Insufficient evidence to deterministically confirm root cause (manual inspection required).",
      rootCauseVerified: false,
      investigationSource: "insufficient_evidence",
      recommendedFix: deterministic.recommendedFix,
      requiresHumanApproval: true,
      approvalStatus:
        existing.approvalStatus === "approved" ? "approved" : "pending_approval",
      safeIdempotentAction: "none",
      status:
        existing.status === "resolved" || existing.status === "dismissed"
          ? existing.status
          : "awaiting_approval",
    });
    await appendIncidentTimeline(existing.id, {
      actor,
      action: "investigation_insufficient_evidence",
      detail: options?.allowAi
        ? "AI debugger unconfigured (GEMINI_API_KEY unset) and deterministic rules found insufficient evidence."
        : "Deterministic classifier found insufficient evidence; no root cause fabricated.",
    });
    return updated ?? getIncidentById(existing.id);
  }

  // Strictly redact any prompt inputs before outbound Gemini call
  const evidencePayload = redactObjectSecrets({
    incidentId: existing.id,
    domain: existing.domain,
    severity: existing.severity,
    affectedComponent: existing.affectedComponent,
    affectedDataset: existing.affectedDataset,
    workerId: existing.workerId,
    providerId: existing.providerId,
    errorDescription: existing.errorDescription,
    redactedTrace: existing.redactedTrace?.slice(0, 1500) ?? null,
    metadata: existing.metadata,
  });

  const prompt = [
    "You are Agent 7 (Autonomous Reliability Debugger) for MacroEdge.",
    "Strictly analyze ONLY the JSON incident evidence below.",
    "RULES:",
    "1. NEVER invent or guess root causes, file paths, error codes, or values not present in the evidence.",
    '2. If the evidence is ambiguous or lacks stack/metric proof, return {"insufficient_evidence": true}.',
    "3. Output strict JSON with keys: insufficient_evidence (boolean), root_cause (string), recommended_fix (string), confidence (high|medium|low), evidence_cited (string[]).",
    `Evidence JSON: ${JSON.stringify(evidencePayload)}`,
  ].join("\n");

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      throw new Error(`Gemini API HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = parseGeminiInvestigationJson(rawText);

    if (!parsed || parsed.insufficient_evidence || !parsed.root_cause?.trim()) {
      const updated = await updateIncident(existing.id, {
        rootCause: "Insufficient evidence after AI trace inspection; manual review required.",
        rootCauseVerified: false,
        investigationSource: "insufficient_evidence",
        requiresHumanApproval: true,
        approvalStatus:
          existing.approvalStatus === "approved" ? "approved" : "pending_approval",
        safeIdempotentAction: "none",
      });
      await appendIncidentTimeline(existing.id, {
        actor: "ai-debugger",
        action: "ai_insufficient_evidence",
        detail: "Gemini debugger declined to speculate due to insufficient trace evidence.",
      });
      return updated ?? getIncidentById(existing.id);
    }

    const safeRootCause = redactSensitiveText(parsed.root_cause.trim());
    const safeFix = redactSensitiveText(
      parsed.recommended_fix?.trim() || existing.recommendedFix || deterministic.recommendedFix
    );

    const updated = await updateIncident(existing.id, {
      rootCause: safeRootCause,
      // AI hypotheses ALWAYS start unverified until concrete verification checks pass!
      rootCauseVerified: false,
      investigationSource: "ai_gemini",
      recommendedFix: safeFix,
      requiresHumanApproval: true,
      approvalStatus:
        existing.approvalStatus === "approved" ? "approved" : "pending_approval",
      status:
        existing.status === "resolved" || existing.status === "dismissed"
          ? existing.status
          : "awaiting_approval",
      safeIdempotentAction: "none",
      metadata: {
        ...existing.metadata,
        aiConfidence: parsed.confidence ?? "low",
        aiEvidenceCited: Array.isArray(parsed.evidence_cited)
          ? parsed.evidence_cited.map((s) => redactSensitiveText(String(s)))
          : [],
      },
    });
    await appendIncidentTimeline(existing.id, {
      actor: "ai-debugger",
      action: "ai_hypothesis_recorded",
      detail: `Gemini AI hypothesis (awaiting verification & human review): ${safeRootCause}`,
    });
    return updated ?? getIncidentById(existing.id);
  } catch (err) {
    const safeMsg = redactSensitiveText(
      err instanceof Error ? err.message : String(err)
    );
    await appendIncidentTimeline(existing.id, {
      actor: "ai-debugger",
      action: "ai_invocation_failed",
      detail: `AI investigation failed without hiding error: ${safeMsg}`,
    });
    return getIncidentById(existing.id);
  }
}

/**
 * Step 6 & 9 safety guard: Executes ONLY whitelisted safe, idempotent recovery actions,
 * never modifying schemas, never editing historical financial rows, and respecting human approval.
 */
export async function executeSafeIdempotentRecovery(
  incidentId: string,
  options?: { actor?: string }
): Promise<RecoveryExecutionResult> {
  assertServerOnly();
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    return { ok: false, blockedReason: "Incident not found", incident: null };
  }

  const actor = options?.actor ?? "agent-7-recovery";
  const action = incident.safeIdempotentAction ?? "none";

  if (incident.requiresHumanApproval && incident.approvalStatus !== "approved") {
    const updated = await updateIncident(incident.id, {
      status: "awaiting_approval",
      approvalStatus:
        incident.approvalStatus === "rejected" ? "rejected" : "pending_approval",
    });
    await appendIncidentTimeline(incident.id, {
      actor,
      action: "remediation_blocked",
      detail: `Blocked autonomous remediation (${action}) because incident requires human approval (status: ${incident.approvalStatus}).`,
    });
    return {
      ok: false,
      blockedReason: "Human approval is required before remediation can execute.",
      incident: updated ?? incident,
    };
  }

  if (action === "none" || !SAFE_IDEMPOTENT_ACTIONS.has(action)) {
    const updated = await updateIncident(incident.id, {
      status: "awaiting_approval",
    });
    await appendIncidentTimeline(incident.id, {
      actor,
      action: "remediation_blocked",
      detail: `No safe automated idempotent remediation registered for action="${action}". Manual fix required.`,
    });
    return {
      ok: false,
      blockedReason: `Action "${action}" is not in the safe idempotent remediation allowlist.`,
      incident: updated ?? incident,
    };
  }

  await updateIncident(incident.id, { status: "remediating" });
  await appendIncidentTimeline(incident.id, {
    actor,
    action: "remediation_started",
    detail: `Executing safe idempotent action: ${action}`,
  });

  try {
    if (action === "retry_sync_run") {
      const runId =
        typeof incident.metadata?.syncRunId === "string"
          ? incident.metadata.syncRunId
          : "";
      if (runId) {
        await retryDeadLetterRun(runId);
      } else {
        await runBackfillJob({
          workerId: (incident.workerId as WorkerId | null) ?? "macro-engine",
          providerId: (incident.providerId as ProviderId | null) ?? undefined,
          trigger: "recovery",
        });
      }
    } else if (action === "evaluate_staleness" || action === "reset_provider_backoff") {
      await evaluateSourceStaleness();
      if (incident.providerId) {
        const providerCfg = getAllProviderStatuses().find(
          (p) => p.providerId === incident.providerId
        );
        if (providerCfg?.configured) {
          await runBackfillJob({
            workerId: providerCfg.ownerWorker,
            providerId: providerCfg.providerId,
            trigger: "recovery",
          });
        }
      }
    } else if (action === "run_backfill_series") {
      await runBackfillJob({
        workerId: (incident.workerId as WorkerId | null) ?? "macro-engine",
        providerId: (incident.providerId as ProviderId | null) ?? undefined,
        seriesKeys: incident.affectedDataset ? [incident.affectedDataset] : undefined,
        trigger: "recovery",
      });
    } else if (action === "reconnect_market_daemon") {
      const { runMarketEngineCycle } = await import(
        "@/services/sync/workers/market-engine"
      );
      await runMarketEngineCycle({ trigger: "recovery" });
    } else if (action === "recompute_derived_metrics") {
      const { runLiquidityRiskEngineSync } = await import(
        "@/services/sync/workers/liquidity-risk-engine"
      );
      await runLiquidityRiskEngineSync({ trigger: "recovery" });
    } else if (action === "refresh_ai_insights") {
      const { runAiSupervisorCycle } = await import(
        "@/services/sync/workers/ai-supervisor"
      );
      await runAiSupervisorCycle({ trigger: "recovery" });
    } else if (action === "clear_stale_locks") {
      await evaluateSourceStaleness();
    }

    await appendIncidentTimeline(incident.id, {
      actor,
      action: "remediation_completed",
      detail: `Safe idempotent action ${action} executed; running recovery verification.`,
    });

    const verification = await verifyIncidentRecovery(incident.id, { actor });
    return {
      ok: verification.verified,
      incident: verification.incident,
      ...(verification.verified
        ? {}
        : { blockedReason: "Recovery action executed but post-check verification did not pass." }),
    };
  } catch (err) {
    const safeMsg = redactSensitiveText(
      err instanceof Error ? err.message : String(err)
    );
    const updated = await updateIncident(incident.id, {
      status: "open",
      redactedTrace: incident.redactedTrace
        ? `${incident.redactedTrace}\n[Recovery Error] ${safeMsg}`
        : safeMsg,
    });
    await appendIncidentTimeline(incident.id, {
      actor,
      action: "remediation_failed",
      detail: `Safe remediation ${action} threw an error: ${safeMsg}`,
    });
    return {
      ok: false,
      blockedReason: safeMsg,
      incident: updated ?? incident,
    };
  }
}

/**
 * Step 9: Runs real verification checks before allowing an incident to transition to `resolved`.
 */
export async function verifyIncidentRecovery(
  incidentId: string,
  options?: { actor?: string }
): Promise<RecoveryVerifyResult> {
  assertServerOnly();
  const incident = await getIncidentById(incidentId);
  if (!incident) return { verified: false, incident: null };

  const actor = options?.actor ?? "agent-7-verifier";
  const nowIso = new Date().toISOString();
  const checks: RecoveryCheckItem[] = [];

  if (incident.requiresHumanApproval && incident.approvalStatus !== "approved") {
    checks.push({
      name: "human_approval_gate",
      passed: false,
      detail: `Approval status is "${incident.approvalStatus}"; human sign-off required before resolution.`,
      checkedAt: nowIso,
    });
  } else {
    checks.push({
      name: "safety_approval_policy",
      passed: true,
      detail: incident.requiresHumanApproval
        ? "Human approval granted."
        : "Safe idempotent remediation policy satisfied.",
      checkedAt: nowIso,
    });
  }

  if (incident.domain === "sync" || incident.domain === "backend") {
    const syncSnapshot = await getSyncSystemSnapshot();
    const runId =
      typeof incident.metadata?.syncRunId === "string"
        ? incident.metadata.syncRunId
        : null;

    if (incident.fingerprint.startsWith("sync:stale-quote:")) {
      const quote = syncSnapshot.marketQuotes.find(
        (q) => q.symbol === incident.affectedDataset && q.sourceId === incident.providerId
      );
      const raw = quote?.rawPayload as Record<string, unknown> | undefined;
      const isRef = raw?.cachedFallback === true || raw?.mode === "reference";
      const ageMs = quote ? Date.now() - Date.parse(quote.quoteTimestamp) : Infinity;
      const maxStaleMs =
        incident.providerId === "yfinance" || incident.providerId === "api_ninjas"
          ? 86_400_000
          : 300_000;
      const quoteOk = Boolean(quote) && (isRef || (Number.isFinite(ageMs) && ageMs <= maxStaleMs));
      checks.push({
        name: "market_quote_freshness_check",
        passed: quoteOk,
        detail: quote
          ? `symbol=${quote.symbol} provider=${quote.sourceId} age=${Math.round(ageMs / 1000)}s isRef=${isRef}`
          : `No quote recorded for ${incident.affectedDataset} on ${incident.providerId}`,
        checkedAt: nowIso,
      });
    } else if (runId) {
      const origRun = syncSnapshot.recentRuns.find((r) => r.id === runId);
      const newerSuccess = syncSnapshot.recentRuns.find(
        (r) =>
          r.id !== runId &&
          r.workerId === (origRun?.workerId ?? incident.workerId) &&
          r.sourceId === (origRun?.sourceId ?? incident.providerId) &&
          r.status === "SUCCEEDED" &&
          (!origRun || r.startedAt >= origRun.startedAt)
      );
      const targetHealth = incident.providerId
        ? syncSnapshot.health.find((h) => h.id === `source:${incident.providerId}`)
        : null;
      const runRecovered =
        Boolean(newerSuccess) ||
        origRun?.status === "SUCCEEDED" ||
        targetHealth?.status === "CURRENT" ||
        targetHealth?.status === "LIVE";

      checks.push({
        name: "sync_run_recovery_check",
        passed: runRecovered,
        detail: runRecovered
          ? `Observed recovered sync run/health (${newerSuccess?.id ?? targetHealth?.status ?? "ok"}).`
          : `No successful recovery run observed yet for run ${runId}.`,
        checkedAt: nowIso,
      });
    } else if (incident.providerId) {
      const health = syncSnapshot.health.find(
        (h) => h.id === `source:${incident.providerId}`
      );
      const healthy =
        health?.status === "CURRENT" ||
        health?.status === "LIVE" ||
        (!isProviderConfigured(incident.providerId as ProviderId) &&
          health?.status === "DISCONNECTED");
      checks.push({
        name: "source_health_check",
        passed: healthy,
        detail: `source:${incident.providerId} status=${health?.status ?? "unknown"}`,
        checkedAt: nowIso,
      });
    } else if (incident.affectedComponent.includes("memory")) {
      const mem = getProcessMemoryStats();
      const memOk = mem.rssMb <= HIGH_MEMORY_RSS_MB;
      checks.push({
        name: "process_memory_check",
        passed: memOk,
        detail: `rss=${mem.rssMb}MB heap=${mem.heapUsedMb}MB (limit ${HIGH_MEMORY_RSS_MB}MB)`,
        checkedAt: nowIso,
      });
    } else if (incident.affectedComponent.includes("event-loop")) {
      const lag = await measureEventLoopLagMs();
      const lagOk = lag <= HIGH_EVENT_LOOP_LAG_MS;
      checks.push({
        name: "event_loop_lag_check",
        passed: lagOk,
        detail: `lag=${lag}ms (limit ${HIGH_EVENT_LOOP_LAG_MS}ms)`,
        checkedAt: nowIso,
      });
    }
  } else if (incident.domain === "database") {
    const start = Date.now();
    try {
      const latestValues = await getLatestValues();
      const latencyMs = Date.now() - start;
      const seriesPopulated = incident.affectedDataset
        ? latestValues.some((lv) => lv.seriesKey === incident.affectedDataset)
        : true;
      checks.push({
        name: "database_readonly_probe",
        passed: latencyMs <= SLOW_DB_QUERY_MS && seriesPopulated,
        detail: `Read probe completed in ${latencyMs}ms${incident.affectedDataset ? ` (series ${incident.affectedDataset} present: ${seriesPopulated})` : ""}`,
        checkedAt: nowIso,
      });
    } catch (err) {
      checks.push({
        name: "database_readonly_probe",
        passed: false,
        detail: redactSensitiveText(err instanceof Error ? err.message : String(err)),
        checkedAt: nowIso,
      });
    }
  } else {
    // Frontend errors require human approval (already checked above)
    checks.push({
      name: "frontend_telemetry_regression_check",
      passed:
        !incident.requiresHumanApproval || incident.approvalStatus === "approved",
      detail:
        incident.approvalStatus === "approved"
          ? "Code fix reviewed & approved by operator."
          : "Awaiting human review of client error fix.",
      checkedAt: nowIso,
    });
  }

  const verified = checks.length > 0 && checks.every((c) => c.passed);
  const recoveryVerification: RecoveryVerification = {
    verified,
    verifiedAt: nowIso,
    summary: verified
      ? `Verified recovery across ${checks.length}/${checks.length} check(s).`
      : `Verification failed (${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}).`,
    checks,
  };

  const nextStatus: IncidentStatus = verified
    ? "resolved"
    : incident.requiresHumanApproval && incident.approvalStatus !== "approved"
    ? "awaiting_approval"
    : "open";

  const updated = await updateIncident(incident.id, {
    status: nextStatus,
    recoveryVerification,
    rootCauseVerified: verified ? true : incident.rootCauseVerified,
    resolvedAt: verified ? nowIso : null,
  });

  await appendIncidentTimeline(incident.id, {
    actor,
    action: verified ? "recovery_verified" : "verification_failed",
    detail: recoveryVerification.summary,
  });

  return {
    verified,
    incident: updated ?? (await getIncidentById(incident.id)),
  };
}

/**
 * Unified operator / API action handler (`approve`, `reject`, `dismiss`, `remediate`, `investigate`, `resolve`, `reopen`).
 */
export async function handleIncidentAction(
  incidentId: string,
  payload: IncidentActionPayload
): Promise<IncidentActionOutcome> {
  assertServerOnly();
  const actor = redactSensitiveText(payload.actor?.trim() || "operator");
  const note = payload.note ? redactSensitiveText(payload.note.trim()) : "";
  const existing = await getIncidentById(incidentId);

  if (!existing) {
    return {
      ok: false,
      message: `Incident ${incidentId} not found`,
      incident: null,
      snapshot: await getIncidentDashboardSnapshot(),
    };
  }

  let ok = true;
  let message = "Action completed";
  let updated: SystemIncidentRecord | null = existing;

  switch (payload.action) {
    case "approve": {
      updated = await updateIncident(existing.id, {
        approvalStatus: "approved",
        status: existing.status === "awaiting_approval" ? "open" : existing.status,
      });
      await appendIncidentTimeline(existing.id, {
        actor,
        action: "human_approved",
        detail: note || "Human operator approved proposed remediation.",
      });
      message = `Approved remediation for ${existing.id}`;
      break;
    }
    case "reject": {
      updated = await updateIncident(existing.id, {
        approvalStatus: "rejected",
        status: "awaiting_approval",
      });
      await appendIncidentTimeline(existing.id, {
        actor,
        action: "human_rejected",
        detail: note || "Human operator rejected proposed fix.",
      });
      message = `Rejected fix for ${existing.id}`;
      break;
    }
    case "dismiss": {
      updated = await updateIncident(existing.id, {
        status: "dismissed",
      });
      await appendIncidentTimeline(existing.id, {
        actor,
        action: "dismissed",
        detail: note || "Incident dismissed by operator.",
      });
      message = `Dismissed ${existing.id}`;
      break;
    }
    case "reopen": {
      updated = await updateIncident(existing.id, {
        status: existing.requiresHumanApproval ? "awaiting_approval" : "open",
        resolvedAt: null,
      });
      await appendIncidentTimeline(existing.id, {
        actor,
        action: "reopened",
        detail: note || "Incident manually reopened.",
      });
      message = `Reopened ${existing.id}`;
      break;
    }
    case "investigate": {
      updated = await investigateIncidentRootCause(existing.id, {
        allowAi: true,
        actor,
      });
      message = `Completed investigation for ${existing.id}`;
      break;
    }
    case "remediate": {
      const rem = await executeSafeIdempotentRecovery(existing.id, { actor });
      ok = rem.ok;
      updated = rem.incident;
      message = rem.ok
        ? `Safe recovery & verification passed for ${existing.id}`
        : rem.blockedReason ?? `Recovery blocked for ${existing.id}`;
      break;
    }
    case "resolve": {
      const ver = await verifyIncidentRecovery(existing.id, { actor });
      ok = ver.verified;
      updated = ver.incident;
      message = ver.verified
        ? `Verified and resolved ${existing.id}`
        : `Verification failed; ${existing.id} remains ${ver.incident?.status ?? existing.status}`;
      break;
    }
    default: {
      ok = false;
      message = `Unsupported action: ${String(payload.action)}`;
    }
  }

  return {
    ok,
    message,
    incident: updated ?? (await getIncidentById(existing.id)),
    snapshot: await getIncidentDashboardSnapshot(),
  };
}

function findNewerSuccessForRun(
  failedRun: SyncRunRecord,
  recentRuns: SyncRunRecord[]
): SyncRunRecord | undefined {
  return recentRuns.find(
    (r) =>
      r.id !== failedRun.id &&
      r.status === "SUCCEEDED" &&
      r.workerId === failedRun.workerId &&
      r.sourceId === failedRun.sourceId &&
      (r.jobName === failedRun.jobName || Boolean(failedRun.sourceId)) &&
      r.startedAt >= failedRun.startedAt
  );
}

async function resolveSupersededSyncIncidents(
  recentRuns: SyncRunRecord[],
  activeIncidents: SystemIncidentRecord[]
): Promise<number> {
  let resolvedCount = 0;
  for (const inc of activeIncidents) {
    if (inc.domain !== "sync" || inc.status === "resolved" || inc.status === "dismissed") {
      continue;
    }
    const runId = typeof inc.metadata?.syncRunId === "string" ? inc.metadata.syncRunId : null;
    if (!runId) continue;
    const orig = recentRuns.find((r) => r.id === runId);
    if (orig && findNewerSuccessForRun(orig, recentRuns)) {
      const ver = await verifyIncidentRecovery(inc.id, { actor: "agent-7-monitor" });
      if (ver.verified) resolvedCount += 1;
    }
  }
  return resolvedCount;
}

function findDuplicateObservationKeys(observations: ObservationRecord[]): string[] {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const obs of observations) {
    const key = `${obs.seriesKey}|${obs.sourceId}|${obs.observationDate}|${obs.publishedAt}|rev${obs.revisionNumber}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) {
      duplicates.push(key);
    }
  }
  return duplicates;
}

function findDuplicateQuoteTimestamps(quotes: MarketQuoteRecord[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const q of quotes) {
    const key = `${q.symbol}|${q.sourceId}|${q.quoteTimestamp}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return duplicates;
}

async function probeSupabaseReadonlyLatency(
  supabase: SupabaseClient
): Promise<{ latencyMs: number; error: string | null }> {
  const start = Date.now();
  const { error } = await supabase
    .from("latest_values")
    .select("series_key", { count: "exact", head: true });
  return {
    latencyMs: Date.now() - start,
    error: error ? error.message : null,
  };
}

function evaluateHealthStalenessStatus(h: DataHealthRecord, nowMs: number): boolean {
  if (!h.sourceId) return false;
  if (!isProviderConfigured(h.sourceId)) return false;
  if (h.status === "STALE") return true;
  if (h.lastSuccessAt && h.entityType === "worker" && h.workerId === "orchestrator") {
    const ageSec = Math.floor((nowMs - Date.parse(h.lastSuccessAt)) / 1000);
    return Number.isFinite(ageSec) && ageSec > STALE_HEARTBEAT_LAG_SECONDS * 2;
  }
  return false;
}

/**
 * Continuously monitors Frontend, Backend, Database, and Sync health deterministically,
 * classifies any genuine issues, applies safe idempotent auto-remediation ONLY where permitted,
 * and records every incident + recovery verification cleanly.
 */
export async function runDeterministicMonitorSweep(
  options?: MonitorSweepOptions
): Promise<MonitorSweepResult> {
  assertServerOnly();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const actor = options?.actor ?? "agent-7-monitor";
  const autoRemediate = options?.autoRemediate ?? true;
  const invokeAi = Boolean(options?.invokeAi);

  const checksRun: SweepCheckItem[] = [];
  let incidentsDetected = 0;
  let incidentsDeduplicated = 0;
  let autoRemediatedCount = 0;
  let awaitingApprovalCount = 0;
  let resolvedCount = 0;
  let telemetryRecorded = 0;

  const detectedIncidentIds: string[] = [];

  const recordFinding = async (input: UpsertIncidentInput) => {
    const res = await upsertIncident({
      ...input,
      timelineActor: input.timelineActor ?? actor,
    });
    if (res.deduplicated) {
      incidentsDeduplicated += 1;
    } else {
      incidentsDetected += 1;
    }
    if (res.incident.status === "awaiting_approval") {
      awaitingApprovalCount += 1;
    }
    detectedIncidentIds.push(res.incident.id);
    return res;
  };

  // --- Gather core telemetry & sync snapshots ---
  const [recentTelemetry, syncSnapshot, existingIncidents] = await Promise.all([
    listRuntimeTelemetry({ limit: 80 }),
    getSyncSystemSnapshot(),
    listIncidents({ includeClosed: false, limit: 200 }),
  ]);

  // 1. FRONTEND MONITORING
  const feStart = Date.now();
  const recentFailedFe = recentTelemetry.filter(
    (t) =>
      !t.ok &&
      (t.metricType === "ui_error" ||
        t.metricType === "hydration_error" ||
        (t.metricType === "api_latency" && String(t.metadata?.domain ?? "") === "frontend"))
  );
  checksRun.push(
    buildMetricCheck(
      "frontend",
      "client_error_and_chart_telemetry",
      recentFailedFe.length === 0,
      recentFailedFe.length === 0
        ? "Zero unhandled React/chart/client errors in recent telemetry window."
        : `${recentFailedFe.length} client error telemetry event(s) captured.`,
      Date.now() - feStart
    )
  );

  // 2. BACKEND MONITORING (Memory, CPU, Event Loop Lag, WS Disconnects, API latency)
  const beStart = Date.now();
  const mem = getProcessMemoryStats();
  const cpuPercent = sampleCpuUsagePercent();
  const eventLoopLagMs = await measureEventLoopLagMs();
  const memHealthy = mem.rssMb <= HIGH_MEMORY_RSS_MB;
  const lagHealthy = eventLoopLagMs <= HIGH_EVENT_LOOP_LAG_MS;
  const cpuHealthy = cpuPercent <= 92;

  if (options?.includeTelemetry !== false) {
    await recordRuntimeTelemetry({
      sourceComponent: "node-runtime",
      metricType: "memory_rss",
      memoryRssMb: mem.rssMb,
      heapUsedMb: mem.heapUsedMb,
      eventLoopLagMs,
      ok: memHealthy && lagHealthy && cpuHealthy,
      detail: `rss=${mem.rssMb}MB heap=${mem.heapUsedMb}/${mem.heapTotalMb}MB cpu=${cpuPercent}% lag=${eventLoopLagMs}ms`,
      metadata: { cpuPercent },
    });
    telemetryRecorded += 1;
  }

  checksRun.push(
    buildMetricCheck(
      "backend",
      "memory_cpu_and_event_loop_health",
      memHealthy && lagHealthy && cpuHealthy,
      `RSS ${mem.rssMb}MB, Heap ${mem.heapUsedMb}MB, CPU ${cpuPercent}%, Event-loop lag ${eventLoopLagMs}ms`,
      Date.now() - beStart
    )
  );

  if (!memHealthy) {
    await recordFinding({
      fingerprint: "backend:high-memory-rss",
      severity: mem.rssMb > HIGH_MEMORY_RSS_MB * 1.5 ? "Critical" : "High",
      domain: "backend",
      affectedComponent: "node-runtime-memory",
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Backend process memory RSS (${mem.rssMb}MB) exceeded threshold (${HIGH_MEMORY_RSS_MB}MB).`,
      rootCause: `Process RSS measured ${mem.rssMb}MB (heap ${mem.heapUsedMb}/${mem.heapTotalMb}MB).`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Inspect active caches, WebSocket buffers, and worker concurrency before scaling memory or patching leaks.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
    });
  }

  if (!lagHealthy) {
    await recordFinding({
      fingerprint: "backend:high-event-loop-lag",
      severity: "High",
      domain: "backend",
      affectedComponent: "node-event-loop",
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Backend Node event-loop lag (${eventLoopLagMs}ms) exceeded ${HIGH_EVENT_LOOP_LAG_MS}ms threshold.`,
      rootCause: `Measured ${eventLoopLagMs}ms event-loop blocking latency.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Profile CPU-heavy synchronous computation or JSON parsing on the worker loop.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
    });
  }

  if (!cpuHealthy) {
    await recordFinding({
      fingerprint: "backend:high-cpu-utilization",
      severity: "High",
      domain: "backend",
      affectedComponent: "node-runtime-cpu",
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Backend Node CPU utilization (${cpuPercent}%) exceeded 92% threshold.`,
      rootCause: `Process CPU time ratio reached ${cpuPercent}% across sampling window.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Throttle concurrent worker polling intervals and inspect hot loops before scaling compute.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#extended-checks",
    });
  }

  // Slow/Failed API latency telemetry check
  const slowOrFailedApis = recentTelemetry.filter(
    (t) =>
      t.metricType === "api_latency" &&
      String(t.metadata?.domain ?? "") !== "frontend" &&
      (!t.ok || (t.latencyMs ?? 0) > SLOW_API_LATENCY_MS)
  );
  checksRun.push(
    buildMetricCheck(
      "backend",
      "api_endpoint_latency_and_errors",
      slowOrFailedApis.length === 0,
      slowOrFailedApis.length === 0
        ? "All tracked backend API telemetry healthy."
        : `${slowOrFailedApis.length} backend API failure/slow event(s).`,
      1
    )
  );
  for (const apiEvt of slowOrFailedApis.slice(0, 3)) {
    await recordFinding({
      fingerprint: `backend:api:${apiEvt.sourceComponent}:${apiEvt.ok ? "slow" : "err"}`,
      severity: apiEvt.ok ? "Medium" : "High",
      domain: "backend",
      affectedComponent: apiEvt.sourceComponent,
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription:
        apiEvt.detail ??
        `API degradation on ${apiEvt.sourceComponent} (${apiEvt.latencyMs ?? 0}ms)`,
      investigationSource: "deterministic",
      rootCause: `API handler ${apiEvt.sourceComponent} recorded latency=${apiEvt.latencyMs ?? 0}ms ok=${String(apiEvt.ok)}.`,
      rootCauseVerified: true,
      recommendedFix:
        "Inspect API route logs and downstream provider timeouts before modifying handler code.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
    });
  }

  // Active WS disconnection check (ONLY if a WS provider IS configured)
  const configuredWsDown = syncSnapshot.health.filter(
    (h) =>
      h.entityType === "source" &&
      h.sourceId &&
      isProviderConfigured(h.sourceId) &&
      (h.sourceId === "coinbase_ws" ||
        h.sourceId === "twelve_data_ws" ||
        h.sourceId === "finnhub_ws" ||
        h.sourceId === "polygon_ws") &&
      (h.status === "DISCONNECTED" || h.status === "FAILED" || h.status === "STALE")
  );
  checksRun.push(
    buildMetricCheck(
      "backend",
      "websocket_active_connections",
      configuredWsDown.length === 0,
      configuredWsDown.length === 0
        ? "All configured WebSocket streams healthy (unconfigured feeds cleanly DISCONNECTED)."
        : `${configuredWsDown.length} configured WebSocket stream(s) offline/stale.`,
      1
    )
  );
  for (const wsHealth of configuredWsDown) {
    await recordFinding({
      fingerprint: `backend:ws-disconnect:${wsHealth.sourceId}`,
      severity: wsHealth.status === "FAILED" ? "Critical" : "High",
      domain: "backend",
      affectedComponent: `market-ws:${wsHealth.sourceId}`,
      workerId: "market-engine",
      providerId: wsHealth.sourceId,
      status: "open",
      requiresHumanApproval: false,
      approvalStatus: "not_required",
      safeIdempotentAction: "reconnect_market_daemon",
      errorDescription: `Configured market WebSocket feed ${wsHealth.sourceId} is ${wsHealth.status}${wsHealth.lastError ? `: ${wsHealth.lastError}` : "."}`,
      rootCause: wsHealth.lastError
        ? `WebSocket stream ${wsHealth.sourceId} disconnected (${wsHealth.lastError}).`
        : `Configured WebSocket provider ${wsHealth.sourceId} lost heartbeat or failed connection.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Execute safe idempotent MarketWebSocketDaemon reconnect cycle.",
      regressionTestRef: "scripts/verify-sync-acceptance.mjs#test-1",
    });
  }

  // 3. DATABASE MONITORING (Strictly Read-Only!)
  const dbStart = Date.now();
  let dbProbeOk = true;
  let dbProbeDetail = "Read-only observation, latest_values & quote integrity checks passed.";
  try {
    const [latestValues, observations, quotes] = await Promise.all([
      getLatestValues(),
      getObservations(undefined, 2000),
      getMarketQuotes(),
    ]);

    const supabase = getSupabaseAdminClient();
    if (options?.runDbProbe !== false && supabase && isSupabaseAdminConfigured()) {
      const sbProbe = await probeSupabaseReadonlyLatency(supabase);
      if (sbProbe.error) {
        dbProbeOk = false;
        dbProbeDetail = `Supabase read probe failed: ${sbProbe.error}`;
        await recordFinding({
          fingerprint: "database:supabase-connection-error",
          severity: "Critical",
          domain: "database",
          affectedComponent: "supabase-postgres",
          status: "awaiting_approval",
          requiresHumanApproval: true,
          approvalStatus: "pending_approval",
          safeIdempotentAction: "none",
          errorDescription: `Supabase connection/query failed: ${sbProbe.error}`,
          rootCause: `Supabase admin read failed with error: ${sbProbe.error}`,
          rootCauseVerified: true,
          investigationSource: "deterministic",
          recommendedFix:
            "Check Supabase availability, service-role key validity, and RLS/table health.",
          regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
        });
      } else if (sbProbe.latencyMs > SLOW_DB_QUERY_MS) {
        dbProbeOk = false;
        dbProbeDetail = `Supabase slow read probe (${sbProbe.latencyMs}ms > ${SLOW_DB_QUERY_MS}ms)`;
        await recordFinding({
          fingerprint: "database:slow-read-probe",
          severity: "Medium",
          domain: "database",
          affectedComponent: "supabase-postgres:latest_values",
          status: "awaiting_approval",
          requiresHumanApproval: true,
          approvalStatus: "pending_approval",
          safeIdempotentAction: "none",
          errorDescription: dbProbeDetail,
          rootCause: `Query latency to latest_values measured ${sbProbe.latencyMs}ms.`,
          rootCauseVerified: true,
          investigationSource: "deterministic",
          recommendedFix:
            "Review database CPU/connections and table indexes; require human approval for schema changes.",
          regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
        });
      }
    }

    // Duplicate record & monotonic conflict check (read-only)
    const dupObs = findDuplicateObservationKeys(observations);
    const dupQuotes = findDuplicateQuoteTimestamps(quotes);
    const dbAnomalies = syncSnapshot.anomalies.filter(
      (a) =>
        !a.resolved &&
        (a.anomalyType === "NON_MONOTONIC_REJECTED" ||
          a.anomalyType === "SCHEMA_MISMATCH" ||
          a.message.toLowerCase().includes("monotonic"))
    );

    if (dupObs.length > 0 || dupQuotes.length > 0 || dbAnomalies.length > 0) {
      dbProbeOk = false;
      dbProbeDetail = `Detected duplicate/monotonic integrity alerts (obsDupes=${dupObs.length}, quoteDupes=${dupQuotes.length}, anomalies=${dbAnomalies.length}).`;
      await recordFinding({
        fingerprint: "database:duplicate-or-monotonic-integrity",
        severity: "High",
        domain: "database",
        affectedComponent: "data_observations/market_quotes",
        status: "awaiting_approval",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        errorDescription: dbProbeDetail,
        redactedTrace: JSON.stringify({
          sampleDupObs: dupObs.slice(0, 3),
          sampleDupQuotes: dupQuotes.slice(0, 3),
          anomalies: dbAnomalies.slice(0, 3).map((a) => a.message),
        }),
        rootCause:
          "Duplicate observation/quote keys or monotonic timestamp guard rejections observed in store.",
        rootCauseVerified: true,
        investigationSource: "deterministic",
        recommendedFix:
          "Investigate upstream feed timestamps and SQL unique constraints; NEVER delete historical financial rows automatically.",
        regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
      });
    }

    // Read-only historical consistency check: verify latest_values matches newest validated observation
    const obsBySeries = new Map<string, ObservationRecord[]>();
    for (const obs of observations) {
      if (obs.validationStatus !== "VALIDATED") continue;
      const list = obsBySeries.get(obs.seriesKey) ?? [];
      list.push(obs);
      obsBySeries.set(obs.seriesKey, list);
    }
    const historicalDriftSeries: string[] = [];
    for (const lv of latestValues) {
      const seriesObs = obsBySeries.get(lv.seriesKey);
      if (!seriesObs || seriesObs.length === 0) continue;
      const sorted = [...seriesObs].sort((a, b) => {
        if (b.observationDate !== a.observationDate) {
          return b.observationDate.localeCompare(a.observationDate);
        }
        if (b.publishedAt !== a.publishedAt) {
          return b.publishedAt.localeCompare(a.publishedAt);
        }
        return b.revisionNumber - a.revisionNumber;
      });
      const expectedLatest = sorted[0];
      if (
        expectedLatest.observationDate !== lv.observationDate ||
        Math.abs(expectedLatest.value - lv.value) > 1e-6
      ) {
        historicalDriftSeries.push(
          `${lv.seriesKey}(latest=${lv.observationDate}:${lv.value}, obs=${expectedLatest.observationDate}:${expectedLatest.value})`
        );
      }
    }
    if (historicalDriftSeries.length > 0) {
      dbProbeOk = false;
      dbProbeDetail = `Detected historical snapshot drift in latest_values vs data_observations: ${historicalDriftSeries.slice(0, 3).join("; ")}`;
      await recordFinding({
        fingerprint: "database:historical-latest-drift",
        severity: "Critical",
        domain: "database",
        affectedComponent: "latest_values/data_observations",
        status: "awaiting_approval",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        errorDescription: dbProbeDetail,
        rootCause:
          "latest_values diverged from the newest validated observation vintage in data_observations.",
        rootCauseVerified: true,
        investigationSource: "deterministic",
        recommendedFix:
          "Audit monotonic upsert RPC & historical vintages with human approval before reconciling latest_values.",
        regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
      });
    }

    // Missing observations check ONLY after at least one macro-engine run succeeded
    const macroRanSuccess = syncSnapshot.recentRuns.some(
      (r) => r.workerId === "macro-engine" && r.status === "SUCCEEDED"
    );
    if (macroRanSuccess && latestValues.length > 0) {
      const presentKeys = new Set(latestValues.map((lv) => lv.seriesKey));
      const expectedKeys = MACRO_SERIES_MAPPINGS.filter(
        (m) =>
          m.seriesKey !== "ISM_MFG" &&
          m.seriesKey !== "ISM_SVC" &&
          isProviderConfigured(m.primaryProvider) &&
          Boolean(getSeriesMapping(m.seriesKey))
      ).map((m) => m.seriesKey);
      const missingKeys = expectedKeys.filter((k) => !presentKeys.has(k));
      if (missingKeys.length > 0) {
        dbProbeOk = false;
        dbProbeDetail = `Missing ${missingKeys.length} expected series in latest_values: ${missingKeys.slice(0, 5).join(", ")}`;
        await recordFinding({
          fingerprint: `database:missing-series:${missingKeys.slice(0, 4).join(",")}`,
          severity: "Medium",
          domain: "database",
          affectedComponent: "latest_values",
          affectedDataset: missingKeys[0],
          workerId: "macro-engine",
          status: "open",
          requiresHumanApproval: false,
          approvalStatus: "not_required",
          safeIdempotentAction: "run_backfill_series",
          errorDescription: dbProbeDetail,
          rootCause: `macro-engine succeeded previously, but ${missingKeys.length} configured non-proprietary series have no row in latest_values.`,
          rootCauseVerified: true,
          investigationSource: "deterministic",
          recommendedFix:
            "Execute safe series backfill via macro-engine without touching existing historical rows.",
          regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
        });
      }
    }

    if (options?.includeTelemetry !== false) {
      await recordRuntimeTelemetry({
        sourceComponent: "database-integrity-probe",
        metricType: "db_query",
        latencyMs: Date.now() - dbStart,
        ok: dbProbeOk,
        detail: dbProbeDetail,
      });
      telemetryRecorded += 1;
    }
  } catch (err) {
    dbProbeOk = false;
    dbProbeDetail = err instanceof Error ? err.message : String(err);
    await recordFinding({
      fingerprint: "database:readonly-probe-exception",
      severity: "Critical",
      domain: "database",
      affectedComponent: "sync-persistence-store",
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Database integrity probe failed: ${redactSensitiveText(dbProbeDetail)}`,
      redactedTrace: err instanceof Error ? err.stack ?? dbProbeDetail : dbProbeDetail,
      rootCause: `Database store read threw an unhandled error: ${redactSensitiveText(dbProbeDetail)}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Inspect Supabase/local store file permissions and schema migration state.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#db-integrity",
    });
  }
  checksRun.push(
    buildMetricCheck(
      "database",
      "readonly_integrity_and_latency",
      dbProbeOk,
      dbProbeDetail,
      Date.now() - dbStart
    )
  );

  // 4. DATA SYNCHRONIZATION MONITORING
  const syncStart = Date.now();
  const unrecoveredFailures = syncSnapshot.recentRuns.filter(
    (run) =>
      (run.status === "FAILED" || run.status === "DEAD_LETTER") &&
      !findNewerSuccessForRun(run, syncSnapshot.recentRuns)
  );
  const staleHealth = syncSnapshot.health.filter((h) =>
    evaluateHealthStalenessStatus(h, startedAtMs)
  );
  const openSyncAnomalies = syncSnapshot.anomalies.filter(
    (a) =>
      !a.resolved &&
      a.severity !== "INFO" &&
      a.anomalyType !== "NON_MONOTONIC_REJECTED" &&
      a.anomalyType !== "SCHEMA_MISMATCH"
  );

  // Check for stale configured market quotes using provider-appropriate cadence thresholds
  const staleQuotes = syncSnapshot.marketQuotes.filter((q) => {
    if (!isProviderConfigured(q.sourceId)) return false;
    const raw = q.rawPayload as Record<string, unknown> | undefined;
    if (raw?.cachedFallback === true || raw?.mode === "reference") return false;
    const ageMs = startedAtMs - Date.parse(q.quoteTimestamp);
    const maxStaleMs =
      q.sourceId === "fred" || q.sourceId === "fed_reserve"
        ? 7 * 86_400_000
        : q.sourceId === "yfinance" || q.sourceId === "api_ninjas"
        ? 86_400_000
        : 300_000;
    return Number.isFinite(ageMs) && ageMs > maxStaleMs;
  });

  const runningJobs = syncSnapshot.recentRuns.filter((r) => r.status === "RUNNING");
  const runningCounts = new Map<string, SyncRunRecord[]>();
  for (const r of runningJobs) {
    const key = `${r.workerId}:${r.sourceId ?? "none"}:${r.jobName}`;
    const arr = runningCounts.get(key) ?? [];
    arr.push(r);
    runningCounts.set(key, arr);
  }
  const duplicateOrHungRuns = runningJobs.filter((r) => {
    const key = `${r.workerId}:${r.sourceId ?? "none"}:${r.jobName}`;
    const ageMs = startedAtMs - Date.parse(r.startedAt);
    return (runningCounts.get(key)?.length ?? 0) > 1 || (Number.isFinite(ageMs) && ageMs > 180_000);
  });

  const syncClean =
    unrecoveredFailures.length === 0 &&
    staleHealth.length === 0 &&
    openSyncAnomalies.length === 0 &&
    staleQuotes.length === 0 &&
    duplicateOrHungRuns.length === 0;

  checksRun.push(
    buildMetricCheck(
      "sync",
      "sync_runs_health_and_anomalies",
      syncClean,
      syncClean
        ? "Zero unrecovered sync failures, stale prices/feeds, duplicate jobs, or open normalization anomalies."
        : `failures=${unrecoveredFailures.length}, staleFeeds=${staleHealth.length}, staleQuotes=${staleQuotes.length}, dupHungJobs=${duplicateOrHungRuns.length}, anomalies=${openSyncAnomalies.length}`,
      Date.now() - syncStart
    )
  );

  for (const q of staleQuotes.slice(0, 4)) {
    const ageSec = Math.round((startedAtMs - Date.parse(q.quoteTimestamp)) / 1000);
    await recordFinding({
      fingerprint: `sync:stale-quote:${q.symbol}:${q.sourceId}`,
      severity: "High",
      domain: "sync",
      affectedComponent: `market-quote:${q.symbol}`,
      affectedDataset: q.symbol,
      workerId: "market-engine",
      providerId: q.sourceId,
      status: "open",
      requiresHumanApproval: false,
      approvalStatus: "not_required",
      safeIdempotentAction: "reconnect_market_daemon",
      errorDescription: `Stale market price for ${q.symbol} on ${q.sourceId} (age=${ageSec}s).`,
      rootCause: `Market quote ${q.symbol} from configured provider ${q.sourceId} has not updated for ${ageSec}s.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix: "Reconnect MarketWebSocketDaemon or run safe market quote refresh cycle.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#sync-stale-and-dupes",
    });
  }

  for (const dupRun of duplicateOrHungRuns.slice(0, 4)) {
    await recordFinding({
      fingerprint: `sync:duplicate-or-hung:${dupRun.workerId}:${dupRun.jobName}`,
      severity: "High",
      domain: "sync",
      affectedComponent: `sync-lock:${dupRun.workerId}`,
      affectedDataset: dupRun.jobName,
      workerId: dupRun.workerId,
      providerId: dupRun.sourceId,
      status: "open",
      requiresHumanApproval: false,
      approvalStatus: "not_required",
      safeIdempotentAction: "clear_stale_locks",
      errorDescription: `Duplicate or hung RUNNING sync job detected (${dupRun.jobName}, started ${dupRun.startedAt}).`,
      rootCause: `Found overlapping or stale RUNNING entry for ${dupRun.jobName}.`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix: "Re-evaluate orchestrator locks and stale source health.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#sync-stale-and-dupes",
    });
  }

  for (const run of unrecoveredFailures.slice(0, 6)) {
    const providerHealth = run.sourceId
      ? syncSnapshot.health.find((h) => h.id === `source:${run.sourceId}`)
      : null;
    const isCritical =
      run.status === "DEAD_LETTER" &&
      (providerHealth?.consecutiveFailures ?? 0) >= 3;

    const classification = classifyIncidentDeterministically({
      domain: "sync",
      affectedComponent: `sync-worker:${run.workerId}`,
      affectedDataset: run.sourceId ?? null,
      workerId: run.workerId,
      providerId: run.sourceId,
      errorDescription: run.errorMessage ?? `Sync run ${run.status}`,
      redactedTrace: null,
      metadata: { syncRunId: run.id },
    });

    await recordFinding({
      fingerprint: `sync:failed-run:${run.workerId}:${run.sourceId ?? "none"}:${run.jobName}`,
      severity: isCritical ? "Critical" : "High",
      domain: "sync",
      affectedComponent: `worker:${run.workerId}`,
      affectedDataset: run.sourceId ?? run.jobName,
      workerId: run.workerId,
      providerId: run.sourceId,
      status: classification.requiresHumanApproval ? "awaiting_approval" : "open",
      requiresHumanApproval: classification.requiresHumanApproval,
      approvalStatus: classification.requiresHumanApproval
        ? "pending_approval"
        : "not_required",
      safeIdempotentAction: classification.safeIdempotentAction,
      errorDescription: `Sync run ${run.id} ended in ${run.status} (attempt ${run.attempt}/${run.maxAttempts}): ${run.errorMessage ?? "No error summary recorded."}`,
      redactedTrace: JSON.stringify({
        syncRunId: run.id,
        triggerType: run.triggerType,
        attempt: run.attempt,
        maxAttempts: run.maxAttempts,
        rawPayload: redactObjectSecrets(run.rawPayload),
      }),
      rootCause: classification.rootCause,
      rootCauseVerified: classification.rootCauseVerified,
      investigationSource: classification.investigationSource,
      recommendedFix: classification.recommendedFix,
      regressionTestRef: classification.regressionTestRef,
      metadata: {
        syncRunId: run.id,
        jobName: run.jobName,
      },
    });
  }

  for (const health of staleHealth.slice(0, 5)) {
    await recordFinding({
      fingerprint: `sync:stale-source:${health.id}`,
      severity: "Medium",
      domain: "sync",
      affectedComponent: health.id,
      affectedDataset: health.sourceId,
      workerId: health.workerId,
      providerId: health.sourceId,
      status: "open",
      requiresHumanApproval: false,
      approvalStatus: "not_required",
      safeIdempotentAction: "evaluate_staleness",
      errorDescription: `Configured data source ${health.id} is STALE (age=${health.freshnessSeconds ?? "unknown"}s).`,
      rootCause: `Source ${health.id} exceeded expected staleness interval (${health.freshnessSeconds ?? "unknown"}s).`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Re-evaluate cadence freshness and dispatch safe idempotent provider sync.",
      regressionTestRef: "scripts/verify-sync-acceptance.mjs#test-7",
    });
  }

  for (const anomaly of openSyncAnomalies.slice(0, 6)) {
    const anomalyTyped: DataAnomalyRecord = anomaly;
    const requiresApproval =
      anomalyTyped.anomalyType === "OUTLIER_SPIKE" ||
      anomalyTyped.anomalyType === "MISSING_FIELD";

    await recordFinding({
      fingerprint: `sync:anomaly:${anomalyTyped.seriesKey}:${anomalyTyped.anomalyType}`,
      severity:
        anomalyTyped.severity === "CRITICAL"
          ? "Critical"
          : anomalyTyped.severity === "ERROR"
          ? "High"
          : "Medium",
      domain: "sync",
      affectedComponent: `validation:${anomalyTyped.seriesKey}`,
      affectedDataset: anomalyTyped.seriesKey,
      workerId: anomalyTyped.workerId ?? "validation-recovery",
      providerId: anomalyTyped.sourceId,
      status: requiresApproval ? "awaiting_approval" : "open",
      requiresHumanApproval: requiresApproval,
      approvalStatus: requiresApproval ? "pending_approval" : "not_required",
      safeIdempotentAction: requiresApproval ? "none" : "run_backfill_series",
      errorDescription: `[${anomalyTyped.anomalyType}] ${anomalyTyped.message}`,
      redactedTrace: JSON.stringify({
        anomalyId: anomalyTyped.id,
        observedValue: anomalyTyped.observedValue,
        expectedRange: anomalyTyped.expectedRange,
        rawPayload: redactObjectSecrets(anomalyTyped.rawPayload),
      }),
      rootCause: `Validation engine triggered ${anomalyTyped.anomalyType} on ${anomalyTyped.seriesKey}: ${anomalyTyped.message}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix: requiresApproval
        ? "Verify upstream release unit/value manually before modifying or re-normalizing series data."
        : "Run idempotent series backfill check.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#sync-anomalies",
      metadata: {
        anomalyId: anomalyTyped.id,
        anomalyType: anomalyTyped.anomalyType,
      },
    });
  }

  // Auto-resolve any sync incidents whose underlying run/source subsequently recovered cleanly
  resolvedCount += await resolveSupersededSyncIncidents(
    syncSnapshot.recentRuns,
    existingIncidents
  );

  // Optionally invoke AI investigation + safe idempotent remediation on newly opened/eligible items
  const uniqueTargetIds = Array.from(new Set(detectedIncidentIds));
  for (const incId of uniqueTargetIds) {
    const cur = await getIncidentById(incId);
    if (!cur || cur.status === "resolved" || cur.status === "dismissed") continue;

    if (invokeAi && !cur.rootCauseVerified) {
      await investigateIncidentRootCause(cur.id, { allowAi: true, actor });
    }

    const latestInc = await getIncidentById(incId);
    const lastAutoMs =
      typeof latestInc?.metadata?.lastAutoRemediationAt === "string"
        ? Date.parse(latestInc.metadata.lastAutoRemediationAt)
        : NaN;
    const cooldownActive =
      Number.isFinite(lastAutoMs) && Date.now() - lastAutoMs < 120_000;

    if (
      autoRemediate &&
      !cooldownActive &&
      latestInc &&
      !latestInc.requiresHumanApproval &&
      latestInc.safeIdempotentAction &&
      latestInc.safeIdempotentAction !== "none" &&
      latestInc.status === "open"
    ) {
      await updateIncident(latestInc.id, {
        metadata: {
          ...latestInc.metadata,
          lastAutoRemediationAt: new Date().toISOString(),
        },
      });
      const rem = await executeSafeIdempotentRecovery(latestInc.id, { actor });
      if (rem.ok) {
        autoRemediatedCount += 1;
        resolvedCount += 1;
      }
    }
  }

  const finishedAtMs = Date.now();
  return {
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    incidentsDetected,
    incidentsDeduplicated,
    autoRemediatedCount,
    awaitingApprovalCount,
    resolvedCount,
    telemetryRecorded,
    checksRun,
  };
}

let workerMonitorsInstalled = false;

/**
 * Attaches backend process crash & unhandled rejection telemetry recorders to standalone workers.
 * Never swallows errors or fakes clean exits on uncaught exceptions.
 */
export function installWorkerProcessMonitors(
  workerName = "macroedge-sync-worker"
): () => void {
  assertServerOnly();
  if (workerMonitorsInstalled) {
    return () => {};
  }
  workerMonitorsInstalled = true;

  const onUncaughtException = (err: Error) => {
    const safeMsg = redactSensitiveText(err?.message || "Uncaught exception");
    const safeTrace = redactSensitiveText(err?.stack || safeMsg);
    console.error(`[Agent7 Monitor][${workerName}] uncaughtException:`, safeMsg);

    void Promise.allSettled([
      recordRuntimeTelemetry({
        sourceComponent: workerName,
        metricType: "worker_tick",
        ok: false,
        detail: `uncaughtException: ${safeMsg}`,
      }),
      upsertIncident({
        fingerprint: `backend:worker-crash:${workerName}:${safeMsg.slice(0, 64)}`,
        severity: "Critical",
        domain: "backend",
        affectedComponent: workerName,
        status: "awaiting_approval",
        requiresHumanApproval: true,
        approvalStatus: "pending_approval",
        safeIdempotentAction: "none",
        errorDescription: `Worker ${workerName} uncaughtException: ${safeMsg}`,
        redactedTrace: safeTrace,
        rootCause: `Unhandled runtime exception in ${workerName}: ${safeMsg}`,
        rootCauseVerified: true,
        investigationSource: "deterministic",
        recommendedFix:
          "Inspect redacted crash stack trace and patch unhandled throw before restarting worker.",
        regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
      }),
    ]).finally(() => {
      process.exit(1);
    });
  };

  const onUnhandledRejection = (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : msg;
    const safeMsg = redactSensitiveText(msg);
    console.error(`[Agent7 Monitor][${workerName}] unhandledRejection:`, safeMsg);

    void upsertIncident({
      fingerprint: `backend:unhandled-rejection:${workerName}:${safeMsg.slice(0, 64)}`,
      severity: "High",
      domain: "backend",
      affectedComponent: workerName,
      status: "awaiting_approval",
      requiresHumanApproval: true,
      approvalStatus: "pending_approval",
      safeIdempotentAction: "none",
      errorDescription: `Worker ${workerName} unhandledRejection: ${safeMsg}`,
      redactedTrace: redactSensitiveText(stack ?? safeMsg),
      rootCause: `Unhandled promise rejection in ${workerName}: ${safeMsg}`,
      rootCauseVerified: true,
      investigationSource: "deterministic",
      recommendedFix:
        "Ensure async worker errors are explicitly handled or surfaced through executeWithRetry.",
      regressionTestRef: "scripts/verify-agent7-incidents.mjs#backend-health",
    }).catch(() => {});
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  return () => {
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
    workerMonitorsInstalled = false;
  };
}
