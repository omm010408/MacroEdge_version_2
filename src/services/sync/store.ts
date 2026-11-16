import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type {
  AggregateMarketBarInput,
  AnomalySeverity,
  AnomalyType,
  BarTimeframe,
  DataAnomalyRecord,
  DataHealthRecord,
  DataSourceRecord,
  LatestValueRecord,
  MacroInsightRecord,
  MarketBarRecord,
  MarketQuoteRecord,
  MarketSymbol,
  ObservationRecord,
  ProviderId,
  SyncCheckpointRecord,
  SyncRunRecord,
  SyncRunStatus,
  SyncStatusType,
  SyncSystemSnapshot,
  TriggerType,
  UpsertMarketQuoteInput,
  UpsertMarketQuoteResult,
  UpsertObservationInput,
  UpsertObservationResult,
  WorkerId,
} from "@/lib/sync/types";
import { getAllProviderStatuses, listProviders } from "@/services/sync/provider-registry";

interface LocalSyncState {
  version: number;
  dataSources: Record<string, DataSourceRecord>;
  observations: ObservationRecord[];
  latestValues: Record<string, LatestValueRecord>;
  marketQuotes: Record<string, MarketQuoteRecord>;
  marketBars: Record<string, MarketBarRecord>;
  syncRuns: SyncRunRecord[];
  dataHealth: Record<string, DataHealthRecord>;
  dataAnomalies: DataAnomalyRecord[];
  syncCheckpoints: Record<string, SyncCheckpointRecord>;
  macroInsights: MacroInsightRecord[];
}

const MAX_LOCAL_OBSERVATIONS = 5000;
const MAX_LOCAL_BARS = 3000;
const MAX_LOCAL_RUNS = 500;
const MAX_LOCAL_ANOMALIES = 500;
const MAX_LOCAL_INSIGHTS = 100;

declare global {
  var __macroedgeSyncState: LocalSyncState | undefined;
  var __macroedgeSyncMutex: Promise<void> | undefined;
  var __macroedgeDiskHydrated: boolean | undefined;
}

function getLocalStatePath(): string {
  return (
    process.env.MACROEDGE_SYNC_STATE_PATH?.trim() ||
    path.join(process.cwd(), ".macroedge-sync-state.json")
  );
}

function createInitialDataSources(): Record<string, DataSourceRecord> {
  const now = new Date().toISOString();
  const sources: Record<string, DataSourceRecord> = {};
  for (const cfg of listProviders()) {
    sources[cfg.id] = {
      id: cfg.id,
      name: cfg.name,
      category: cfg.category,
      transport: cfg.transport,
      cadence: cfg.cadence,
      expectedIntervalSeconds: cfg.expectedIntervalSeconds,
      staleAfterSeconds: cfg.staleAfterSeconds,
      rateLimitRpm: cfg.rateLimit.requestsPerMinute,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      requiresApiKey: cfg.requiresApiKey,
      envVarName: cfg.envVarName,
      baseUrl: cfg.baseUrl,
      attribution: cfg.attribution,
      enabled: cfg.enabledByDefault,
      metadata: { ownerWorker: cfg.ownerWorker, wsUrl: cfg.wsUrl ?? null },
      createdAt: now,
      updatedAt: now,
    };
  }
  return sources;
}

function createInitialHealth(): Record<string, DataHealthRecord> {
  const now = new Date().toISOString();
  const health: Record<string, DataHealthRecord> = {};
  for (const status of getAllProviderStatuses()) {
    const id = `source:${status.providerId}`;
    health[id] = {
      id,
      entityType: "source",
      sourceId: status.providerId,
      workerId: status.ownerWorker,
      status: status.configured ? status.status : "DISCONNECTED",
      lastSuccessAt: null,
      lastAttemptAt: null,
      nextScheduledAt: null,
      freshnessSeconds: null,
      consecutiveFailures: 0,
      latencyMs: null,
      lastError: null,
      details: { configured: status.configured, transport: status.transport },
      updatedAt: now,
    };
  }
  const workers: WorkerId[] = [
    "orchestrator",
    "market-engine",
    "macro-engine",
    "positioning-engine",
    "liquidity-risk-engine",
    "validation-recovery",
    "ai-supervisor",
  ];
  for (const workerId of workers) {
    const id = `worker:${workerId}`;
    health[id] = {
      id,
      entityType: "worker",
      sourceId: null,
      workerId,
      status: "CURRENT",
      lastSuccessAt: null,
      lastAttemptAt: null,
      nextScheduledAt: null,
      freshnessSeconds: null,
      consecutiveFailures: 0,
      latencyMs: null,
      lastError: null,
      details: {},
      updatedAt: now,
    };
  }
  return health;
}

function createEmptyState(): LocalSyncState {
  return {
    version: 1,
    dataSources: createInitialDataSources(),
    observations: [],
    latestValues: {},
    marketQuotes: {},
    marketBars: {},
    syncRuns: [],
    dataHealth: createInitialHealth(),
    dataAnomalies: [],
    syncCheckpoints: {},
    macroInsights: [],
  };
}

async function withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__macroedgeSyncMutex ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.__macroedgeSyncMutex = prev.then(() => current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function getLocalState(): Promise<LocalSyncState> {
  if (!globalThis.__macroedgeSyncState) {
    globalThis.__macroedgeSyncState = createEmptyState();
  }

  if (!globalThis.__macroedgeDiskHydrated && typeof window === "undefined") {
    globalThis.__macroedgeDiskHydrated = true;
    try {
      const raw = await fs.readFile(getLocalStatePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalSyncState>;
      if (parsed && typeof parsed === "object" && parsed.version === 1) {
        globalThis.__macroedgeSyncState = {
          ...createEmptyState(),
          ...parsed,
          dataSources: {
            ...createInitialDataSources(),
            ...(parsed.dataSources ?? {}),
          },
          dataHealth: {
            ...createInitialHealth(),
            ...(parsed.dataHealth ?? {}),
          },
        };
      }
    } catch {
      // No prior disk snapshot or read-only environment — keep clean initial state
    }
  }

  return globalThis.__macroedgeSyncState;
}

async function persistLocalState(state: LocalSyncState): Promise<void> {
  if (typeof window !== "undefined") return;
  const target = getLocalStatePath();
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state), "utf8");
    await fs.rename(tmp, target);
  } catch {
    // Best-effort durable file persistence; in-memory globalThis remains intact on read-only runtimes
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore cleanup error
    }
  }
}

