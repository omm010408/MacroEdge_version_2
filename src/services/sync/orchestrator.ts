import type { DataCadence } from "@/lib/types";
import type {
  DataHealthRecord,
  MarketSymbol,
  ProviderId,
  SyncStatusType,
  SyncRunRecord,
  TriggerType,
  WorkerId,
} from "@/lib/sync/types";
import {
  getProviderConfig,
  listProviders,
  MACRO_SERIES_MAPPINGS,
  PROVIDER_REGISTRY,
} from "@/services/sync/provider-registry";
import {
  completeSyncRun,
  getLatestValues,
  listDataHealth,
  listSyncRuns,
  recordAnomaly,
  recordSyncRunStart,
  seedDataSourcesIfNeeded,
  updateDataHealth,
} from "@/services/sync/store";
import {
  evaluateSourceStaleness,
  registerOrchestratorDispatcher,
  type WorkerExecutionSummary,
} from "@/services/sync/validation-recovery";
import { runAiSupervisorCycle } from "@/services/sync/workers/ai-supervisor";
import { runLiquidityRiskEngineSync } from "@/services/sync/workers/liquidity-risk-engine";
import { runMacroEngineSync } from "@/services/sync/workers/macro-engine";
import { runMarketEngineCycle } from "@/services/sync/workers/market-engine";
import { runPositioningEngineSync } from "@/services/sync/workers/positioning-engine";

export interface SourceUpdatePolicy {
  providerId: ProviderId;
  workerId: WorkerId;
  cadence: DataCadence;
  pollIntervalMs: number;
  staleAfterMs: number;
  minSpacingMs: number;
  requestsPerMinute: number;
  scheduleRule: string;
}

export interface DispatchSyncJobOptions {
  workerId?: WorkerId;
  providerId?: ProviderId;
  trigger?: TriggerType;
  force?: boolean;
  backfill?: boolean;
  seriesKeys?: string[];
  symbols?: MarketSymbol[];
}

export interface DispatchSyncResult {
  ok: boolean;
  trigger: TriggerType;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summaries: WorkerExecutionSummary[];
  errors: Array<{ workerId: WorkerId; providerId?: ProviderId; message: string }>;
  skippedLocks?: string[];
}

declare global {
  var __macroedgeOrchestratorLocks:
    | Map<string, Promise<WorkerExecutionSummary>>
    | undefined;
  var __macroedgeOrchestratorRateHistory: Map<ProviderId, number[]> | undefined;
}

function getJobLockMap(): Map<string, Promise<WorkerExecutionSummary>> {
  if (!globalThis.__macroedgeOrchestratorLocks) {
    globalThis.__macroedgeOrchestratorLocks = new Map();
  }
  return globalThis.__macroedgeOrchestratorLocks;
}

function getRateHistoryMap(): Map<ProviderId, number[]> {
  if (!globalThis.__macroedgeOrchestratorRateHistory) {
    globalThis.__macroedgeOrchestratorRateHistory = new Map();
  }
  return globalThis.__macroedgeOrchestratorRateHistory;
}

/**
 * Source-specific polling & dispatch policies derived from PROVIDER_REGISTRY.
 * Never collapses heterogeneous real-time, daily, weekly, and monthly sources
 * onto a single global polling interval.
 */
