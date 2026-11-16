// src/services/sync/debug.ts
// High-End AutoSync Diagnostic & Telemetry Engine for MacroEdge.
// Provides institutional-grade real-time diagnostic introspection, lock audits,
// rate window headroom metering, cadence analysis, latency profiling, and anomaly isolation.

import type { ProviderId, SyncStatusType, WorkerId } from "@/lib/sync/types";
import {
  clearOrchestratorLocks,
  dispatchSyncJob,
  getActiveOrchestratorLocks,
  getProviderRateHistories,
  getSourceUpdatePolicies,
  resetProviderRateHistory,
  type SourceUpdatePolicy,
} from "@/services/sync/orchestrator";
import {
  getLatestValues,
  getMarketQuotes,
  getSyncSystemSnapshot,
  listAnomalies,
  listDataHealth,
  listSyncRuns,
} from "@/services/sync/store";
import {
  getAllProviderStatuses,
  PROVIDER_REGISTRY,
} from "@/services/sync/provider-registry";
import { measureEventLoopLagMs } from "@/services/incidents/debugger-engine";

export interface ProviderDiagnosticItem {
  providerId: ProviderId;
  name: string;
  configured: boolean;
  cadence: string;
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  status: SyncStatusType;
  overdue: boolean;
  secondsSinceLastSuccess: number | null;
  rateLimitUsage: {
    requestsInLastMinute: number;
    maxAllowed: number;
    minSpacingMs: number;
    windowHeadroom: number;
  };
}

export interface WorkerDiagnosticItem {
  workerId: WorkerId;
  status: SyncStatusType;
  lastRunId: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunTime: string | null;
  recordsUpdated: number;
  hasActiveLock: boolean;
}

export interface AutoSyncDiagnostics {
  timestamp: string;
  uptimeSeconds: number;
  overallStatus: SyncStatusType;
  verdict: "HEALTHY" | "DEGRADED" | "LOCKED" | "RATE_LIMITED" | "STALE" | "AWAITING_SYNC";
  persistenceMode: string;
  eventLoopLagMs: number;
  memoryUsageMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  activeLocks: string[];
  providers: Record<string, ProviderDiagnosticItem>;
  workers: Record<string, WorkerDiagnosticItem>;
  counts: {
    totalLatestValues: number;
    totalMarketQuotes: number;
    unresolvedAnomalies: number;
    deadLetterRunsCount: number;
  };
  cadencePolicies: SourceUpdatePolicy[];
  recentRunsSummary: {
    totalSampled: number;
    succeeded: number;
    failed: number;
    averageDurationMs: number;
  };
  issues: Array<{
    severity: "INFO" | "WARNING" | "CRITICAL";
    code: string;
    message: string;
    recommendation: string;
  }>;
}

export interface AutoSyncProbeResult {
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  workerLatenciesMs: Record<string, number>;
  ok: boolean;
  errors: Array<{ workerId: string; message: string }>;
}

