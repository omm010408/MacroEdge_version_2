// Strictly server-side persistence store for MacroEdge Phase 3 incident response
// and runtime telemetry. Uses Supabase Postgres (service_role) when configured and
// falls back cleanly to a mutex-locked durable atomic JSON file store locally.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { redactObjectSecrets, redactSensitiveText } from "@/lib/incidents/redact";
import type {
  AppendTimelineEventInput,
  ApprovalStatus,
  IncidentCountsSummary,
  IncidentDashboardSnapshot,
  IncidentDomain,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEvent,
  InvestigationSource,
  ListIncidentsOptions,
  ListTelemetryOptions,
  RecordTelemetryInput,
  RecoveryVerification,
  RuntimeTelemetryMetricType,
  RuntimeTelemetryRecord,
  SafeRemediationAction,
  SystemIncidentRecord,
  UpdateIncidentPatch,
  UpsertIncidentInput,
  UpsertIncidentResult,
} from "@/lib/incidents/types";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

const DEFAULT_LOCAL_STATE_FILE = ".macroedge-incidents-state.json";
const MAX_TIMELINE_EVENTS = 100;
const MAX_LOCAL_INCIDENTS = 250;
const MAX_LOCAL_TELEMETRY_SAMPLES = 400;
const MAX_SUPABASE_TELEMETRY_KEEP = 1000;
const TELEMETRY_PRUNE_INTERVAL = 50;

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

const CLOSED_STATUSES = new Set<IncidentStatus>(["resolved", "dismissed"]);

interface LocalIncidentState {
  stateFilePath: string;
  incidents: SystemIncidentRecord[];
  telemetry: RuntimeTelemetryRecord[];
}

const globalIncidentStore = globalThis as typeof globalThis & {
  __macroedgeIncidentState?: LocalIncidentState;
  __macroedgeIncidentLock?: Promise<void>;
  __macroedgeIncidentTelemetryWriteCount?: number;
};

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/services/incidents/store.ts is strictly server-side and cannot run in the browser."
    );
  }
}

function resolveStateFilePath(): string {
  const override = process.env.MACROEDGE_INCIDENT_STATE_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), DEFAULT_LOCAL_STATE_FILE);
}

function createEmptyLocalState(stateFilePath: string): LocalIncidentState {
  return {
    stateFilePath,
    incidents: [],
    telemetry: [],
  };
}

function isReadOnlyFsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}

function normalizeIsoTimestamp(value?: string | null): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function newerIso(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return normalizeIsoTimestamp(b);
  if (!Number.isFinite(tb)) return normalizeIsoTimestamp(a);
  return tb >= ta ? new Date(tb).toISOString() : new Date(ta).toISOString();
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? redactSensitiveText(trimmed) : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return redactObjectSecrets(value as Record<string, unknown>);
}

function sanitizeFingerprint(input: UpsertIncidentInput): string {
  const trimmed = redactSensitiveText(input.fingerprint.trim());
  if (trimmed.length > 0) {
    return trimmed.slice(0, 240);
  }
  const digest = crypto
    .createHash("sha256")
    .update(
      `${input.domain}:${input.affectedComponent}:${redactSensitiveText(
        input.errorDescription
      )}`
    )
    .digest("hex")
    .slice(0, 16);
  return `auto:${input.domain}:${digest}`;
}

function sanitizeTimelineEvents(events: unknown): IncidentTimelineEvent[] {
  if (!Array.isArray(events)) return [];
  const parsed: IncidentTimelineEvent[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    parsed.push({
      id:
        typeof item.id === "string" && item.id.trim().length > 0
          ? item.id
          : crypto.randomUUID(),
      timestamp: normalizeIsoTimestamp(
        typeof item.timestamp === "string" ? item.timestamp : null
      ),
      actor: redactSensitiveText(
        typeof item.actor === "string" && item.actor.trim().length > 0
          ? item.actor.trim()
          : "system"
      ),
      action: redactSensitiveText(
        typeof item.action === "string" && item.action.trim().length > 0
          ? item.action.trim()
          : "event"
      ),
      detail: redactSensitiveText(
        typeof item.detail === "string" ? item.detail : ""
      ),
      metadata:
        item.metadata && typeof item.metadata === "object"
          ? redactObjectSecrets(item.metadata as Record<string, unknown>)
          : undefined,
    });
  }
  return capTimelineEvents(parsed);
}

function capTimelineEvents(
  events: IncidentTimelineEvent[]
): IncidentTimelineEvent[] {
  if (events.length <= MAX_TIMELINE_EVENTS) {
    return events;
  }
  // Keep the initial detection event + the latest events for full diagnostic context.
  return [events[0], ...events.slice(-(MAX_TIMELINE_EVENTS - 1))];
}

function createTimelineEvent(
  input: AppendTimelineEventInput
): IncidentTimelineEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: normalizeIsoTimestamp(input.timestamp),
    actor: redactSensitiveText(input.actor.trim() || "system"),
    action: redactSensitiveText(input.action.trim() || "event"),
    detail: redactSensitiveText(input.detail.trim()),
    metadata: input.metadata
      ? redactObjectSecrets(input.metadata)
      : undefined,
  };
}