export const SOURCE_UPDATE_POLICIES: Record<ProviderId, SourceUpdatePolicy> = {
  coinbase_ws: {
    providerId: "coinbase_ws",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.coinbase_ws.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.coinbase_ws.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.coinbase_ws.rateLimit.requestsPerMinute,
    scheduleRule: "Continuous WebSocket stream + 60s health/REST fallback check",
  },
  twelve_data_ws: {
    providerId: "twelve_data_ws",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.twelve_data_ws.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.twelve_data_ws.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.twelve_data_ws.rateLimit.requestsPerMinute,
    scheduleRule: "Continuous WebSocket stream + 60s health/REST fallback check",
  },
  finnhub_ws: {
    providerId: "finnhub_ws",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.finnhub_ws.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.finnhub_ws.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.finnhub_ws.rateLimit.requestsPerMinute,
    scheduleRule: "Continuous WebSocket stream + 60s health/REST fallback check",
  },
  polygon_ws: {
    providerId: "polygon_ws",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.polygon_ws.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.polygon_ws.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.polygon_ws.rateLimit.requestsPerMinute,
    scheduleRule: "Continuous WebSocket stream + 60s health/REST fallback check",
  },
  api_ninjas: {
    providerId: "api_ninjas",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.api_ninjas.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.api_ninjas.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.api_ninjas.rateLimit.requestsPerMinute,
    scheduleRule: "60s REST quote polling for gold spot price",
  },
  yfinance: {
    providerId: "yfinance",
    workerId: "market-engine",
    cadence: "LIVE",
    pollIntervalMs: 60_000,
    staleAfterMs: PROVIDER_REGISTRY.yfinance.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.yfinance.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.yfinance.rateLimit.requestsPerMinute,
    scheduleRule: "60s yfinance market quote refresh across global assets (DXY, SPX, Treasuries, Commodities, Crypto)",
  },
  marketaux: {
    providerId: "marketaux",
    workerId: "ai-supervisor",
    cadence: "LIVE",
    pollIntervalMs: 300_000,
    staleAfterMs: PROVIDER_REGISTRY.marketaux.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.marketaux.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.marketaux.rateLimit.requestsPerMinute,
    scheduleRule: "5-minute polling for global financial news & macroeconomic sentiment (Marketaux)",
  },
  fred: {
    providerId: "fred",
    workerId: "macro-engine",
    cadence: "DAILY",
    pollIntervalMs: PROVIDER_REGISTRY.fred.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.fred.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.fred.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.fred.rateLimit.requestsPerMinute,
    scheduleRule: "Hourly check for daily & monthly macro releases (FRED)",
  },
  bls: {
    providerId: "bls",
    workerId: "macro-engine",
    cadence: "MONTHLY",
    pollIntervalMs: PROVIDER_REGISTRY.bls.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.bls.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.bls.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.bls.rateLimit.requestsPerMinute,
    scheduleRule: "4-hour release cadence for BLS CPI/PPI/Employment releases",
  },
  bea: {
    providerId: "bea",
    workerId: "macro-engine",
    cadence: "MONTHLY",
    pollIntervalMs: PROVIDER_REGISTRY.bea.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.bea.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.bea.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.bea.rateLimit.requestsPerMinute,
    scheduleRule: "4-hour release cadence for BEA GDP/PCE NIPA releases",
  },
  us_treasury: {
    providerId: "us_treasury",
    workerId: "liquidity-risk-engine",
    cadence: "DAILY",
    pollIntervalMs: PROVIDER_REGISTRY.us_treasury.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.us_treasury.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.us_treasury.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.us_treasury.rateLimit.requestsPerMinute,
    scheduleRule: "Hourly check aligned to daily Treasury Fiscal Data publication",
  },
  fed_reserve: {
    providerId: "fed_reserve",
    workerId: "liquidity-risk-engine",
    cadence: "DAILY",
    pollIntervalMs: PROVIDER_REGISTRY.fed_reserve.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.fed_reserve.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.fed_reserve.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.fed_reserve.rateLimit.requestsPerMinute,
    scheduleRule: "Hourly check for NY Fed daily reference rates & Thu H.4.1",
  },
  cftc: {
    providerId: "cftc",
    workerId: "positioning-engine",
    cadence: "WEEKLY",
    pollIntervalMs: PROVIDER_REGISTRY.cftc.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.cftc.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.cftc.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.cftc.rateLimit.requestsPerMinute,
    scheduleRule: "6-hour check aligned to Friday 15:30 ET CFTC COT schedule",
  },
  gemini: {
    providerId: "gemini",
    workerId: "ai-supervisor",
    cadence: "DAILY",
    pollIntervalMs: PROVIDER_REGISTRY.gemini.expectedIntervalSeconds * 1000,
    staleAfterMs: PROVIDER_REGISTRY.gemini.staleAfterSeconds * 1000,
    minSpacingMs: PROVIDER_REGISTRY.gemini.rateLimit.minSpacingMs,
    requestsPerMinute: PROVIDER_REGISTRY.gemini.rateLimit.requestsPerMinute,
    scheduleRule: "Hourly post-validation synthesis only when validated data exists",
  },
};

export function getSourceUpdatePolicies(): SourceUpdatePolicy[] {
  return Object.values(SOURCE_UPDATE_POLICIES);
}

export function getActiveOrchestratorLocks(): string[] {
  return Array.from(getJobLockMap().keys());
}