function computeObservationChecksum(input: UpsertObservationInput): string {
  return crypto
    .createHash("sha256")
    .update(
      `${input.seriesKey}|${input.sourceId}|${input.observationDate}|${input.value}|${input.unit}`
    )
    .digest("hex");
}

function computeQuoteDedupHash(input: UpsertMarketQuoteInput): string {
  return crypto
    .createHash("sha256")
    .update(
      `${input.symbol}|${input.sourceId}|${input.price}|${input.quoteTimestamp}|${input.tickSeq ?? 0}`
    )
    .digest("hex");
}

function getClient(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) return null;
  try {
    return getSupabaseAdminClient();
  } catch {
    return null;
  }
}

export async function resetLocalSyncStoreForTests(deleteDiskFile = false): Promise<void> {
  await withLocalLock(async () => {
    globalThis.__macroedgeSyncState = createEmptyState();
    globalThis.__macroedgeDiskHydrated = true;
    if (deleteDiskFile) {
      try {
        await fs.unlink(getLocalStatePath());
      } catch {
        // ignore missing file
      }
    }
  });
}

export async function seedDataSourcesIfNeeded(): Promise<void> {
  const client = getClient();
  const sources = Object.values(createInitialDataSources());

  if (client) {
    const rows = sources.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      transport: s.transport,
      cadence: s.cadence,
      expected_interval_seconds: s.expectedIntervalSeconds,
      stale_after_seconds: s.staleAfterSeconds,
      rate_limit_rpm: s.rateLimitRpm,
      timeout_ms: s.timeoutMs,
      max_retries: s.maxRetries,
      requires_api_key: s.requiresApiKey,
      env_var_name: s.envVarName,
      base_url: s.baseUrl,
      attribution: s.attribution,
      enabled: s.enabled,
      metadata: s.metadata,
    }));
    await client.from("data_sources").upsert(rows, { onConflict: "id" });
    return;
  }

  await withLocalLock(async () => {
    const state = await getLocalState();
    for (const src of sources) {
      if (!state.dataSources[src.id]) {
        state.dataSources[src.id] = src;
      }
    }
  });
}