function generateIncidentId(
  existingIds: Set<string>,
  detectedAtIso: string
): string {
  const parsed = Date.parse(detectedAtIso);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const yyyymmdd = date.toISOString().slice(0, 10).replaceAll("-", "");

  for (let attempt = 0; attempt < 16; attempt++) {
    const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
    const candidate = `INC-${yyyymmdd}-${suffix}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `INC-${yyyymmdd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function sortIncidentsForOperations(
  incidents: SystemIncidentRecord[]
): SystemIncidentRecord[] {
  return [...incidents].sort((a, b) => {
    const aClosed = CLOSED_STATUSES.has(a.status) ? 1 : 0;
    const bClosed = CLOSED_STATUSES.has(b.status) ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;

    if (aClosed === 0) {
      const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sevDiff !== 0) return sevDiff;
    }

    return Date.parse(b.lastDetectedAt) - Date.parse(a.lastDetectedAt);
  });
}

function capLocalIncidents(
  incidents: SystemIncidentRecord[]
): SystemIncidentRecord[] {
  const sorted = sortIncidentsForOperations(incidents);
  if (sorted.length <= MAX_LOCAL_INCIDENTS) {
    return sorted;
  }
  return sorted.slice(0, MAX_LOCAL_INCIDENTS);
}

function capLocalTelemetry(
  samples: RuntimeTelemetryRecord[]
): RuntimeTelemetryRecord[] {
  return [...samples]
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
    .slice(0, MAX_LOCAL_TELEMETRY_SAMPLES);
}

async function withLocalLock<T>(operation: () => Promise<T>): Promise<T> {
  const prev = globalIncidentStore.__macroedgeIncidentLock ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalIncidentStore.__macroedgeIncidentLock = prev.then(() => next);
  await prev;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function loadLocalState(): Promise<LocalIncidentState> {
  const filePath = resolveStateFilePath();
  const cached = globalIncidentStore.__macroedgeIncidentState;
  if (cached && cached.stateFilePath === filePath) {
    return cached;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalIncidentState>;
    const hydrated: LocalIncidentState = {
      stateFilePath: filePath,
      incidents: Array.isArray(parsed.incidents)
        ? capLocalIncidents(parsed.incidents.map(sanitizeIncidentRecord))
        : [],
      telemetry: Array.isArray(parsed.telemetry)
        ? capLocalTelemetry(parsed.telemetry.map(sanitizeTelemetryRecord))
        : [],
    };
    globalIncidentStore.__macroedgeIncidentState = hydrated;
    return hydrated;
  } catch {
    const empty = createEmptyLocalState(filePath);
    globalIncidentStore.__macroedgeIncidentState = empty;
    return empty;
  }
}

async function saveLocalState(state: LocalIncidentState): Promise<void> {
  state.incidents = capLocalIncidents(state.incidents);
  state.telemetry = capLocalTelemetry(state.telemetry);
  globalIncidentStore.__macroedgeIncidentState = state;

  const payload = JSON.stringify(
    {
      incidents: state.incidents,
      telemetry: state.telemetry,
    },
    null,
    2
  );

  const filePath = state.stateFilePath;
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(tmpPath, payload, "utf8");
        await fs.rename(tmpPath, filePath);
        return;
      } catch (retryErr) {
        if (isReadOnlyFsError(retryErr)) return;
        throw retryErr;
      }
    }
    if (isReadOnlyFsError(err)) {
      return;
    }
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function sanitizeRecoveryVerification(
  value: unknown
): RecoveryVerification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = redactObjectSecrets(value as Record<string, unknown>);
  const rawChecks = Array.isArray(raw.checks) ? raw.checks : [];
  return {
    verified: Boolean(raw.verified),
    verifiedAt: normalizeIsoTimestamp(
      typeof raw.verifiedAt === "string" ? raw.verifiedAt : null
    ),
    summary: redactSensitiveText(
      typeof raw.summary === "string" ? raw.summary : ""
    ),
    checks: rawChecks
      .filter((c) => c && typeof c === "object")
      .map((c) => {
        const entry = c as Record<string, unknown>;
        return {
          name: redactSensitiveText(
            typeof entry.name === "string" ? entry.name : "check"
          ),
          passed: Boolean(entry.passed),
          detail: redactSensitiveText(
            typeof entry.detail === "string" ? entry.detail : ""
          ),
          checkedAt: normalizeIsoTimestamp(
            typeof entry.checkedAt === "string" ? entry.checkedAt : null
          ),
        };
      }),
  };
}

function sanitizeIncidentRecord(
  record: SystemIncidentRecord
): SystemIncidentRecord {
  return {
    id: record.id,
    fingerprint: redactSensitiveText(record.fingerprint),
    severity: record.severity,
    domain: record.domain,
    affectedComponent: redactSensitiveText(record.affectedComponent),
    affectedDataset: toNullableString(record.affectedDataset),
    workerId: toNullableString(record.workerId),
    providerId: toNullableString(record.providerId),
    status: record.status,
    approvalStatus: record.approvalStatus,
    requiresHumanApproval: Boolean(record.requiresHumanApproval),
    safeIdempotentAction: record.safeIdempotentAction ?? null,
    firstDetectedAt: normalizeIsoTimestamp(record.firstDetectedAt),
    lastDetectedAt: normalizeIsoTimestamp(record.lastDetectedAt),
    occurrenceCount: Math.max(1, Number(record.occurrenceCount || 1)),
    errorDescription: redactSensitiveText(record.errorDescription),
    redactedTrace: toNullableString(record.redactedTrace),
    rootCause: toNullableString(record.rootCause),
    rootCauseVerified: Boolean(record.rootCauseVerified),
    investigationSource: record.investigationSource,
    recommendedFix: toNullableString(record.recommendedFix),
    regressionTestRef: toNullableString(record.regressionTestRef),
    recoveryVerification: sanitizeRecoveryVerification(
      record.recoveryVerification
    ),
    timeline: sanitizeTimelineEvents(record.timeline),
    metadata: toRecord(record.metadata),
    resolvedAt: record.resolvedAt
      ? normalizeIsoTimestamp(record.resolvedAt)
      : null,
    updatedAt: normalizeIsoTimestamp(record.updatedAt),
  };
}

function sanitizeTelemetryRecord(
  record: RuntimeTelemetryRecord
): RuntimeTelemetryRecord {
  return {
    id: record.id,
    recordedAt: normalizeIsoTimestamp(record.recordedAt),
    sourceComponent: redactSensitiveText(record.sourceComponent),
    metricType: record.metricType,
    latencyMs: toNullableNumber(record.latencyMs),
    memoryRssMb: toNullableNumber(record.memoryRssMb),
    heapUsedMb: toNullableNumber(record.heapUsedMb),
    eventLoopLagMs: toNullableNumber(record.eventLoopLagMs),
    ok: Boolean(record.ok),
    detail: toNullableString(record.detail),
    metadata: toRecord(record.metadata),
  };
}

function mapIncidentRow(row: Record<string, unknown>): SystemIncidentRecord {
  return sanitizeIncidentRecord({
    id: String(row.id ?? ""),
    fingerprint: String(row.fingerprint ?? ""),
    severity: (row.severity as IncidentSeverity) ?? "Medium",
    domain: (row.domain as IncidentDomain) ?? "backend",
    affectedComponent: String(row.affected_component ?? "unknown"),
    affectedDataset:
      typeof row.affected_dataset === "string" ? row.affected_dataset : null,
    workerId: typeof row.worker_id === "string" ? row.worker_id : null,
    providerId: typeof row.provider_id === "string" ? row.provider_id : null,
    status: (row.status as IncidentStatus) ?? "open",
    approvalStatus: (row.approval_status as ApprovalStatus) ?? "not_required",
    requiresHumanApproval: Boolean(row.requires_human_approval),
    safeIdempotentAction:
      typeof row.safe_idempotent_action === "string"
        ? (row.safe_idempotent_action as SafeRemediationAction)
        : null,
    firstDetectedAt: String(row.first_detected_at ?? new Date().toISOString()),
    lastDetectedAt: String(row.last_detected_at ?? new Date().toISOString()),
    occurrenceCount: Math.max(1, Number(row.occurrence_count ?? 1)),
    errorDescription: String(row.error_description ?? ""),
    redactedTrace:
      typeof row.redacted_trace === "string" ? row.redacted_trace : null,
    rootCause: typeof row.root_cause === "string" ? row.root_cause : null,
    rootCauseVerified: Boolean(row.root_cause_verified),
    investigationSource:
      (row.investigation_source as InvestigationSource) ??
      "insufficient_evidence",
    recommendedFix:
      typeof row.recommended_fix === "string" ? row.recommended_fix : null,
    regressionTestRef:
      typeof row.regression_test_ref === "string"
        ? row.regression_test_ref
        : null,
    recoveryVerification:
      (row.recovery_verification as RecoveryVerification | null) ?? null,
    timeline: Array.isArray(row.timeline)
      ? (row.timeline as IncidentTimelineEvent[])
      : [],
    metadata: toRecord(row.metadata),
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  });
}

function mapIncidentRecordToRow(
  record: SystemIncidentRecord
): Record<string, unknown> {
  const safe = sanitizeIncidentRecord(record);
  return {
    id: safe.id,
    fingerprint: safe.fingerprint,
    severity: safe.severity,
    domain: safe.domain,
    affected_component: safe.affectedComponent,
    affected_dataset: safe.affectedDataset,
    worker_id: safe.workerId,
    provider_id: safe.providerId,
    status: safe.status,
    approval_status: safe.approvalStatus,
    requires_human_approval: safe.requiresHumanApproval,
    safe_idempotent_action: safe.safeIdempotentAction,
    first_detected_at: safe.firstDetectedAt,
    last_detected_at: safe.lastDetectedAt,
    occurrence_count: safe.occurrenceCount,
    error_description: safe.errorDescription,
    redacted_trace: safe.redactedTrace,
    root_cause: safe.rootCause,
    root_cause_verified: safe.rootCauseVerified,
    investigation_source: safe.investigationSource,
    recommended_fix: safe.recommendedFix,
    regression_test_ref: safe.regressionTestRef,
    recovery_verification: safe.recoveryVerification,
    timeline: safe.timeline,
    metadata: safe.metadata,
    resolved_at: safe.resolvedAt,
    updated_at: safe.updatedAt,
  };
}

function mapTelemetryRow(row: Record<string, unknown>): RuntimeTelemetryRecord {
  return sanitizeTelemetryRecord({
    id: String(row.id ?? crypto.randomUUID()),
    recordedAt: String(row.recorded_at ?? new Date().toISOString()),
    sourceComponent: String(row.source_component ?? "unknown"),
    metricType: (row.metric_type as RuntimeTelemetryMetricType) ?? "api_latency",
    latencyMs: toNullableNumber(row.latency_ms),
    memoryRssMb: toNullableNumber(row.memory_rss_mb),
    heapUsedMb: toNullableNumber(row.heap_used_mb),
    eventLoopLagMs: toNullableNumber(row.event_loop_lag_ms),
    ok: row.ok === undefined ? true : Boolean(row.ok),
    detail: typeof row.detail === "string" ? row.detail : null,
    metadata: toRecord(row.metadata),
  });
}

function buildUpdatedIncidentOnRecurrence(
  existing: SystemIncidentRecord,
  input: UpsertIncidentInput
): UpsertIncidentResult {
  const nowIso = new Date().toISOString();
  const detectedAtIso = normalizeIsoTimestamp(input.detectedAt ?? nowIso);
  const redactedError = redactSensitiveText(input.errorDescription.trim());
  const redactedTrace = toNullableString(input.redactedTrace);
  const mergedMetadata = {
    ...existing.metadata,
    ...toRecord(input.metadata),
  };

  if (!CLOSED_STATUSES.has(existing.status)) {
    const nextSeverity =
      SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity]
        ? input.severity
        : existing.severity;
    const nextOccurrenceCount = existing.occurrenceCount + 1;

    const dedupEvent = createTimelineEvent({
      timestamp: detectedAtIso,
      actor: input.timelineActor ?? "incident-detector",
      action: input.timelineAction ?? "deduplicated",
      detail:
        input.timelineDetail ??
        `Recurring detection #${nextOccurrenceCount}: ${redactedError}`,
      metadata: {
        occurrenceCount: nextOccurrenceCount,
        severity: nextSeverity,
      },
    });

    const updated = sanitizeIncidentRecord({
      ...existing,
      severity: nextSeverity,
      affectedDataset:
        existing.affectedDataset ?? toNullableString(input.affectedDataset),
      workerId: existing.workerId ?? toNullableString(input.workerId),
      providerId: existing.providerId ?? toNullableString(input.providerId),
      lastDetectedAt: newerIso(existing.lastDetectedAt, detectedAtIso),
      occurrenceCount: nextOccurrenceCount,
      errorDescription: redactedError || existing.errorDescription,
      redactedTrace: redactedTrace ?? existing.redactedTrace,
      rootCause: toNullableString(input.rootCause) ?? existing.rootCause,
      rootCauseVerified:
        input.rootCauseVerified ?? existing.rootCauseVerified,
      investigationSource:
        input.investigationSource ?? existing.investigationSource,
      recommendedFix:
        toNullableString(input.recommendedFix) ?? existing.recommendedFix,
      regressionTestRef:
        toNullableString(input.regressionTestRef) ??
        existing.regressionTestRef,
      recoveryVerification:
        input.recoveryVerification !== undefined
          ? input.recoveryVerification
          : existing.recoveryVerification,
      timeline: capTimelineEvents([...existing.timeline, dedupEvent]),
      metadata: mergedMetadata,
      updatedAt: nowIso,
    });

    return {
      incident: updated,
      deduplicated: true,
      reopened: false,
    };
  }

  // Reopen closed/resolved incident cleanly rather than violating unique(fingerprint).
  const nextOccurrenceCount = existing.occurrenceCount + 1;
  const requiresHumanApproval =
    input.requiresHumanApproval ?? existing.requiresHumanApproval;
  const nextApprovalStatus: ApprovalStatus =
    input.approvalStatus ??
    (requiresHumanApproval ? "pending_approval" : "not_required");

  const reopenEvent = createTimelineEvent({
    timestamp: detectedAtIso,
    actor: input.timelineActor ?? "incident-detector",
    action: "reopened",
    detail:
      input.timelineDetail ??
      `Reopened previously ${existing.status} incident on recurrence #${nextOccurrenceCount}: ${redactedError}`,
    metadata: {
      previousStatus: existing.status,
      occurrenceCount: nextOccurrenceCount,
    },
  });

  const reopened = sanitizeIncidentRecord({
    ...existing,
    severity: input.severity,
    domain: input.domain,
    affectedComponent: redactSensitiveText(input.affectedComponent),
    affectedDataset:
      toNullableString(input.affectedDataset) ?? existing.affectedDataset,
    workerId: toNullableString(input.workerId) ?? existing.workerId,
    providerId: toNullableString(input.providerId) ?? existing.providerId,
    status: input.status ?? "open",
    approvalStatus: nextApprovalStatus,
    requiresHumanApproval,
    safeIdempotentAction:
      input.safeIdempotentAction !== undefined
        ? input.safeIdempotentAction
        : existing.safeIdempotentAction,
    lastDetectedAt: newerIso(existing.lastDetectedAt, detectedAtIso),
    occurrenceCount: nextOccurrenceCount,
    errorDescription: redactedError || existing.errorDescription,
    redactedTrace: redactedTrace ?? existing.redactedTrace,
    rootCause: toNullableString(input.rootCause),
    rootCauseVerified: Boolean(input.rootCauseVerified),
    investigationSource:
      input.investigationSource ?? "insufficient_evidence",
    recommendedFix: toNullableString(input.recommendedFix),
    regressionTestRef:
      toNullableString(input.regressionTestRef) ?? existing.regressionTestRef,
    recoveryVerification: input.recoveryVerification ?? null,
    timeline: capTimelineEvents([...existing.timeline, reopenEvent]),
    metadata: mergedMetadata,
    resolvedAt: null,
    updatedAt: nowIso,
  });

  return {
    incident: reopened,
    deduplicated: false,
    reopened: true,
  };
}