export function getProviderRateHistories(): Record<
  string,
  { requestsInLastMinute: number; maxAllowed: number; minSpacingMs: number }
> {
  const historyMap = getRateHistoryMap();
  const now = Date.now();
  const result: Record<
    string,
    { requestsInLastMinute: number; maxAllowed: number; minSpacingMs: number }
  > = {};
  for (const [providerId, times] of historyMap.entries()) {
    const recent = times.filter((ts) => now - ts < 60_000);
    const cfg = getProviderConfig(providerId);
    result[providerId] = {
      requestsInLastMinute: recent.length,
      maxAllowed: cfg.rateLimit.requestsPerMinute,
      minSpacingMs: cfg.rateLimit.minSpacingMs,
    };
  }
  return result;
}

export function clearOrchestratorLocks(): number {
  const lockMap = getJobLockMap();
  const count = lockMap.size;
  lockMap.clear();
  return count;
}

export function resetProviderRateHistory(providerId?: ProviderId): void {
  const historyMap = getRateHistoryMap();
  if (providerId) {
    historyMap.delete(providerId);
  } else {
    historyMap.clear();
  }
}

const MACRO_PROVIDER_SERIES_MAP: Partial<Record<ProviderId, string[]>> = {
  bls: ["CPI_YOY"],
  bea: ["REAL_GDP_QOQ"],
  fred: [
    "CORE_CPI_YOY",
    "PCE_YOY",
    "CORE_PCE_YOY",
    "PPI_YOY",
    "NFP_PAYEMS",
    "UNRATE",
    "AHE_YOY",
    "ISM_MFG",
    "ISM_SVC",
    "RETAIL_SALES_MOM",
    "CONSUMER_CONFIDENCE",
    "UST_AVG_NOTE_RATE",
    "FED_EFFR_OFFICIAL",
  ],
};

function getSeriesKeysForMacroProvider(providerId: ProviderId): string[] | undefined {
  const mapped = MACRO_PROVIDER_SERIES_MAP[providerId];
  if (mapped && mapped.length > 0) return mapped;
  const fromRegistry = MACRO_SERIES_MAPPINGS.filter(
    (m) => m.primaryProvider === providerId || m.fallbackProvider === providerId
  ).map((m) => m.seriesKey);
  return fromRegistry.length > 0 ? fromRegistry : undefined;
}

function defaultProviderForWorker(workerId: WorkerId): ProviderId {
  switch (workerId) {
    case "market-engine":
      return "coinbase_ws";
    case "macro-engine":
      return "fred";
    case "positioning-engine":
      return "cftc";
    case "liquidity-risk-engine":
      return "fed_reserve";
    case "ai-supervisor":
      return "gemini";
    case "validation-recovery":
    case "orchestrator":
      return "fred";
  }
}

function checkAndRecordRateWindow(providerId: ProviderId, force: boolean): {
  allowed: boolean;
  reason?: string;
} {
  const cfg = getProviderConfig(providerId);
  const historyMap = getRateHistoryMap();
  const now = Date.now();
  const recent = (historyMap.get(providerId) ?? []).filter((ts) => now - ts < 60_000);

  // Even forced dispatches honor burst protection if RPM is critically exceeded
  const maxAllowed = force ? cfg.rateLimit.requestsPerMinute * 2 : cfg.rateLimit.requestsPerMinute;
  if (recent.length >= maxAllowed) {
    historyMap.set(providerId, recent);
    return {
      allowed: false,
      reason: `Rate limit window exceeded for ${providerId} (${recent.length}/${maxAllowed} rpm)`,
    };
  }

  const last = recent[recent.length - 1];
  if (!force && last && now - last < cfg.rateLimit.minSpacingMs) {
    historyMap.set(providerId, recent);
    return {
      allowed: false,
      reason: `Rate-limit spacing active for ${providerId} (${cfg.rateLimit.minSpacingMs}ms)`,
    };
  }

  recent.push(now);
  historyMap.set(providerId, recent);
  return { allowed: true };
}