export async function getDataSources(): Promise<DataSourceRecord[]> {
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from("data_sources")
      .select("*")
      .order("id", { ascending: true });
    if (!error && data && data.length > 0) {
      return data.map((row) => ({
        id: row.id as ProviderId,
        name: String(row.name),
        category: row.category as DataSourceRecord["category"],
        transport: row.transport as DataSourceRecord["transport"],
        cadence: row.cadence as DataSourceRecord["cadence"],
        expectedIntervalSeconds: Number(row.expected_interval_seconds),
        staleAfterSeconds: Number(row.stale_after_seconds),
        rateLimitRpm: Number(row.rate_limit_rpm),
        timeoutMs: Number(row.timeout_ms),
        maxRetries: Number(row.max_retries),
        requiresApiKey: Boolean(row.requires_api_key),
        envVarName: row.env_var_name ? String(row.env_var_name) : null,
        baseUrl: String(row.base_url),
        attribution: String(row.attribution),
        enabled: Boolean(row.enabled),
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    }
  }

  const state = await getLocalState();
  return Object.values(state.dataSources).sort((a, b) => a.id.localeCompare(b.id));
}

export async function upsertMacroObservation(
  input: UpsertObservationInput
): Promise<UpsertObservationResult> {
  if (!Number.isFinite(input.value) || !input.observationDate || !input.publishedAt) {
    return {
      accepted: false,
      status: "REJECTED_INVALID",
      observationId: null,
      latestUpdated: false,
      revisionNumber: 0,
    };
  }

  const checksum = computeObservationChecksum(input);
  const client = getClient();

  if (client) {
    await seedDataSourcesIfNeeded();
    const { data, error } = await client.rpc("upsert_macro_observation", {
      p_series_key: input.seriesKey,
      p_source_id: input.sourceId,
      p_external_series_id: input.externalSeriesId,
      p_observation_date: input.observationDate,
      p_published_at: input.publishedAt,
      p_value: input.value,
      p_previous_value: input.previousValue,
      p_unit: input.unit,
      p_cadence: input.cadence,
      p_source_attribution: input.sourceAttribution,
      p_checksum: checksum,
      p_status: input.status ?? "CURRENT",
      p_raw_payload: input.rawPayload ?? {},
    });

    if (!error && data) {
      const payload = data as {
        accepted?: boolean;
        status?: UpsertObservationResult["status"];
        observation_id?: string | null;
        latest_updated?: boolean;
        revision_number?: number;
      };
      return {
        accepted: Boolean(payload.accepted),
        status: payload.status ?? "UPSERTED",
        observationId: payload.observation_id ?? null,
        latestUpdated: Boolean(payload.latest_updated),
        revisionNumber: Number(payload.revision_number ?? 1),
      };
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const now = new Date().toISOString();

    const existingVintage = state.observations.find(
      (o) =>
        o.seriesKey === input.seriesKey &&
        o.sourceId === input.sourceId &&
        o.observationDate === input.observationDate &&
        o.isLatest
    );

    let obsId: string;
    let revisionNumber = 1;

    if (existingVintage) {
      if (input.publishedAt < existingVintage.publishedAt) {
        state.dataAnomalies.unshift({
          id: crypto.randomUUID(),
          seriesKey: input.seriesKey,
          sourceId: input.sourceId,
          workerId: input.workerId ?? "validation-recovery",
          severity: "WARN",
          anomalyType: "NON_MONOTONIC_REJECTED",
          message: `Rejected older vintage (${input.publishedAt} < ${existingVintage.publishedAt}) for ${input.seriesKey} @ ${input.observationDate}`,
          observedValue: String(input.value),
          expectedRange: `publishedAt >= ${existingVintage.publishedAt}`,
          resolved: false,
          resolvedAt: null,
          rawPayload: { incoming: input.publishedAt, existing: existingVintage.publishedAt },
          detectedAt: now,
        });
        state.dataAnomalies = state.dataAnomalies.slice(0, MAX_LOCAL_ANOMALIES);
        await persistLocalState(state);

        return {
          accepted: false,
          status: "REJECTED_OLDER_VINTAGE",
          observationId: existingVintage.id,
          latestUpdated: false,
          revisionNumber: existingVintage.revisionNumber,
        };
      }

      if (existingVintage.checksum === checksum && existingVintage.value === input.value) {
        existingVintage.fetchedAt = now;
        obsId = existingVintage.id;
        revisionNumber = existingVintage.revisionNumber;
      } else {
        existingVintage.isLatest = false;
        revisionNumber = existingVintage.revisionNumber + 1;
        obsId = crypto.randomUUID();
        state.observations.unshift({
          id: obsId,
          seriesKey: input.seriesKey,
          sourceId: input.sourceId,
          externalSeriesId: input.externalSeriesId,
          observationDate: input.observationDate,
          publishedAt: input.publishedAt,
          fetchedAt: now,
          value: input.value,
          previousValue: input.previousValue,
          unit: input.unit,
          cadence: input.cadence,
          revisionNumber,
          isLatest: true,
          validationStatus: input.validationStatus ?? "VALIDATED",
          checksum,
          rawPayload: input.rawPayload ?? {},
          createdAt: now,
        });
      }
    } else {
      obsId = crypto.randomUUID();
      state.observations.unshift({
        id: obsId,
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        externalSeriesId: input.externalSeriesId,
        observationDate: input.observationDate,
        publishedAt: input.publishedAt,
        fetchedAt: now,
        value: input.value,
        previousValue: input.previousValue,
        unit: input.unit,
        cadence: input.cadence,
        revisionNumber: 1,
        isLatest: true,
        validationStatus: input.validationStatus ?? "VALIDATED",
        checksum,
        rawPayload: input.rawPayload ?? {},
        createdAt: now,
      });
    }

    if (state.observations.length > MAX_LOCAL_OBSERVATIONS) {
      state.observations = state.observations.slice(0, MAX_LOCAL_OBSERVATIONS);
    }

    const existingLatest = state.latestValues[input.seriesKey];
    const shouldUpdateLatest =
      !existingLatest ||
      input.observationDate > existingLatest.observationDate ||
      (input.observationDate === existingLatest.observationDate &&
        input.publishedAt >= existingLatest.publishedAt);

    if (shouldUpdateLatest) {
      const changeValue =
        input.previousValue !== null ? Number((input.value - input.previousValue).toFixed(6)) : null;
      const changePct =
        input.previousValue !== null && input.previousValue !== 0
          ? Number((((input.value - input.previousValue) / input.previousValue) * 100).toFixed(4))
          : null;

      state.latestValues[input.seriesKey] = {
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        externalSeriesId: input.externalSeriesId,
        latestObservationId: obsId,
        observationDate: input.observationDate,
        publishedAt: input.publishedAt,
        fetchedAt: now,
        value: input.value,
        previousValue: input.previousValue,
        changeValue,
        changePct,
        unit: input.unit,
        cadence: input.cadence,
        status: input.status ?? "CURRENT",
        revisionNumber,
        sourceAttribution: input.sourceAttribution,
        rawPayload: input.rawPayload ?? {},
        updatedAt: now,
      };
    }

    await persistLocalState(state);

    return {
      accepted: true,
      status: shouldUpdateLatest
        ? existingVintage && existingVintage.checksum === checksum
          ? "UNCHANGED"
          : "UPSERTED"
        : "VINTAGE_ONLY_OLDER_THAN_LATEST",
      observationId: obsId,
      latestUpdated: shouldUpdateLatest,
      revisionNumber,
    };
  });
}

export async function upsertMarketQuote(
  input: UpsertMarketQuoteInput
): Promise<UpsertMarketQuoteResult> {
  const dedupHash = computeQuoteDedupHash(input);
  const previousClose = input.previousClose ?? null;
  const changeValue =
    input.changeValue ??
    (previousClose !== null ? Number((input.price - previousClose).toFixed(6)) : 0);
  const changePct =
    input.changePct ??
    (previousClose !== null && previousClose !== 0
      ? Number((((input.price - previousClose) / previousClose) * 100).toFixed(4))
      : 0);
  const tickSeq = input.tickSeq ?? 0;
  const client = getClient();

  if (client) {
    await seedDataSourcesIfNeeded();
    const { data, error } = await client.rpc("upsert_market_quote", {
      p_symbol: input.symbol,
      p_source_id: input.sourceId,
      p_external_symbol: input.externalSymbol,
      p_asset_class: input.assetClass,
      p_price: input.price,
      p_bid: input.bid ?? null,
      p_ask: input.ask ?? null,
      p_previous_close: previousClose,
      p_change_value: changeValue,
      p_change_pct: changePct,
      p_volume: input.volume ?? null,
      p_unit: input.unit ?? "",
      p_tick_seq: tickSeq,
      p_quote_timestamp: input.quoteTimestamp,
      p_status: input.status ?? "LIVE",
      p_dedup_hash: dedupHash,
      p_raw_payload: input.rawPayload ?? {},
    });

    if (!error && data) {
      const payload = data as { accepted?: boolean };
      return {
        accepted: Boolean(payload.accepted),
        symbol: input.symbol,
        reason: payload.accepted ? undefined : "DEDUP_OR_STALE_TICK",
      };
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const existing = state.marketQuotes[input.symbol];

    if (existing) {
      const duplicate = existing.dedupHash === dedupHash;
      const olderTimestamp = input.quoteTimestamp < existing.quoteTimestamp;
      const olderSeqSameTs =
        input.quoteTimestamp === existing.quoteTimestamp && tickSeq < existing.tickSeq;
      if (olderTimestamp || olderSeqSameTs) {
        return {
          accepted: false,
          symbol: input.symbol,
          reason: "DEDUP_OR_STALE_TICK",
        };
      }
      if (duplicate) {
        const now = new Date().toISOString();
        existing.receivedAt = now;
        existing.updatedAt = now;
        if (input.status) {
          existing.status = input.status;
        }
        await persistLocalState(state);
        return {
          accepted: false,
          symbol: input.symbol,
          reason: "DEDUP_OR_STALE_TICK",
        };
      }
    }

    const now = new Date().toISOString();
    state.marketQuotes[input.symbol] = {
      symbol: input.symbol,
      sourceId: input.sourceId,
      externalSymbol: input.externalSymbol,
      assetClass: input.assetClass,
      price: input.price,
      bid: input.bid ?? null,
      ask: input.ask ?? null,
      previousClose,
      changeValue,
      changePct,
      volume: input.volume ?? null,
      unit: input.unit ?? "",
      tickSeq,
      quoteTimestamp: input.quoteTimestamp,
      receivedAt: now,
      status: input.status ?? "LIVE",
      dedupHash,
      rawPayload: input.rawPayload ?? {},
      updatedAt: now,
    };

    await persistLocalState(state);
    return { accepted: true, symbol: input.symbol };
  });
}

export async function aggregateMarketBar(
  input: AggregateMarketBarInput
): Promise<MarketBarRecord> {
  const client = getClient();
  const barVolume = input.volume ?? 0;

  if (client) {
    const { data: existing } = await client
      .from("market_bars")
      .select("*")
      .eq("symbol", input.symbol)
      .eq("timeframe", input.timeframe)
      .eq("bar_time", input.barTime)
      .maybeSingle();

    const now = new Date().toISOString();
    const record = existing
      ? {
          symbol: input.symbol,
          source_id: input.sourceId,
          timeframe: input.timeframe,
          bar_time: input.barTime,
          open: Number(existing.open),
          high: Math.max(Number(existing.high), input.price),
          low: Math.min(Number(existing.low), input.price),
          close: input.price,
          volume: Number(existing.volume) + barVolume,
          tick_count: Number(existing.tick_count) + 1,
          is_closed: Boolean(input.isClosed ?? existing.is_closed),
          raw_payload: input.rawPayload ?? {},
          updated_at: now,
        }
      : {
          symbol: input.symbol,
          source_id: input.sourceId,
          timeframe: input.timeframe,
          bar_time: input.barTime,
          open: input.price,
          high: input.price,
          low: input.price,
          close: input.price,
          volume: barVolume,
          tick_count: 1,
          is_closed: Boolean(input.isClosed ?? false),
          raw_payload: input.rawPayload ?? {},
          updated_at: now,
        };

    const { data: upserted } = await client
      .from("market_bars")
      .upsert(record, { onConflict: "symbol,timeframe,bar_time" })
      .select("*")
      .single();

    if (upserted) {
      return {
        id: String(upserted.id),
        symbol: upserted.symbol as MarketSymbol,
        sourceId: upserted.source_id as ProviderId,
        timeframe: upserted.timeframe as BarTimeframe,
        barTime: String(upserted.bar_time),
        open: Number(upserted.open),
        high: Number(upserted.high),
        low: Number(upserted.low),
        close: Number(upserted.close),
        volume: Number(upserted.volume),
        tickCount: Number(upserted.tick_count),
        isClosed: Boolean(upserted.is_closed),
        rawPayload: (upserted.raw_payload as Record<string, unknown>) ?? {},
        updatedAt: String(upserted.updated_at),
      };
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const key = `${input.symbol}:${input.timeframe}:${input.barTime}`;
    const existing = state.marketBars[key];
    const now = new Date().toISOString();

    const updated: MarketBarRecord = existing
      ? {
          ...existing,
          sourceId: input.sourceId,
          high: Math.max(existing.high, input.price),
          low: Math.min(existing.low, input.price),
          close: input.price,
          volume: existing.volume + barVolume,
          tickCount: existing.tickCount + 1,
          isClosed: input.isClosed ?? existing.isClosed,
          rawPayload: input.rawPayload ?? existing.rawPayload,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          symbol: input.symbol,
          sourceId: input.sourceId,
          timeframe: input.timeframe,
          barTime: input.barTime,
          open: input.price,
          high: input.price,
          low: input.price,
          close: input.price,
          volume: barVolume,
          tickCount: 1,
          isClosed: Boolean(input.isClosed ?? false),
          rawPayload: input.rawPayload ?? {},
          updatedAt: now,
        };

    state.marketBars[key] = updated;
    const keys = Object.keys(state.marketBars);
    if (keys.length > MAX_LOCAL_BARS) {
      const sorted = Object.values(state.marketBars).sort((a, b) =>
        b.barTime.localeCompare(a.barTime)
      );
      state.marketBars = Object.fromEntries(
        sorted
          .slice(0, MAX_LOCAL_BARS)
          .map((b) => [`${b.symbol}:${b.timeframe}:${b.barTime}`, b])
      );
    }

    await persistLocalState(state);
    return updated;
  });
}

export async function recordSyncRunStart(params: {
  workerId: WorkerId;
  sourceId?: ProviderId | null;
  jobName: string;
  triggerType?: TriggerType;
  attempt?: number;
  maxAttempts?: number;
  rawPayload?: Record<string, unknown>;
}): Promise<SyncRunRecord> {
  const now = new Date().toISOString();
  const run: SyncRunRecord = {
    id: crypto.randomUUID(),
    workerId: params.workerId,
    sourceId: params.sourceId ?? null,
    jobName: params.jobName,
    triggerType: params.triggerType ?? "scheduled",
    status: "RUNNING",
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    recordsFetched: 0,
    recordsValidated: 0,
    recordsUpserted: 0,
    recordsRejected: 0,
    attempt: params.attempt ?? 1,
    maxAttempts: params.maxAttempts ?? 3,
    deadLettered: false,
    errorCode: null,
    errorMessage: null,
    rawPayload: params.rawPayload ?? {},
  };

  const client = getClient();
  if (client) {
    const { data } = await client
      .from("sync_runs")
      .insert({
        id: run.id,
        worker_id: run.workerId,
        source_id: run.sourceId,
        job_name: run.jobName,
        trigger_type: run.triggerType,
        status: run.status,
        started_at: run.startedAt,
        attempt: run.attempt,
        max_attempts: run.maxAttempts,
        dead_lettered: false,
        raw_payload: run.rawPayload,
      })
      .select("*")
      .single();
    if (data) {
      return { ...run, id: String(data.id) };
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    state.syncRuns.unshift(run);
    state.syncRuns = state.syncRuns.slice(0, MAX_LOCAL_RUNS);
    await persistLocalState(state);
    return run;
  });
}

export async function completeSyncRun(
  runId: string,
  update: {
    status: Exclude<SyncRunStatus, "RUNNING">;
    recordsFetched?: number;
    recordsValidated?: number;
    recordsUpserted?: number;
    recordsRejected?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    deadLettered?: boolean;
    rawPayload?: Record<string, unknown>;
  }
): Promise<SyncRunRecord | null> {
  const finishedAt = new Date().toISOString();
  const client = getClient();

  if (client) {
    const { data: existing } = await client
      .from("sync_runs")
      .select("started_at, attempt, max_attempts")
      .eq("id", runId)
      .maybeSingle();

    const startedMs = existing?.started_at ? Date.parse(String(existing.started_at)) : Date.now();
    const durationMs = Math.max(0, Date.now() - startedMs);
    const deadLettered =
      update.deadLettered ??
      (update.status === "DEAD_LETTER" ||
        (update.status === "FAILED" &&
          Number(existing?.attempt ?? 1) >= Number(existing?.max_attempts ?? 3)));

    const { data } = await client
      .from("sync_runs")
      .update({
        status: deadLettered ? "DEAD_LETTER" : update.status,
        finished_at: finishedAt,
        duration_ms: durationMs,
        records_fetched: update.recordsFetched ?? 0,
        records_validated: update.recordsValidated ?? 0,
        records_upserted: update.recordsUpserted ?? 0,
        records_rejected: update.recordsRejected ?? 0,
        dead_lettered: deadLettered,
        error_code: update.errorCode ?? null,
        error_message: update.errorMessage ?? null,
        raw_payload: update.rawPayload ?? {},
      })
      .eq("id", runId)
      .select("*")
      .maybeSingle();

    if (data) {
      return mapDbSyncRun(data);
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const idx = state.syncRuns.findIndex((r) => r.id === runId);
    if (idx === -1) return null;

    const current = state.syncRuns[idx];
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(current.startedAt));
    const deadLettered =
      update.deadLettered ??
      (update.status === "DEAD_LETTER" ||
        (update.status === "FAILED" && current.attempt >= current.maxAttempts));

    const updated: SyncRunRecord = {
      ...current,
      status: deadLettered ? "DEAD_LETTER" : update.status,
      finishedAt,
      durationMs,
      recordsFetched: update.recordsFetched ?? current.recordsFetched,
      recordsValidated: update.recordsValidated ?? current.recordsValidated,
      recordsUpserted: update.recordsUpserted ?? current.recordsUpserted,
      recordsRejected: update.recordsRejected ?? current.recordsRejected,
      deadLettered,
      errorCode: update.errorCode ?? null,
      errorMessage: update.errorMessage ?? null,
      rawPayload: update.rawPayload ?? current.rawPayload,
    };

    state.syncRuns[idx] = updated;
    await persistLocalState(state);
    return updated;
  });
}

export async function updateDataHealth(params: {
  id: string;
  entityType: "source" | "worker";
  sourceId?: ProviderId | null;
  workerId?: WorkerId | null;
  status: SyncStatusType;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  nextScheduledAt?: string | null;
  freshnessSeconds?: number | null;
  consecutiveFailures?: number;
  latencyMs?: number | null;
  lastError?: string | null;
  details?: Record<string, unknown>;
}): Promise<DataHealthRecord> {
  const now = new Date().toISOString();
  const client = getClient();

  if (client) {
    const { data: existing } = await client
      .from("data_health")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    const record = {
      id: params.id,
      entity_type: params.entityType,
      source_id: params.sourceId ?? null,
      worker_id: params.workerId ?? null,
      status: params.status,
      last_success_at:
        params.lastSuccessAt !== undefined
          ? params.lastSuccessAt
          : existing?.last_success_at ?? null,
      last_attempt_at: params.lastAttemptAt ?? now,
      next_scheduled_at:
        params.nextScheduledAt !== undefined
          ? params.nextScheduledAt
          : existing?.next_scheduled_at ?? null,
      freshness_seconds:
        params.freshnessSeconds !== undefined
          ? params.freshnessSeconds
          : existing?.freshness_seconds ?? null,
      consecutive_failures:
        params.consecutiveFailures !== undefined
          ? params.consecutiveFailures
          : Number(existing?.consecutive_failures ?? 0),
      latency_ms:
        params.latencyMs !== undefined ? params.latencyMs : existing?.latency_ms ?? null,
      last_error:
        params.lastError !== undefined ? params.lastError : existing?.last_error ?? null,
      details: params.details ?? (existing?.details as Record<string, unknown>) ?? {},
      updated_at: now,
    };

    const { data } = await client
      .from("data_health")
      .upsert(record, { onConflict: "id" })
      .select("*")
      .single();

    if (data) {
      return mapDbHealth(data);
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const existing = state.dataHealth[params.id];
    const updated: DataHealthRecord = {
      id: params.id,
      entityType: params.entityType,
      sourceId: params.sourceId ?? existing?.sourceId ?? null,
      workerId: params.workerId ?? existing?.workerId ?? null,
      status: params.status,
      lastSuccessAt:
        params.lastSuccessAt !== undefined
          ? params.lastSuccessAt
          : existing?.lastSuccessAt ?? null,
      lastAttemptAt: params.lastAttemptAt ?? now,
      nextScheduledAt:
        params.nextScheduledAt !== undefined
          ? params.nextScheduledAt
          : existing?.nextScheduledAt ?? null,
      freshnessSeconds:
        params.freshnessSeconds !== undefined
          ? params.freshnessSeconds
          : existing?.freshnessSeconds ?? null,
      consecutiveFailures:
        params.consecutiveFailures !== undefined
          ? params.consecutiveFailures
          : existing?.consecutiveFailures ?? 0,
      latencyMs: params.latencyMs !== undefined ? params.latencyMs : existing?.latencyMs ?? null,
      lastError: params.lastError !== undefined ? params.lastError : existing?.lastError ?? null,
      details: params.details ?? existing?.details ?? {},
      updatedAt: now,
    };

    state.dataHealth[params.id] = updated;
    await persistLocalState(state);
    return updated;
  });
}

export async function recordAnomaly(params: {
  seriesKey: string;
  sourceId?: ProviderId | null;
  workerId: WorkerId;
  severity: AnomalySeverity;
  anomalyType: AnomalyType;
  message: string;
  observedValue?: string | null;
  expectedRange?: string | null;
  rawPayload?: Record<string, unknown>;
}): Promise<DataAnomalyRecord> {
  const now = new Date().toISOString();
  const anomaly: DataAnomalyRecord = {
    id: crypto.randomUUID(),
    seriesKey: params.seriesKey,
    sourceId: params.sourceId ?? null,
    workerId: params.workerId,
    severity: params.severity,
    anomalyType: params.anomalyType,
    message: params.message,
    observedValue: params.observedValue ?? null,
    expectedRange: params.expectedRange ?? null,
    resolved: false,
    resolvedAt: null,
    rawPayload: params.rawPayload ?? {},
    detectedAt: now,
  };

  const client = getClient();
  if (client) {
    const { data } = await client
      .from("data_anomalies")
      .insert({
        id: anomaly.id,
        series_key: anomaly.seriesKey,
        source_id: anomaly.sourceId,
        worker_id: anomaly.workerId,
        severity: anomaly.severity,
        anomaly_type: anomaly.anomalyType,
        message: anomaly.message,
        observed_value: anomaly.observedValue,
        expected_range: anomaly.expectedRange,
        resolved: false,
        raw_payload: anomaly.rawPayload,
        detected_at: anomaly.detectedAt,
      })
      .select("*")
      .single();
    if (data) {
      return mapDbAnomaly(data);
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    state.dataAnomalies.unshift(anomaly);
    state.dataAnomalies = state.dataAnomalies.slice(0, MAX_LOCAL_ANOMALIES);
    await persistLocalState(state);
    return anomaly;
  });
}

export async function resolveAnomaly(anomalyId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const client = getClient();
  if (client) {
    const { error } = await client
      .from("data_anomalies")
      .update({ resolved: true, resolved_at: now })
      .eq("id", anomalyId);
    if (!error) return true;
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    const target = state.dataAnomalies.find((a) => a.id === anomalyId);
    if (!target) return false;
    target.resolved = true;
    target.resolvedAt = now;
    await persistLocalState(state);
    return true;
  });
}