function buildNewIncidentRecord(
  input: UpsertIncidentInput,
  fingerprint: string,
  existingIds: Set<string>
): SystemIncidentRecord {
  const nowIso = new Date().toISOString();
  const detectedAtIso = normalizeIsoTimestamp(input.detectedAt ?? nowIso);
  const redactedError = redactSensitiveText(input.errorDescription.trim());
  const requiresHumanApproval = Boolean(input.requiresHumanApproval);
  const status: IncidentStatus = input.status ?? "open";
  const approvalStatus: ApprovalStatus =
    input.approvalStatus ??
    (requiresHumanApproval ? "pending_approval" : "not_required");

  const initialEvent = createTimelineEvent({
    timestamp: detectedAtIso,
    actor: input.timelineActor ?? "incident-detector",
    action: input.timelineAction ?? "detected",
    detail: input.timelineDetail ?? redactedError,
    metadata: {
      severity: input.severity,
      domain: input.domain,
      affectedComponent: redactSensitiveText(input.affectedComponent),
    },
  });

  return sanitizeIncidentRecord({
    id: generateIncidentId(existingIds, detectedAtIso),
    fingerprint,
    severity: input.severity,
    domain: input.domain,
    affectedComponent: input.affectedComponent,
    affectedDataset: input.affectedDataset ?? null,
    workerId: input.workerId ?? null,
    providerId: input.providerId ?? null,
    status,
    approvalStatus,
    requiresHumanApproval,
    safeIdempotentAction: input.safeIdempotentAction ?? null,
    firstDetectedAt: detectedAtIso,
    lastDetectedAt: detectedAtIso,
    occurrenceCount: 1,
    errorDescription: redactedError,
    redactedTrace: input.redactedTrace ?? null,
    rootCause: input.rootCause ?? null,
    rootCauseVerified: Boolean(input.rootCauseVerified),
    investigationSource:
      input.investigationSource ?? "insufficient_evidence",
    recommendedFix: input.recommendedFix ?? null,
    regressionTestRef: input.regressionTestRef ?? null,
    recoveryVerification: input.recoveryVerification ?? null,
    timeline: [initialEvent],
    metadata: input.metadata ?? {},
    resolvedAt:
      status === "resolved" ? nowIso : null,
    updatedAt: nowIso,
  });
}

