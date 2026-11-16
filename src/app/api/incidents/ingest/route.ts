import { syncErrorResponse, syncJsonResponse } from "@/app/api/sync/_shared";
import type {
  IncidentDomain,
  IncidentIngestPayload,
  IncidentSeverity,
  RuntimeTelemetryMetricType,
} from "@/lib/incidents/types";
import { ingestTelemetryAndClassify } from "@/services/incidents/debugger-engine";

export const dynamic = "force-dynamic";

const ALLOWED_DOMAINS = new Set<IncidentDomain>([
  "frontend",
  "backend",
  "database",
  "sync",
]);
const ALLOWED_SEVERITIES = new Set<IncidentSeverity>([
  "Critical",
  "High",
  "Medium",
  "Low",
]);
const ALLOWED_TELEMETRY_TYPES = new Set<RuntimeTelemetryMetricType>([
  "api_latency",
  "worker_tick",
  "memory_rss",
  "event_loop_lag",
  "db_query",
  "realtime_disconnect",
  "ui_error",
  "hydration_error",
]);

function clampString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export async function POST(req: Request) {
  let raw: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return syncErrorResponse("Invalid telemetry payload.", 400);
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return syncErrorResponse("Malformed JSON payload.", 400);
  }

  const domain = raw.domain;
  if (typeof domain !== "string" || !ALLOWED_DOMAINS.has(domain as IncidentDomain)) {
    return syncErrorResponse("Invalid incident domain.", 400);
  }

  const affectedComponent = clampString(raw.affectedComponent, 160);
  const errorDescription = clampString(raw.errorDescription, 2000);
  if (!affectedComponent || !errorDescription) {
    return syncErrorResponse(
      "Both affectedComponent and errorDescription are required.",
      400
    );
  }

  const severity =
    typeof raw.severity === "string" &&
    ALLOWED_SEVERITIES.has(raw.severity as IncidentSeverity)
      ? (raw.severity as IncidentSeverity)
      : undefined;

  let telemetry: IncidentIngestPayload["telemetry"] | undefined;
  if (
    raw.telemetry &&
    typeof raw.telemetry === "object" &&
    !Array.isArray(raw.telemetry)
  ) {
    const t = raw.telemetry as Record<string, unknown>;
    const metricType =
      typeof t.metricType === "string" &&
      ALLOWED_TELEMETRY_TYPES.has(t.metricType as RuntimeTelemetryMetricType)
        ? (t.metricType as RuntimeTelemetryMetricType)
        : "ui_error";

    telemetry = {
      sourceComponent: clampString(t.sourceComponent, 160) ?? affectedComponent,
      metricType,
      latencyMs: typeof t.latencyMs === "number" && Number.isFinite(t.latencyMs) ? t.latencyMs : null,
      ok: typeof t.ok === "boolean" ? t.ok : false,
      detail: clampString(t.detail, 1000) ?? errorDescription,
    };
  }

  const payload: IncidentIngestPayload = {
    domain: domain as IncidentDomain,
    severity,
    fingerprint: clampString(raw.fingerprint, 200) ?? undefined,
    affectedComponent,
    affectedDataset: clampString(raw.affectedDataset, 120),
    workerId: clampString(raw.workerId, 80),
    providerId: clampString(raw.providerId, 80),
    errorDescription,
    stackTrace: clampString(raw.stackTrace, 4000),
    routePath: clampString(raw.routePath, 240),
    metadata:
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
    telemetry,
  };

  try {
    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "client";
    const result = await ingestTelemetryAndClassify(payload, {
      sourceKey: forwardedFor,
    });

    if (result.rateLimited) {
      return syncErrorResponse("Telemetry rate limit exceeded for component.", 429);
    }

    return syncJsonResponse(
      {
        ok: true,
        telemetryRecorded: result.telemetryRecorded,
        incidentId: result.incidentResult?.incident.id ?? null,
        deduplicated: result.incidentResult?.deduplicated ?? false,
      },
      202
    );
  } catch (err) {
    console.error(
      "[POST /api/incidents/ingest] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return syncErrorResponse("Failed to record telemetry event.", 500);
  }
}
