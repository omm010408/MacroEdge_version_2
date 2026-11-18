"use client";

import { redactObjectSecrets, redactSensitiveText } from "@/lib/incidents/redact";
import type {
  IncidentDomain,
  IncidentIngestPayload,
  IncidentSeverity,
  RuntimeTelemetryMetricType,
} from "@/lib/incidents/types";

const MAX_EVENTS_PER_MINUTE = 8;
const DEDUP_TTL_MS = 30_000;
const WINDOW_MS = 60_000;

const sentHistory: number[] = [];
const dedupCache = new Map<string, number>();

export interface ReportFrontendIncidentOptions {
  domain?: IncidentDomain;
  severity?: IncidentSeverity;
  affectedComponent: string;
  affectedDataset?: string | null;
  errorDescription: string;
  stackTrace?: string | null;
  routePath?: string | null;
  metricType?: RuntimeTelemetryMetricType;
  latencyMs?: number | null;
  ok?: boolean;
  metadata?: Record<string, unknown>;
}

function shouldSkipUrl(url: string): boolean {
  return url.includes("/api/incidents");
}

function canSendClientReport(dedupKey: string): boolean {
  const now = Date.now();
  while (sentHistory.length > 0 && now - sentHistory[0] > WINDOW_MS) {
    sentHistory.shift();
  }
  if (sentHistory.length >= MAX_EVENTS_PER_MINUTE) {
    return false;
  }
  const prev = dedupCache.get(dedupKey);
  if (prev !== undefined && now - prev < DEDUP_TTL_MS) {
    return false;
  }
  dedupCache.set(dedupKey, now);
  if (dedupCache.size > 200) {
    for (const [k, ts] of dedupCache.entries()) {
      if (now - ts >= DEDUP_TTL_MS) dedupCache.delete(k);
    }
  }
  sentHistory.push(now);
  return true;
}