function applyIncidentPatch(
  existing: SystemIncidentRecord,
  patch: UpdateIncidentPatch
): SystemIncidentRecord {
  const nowIso = new Date().toISOString();
  const nextStatus = patch.status ?? existing.status;

  let nextResolvedAt = existing.resolvedAt;
  if (patch.resolvedAt !== undefined) {
    nextResolvedAt = patch.resolvedAt
      ? normalizeIsoTimestamp(patch.resolvedAt)
      : null;
  } else if (nextStatus === "resolved" && !existing.resolvedAt) {
    nextResolvedAt = nowIso;
  } else if (!CLOSED_STATUSES.has(nextStatus)) {
    nextResolvedAt = null;
  }

  return sanitizeIncidentRecord({
    ...existing,
    severity: patch.severity ?? existing.severity,
    affectedComponent: patch.affectedComponent ?? existing.affectedComponent,
    affectedDataset:
      patch.affectedDataset !== undefined
        ? patch.affectedDataset
        : existing.affectedDataset,
    workerId:
      patch.workerId !== undefined ? patch.workerId : existing.workerId,
    providerId:
      patch.providerId !== undefined ? patch.providerId : existing.providerId,
    status: nextStatus,
    approvalStatus: patch.approvalStatus ?? existing.approvalStatus,
    requiresHumanApproval:
      patch.requiresHumanApproval !== undefined
        ? patch.requiresHumanApproval
        : existing.requiresHumanApproval,
    safeIdempotentAction:
      patch.safeIdempotentAction !== undefined
        ? patch.safeIdempotentAction
        : existing.safeIdempotentAction,
    lastDetectedAt: patch.lastDetectedAt
      ? normalizeIsoTimestamp(patch.lastDetectedAt)
      : existing.lastDetectedAt,
    errorDescription: patch.errorDescription ?? existing.errorDescription,
    redactedTrace:
      patch.redactedTrace !== undefined
        ? patch.redactedTrace
        : existing.redactedTrace,
    rootCause:
      patch.rootCause !== undefined ? patch.rootCause : existing.rootCause,
    rootCauseVerified:
      patch.rootCauseVerified !== undefined
        ? patch.rootCauseVerified
        : existing.rootCauseVerified,
    investigationSource:
      patch.investigationSource ?? existing.investigationSource,
    recommendedFix:
      patch.recommendedFix !== undefined
        ? patch.recommendedFix
        : existing.recommendedFix,
    regressionTestRef:
      patch.regressionTestRef !== undefined
        ? patch.regressionTestRef
        : existing.regressionTestRef,
    recoveryVerification:
      patch.recoveryVerification !== undefined
        ? patch.recoveryVerification
        : existing.recoveryVerification,
    metadata: patch.metadata
      ? { ...existing.metadata, ...toRecord(patch.metadata) }
      : existing.metadata,
    resolvedAt: nextResolvedAt,
    updatedAt: nowIso,
  });
}