function isSourceDueForSync(
  providerId: ProviderId,
  healthById: Map<string, DataHealthRecord>,
  nowMs: number
): boolean {
  const policy = SOURCE_UPDATE_POLICIES[providerId];
  const health = healthById.get(`source:${providerId}`);
  if (!health) return true;

  // Never keep polling unconfigured disabled sources if already checked recently
  const lastCheckIso = health.lastAttemptAt ?? health.lastSuccessAt;
  if (!lastCheckIso) return true;

  const lastCheckMs = Date.parse(lastCheckIso);
  if (!Number.isFinite(lastCheckMs)) return true;

  const elapsedMs = nowMs - lastCheckMs;

  // Release-window tightening: CFTC on Friday after 15:30 ET (20:30 UTC), BLS/BEA around 08:30 ET (13:30 UTC)
  if (providerId === "cftc") {
    const dt = new Date(nowMs);
    const isFridayReleaseWindow =
      dt.getUTCDay() === 5 && dt.getUTCHours() >= 19 && dt.getUTCHours() <= 23;
    const effectiveInterval = isFridayReleaseWindow
      ? Math.min(policy.pollIntervalMs, 900_000)
      : policy.pollIntervalMs;
    return elapsedMs >= effectiveInterval;
  }

  return elapsedMs >= policy.pollIntervalMs;
}

async function runSingleWorkerIsolated(params: {
  workerId: WorkerId;
  providerId: ProviderId;
  trigger: TriggerType;
  force: boolean;
  backfill: boolean;
  seriesKeys?: string[];
  symbols?: MarketSymbol[];
}): Promise<{
  summary: WorkerExecutionSummary;
  deduplicatedLock?: string;
  error?: { workerId: WorkerId; providerId?: ProviderId; message: string };
}> {
  const lockKey = `${params.providerId}:${params.workerId}`;
  const lockMap = getJobLockMap();

  const existingInFlight = lockMap.get(lockKey);
  if (existingInFlight) {
    const sharedSummary = await existingInFlight;
    return {
      summary: {
        ...sharedSummary,
        recordsSkipped: sharedSummary.recordsSkipped + 1,
      },
      deduplicatedLock: lockKey,
    };
  }

  const rateCheck = checkAndRecordRateWindow(params.providerId, params.force);
  if (!rateCheck.allowed) {
    const skippedSummary: WorkerExecutionSummary = {
      runId: "rate-limited",
      workerId: params.workerId,
      providerId: params.providerId,
      status: "SUCCEEDED",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: 1,
      anomaliesDetected: 0,
      latencyMs: 0,
      error: rateCheck.reason,
    };
    return { summary: skippedSummary };
  }

  const execution = (async (): Promise<WorkerExecutionSummary> => {
    switch (params.workerId) {
      case "market-engine":
        return runMarketEngineCycle({
          symbols: params.symbols,
          trigger: params.trigger,
          providerId: params.providerId,
        });
      case "macro-engine":
        return runMacroEngineSync({
          seriesKeys: params.seriesKeys,
          backfill: params.backfill,
          trigger: params.trigger,
          providerId: params.providerId,
        });
      case "positioning-engine":
        return runPositioningEngineSync({
          trigger: params.trigger,
        });
      case "liquidity-risk-engine":
        return runLiquidityRiskEngineSync({
          trigger: params.trigger,
          providerId: params.providerId,
        });
      case "ai-supervisor":
        return runAiSupervisorCycle({
          trigger: params.trigger,
        });
      case "validation-recovery": {
        await evaluateSourceStaleness();
        return {
          runId: "validation-sweep",
          workerId: "validation-recovery",
          providerId: params.providerId,
          status: "SUCCEEDED",
          recordsInserted: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          anomaliesDetected: 0,
          latencyMs: 0,
        };
      }
      case "orchestrator":
        return {
          runId: "orchestrator-noop",
          workerId: "orchestrator",
          providerId: params.providerId,
          status: "SUCCEEDED",
          recordsInserted: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          anomaliesDetected: 0,
          latencyMs: 0,
        };
    }
  })();

  lockMap.set(lockKey, execution);

  try {
    const rawSummary = await execution;
    const summary: WorkerExecutionSummary =
      (params.workerId === "macro-engine" ||
        params.workerId === "liquidity-risk-engine") &&
      params.providerId
        ? { ...rawSummary, providerId: params.providerId }
        : rawSummary;
    const err =
      summary.status === "FAILED" || summary.status === "DEAD_LETTER"
        ? {
            workerId: params.workerId,
            providerId: summary.providerId,
            message: summary.error ?? `Worker ${params.workerId} returned ${summary.status}`,
          }
        : undefined;
    return { summary, error: err };
  } catch (err) {
    // Isolated error boundary: capture unhandled worker crash without breaking other workers
    const message = err instanceof Error ? err.message : String(err);
    const failedRun = await recordSyncRunStart({
      workerId: params.workerId,
      sourceId: params.providerId,
      jobName: `${params.workerId}-isolated-boundary`,
      triggerType: params.trigger,
      attempt: 1,
      maxAttempts: 1,
      rawPayload: { isolatedCrash: true },
    });

    await completeSyncRun(failedRun.id, {
      status: "FAILED",
      errorCode: "WORKER_UNHANDLED_EXCEPTION",
      errorMessage: message,
      deadLettered: false,
    });

    await recordAnomaly({
      seriesKey: `WORKER_${params.workerId.toUpperCase()}`,
      sourceId: params.providerId,
      workerId: params.workerId,
      severity: "ERROR",
      anomalyType: "TRANSPORT_FAILURE",
      message: `Isolated error boundary caught crash in ${params.workerId}: ${message}`,
      rawPayload: { runId: failedRun.id },
    });

    await updateDataHealth({
      id: `worker:${params.workerId}`,
      entityType: "worker",
      sourceId: null,
      workerId: params.workerId,
      status: "FAILED",
      lastAttemptAt: new Date().toISOString(),
      lastError: message,
      details: { isolatedCrashRunId: failedRun.id },
    });

    return {
      summary: {
        runId: failedRun.id,
        workerId: params.workerId,
        providerId: params.providerId,
        status: "FAILED",
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        anomaliesDetected: 1,
        latencyMs: 0,
        error: message,
      },
      error: {
        workerId: params.workerId,
        providerId: params.providerId,
        message,
      },
    };
  } finally {
    lockMap.delete(lockKey);
  }
}