export async function getAutoSyncDiagnostics(): Promise<AutoSyncDiagnostics> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const [
    snapshot,
    activeLocks,
    rateHistories,
    policies,
    providerStatuses,
    healthList,
    recentRuns,
    latestValues,
    marketQuotes,
    anomalies,
    eventLoopLagMs,
  ] = await Promise.all([
    getSyncSystemSnapshot(),
    Promise.resolve(getActiveOrchestratorLocks()),
    Promise.resolve(getProviderRateHistories()),
    Promise.resolve(getSourceUpdatePolicies()),
    Promise.resolve(getAllProviderStatuses()),
    listDataHealth(),
    listSyncRuns(40),
    getLatestValues(),
    getMarketQuotes(),
    listAnomalies(false, 50),
    measureEventLoopLagMs(),
  ]);

  const mem = process.memoryUsage();
  const memoryUsageMb = {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
  };

  const healthMap = new Map(healthList.map((h) => [h.id, h]));
  const issues: AutoSyncDiagnostics["issues"] = [];

  // Provider Diagnostic Mapping
  const providers: Record<string, ProviderDiagnosticItem> = {};
  for (const pStatus of providerStatuses) {
    const providerId = pStatus.providerId;
    const cfg = PROVIDER_REGISTRY[providerId];
    if (!cfg) continue;

    const health = healthMap.get(`source:${providerId}`);
    const lastAttemptAt = health?.lastAttemptAt ?? null;
    const lastSuccessAt = health?.lastSuccessAt ?? null;
    const status: SyncStatusType = health?.status ?? "DISCONNECTED";

    let secondsSinceLastSuccess: number | null = null;
    let overdue = false;

    if (lastSuccessAt) {
      const successMs = Date.parse(lastSuccessAt);
      if (Number.isFinite(successMs)) {
        secondsSinceLastSuccess = Math.max(0, Math.round((startedAtMs - successMs) / 1000));
        if (pStatus.configured && secondsSinceLastSuccess > cfg.staleAfterSeconds) {
          overdue = true;
        }
      }
    } else if (pStatus.configured) {
      overdue = true;
    }

    const rateHistory = rateHistories[providerId] ?? {
      requestsInLastMinute: 0,
      maxAllowed: cfg.rateLimit.requestsPerMinute,
      minSpacingMs: cfg.rateLimit.minSpacingMs,
    };
    const windowHeadroom = Math.max(0, rateHistory.maxAllowed - rateHistory.requestsInLastMinute);

    if (pStatus.configured && rateHistory.requestsInLastMinute >= rateHistory.maxAllowed) {
      issues.push({
        severity: "WARNING",
        code: `RATE_LIMIT_EXHAUSTED_${providerId.toUpperCase()}`,
        message: `Provider ${cfg.name} has exhausted its sliding RPM window (${rateHistory.requestsInLastMinute}/${rateHistory.maxAllowed} req/min).`,
        recommendation: `Allow the 60-second burst window to drain or trigger resetRateLimitHistory() if testing.`,
      });
    }

    if (overdue && pStatus.configured) {
      issues.push({
        severity: "WARNING",
        code: `PROVIDER_STALE_${providerId.toUpperCase()}`,
        message: `Configured provider ${cfg.name} is overdue for sync (elapsed ${secondsSinceLastSuccess ?? "never"}s > threshold ${cfg.staleAfterSeconds}s).`,
        recommendation: `Trigger a targeted sync for ${providerId} via POST /api/sync/trigger.`,
      });
    }

    providers[providerId] = {
      providerId,
      name: cfg.name,
      configured: pStatus.configured,
      cadence: cfg.cadence,
      expectedIntervalSeconds: cfg.expectedIntervalSeconds,
      staleAfterSeconds: cfg.staleAfterSeconds,
      lastAttemptAt,
      lastSuccessAt,
      status,
      overdue,
      secondsSinceLastSuccess,
      rateLimitUsage: {
        ...rateHistory,
        windowHeadroom,
      },
    };
  }

  // Worker Diagnostic Mapping
  const workerIds: WorkerId[] = [
    "orchestrator",
    "market-engine",
    "macro-engine",
    "positioning-engine",
    "liquidity-risk-engine",
    "validation-recovery",
    "ai-supervisor",
  ];

  const workers: Record<string, WorkerDiagnosticItem> = {};
  for (const wId of workerIds) {
    const wHealth = healthMap.get(`worker:${wId}`);
    const lastRun = recentRuns.find((r) => r.workerId === wId);
    const hasLock = activeLocks.some((l) => l.includes(wId));

    if (wHealth?.status === "FAILED") {
      issues.push({
        severity: "CRITICAL",
        code: `WORKER_FAILED_${wId.toUpperCase()}`,
        message: `Sync worker ${wId} is in FAILED state: ${wHealth.lastError || "Unspecified failure"}.`,
        recommendation: `Check worker logs, ensure API keys are populated, and dispatch recovery sweep.`,
      });
    }

    workers[wId] = {
      workerId: wId,
      status: wHealth?.status ?? (lastRun?.status === "SUCCEEDED" ? "CURRENT" : "DISCONNECTED"),
      lastRunId: lastRun?.id ?? null,
      lastRunStatus: lastRun?.status ?? null,
      lastRunDurationMs: lastRun?.durationMs ?? null,
      lastRunTime: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
      recordsUpdated: lastRun?.recordsUpserted ?? 0,
      hasActiveLock: hasLock,
    };
  }

  // Active Locks Diagnostic
  if (activeLocks.length > 0) {
    issues.push({
      severity: "INFO",
      code: "ACTIVE_SYNC_LOCKS",
      message: `${activeLocks.length} active worker lock(s) in progress: ${activeLocks.join(", ")}.`,
      recommendation: "Locks are normal while sync is in-flight. If persisting > 90s, clear orphaned locks.",
    });
  }

  // Event loop lag diagnostic
  if (eventLoopLagMs > 150) {
    issues.push({
      severity: "WARNING",
      code: "HIGH_EVENT_LOOP_LAG",
      message: `Event loop latency measured ${eventLoopLagMs}ms (threshold 150ms).`,
      recommendation: "Node thread has blocking operations or heavy CPU synchronization cycles.",
    });
  }

  // Summaries
  const succRuns = recentRuns.filter((r) => r.status === "SUCCEEDED");
  const failRuns = recentRuns.filter((r) => r.status === "FAILED" || r.status === "DEAD_LETTER");
  const avgDuration =
    succRuns.length > 0
      ? Math.round(succRuns.reduce((acc, r) => acc + (r.durationMs || 0), 0) / succRuns.length)
      : 0;

  // Determine overall verdict
  let verdict: AutoSyncDiagnostics["verdict"] = "HEALTHY";
  if (activeLocks.length > 2) {
    verdict = "LOCKED";
  } else if (issues.some((i) => i.code.startsWith("RATE_LIMIT_EXHAUSTED"))) {
    verdict = "RATE_LIMITED";
  } else if (issues.some((i) => i.severity === "CRITICAL")) {
    verdict = "DEGRADED";
  } else if (issues.some((i) => i.code.startsWith("PROVIDER_STALE"))) {
    verdict = "STALE";
  } else if (latestValues.length === 0 && marketQuotes.length === 0) {
    verdict = "AWAITING_SYNC";
  }

  return {
    timestamp: startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    overallStatus: snapshot.overallStatus,
    verdict,
    persistenceMode: snapshot.persistenceMode,
    eventLoopLagMs,
    memoryUsageMb,
    activeLocks,
    providers,
    workers,
    counts: {
      totalLatestValues: latestValues.length,
      totalMarketQuotes: marketQuotes.length,
      unresolvedAnomalies: anomalies.length,
      deadLetterRunsCount: recentRuns.filter((r) => r.deadLettered).length,
    },
    cadencePolicies: policies,
    recentRunsSummary: {
      totalSampled: recentRuns.length,
      succeeded: succRuns.length,
      failed: failRuns.length,
      averageDurationMs: avgDuration,
    },
    issues,
  };
}

export async function runAutoSyncProbe(): Promise<AutoSyncProbeResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const syncResult = await dispatchSyncJob({
    force: true,
    trigger: "manual",
  });

  const workerLatenciesMs: Record<string, number> = {};
  for (const s of syncResult.summaries) {
    workerLatenciesMs[`${s.workerId}:${s.providerId ?? "primary"}`] = s.latencyMs;
  }

  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();

  return {
    startedAt,
    finishedAt,
    totalDurationMs: finishedAtMs - startedAtMs,
    workerLatenciesMs,
    ok: syncResult.ok,
    errors: syncResult.errors.map((e) => ({
      workerId: e.workerId,
      message: e.message,
    })),
  };
}

export async function clearOrphanedSyncLocks(): Promise<{ clearedCount: number; remainingLocks: string[] }> {
  const clearedCount = clearOrchestratorLocks();
  const remainingLocks = getActiveOrchestratorLocks();
  return { clearedCount, remainingLocks };
}

export async function resetRateLimitHistory(providerId?: ProviderId): Promise<{ reset: boolean; timestamp: string }> {
  resetProviderRateHistory(providerId);
  return { reset: true, timestamp: new Date().toISOString() };
}