function filterIncidentsList(
  incidents: SystemIncidentRecord[],
  options?: ListIncidentsOptions
): SystemIncidentRecord[] {
  const statusFilter = options?.status
    ? Array.isArray(options.status)
      ? new Set(options.status)
      : new Set([options.status])
    : null;

  const includeClosed = options?.includeClosed ?? true;
  const limit = Math.max(1, options?.limit ?? 100);

  const filtered = incidents.filter((item) => {
    if (statusFilter && !statusFilter.has(item.status)) return false;
    if (!statusFilter && !includeClosed && CLOSED_STATUSES.has(item.status)) {
      return false;
    }
    if (options?.domain && item.domain !== options.domain) return false;
    if (options?.severity && item.severity !== options.severity) return false;
    return true;
  });

  return sortIncidentsForOperations(filtered).slice(0, limit);
}

function computeIncidentCounts(
  incidents: SystemIncidentRecord[]
): IncidentCountsSummary {
  const counts: IncidentCountsSummary = {
    total: incidents.length,
    open: 0,
    investigating: 0,
    remediating: 0,
    awaitingApproval: 0,
    resolved: 0,
    dismissed: 0,
    criticalOpen: 0,
    byDomain: {
      frontend: 0,
      backend: 0,
      database: 0,
      sync: 0,
    },
  };

  for (const incident of incidents) {
    counts.byDomain[incident.domain] =
      (counts.byDomain[incident.domain] ?? 0) + 1;

    switch (incident.status) {
      case "open":
        counts.open += 1;
        break;
      case "investigating":
        counts.investigating += 1;
        break;
      case "remediating":
        counts.remediating += 1;
        break;
      case "awaiting_approval":
        counts.awaitingApproval += 1;
        break;
      case "resolved":
        counts.resolved += 1;
        break;
      case "dismissed":
        counts.dismissed += 1;
        break;
    }

    if (
      incident.severity === "Critical" &&
      !CLOSED_STATUSES.has(incident.status)
    ) {
      counts.criticalOpen += 1;
    }
  }

  return counts;
}