export function reportFrontendIncident(
  options: ReportFrontendIncidentOptions
): void {
  if (typeof window === "undefined") return;

  const safeComponent = redactSensitiveText(options.affectedComponent.trim());
  const safeMessage = redactSensitiveText(options.errorDescription.trim());
  if (!safeComponent || !safeMessage) return;

  // Never trigger recursive incident logging on the incident endpoints themselves
  if (shouldSkipUrl(safeComponent) || shouldSkipUrl(safeMessage)) {
    return;
  }

  // Filter out uninformative cross-origin script errors with no stack trace or filename
  if (
    (safeMessage === "Script error." || safeMessage === "Script error") &&
    !options.stackTrace &&
    (!safeComponent || safeComponent === "browser-window" || safeComponent.startsWith("browser:"))
  ) {
    return;
  }

  const routePath =
    options.routePath ??
    (typeof window !== "undefined" ? window.location?.pathname ?? null : null);
  const dedupKey = `${safeComponent}:${routePath ?? ""}:${safeMessage.slice(0, 120)}`;
  if (!canSendClientReport(dedupKey)) return;

  const payload: IncidentIngestPayload = {
    domain: options.domain ?? "frontend",
    severity: options.severity,
    affectedComponent: safeComponent.slice(0, 160),
    affectedDataset: options.affectedDataset ?? null,
    errorDescription: safeMessage.slice(0, 1800),
    stackTrace: options.stackTrace
      ? redactSensitiveText(options.stackTrace).slice(0, 3500)
      : null,
    routePath,
    metadata: options.metadata ? redactObjectSecrets(options.metadata) : undefined,
    telemetry: {
      sourceComponent: safeComponent.slice(0, 160),
      metricType: options.metricType ?? "ui_error",
      latencyMs: options.latencyMs ?? null,
      ok: options.ok ?? false,
      detail: safeMessage.slice(0, 900),
    },
  };

  try {
    const serialized = JSON.stringify(payload);
    void fetch("/api/incidents/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry delivery errors are swallowed only after local failure protection
  }
}

export function reportChartAnomaly(params: {
  chartComponent: string;
  seriesLabel?: string;
  issue: string;
  invalidCount?: number;
}): void {
  reportFrontendIncident({
    domain: "frontend",
    severity: "Medium",
    affectedComponent: `chart:${params.chartComponent}`,
    affectedDataset: params.seriesLabel ?? null,
    errorDescription: `Chart data/render anomaly in ${params.chartComponent}: ${params.issue}`,
    metricType: "ui_error",
    metadata: {
      seriesLabel: params.seriesLabel,
      invalidCount: params.invalidCount ?? null,
    },
  });
}

export function reportApiFailure(params: {
  url: string;
  status: number;
  latencyMs?: number;
  detail?: string;
}): void {
  if (shouldSkipUrl(params.url)) return;
  reportFrontendIncident({
    domain: params.status >= 500 ? "backend" : "frontend",
    severity: params.status >= 500 ? "High" : "Medium",
    affectedComponent: `api-client:${redactSensitiveText(params.url).slice(0, 120)}`,
    errorDescription: `API request failed (${params.status}) for ${redactSensitiveText(params.url)}: ${params.detail ?? "HTTP error"}`,
    metricType: "api_latency",
    latencyMs: params.latencyMs ?? null,
    ok: false,
  });
}

let monitorsInstalled = false;

export function installGlobalFrontendMonitors(): () => void {
  if (typeof window === "undefined" || monitorsInstalled) {
    return () => {};
  }
  monitorsInstalled = true;

  const onWindowError = (event: ErrorEvent) => {
    // Ignore cross-origin masked script errors (browser extensions, adblockers, etc.)
    if (
      event.message === "Script error." ||
      event.message === "Script error" ||
      (!event.filename && !event.error)
    ) {
      return;
    }

    reportFrontendIncident({
      domain: "frontend",
      severity: "High",
      affectedComponent: event.filename
        ? `browser:${event.filename.split("/").slice(-1)[0]}`
        : "browser-window",
      errorDescription: event.message || "Unhandled browser runtime error",
      stackTrace:
        event.error instanceof Error ? event.error.stack ?? event.error.message : null,
      metricType:
        typeof event.message === "string" &&
        event.message.toLowerCase().includes("hydration")
          ? "hydration_error"
          : "ui_error",
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection");
    reportFrontendIncident({
      domain: "frontend",
      severity: "High",
      affectedComponent: "browser-promise",
      errorDescription: `Unhandled promise rejection: ${msg}`,
      stackTrace: reason instanceof Error ? reason.stack ?? msg : msg,
      metricType: "ui_error",
    });
  };

  // Preserve original console.error completely while streaming critical React/Hydration logs
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    try {
      const joined = args
        .slice(0, 3)
        .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : ""))
        .filter(Boolean)
        .join(" | ");

      const hasErrorObject = args.some((a) => a instanceof Error);
      const lower = joined.toLowerCase();
      if (
        joined &&
        !shouldSkipUrl(joined) &&
        (hasErrorObject ||
          lower.includes("hydration") ||
          lower.includes("uncaught") ||
          lower.includes("chart") ||
          lower.includes("chunkloaderror") ||
          lower.includes("minified react") ||
          lower.includes("each child in a list") ||
          lower.includes("failed to fetch"))
      ) {
        reportFrontendIncident({
          domain: "frontend",
          severity: "Medium",
          affectedComponent: "browser-console",
          errorDescription: joined,
          metricType: joined.toLowerCase().includes("hydration")
            ? "hydration_error"
            : "ui_error",
        });
      }
    } catch {
      // Never break native console.error
    }
  };

  const originalFetch = window.fetch.bind(window);
  const monitoredFetch: typeof window.fetch = async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    const shouldObserveApi =
      (rawUrl.startsWith("/api/macro") || rawUrl.startsWith("/api/sync")) &&
      !shouldSkipUrl(rawUrl);

    if (!shouldObserveApi) {
      return originalFetch(input, init);
    }

    const startedMs = performance.now();
    try {
      const response = await originalFetch(input, init);
      const latencyMs = Math.round(performance.now() - startedMs);
      if (response.status >= 500) {
        reportApiFailure({
          url: rawUrl,
          status: response.status,
          latencyMs,
          detail: response.statusText || `HTTP ${response.status}`,
        });
      }
      return response;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startedMs);
      reportApiFailure({
        url: rawUrl,
        status: 0,
        latencyMs,
        detail: err instanceof Error ? err.message : "Network fetch failure",
      });
      throw err;
    }
  };
  window.fetch = monitoredFetch;

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.fetch = originalFetch;
    console.error = originalConsoleError;
    monitorsInstalled = false;
  };
}