export async function getCheckpoint(
  checkpointKey: string
): Promise<SyncCheckpointRecord | null> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("sync_checkpoints")
      .select("*")
      .eq("checkpoint_key", checkpointKey)
      .maybeSingle();
    if (data) {
      return mapDbCheckpoint(data);
    }
  }

  const state = await getLocalState();
  return state.syncCheckpoints[checkpointKey] ?? null;
}

export async function upsertCheckpoint(
  checkpoint: Omit<SyncCheckpointRecord, "updatedAt">
): Promise<SyncCheckpointRecord> {
  const now = new Date().toISOString();
  const record: SyncCheckpointRecord = { ...checkpoint, updatedAt: now };
  const client = getClient();

  if (client) {
    const { data } = await client
      .from("sync_checkpoints")
      .upsert(
        {
          checkpoint_key: record.checkpointKey,
          worker_id: record.workerId,
          source_id: record.sourceId,
          cursor_value: record.cursorValue,
          last_observation_date: record.lastObservationDate,
          last_published_at: record.lastPublishedAt,
          retry_count: record.retryCount,
          next_retry_at: record.nextRetryAt,
          metadata: record.metadata,
          updated_at: now,
        },
        { onConflict: "checkpoint_key" }
      )
      .select("*")
      .single();
    if (data) {
      return mapDbCheckpoint(data);
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    state.syncCheckpoints[record.checkpointKey] = record;
    await persistLocalState(state);
    return record;
  });
}