async function maybePruneSupabaseTelemetry(): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const count = (globalIncidentStore.__macroedgeIncidentTelemetryWriteCount ?? 0) + 1;
  globalIncidentStore.__macroedgeIncidentTelemetryWriteCount = count;
  if (count % TELEMETRY_PRUNE_INTERVAL !== 0) {
    return;
  }

  const { data } = await supabase
    .from("runtime_telemetry_samples")
    .select("recorded_at")
    .order("recorded_at", { ascending: false })
    .range(MAX_SUPABASE_TELEMETRY_KEEP, MAX_SUPABASE_TELEMETRY_KEEP);

  const cutoffRow = data?.[0] as { recorded_at?: string } | undefined;
  if (!cutoffRow?.recorded_at) return;

  await supabase
    .from("runtime_telemetry_samples")
    .delete()
    .lt("recorded_at", cutoffRow.recorded_at);
}

export async function upsertIncident(
  input: UpsertIncidentInput
): Promise<UpsertIncidentResult> {
  assertServerOnly();
  const fingerprint = sanitizeFingerprint(input);
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    const { data: existingRow, error: lookupError } = await supabase
      .from("system_incidents")
      .select("*")
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    if (lookupError) {
      throw new Error(
        `Failed to query system_incidents by fingerprint: ${lookupError.message}`
      );
    }

    if (existingRow) {
      const existing = mapIncidentRow(existingRow as Record<string, unknown>);
      const next = buildUpdatedIncidentOnRecurrence(existing, input);
      const { data: updatedRow, error: updateError } = await supabase
        .from("system_incidents")
        .update(mapIncidentRecordToRow(next.incident))
        .eq("id", existing.id)
        .select("*")
        .single();

      if (updateError || !updatedRow) {
        throw new Error(
          `Failed to update deduplicated incident ${existing.id}: ${
            updateError?.message ?? "no row returned"
          }`
        );
      }

      return {
        incident: mapIncidentRow(updatedRow as Record<string, unknown>),
        deduplicated: next.deduplicated,
        reopened: next.reopened,
      };
    }

    const newRecord = buildNewIncidentRecord(
      input,
      fingerprint,
      new Set<string>()
    );
    const { data: insertedRow, error: insertError } = await supabase
      .from("system_incidents")
      .insert(mapIncidentRecordToRow(newRecord))
      .select("*")
      .single();

    if (!insertError && insertedRow) {
      return {
        incident: mapIncidentRow(insertedRow as Record<string, unknown>),
        deduplicated: false,
        reopened: false,
      };
    }

    // Handle concurrent insert conflict on unique(fingerprint)
    if (insertError && insertError.code === "23505") {
      const { data: raceRow, error: raceError } = await supabase
        .from("system_incidents")
        .select("*")
        .eq("fingerprint", fingerprint)
        .maybeSingle();
      if (raceRow && !raceError) {
        const existing = mapIncidentRow(raceRow as Record<string, unknown>);
        const next = buildUpdatedIncidentOnRecurrence(existing, input);
        const { data: resolvedRaceRow, error: raceUpdateErr } = await supabase
          .from("system_incidents")
          .update(mapIncidentRecordToRow(next.incident))
          .eq("id", existing.id)
          .select("*")
          .single();
        if (resolvedRaceRow && !raceUpdateErr) {
          return {
            incident: mapIncidentRow(
              resolvedRaceRow as Record<string, unknown>
            ),
            deduplicated: next.deduplicated,
            reopened: next.reopened,
          };
        }
      }
    }

    throw new Error(
      `Failed to insert incident: ${insertError?.message ?? "unknown error"}`
    );
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    const index = state.incidents.findIndex(
      (item) => item.fingerprint === fingerprint
    );

    if (index >= 0) {
      const next = buildUpdatedIncidentOnRecurrence(
        state.incidents[index],
        input
      );
      state.incidents[index] = next.incident;
      await saveLocalState(state);
      return next;
    }

    const existingIds = new Set(state.incidents.map((item) => item.id));
    const created = buildNewIncidentRecord(input, fingerprint, existingIds);
    state.incidents.unshift(created);
    await saveLocalState(state);
    return {
      incident: created,
      deduplicated: false,
      reopened: false,
    };
  });
}