/**
 * Dispatches one or all synchronization workers with concurrent job locking,
 * rate-limit enforcement, isolated error boundaries, and post-sync staleness evaluation.
 */
export async function dispatchSyncJob(
  options: DispatchSyncJobOptions = {}
): Promise<DispatchSyncResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const trigger = options.trigger ?? "manual";
  const force = Boolean(options.force);
  const backfill = Boolean(options.backfill);

  await seedDataSourcesIfNeeded();

  const summaries: WorkerExecutionSummary[] = [];
  const errors: Array<{ workerId: WorkerId; providerId?: ProviderId; message: string }> = [];
  const skippedLocks: string[] = [];

  let targetWorkers: Array<{
    workerId: WorkerId;
    providerId: ProviderId;
    seriesKeys?: string[];
  }> = [];

  if (options.workerId) {
    const resolvedProvider =
      options.providerId ?? defaultProviderForWorker(options.workerId);
    targetWorkers = [
      {
        workerId: options.workerId,
        providerId: resolvedProvider,
        seriesKeys: options.seriesKeys,
      },
    ];
  } else if (options.providerId) {
    const cfg = getProviderConfig(options.providerId);
    const seriesKeysForProvider =
      options.seriesKeys ??
      (cfg.ownerWorker === "macro-engine"
        ? getSeriesKeysForMacroProvider(options.providerId)
        : undefined);
    targetWorkers = [
      {
        workerId: cfg.ownerWorker,
        providerId: options.providerId,
        seriesKeys: seriesKeysForProvider,
      },
    ];
  } else {
    targetWorkers = [
      { workerId: "market-engine", providerId: "coinbase_ws" },
      {
        workerId: "macro-engine",
        providerId: "fred",
        seriesKeys: options.seriesKeys ?? getSeriesKeysForMacroProvider("fred"),
      },
      {
        workerId: "macro-engine",
        providerId: "bls",
        seriesKeys: getSeriesKeysForMacroProvider("bls"),
      },
      {
        workerId: "macro-engine",
        providerId: "bea",
        seriesKeys: getSeriesKeysForMacroProvider("bea"),
      },
      { workerId: "positioning-engine", providerId: "cftc" },
      { workerId: "liquidity-risk-engine", providerId: "fed_reserve" },
      { workerId: "liquidity-risk-engine", providerId: "us_treasury" },
    ];
  }

  // Run primary data workers concurrently inside isolated error boundaries
  const primarySettled = await Promise.allSettled(
    targetWorkers.map((target) =>
      runSingleWorkerIsolated({
        workerId: target.workerId,
        providerId: target.providerId,
        trigger,
        force,
        backfill,
        seriesKeys: target.seriesKeys,
        symbols: options.symbols,
      })
    )
  );

  for (const settled of primarySettled) {
    if (settled.status === "fulfilled") {
      summaries.push(settled.value.summary);
      if (settled.value.deduplicatedLock) {
        skippedLocks.push(settled.value.deduplicatedLock);
      }
      if (settled.value.error) {
        errors.push(settled.value.error);
      }
    } else {
      const msg =
        settled.reason instanceof Error
          ? settled.reason.message
          : String(settled.reason);
      errors.push({ workerId: "orchestrator", message: msg });
    }
  }

  // When dispatching the full pipeline (no specific worker/provider filter),
  // invoke AI Research Supervisor strictly AFTER validated observations exist.
  if (!options.workerId && !options.providerId) {
    const latestValues = await getLatestValues();
    if (latestValues.length > 0) {
      const aiRes = await runSingleWorkerIsolated({
        workerId: "ai-supervisor",
        providerId: "gemini",
        trigger,
        force,
        backfill: false,
      });
      summaries.push(aiRes.summary);
      if (aiRes.deduplicatedLock) skippedLocks.push(aiRes.deduplicatedLock);
      if (aiRes.error) errors.push(aiRes.error);
    }
  }

  await evaluateSourceStaleness();

  const finishedAtMs = Date.now();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);

  await updateDataHealth({
    id: "worker:orchestrator",
    entityType: "worker",
    sourceId: null,
    workerId: "orchestrator",
    status: errors.length > 0 && summaries.length === errors.length ? "FAILED" : "CURRENT",
    lastSuccessAt:
      errors.length === 0 || summaries.some((s) => s.status === "SUCCEEDED")
        ? new Date(finishedAtMs).toISOString()
        : undefined,
    lastAttemptAt: new Date(finishedAtMs).toISOString(),
    latencyMs: durationMs,
    lastError: errors.length > 0 ? errors.map((e) => e.message).join("; ") : null,
    details: {
      trigger,
      dispatchedCount: summaries.length,
      errorCount: errors.length,
    },
  });

  return {
    ok: errors.length === 0,
    trigger,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs,
    summaries,
    errors,
    ...(skippedLocks.length > 0 ? { skippedLocks } : {}),
  };
}