export async function listCheckpoints(
  limit = 100
): Promise<SyncCheckpointRecord[]> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("sync_checkpoints")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (data) {
      return data.map(mapDbCheckpoint);
    }
  }

  const state = await getLocalState();
  return Object.values(state.syncCheckpoints)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/**
 * Persists post-validation Gemini AI research insights.
 * Strictly read-only relative to data_observations and latest_values.
 */
export async function saveMacroInsight(
  insight: Omit<MacroInsightRecord, "id" | "generatedAt">
): Promise<MacroInsightRecord> {
  const now = new Date().toISOString();
  const record: MacroInsightRecord = {
    ...insight,
    id: crypto.randomUUID(),
    generatedAt: now,
  };

  const client = getClient();
  if (client) {
    const { data } = await client
      .from("macro_insights")
      .insert({
        id: record.id,
        scope: record.scope,
        model_id: record.modelId,
        title: record.title,
        summary: record.summary,
        key_drivers: record.keyDrivers,
        risk_flags: record.riskFlags,
        source_observation_ids: record.sourceObservationIds,
        source_series_keys: record.sourceSeriesKeys,
        based_on_latest_at: record.basedOnLatestAt,
        confidence_note: record.confidenceNote,
        raw_payload: record.rawPayload,
        generated_at: now,
        expires_at: record.expiresAt,
      })
      .select("*")
      .single();
    if (data) {
      return mapDbInsight(data);
    }
  }

  return withLocalLock(async () => {
    const state = await getLocalState();
    state.macroInsights.unshift(record);
    state.macroInsights = state.macroInsights.slice(0, MAX_LOCAL_INSIGHTS);
    await persistLocalState(state);
    return record;
  });
}