export async function updateIncident(
  id: string,
  patch: UpdateIncidentPatch
): Promise<SystemIncidentRecord | null> {
  assertServerOnly();
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    const existing = await getIncidentById(id);
    if (!existing) return null;

    const updated = applyIncidentPatch(existing, patch);
    const { data, error } = await supabase
      .from("system_incidents")
      .update(mapIncidentRecordToRow(updated))
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to update incident ${id}: ${error?.message ?? "no row"}`
      );
    }
    return mapIncidentRow(data as Record<string, unknown>);
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    const index = state.incidents.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const updated = applyIncidentPatch(state.incidents[index], patch);
    state.incidents[index] = updated;
    await saveLocalState(state);
    return updated;
  });
}

export async function getIncidentById(
  id: string
): Promise<SystemIncidentRecord | null> {
  assertServerOnly();
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    const { data, error } = await supabase
      .from("system_incidents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch incident ${id}: ${error.message}`);
    }
    return data ? mapIncidentRow(data as Record<string, unknown>) : null;
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    return state.incidents.find((item) => item.id === id) ?? null;
  });
}

export async function listIncidents(
  options?: ListIncidentsOptions
): Promise<SystemIncidentRecord[]> {
  assertServerOnly();
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    let query = supabase
      .from("system_incidents")
      .select("*")
      .order("last_detected_at", { ascending: false })
      .limit(Math.max(100, options?.limit ?? 100));

    if (options?.domain) {
      query = query.eq("domain", options.domain);
    }
    if (options?.severity) {
      query = query.eq("severity", options.severity);
    }
    if (options?.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      query = query.in("status", statuses);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list incidents: ${error.message}`);
    }

    const rows = (data ?? []).map((row) =>
      mapIncidentRow(row as Record<string, unknown>)
    );
    return filterIncidentsList(rows, options);
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    return filterIncidentsList(state.incidents, options);
  });
}

export async function appendIncidentTimeline(
  id: string,
  event: AppendTimelineEventInput
): Promise<SystemIncidentRecord | null> {
  assertServerOnly();
  const nextEvent = createTimelineEvent(event);
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    const existing = await getIncidentById(id);
    if (!existing) return null;

    const timeline = capTimelineEvents([...existing.timeline, nextEvent]);
    const { data, error } = await supabase
      .from("system_incidents")
      .update({
        timeline,
        updated_at: nowIso,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to append timeline for incident ${id}: ${
          error?.message ?? "no row"
        }`
      );
    }
    return mapIncidentRow(data as Record<string, unknown>);
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    const index = state.incidents.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const existing = state.incidents[index];
    const updated = sanitizeIncidentRecord({
      ...existing,
      timeline: capTimelineEvents([...existing.timeline, nextEvent]),
      updatedAt: nowIso,
    });
    state.incidents[index] = updated;
    await saveLocalState(state);
    return updated;
  });
}