/**
 * Evaluates source-specific polling policies and runs only the workers whose
 * providers are due for a scheduled update.
 */
export async function runScheduledOrchestratorTick(options?: {
  force?: boolean;
  trigger?: TriggerType;
}): Promise<DispatchSyncResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const trigger = options?.trigger ?? "scheduled";
  const force = Boolean(options?.force);

  await seedDataSourcesIfNeeded();
  const healthRows = await listDataHealth();
  const healthById = new Map(healthRows.map((h) => [h.id, h]));

  const dueTasks: Array<{
    workerId: WorkerId;
    providerId: ProviderId;
    seriesKeys?: string[];
  }> = [];
  let marketEngineQueued = false;

  for (const cfg of listProviders()) {
    if (cfg.ownerWorker === "ai-supervisor") continue;
    if (!(force || isSourceDueForSync(cfg.id, healthById, startedAtMs))) {
      continue;
    }

    if (cfg.ownerWorker === "market-engine") {
      // Market engine probes all WS streams in one cycle when unconfigured; avoid 4x redundant runs
      if (!marketEngineQueued) {
        dueTasks.push({ workerId: "market-engine", providerId: cfg.id });
        marketEngineQueued = true;
      }
      continue;
    }

    dueTasks.push({
      workerId: cfg.ownerWorker,
      providerId: cfg.id,
      seriesKeys:
        cfg.ownerWorker === "macro-engine"
          ? getSeriesKeysForMacroProvider(cfg.id)
          : undefined,
    });
  }

  const summaries: WorkerExecutionSummary[] = [];
  const errors: Array<{ workerId: WorkerId; providerId?: ProviderId; message: string }> = [];
  const skippedLocks: string[] = [];

  if (dueTasks.length > 0) {
    const settledList = await Promise.allSettled(
      dueTasks.map((task) =>
        runSingleWorkerIsolated({
          workerId: task.workerId,
          providerId: task.providerId,
          trigger,
          force,
          backfill: false,
          seriesKeys: task.seriesKeys,
        })
      )
    );

    for (const settled of settledList) {
      if (settled.status === "fulfilled") {
        summaries.push(settled.value.summary);
        if (settled.value.deduplicatedLock) {
          skippedLocks.push(settled.value.deduplicatedLock);
        }
        if (settled.value.error) {
          errors.push(settled.value.error);
        }
      } else {
        const msg =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        errors.push({ workerId: "orchestrator", message: msg });
      }
    }
  }

  // Post-validation AI Supervisor check on its own hourly schedule
  if (force || isSourceDueForSync("gemini", healthById, startedAtMs)) {
    const latestValues = await getLatestValues();
    if (latestValues.length > 0) {
      const aiRes = await runSingleWorkerIsolated({
        workerId: "ai-supervisor",
        providerId: "gemini",
        trigger,
        force,
        backfill: false,
      });
      summaries.push(aiRes.summary);
      if (aiRes.deduplicatedLock) skippedLocks.push(aiRes.deduplicatedLock);
      if (aiRes.error) errors.push(aiRes.error);
    }
  }

  await evaluateSourceStaleness();

  // Trigger autonomous Agent 7 deterministic monitor sweep after scheduled orchestrator ticks
  try {
    const { runDeterministicMonitorSweep } = await import(
      "@/services/incidents/debugger-engine"
    );
    await runDeterministicMonitorSweep({
      runDbProbe: false,
      autoRemediate: true,
      invokeAi: false,
      actor: "orchestrator-scheduled-monitor",
    });
  } catch (monitorErr) {
    console.error(
      "[MacroEdge Orchestrator] Agent 7 monitor sweep failed:",
      monitorErr instanceof Error ? monitorErr.message : String(monitorErr)
    );
  }

  const finishedAtMs = Date.now();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);
  const allScheduledWorkersFailed =
    summaries.length > 0 &&
    summaries.every((summary) => summary.status === "FAILED" || summary.status === "DEAD_LETTER");
  const orchestratorStatus: SyncStatusType =
    allScheduledWorkersFailed
      ? "FAILED"
      : errors.length > 0
      ? "DELAYED"
      : "CURRENT";

  await updateDataHealth({
    id: "worker:orchestrator",
    entityType: "worker",
    sourceId: null,
    workerId: "orchestrator",
    status: orchestratorStatus,
    lastSuccessAt:
      errors.length === 0 ? new Date(finishedAtMs).toISOString() : undefined,
    lastAttemptAt: new Date(finishedAtMs).toISOString(),
    nextScheduledAt: new Date(finishedAtMs + 300_000).toISOString(),
    latencyMs: durationMs,
    lastError: errors.length > 0 ? errors.map((e) => e.message).join("; ") : null,
    details: {
      trigger,
      dueProviders: dueTasks.map((t) => t.providerId),
      dueWorkers: Array.from(new Set(dueTasks.map((t) => t.workerId))),
      summariesCount: summaries.length,
      errorCount: errors.length,
    },
  });

  return {
    ok: errors.length === 0,
    trigger,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs,
    summaries,
    errors,
    ...(skippedLocks.length > 0 ? { skippedLocks } : {}),
  };
}