export async function getLatestValues(): Promise<LatestValueRecord[]> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("latest_values")
      .select("*")
      .order("series_key", { ascending: true });
    if (data) {
      return data.map(mapDbLatestValue);
    }
  }

  const state = await getLocalState();
  return Object.values(state.latestValues).sort((a, b) =>
    a.seriesKey.localeCompare(b.seriesKey)
  );
}

export async function getObservations(
  seriesKey?: string,
  limit = 120
): Promise<ObservationRecord[]> {
  const client = getClient();
  if (client) {
    let query = client
      .from("data_observations")
      .select("*")
      .order("observation_date", { ascending: false })
      .order("revision_number", { ascending: false })
      .limit(limit);
    if (seriesKey) {
      query = query.eq("series_key", seriesKey);
    }
    const { data } = await query;
    if (data) {
      return data.map(mapDbObservation);
    }
  }

  const state = await getLocalState();
  const filtered = seriesKey
    ? state.observations.filter((o) => o.seriesKey === seriesKey)
    : state.observations;
  const sorted = [...filtered].sort((a, b) => {
    if (b.observationDate !== a.observationDate) {
      return b.observationDate.localeCompare(a.observationDate);
    }
    if (b.publishedAt !== a.publishedAt) {
      return b.publishedAt.localeCompare(a.publishedAt);
    }
    return b.revisionNumber - a.revisionNumber;
  });
  return sorted.slice(0, limit);
}

export async function getMarketQuotes(): Promise<MarketQuoteRecord[]> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("market_quotes")
      .select("*")
      .order("symbol", { ascending: true });
    if (data) {
      return data.map(mapDbMarketQuote);
    }
  }

  const state = await getLocalState();
  return Object.values(state.marketQuotes).sort((a, b) =>
    a.symbol.localeCompare(b.symbol)
  );
}