export async function recordRuntimeTelemetry(
  input: RecordTelemetryInput
): Promise<RuntimeTelemetryRecord> {
  assertServerOnly();

  const record = sanitizeTelemetryRecord({
    id: crypto.randomUUID(),
    recordedAt: normalizeIsoTimestamp(input.recordedAt),
    sourceComponent: input.sourceComponent,
    metricType: input.metricType,
    latencyMs: toNullableNumber(input.latencyMs),
    memoryRssMb: toNullableNumber(input.memoryRssMb),
    heapUsedMb: toNullableNumber(input.heapUsedMb),
    eventLoopLagMs: toNullableNumber(input.eventLoopLagMs),
    ok: input.ok ?? true,
    detail: input.detail ?? null,
    metadata: input.metadata ?? {},
  });

  const supabase = getSupabaseAdminClient();
  if (supabase && isSupabaseAdminConfigured()) {
    const { data, error } = await supabase
      .from("runtime_telemetry_samples")
      .insert({
        id: record.id,
        recorded_at: record.recordedAt,
        source_component: record.sourceComponent,
        metric_type: record.metricType,
        latency_ms: record.latencyMs,
        memory_rss_mb: record.memoryRssMb,
        heap_used_mb: record.heapUsedMb,
        event_loop_lag_ms: record.eventLoopLagMs,
        ok: record.ok,
        detail: record.detail,
        metadata: record.metadata,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to record runtime telemetry: ${error?.message ?? "no row"}`
      );
    }

    await maybePruneSupabaseTelemetry().catch(() => {});
    return mapTelemetryRow(data as Record<string, unknown>);
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    state.telemetry.unshift(record);
    state.telemetry = capLocalTelemetry(state.telemetry);
    await saveLocalState(state);
    return record;
  });
}

export async function listRuntimeTelemetry(
  options?: ListTelemetryOptions
): Promise<RuntimeTelemetryRecord[]> {
  assertServerOnly();
  const limit = Math.max(1, options?.limit ?? 100);
  const supabase = getSupabaseAdminClient();

  if (supabase && isSupabaseAdminConfigured()) {
    let query = supabase
      .from("runtime_telemetry_samples")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(limit);

    if (options?.metricType) {
      query = query.eq("metric_type", options.metricType);
    }
    if (options?.sourceComponent) {
      query = query.eq("source_component", options.sourceComponent);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list runtime telemetry: ${error.message}`);
    }

    return (data ?? []).map((row) =>
      mapTelemetryRow(row as Record<string, unknown>)
    );
  }

  return withLocalLock(async () => {
    const state = await loadLocalState();
    return capLocalTelemetry(state.telemetry)
      .filter((sample) => {
        if (options?.metricType && sample.metricType !== options.metricType) {
          return false;
        }
        if (
          options?.sourceComponent &&
          sample.sourceComponent !== options.sourceComponent
        ) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  });
}

export async function getIncidentDashboardSnapshot(options?: {
  incidentLimit?: number;
  telemetryLimit?: number;
}): Promise<IncidentDashboardSnapshot> {
  assertServerOnly();
  const incidentLimit = Math.max(1, options?.incidentLimit ?? 150);
  const telemetryLimit = Math.max(1, options?.telemetryLimit ?? 100);

  const [allIncidents, telemetry] = await Promise.all([
    listIncidents({ limit: Math.max(incidentLimit, MAX_LOCAL_INCIDENTS) }),
    listRuntimeTelemetry({ limit: telemetryLimit }),
  ]);

  return {
    persistenceMode: isSupabaseAdminConfigured()
      ? "SUPABASE_POSTGRES"
      : "LOCAL_DURABLE_STORE",
    generatedAt: new Date().toISOString(),
    incidents: allIncidents.slice(0, incidentLimit),
    telemetry,
    counts: computeIncidentCounts(allIncidents),
  };
}

export async function resetLocalIncidentStoreForTests(
  deleteDiskFile = true
): Promise<void> {
  assertServerOnly();
  await withLocalLock(async () => {
    const filePath = resolveStateFilePath();
    globalIncidentStore.__macroedgeIncidentState =
      createEmptyLocalState(filePath);
    if (deleteDiskFile) {
      await fs.unlink(filePath).catch(() => {});
    }
  });
}