/**
 * Retries a previously failed or dead-lettered sync run by ID.
 */
export async function retryFailedSyncJob(
  runId: string
): Promise<DispatchSyncResult> {
  const runs: SyncRunRecord[] = await listSyncRuns(250);
  const target = runs.find((r) => r.id === runId);

  if (!target) {
    const now = new Date().toISOString();
    return {
      ok: false,
      trigger: "recovery",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      summaries: [],
      errors: [
        {
          workerId: "orchestrator",
          message: `Sync run "${runId}" was not found`,
        },
      ],
    };
  }

  const seriesKeys = Array.isArray(target.rawPayload?.seriesKeys)
    ? target.rawPayload.seriesKeys.map(String)
    : undefined;
  const symbols = Array.isArray(target.rawPayload?.symbols)
    ? (target.rawPayload.symbols.map(String) as MarketSymbol[])
    : undefined;
  const backfill = Boolean(target.rawPayload?.backfill);

  return dispatchSyncJob({
    workerId: target.workerId,
    providerId: target.sourceId ?? undefined,
    trigger: "recovery",
    force: true,
    backfill,
    seriesKeys,
    symbols,
  });
}

// Register dispatcher with validation-recovery.ts to break circular static dependency
registerOrchestratorDispatcher(dispatchSyncJob);