export async function getMarketBars(
  symbol?: MarketSymbol,
  timeframe?: BarTimeframe,
  limit = 100
): Promise<MarketBarRecord[]> {
  const client = getClient();
  if (client) {
    let query = client
      .from("market_bars")
      .select("*")
      .order("bar_time", { ascending: false })
      .limit(limit);
    if (symbol) query = query.eq("symbol", symbol);
    if (timeframe) query = query.eq("timeframe", timeframe);
    const { data } = await query;
    if (data) {
      return data.map(mapDbMarketBar);
    }
  }

  const state = await getLocalState();
  return Object.values(state.marketBars)
    .filter((b) => (!symbol || b.symbol === symbol) && (!timeframe || b.timeframe === timeframe))
    .sort((a, b) => b.barTime.localeCompare(a.barTime))
    .slice(0, limit);
}

export async function listSyncRuns(limit = 50): Promise<SyncRunRecord[]> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (data) {
      return data.map(mapDbSyncRun);
    }
  }

  const state = await getLocalState();
  return state.syncRuns.slice(0, limit);
}

export async function listDataHealth(): Promise<DataHealthRecord[]> {
  const client = getClient();
  if (client) {
    const { data } = await client
      .from("data_health")
      .select("*")
      .order("id", { ascending: true });
    if (data && data.length > 0) {
      return data.map(mapDbHealth);
    }
  }

  const state = await getLocalState();
  return Object.values(state.dataHealth).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listAnomalies(
  includeResolved = false,
  limit = 100
): Promise<DataAnomalyRecord[]> {
  const client = getClient();
  if (client) {
    let query = client
      .from("data_anomalies")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(limit);
    if (!includeResolved) {
      query = query.eq("resolved", false);
    }
    const { data } = await query;
    if (data) {
      return data.map(mapDbAnomaly);
    }
  }

  const state = await getLocalState();
  return state.dataAnomalies
    .filter((a) => includeResolved || !a.resolved)
    .slice(0, limit);
}

export async function listMacroInsights(
  scope?: MacroInsightRecord["scope"],
  limit = 20
): Promise<MacroInsightRecord[]> {
  const client = getClient();
  if (client) {
    let query = client
      .from("macro_insights")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(limit);
    if (scope) query = query.eq("scope", scope);
    const { data } = await query;
    if (data) {
      return data.map(mapDbInsight);
    }
  }

  const state = await getLocalState();
  return state.macroInsights
    .filter((i) => !scope || i.scope === scope)
    .slice(0, limit);
}

function deriveOverallStatus(health: DataHealthRecord[]): SyncStatusType {
  if (health.length === 0) return "DISCONNECTED";
  const statuses = new Set(health.map((h) => h.status));
  if (statuses.has("FAILED")) return "FAILED";
  if (statuses.has("STALE")) return "STALE";
  if (statuses.has("LIVE")) return "LIVE";
  if (statuses.has("CURRENT")) return "CURRENT";
  if (statuses.has("DELAYED")) return "DELAYED";
  return "DISCONNECTED";
}

export async function getSyncSystemSnapshot(): Promise<SyncSystemSnapshot> {
  const client = getClient();
  const persistenceMode = client
    ? "SUPABASE_POSTGRES"
    : "LOCAL_DURABLE_STORE";

  const [
    dataSources,
    latestValues,
    marketQuotes,
    recentBars,
    recentRuns,
    health,
    anomalies,
    insights,
    observations,
    checkpoints,
  ] = await Promise.all([
    getDataSources(),
    getLatestValues(),
    getMarketQuotes(),
    getMarketBars(undefined, undefined, 50),
    listSyncRuns(40),
    listDataHealth(),
    listAnomalies(false, 50),
    listMacroInsights(undefined, 10),
    getObservations(undefined, 50),
    listCheckpoints(100),
  ]);

  let observationsCount = observations.length;
  let marketBarsCount = recentBars.length;
  let openAnomaliesCount = anomalies.length;
  let deadLetterRunsCount = recentRuns.filter((r) => r.deadLettered).length;

  if (client) {
    const [obsCountRes, barsCountRes, openAnomRes, dlqRes] = await Promise.all([
      client.from("data_observations").select("*", { count: "exact", head: true }),
      client.from("market_bars").select("*", { count: "exact", head: true }),
      client
        .from("data_anomalies")
        .select("*", { count: "exact", head: true })
        .eq("resolved", false),
      client
        .from("sync_runs")
        .select("*", { count: "exact", head: true })
        .eq("dead_lettered", true),
    ]);
    if (typeof obsCountRes.count === "number") observationsCount = obsCountRes.count;
    if (typeof barsCountRes.count === "number") marketBarsCount = barsCountRes.count;
    if (typeof openAnomRes.count === "number") openAnomaliesCount = openAnomRes.count;
    if (typeof dlqRes.count === "number") deadLetterRunsCount = dlqRes.count;
  } else {
    const localState = await getLocalState();
    observationsCount = localState.observations.length;
    marketBarsCount = Object.keys(localState.marketBars).length;
    openAnomaliesCount = localState.dataAnomalies.filter((a) => !a.resolved).length;
    deadLetterRunsCount = localState.syncRuns.filter((r) => r.deadLettered).length;
  }

  return {
    persistenceMode,
    generatedAt: new Date().toISOString(),
    overallStatus: deriveOverallStatus(health),
    providers: getAllProviderStatuses(),
    dataSources,
    latestValues,
    marketQuotes,
    recentBars,
    recentRuns,
    health,
    anomalies,
    checkpoints,
    insights,
    counts: {
      observations: observationsCount,
      latestValues: latestValues.length,
      marketQuotes: marketQuotes.length,
      marketBars: marketBarsCount,
      openAnomalies: openAnomaliesCount,
      deadLetterRuns: deadLetterRunsCount,
    },
  };
}

function mapDbObservation(row: Record<string, unknown>): ObservationRecord {
  return {
    id: String(row.id),
    seriesKey: String(row.series_key),
    sourceId: row.source_id as ProviderId,
    externalSeriesId: String(row.external_series_id),
    observationDate: String(row.observation_date),
    publishedAt: String(row.published_at),
    fetchedAt: String(row.fetched_at),
    value: Number(row.value),
    previousValue: row.previous_value !== null ? Number(row.previous_value) : null,
    unit: String(row.unit),
    cadence: row.cadence as ObservationRecord["cadence"],
    revisionNumber: Number(row.revision_number),
    isLatest: Boolean(row.is_latest),
    validationStatus: row.validation_status as ObservationRecord["validationStatus"],
    checksum: String(row.checksum),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

function mapDbLatestValue(row: Record<string, unknown>): LatestValueRecord {
  return {
    seriesKey: String(row.series_key),
    sourceId: row.source_id as ProviderId,
    externalSeriesId: String(row.external_series_id),
    latestObservationId: row.latest_observation_id ? String(row.latest_observation_id) : null,
    observationDate: String(row.observation_date),
    publishedAt: String(row.published_at),
    fetchedAt: String(row.fetched_at),
    value: Number(row.value),
    previousValue: row.previous_value !== null ? Number(row.previous_value) : null,
    changeValue: row.change_value !== null ? Number(row.change_value) : null,
    changePct: row.change_pct !== null ? Number(row.change_pct) : null,
    unit: String(row.unit),
    cadence: row.cadence as LatestValueRecord["cadence"],
    status: row.status as SyncStatusType,
    revisionNumber: Number(row.revision_number),
    sourceAttribution: String(row.source_attribution),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    updatedAt: String(row.updated_at),
  };
}

function mapDbMarketQuote(row: Record<string, unknown>): MarketQuoteRecord {
  return {
    symbol: row.symbol as MarketSymbol,
    sourceId: row.source_id as ProviderId,
    externalSymbol: String(row.external_symbol),
    assetClass: row.asset_class as MarketQuoteRecord["assetClass"],
    price: Number(row.price),
    bid: row.bid !== null ? Number(row.bid) : null,
    ask: row.ask !== null ? Number(row.ask) : null,
    previousClose: row.previous_close !== null ? Number(row.previous_close) : null,
    changeValue: Number(row.change_value),
    changePct: Number(row.change_pct),
    volume: row.volume !== null ? Number(row.volume) : null,
    unit: String(row.unit),
    tickSeq: Number(row.tick_seq),
    quoteTimestamp: String(row.quote_timestamp),
    receivedAt: String(row.received_at),
    status: row.status as SyncStatusType,
    dedupHash: String(row.dedup_hash),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    updatedAt: String(row.updated_at),
  };
}

function mapDbMarketBar(row: Record<string, unknown>): MarketBarRecord {
  return {
    id: String(row.id),
    symbol: row.symbol as MarketSymbol,
    sourceId: row.source_id as ProviderId,
    timeframe: row.timeframe as BarTimeframe,
    barTime: String(row.bar_time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    tickCount: Number(row.tick_count),
    isClosed: Boolean(row.is_closed),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    updatedAt: String(row.updated_at),
  };
}

function mapDbSyncRun(row: Record<string, unknown>): SyncRunRecord {
  return {
    id: String(row.id),
    workerId: row.worker_id as WorkerId,
    sourceId: row.source_id ? (row.source_id as ProviderId) : null,
    jobName: String(row.job_name),
    triggerType: row.trigger_type as TriggerType,
    status: row.status as SyncRunStatus,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    durationMs: row.duration_ms !== null ? Number(row.duration_ms) : null,
    recordsFetched: Number(row.records_fetched),
    recordsValidated: Number(row.records_validated),
    recordsUpserted: Number(row.records_upserted),
    recordsRejected: Number(row.records_rejected),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    deadLettered: Boolean(row.dead_lettered),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
  };
}

function mapDbHealth(row: Record<string, unknown>): DataHealthRecord {
  return {
    id: String(row.id),
    entityType: row.entity_type as "source" | "worker",
    sourceId: row.source_id ? (row.source_id as ProviderId) : null,
    workerId: row.worker_id ? (row.worker_id as WorkerId) : null,
    status: row.status as SyncStatusType,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    nextScheduledAt: row.next_scheduled_at ? String(row.next_scheduled_at) : null,
    freshnessSeconds: row.freshness_seconds !== null ? Number(row.freshness_seconds) : null,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    latencyMs: row.latency_ms !== null ? Number(row.latency_ms) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    details: (row.details as Record<string, unknown>) ?? {},
    updatedAt: String(row.updated_at),
  };
}

function mapDbAnomaly(row: Record<string, unknown>): DataAnomalyRecord {
  return {
    id: String(row.id),
    seriesKey: String(row.series_key),
    sourceId: row.source_id ? (row.source_id as ProviderId) : null,
    workerId: row.worker_id as WorkerId,
    severity: row.severity as AnomalySeverity,
    anomalyType: row.anomaly_type as AnomalyType,
    message: String(row.message),
    observedValue: row.observed_value ? String(row.observed_value) : null,
    expectedRange: row.expected_range ? String(row.expected_range) : null,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    detectedAt: String(row.detected_at),
  };
}

function mapDbCheckpoint(row: Record<string, unknown>): SyncCheckpointRecord {
  return {
    checkpointKey: String(row.checkpoint_key),
    workerId: row.worker_id as WorkerId,
    sourceId: row.source_id ? (row.source_id as ProviderId) : null,
    cursorValue: row.cursor_value ? String(row.cursor_value) : null,
    lastObservationDate: row.last_observation_date ? String(row.last_observation_date) : null,
    lastPublishedAt: row.last_published_at ? String(row.last_published_at) : null,
    retryCount: Number(row.retry_count ?? 0),
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    updatedAt: String(row.updated_at),
  };
}

function mapDbInsight(row: Record<string, unknown>): MacroInsightRecord {
  return {
    id: String(row.id),
    scope: row.scope as MacroInsightRecord["scope"],
    modelId: String(row.model_id),
    title: String(row.title),
    summary: String(row.summary),
    keyDrivers: Array.isArray(row.key_drivers) ? row.key_drivers.map(String) : [],
    riskFlags: Array.isArray(row.risk_flags) ? row.risk_flags.map(String) : [],
    sourceObservationIds: Array.isArray(row.source_observation_ids)
      ? row.source_observation_ids.map(String)
      : [],
    sourceSeriesKeys: Array.isArray(row.source_series_keys)
      ? row.source_series_keys.map(String)
      : [],
    basedOnLatestAt: String(row.based_on_latest_at),
    confidenceNote: String(row.confidence_note ?? ""),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    generatedAt: String(row.generated_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}
