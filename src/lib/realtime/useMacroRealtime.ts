"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type {
  IncidentDashboardSnapshot,
  IncidentDomain,
  IncidentSeverity,
  IncidentStatus,
  SystemIncidentRecord,
} from "@/lib/incidents/types";
import type {
  DataHealthRecord,
  LatestValueRecord,
  MacroInsightRecord,
  MarketQuoteRecord,
  MarketSymbol,
  ProviderId,
  SyncRunRecord,
  SyncRunStatus,
  SyncStatusType,
  SyncSystemSnapshot,
  TriggerType,
  WorkerId,
} from "@/lib/sync/types";
import type { AutoSyncPeriod } from "@/lib/storage/preferences";

export type { AutoSyncPeriod };

export function parseAutoSyncSeconds(period: AutoSyncPeriod): number | null {
  switch (period) {
    case "30s":
      return 30;
    case "60s":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
    case "off":
    default:
      return null;
  }
}

export const REALTIME_CHANNEL_NAME = "macroedge:realtime:sync";
const SYNC_TRIGGER_TIMEOUT_MS = 20_000;

export const REALTIME_TABLES = [
  "latest_values",
  "market_quotes",
  "data_health",
  "sync_runs",
  "macro_insights",
  "system_incidents",
] as const;

export type RealtimeTableName = (typeof REALTIME_TABLES)[number];

export type RealtimeConnectionStatus = "LIVE" | "DISCONNECTED";

export interface RealtimeDispatchEvent {
  table: RealtimeTableName;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  record:
    | LatestValueRecord
    | MarketQuoteRecord
    | DataHealthRecord
    | SyncRunRecord
    | MacroInsightRecord
    | SystemIncidentRecord;
}

type RealtimeListener = {
  onStatus: (status: RealtimeConnectionStatus) => void;
  onEvent: (event: RealtimeDispatchEvent) => void;
};

interface ChannelEntry {
  client: SupabaseClient;
  channel: RealtimeChannel;
  listeners: Set<RealtimeListener>;
  status: RealtimeConnectionStatus;
}

const channelRegistry = new Map<string, ChannelEntry>();

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function asNullableString(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((item) => String(item));
  return [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function mapRealtimeLatestValue(
  raw: Record<string, unknown>
): LatestValueRecord {
  return {
    seriesKey: asString(raw.seriesKey ?? raw.series_key),
    sourceId: asString(raw.sourceId ?? raw.source_id, "fred") as ProviderId,
    externalSeriesId: asString(raw.externalSeriesId ?? raw.external_series_id),
    latestObservationId: asNullableString(
      raw.latestObservationId ?? raw.latest_observation_id
    ),
    observationDate: asString(raw.observationDate ?? raw.observation_date),
    publishedAt: asString(raw.publishedAt ?? raw.published_at),
    fetchedAt: asString(
      raw.fetchedAt ?? raw.fetched_at,
      new Date().toISOString()
    ),
    value: asNumber(raw.value),
    previousValue: asNullableNumber(raw.previousValue ?? raw.previous_value),
    changeValue: asNullableNumber(raw.changeValue ?? raw.change_value),
    changePct: asNullableNumber(raw.changePct ?? raw.change_pct),
    unit: asString(raw.unit, "%"),
    cadence: asString(raw.cadence, "DAILY") as LatestValueRecord["cadence"],
    status: asString(raw.status, "CURRENT") as SyncStatusType,
    revisionNumber: asNumber(raw.revisionNumber ?? raw.revision_number, 1),
    sourceAttribution: asString(
      raw.sourceAttribution ?? raw.source_attribution
    ),
    rawPayload: asRecord(raw.rawPayload ?? raw.raw_payload),
    updatedAt: asString(
      raw.updatedAt ?? raw.updated_at,
      new Date().toISOString()
    ),
  };
}

export function mapRealtimeMarketQuote(
  raw: Record<string, unknown>
): MarketQuoteRecord {
  return {
    symbol: asString(raw.symbol) as MarketSymbol,
    sourceId: asString(
      raw.sourceId ?? raw.source_id,
      "twelve_data_ws"
    ) as ProviderId,
    externalSymbol: asString(raw.externalSymbol ?? raw.external_symbol),
    assetClass: asString(
      raw.assetClass ?? raw.asset_class,
      "FX"
    ) as MarketQuoteRecord["assetClass"],
    price: asNumber(raw.price),
    bid: asNullableNumber(raw.bid),
    ask: asNullableNumber(raw.ask),
    previousClose: asNullableNumber(
      raw.previousClose ?? raw.previous_close
    ),
    changeValue: asNumber(raw.changeValue ?? raw.change_value),
    changePct: asNumber(raw.changePct ?? raw.change_pct),
    volume: asNullableNumber(raw.volume),
    unit: asString(raw.unit),
    tickSeq: asNumber(raw.tickSeq ?? raw.tick_seq),
    quoteTimestamp: asString(raw.quoteTimestamp ?? raw.quote_timestamp),
    receivedAt: asString(
      raw.receivedAt ?? raw.received_at,
      new Date().toISOString()
    ),
    status: asString(raw.status, "LIVE") as SyncStatusType,
    dedupHash: asString(raw.dedupHash ?? raw.dedup_hash),
    rawPayload: asRecord(raw.rawPayload ?? raw.raw_payload),
    updatedAt: asString(
      raw.updatedAt ?? raw.updated_at,
      new Date().toISOString()
    ),
  };
}

export function mapRealtimeDataHealth(
  raw: Record<string, unknown>
): DataHealthRecord {
  return {
    id: asString(raw.id),
    entityType: asString(
      raw.entityType ?? raw.entity_type,
      "source"
    ) as DataHealthRecord["entityType"],
    sourceId: asNullableString(
      raw.sourceId ?? raw.source_id
    ) as ProviderId | null,
    workerId: asNullableString(
      raw.workerId ?? raw.worker_id
    ) as WorkerId | null,
    status: asString(raw.status, "DISCONNECTED") as SyncStatusType,
    lastSuccessAt: asNullableString(raw.lastSuccessAt ?? raw.last_success_at),
    lastAttemptAt: asNullableString(raw.lastAttemptAt ?? raw.last_attempt_at),
    nextScheduledAt: asNullableString(
      raw.nextScheduledAt ?? raw.next_scheduled_at
    ),
    freshnessSeconds: asNullableNumber(
      raw.freshnessSeconds ?? raw.freshness_seconds
    ),
    consecutiveFailures: asNumber(
      raw.consecutiveFailures ?? raw.consecutive_failures,
      0
    ),
    latencyMs: asNullableNumber(raw.latencyMs ?? raw.latency_ms),
    lastError: asNullableString(raw.lastError ?? raw.last_error),
    details: asRecord(raw.details),
    updatedAt: asString(
      raw.updatedAt ?? raw.updated_at,
      new Date().toISOString()
    ),
  };
}

export function mapRealtimeSyncRun(
  raw: Record<string, unknown>
): SyncRunRecord {
  return {
    id: asString(raw.id),
    workerId: asString(
      raw.workerId ?? raw.worker_id,
      "orchestrator"
    ) as WorkerId,
    sourceId: asNullableString(
      raw.sourceId ?? raw.source_id
    ) as ProviderId | null,
    jobName: asString(raw.jobName ?? raw.job_name),
    triggerType: asString(
      raw.triggerType ?? raw.trigger_type,
      "scheduled"
    ) as TriggerType,
    status: asString(raw.status, "SUCCEEDED") as SyncRunStatus,
    startedAt: asString(
      raw.startedAt ?? raw.started_at,
      new Date().toISOString()
    ),
    finishedAt: asNullableString(raw.finishedAt ?? raw.finished_at),
    durationMs: asNullableNumber(raw.durationMs ?? raw.duration_ms),
    recordsFetched: asNumber(raw.recordsFetched ?? raw.records_fetched, 0),
    recordsValidated: asNumber(
      raw.recordsValidated ?? raw.records_validated,
      0
    ),
    recordsUpserted: asNumber(raw.recordsUpserted ?? raw.records_upserted, 0),
    recordsRejected: asNumber(raw.recordsRejected ?? raw.records_rejected, 0),
    attempt: asNumber(raw.attempt, 1),
    maxAttempts: asNumber(raw.maxAttempts ?? raw.max_attempts, 3),
    deadLettered: Boolean(raw.deadLettered ?? raw.dead_lettered),
    errorCode: asNullableString(raw.errorCode ?? raw.error_code),
    errorMessage: asNullableString(raw.errorMessage ?? raw.error_message),
    rawPayload: asRecord(raw.rawPayload ?? raw.raw_payload),
  };
}

export function mapRealtimeMacroInsight(
  raw: Record<string, unknown>
): MacroInsightRecord {
  return {
    id: asString(raw.id),
    scope: asString(raw.scope, "regime") as MacroInsightRecord["scope"],
    modelId: asString(raw.modelId ?? raw.model_id),
    title: asString(raw.title),
    summary: asString(raw.summary),
    keyDrivers: asStringArray(raw.keyDrivers ?? raw.key_drivers),
    riskFlags: asStringArray(raw.riskFlags ?? raw.risk_flags),
    sourceObservationIds: asStringArray(
      raw.sourceObservationIds ?? raw.source_observation_ids
    ),
    sourceSeriesKeys: asStringArray(
      raw.sourceSeriesKeys ?? raw.source_series_keys
    ),
    basedOnLatestAt: asString(
      raw.basedOnLatestAt ?? raw.based_on_latest_at
    ),
    confidenceNote: asString(
      raw.confidenceNote ?? raw.confidence_note
    ),
    rawPayload: asRecord(raw.rawPayload ?? raw.raw_payload),
    generatedAt: asString(
      raw.generatedAt ?? raw.generated_at,
      new Date().toISOString()
    ),
    expiresAt: asNullableString(raw.expiresAt ?? raw.expires_at),
  };
}

export function mapRealtimeIncident(
  raw: Record<string, unknown>
): SystemIncidentRecord {
  return {
    id: asString(raw.id),
    fingerprint: asString(raw.fingerprint),
    severity: asString(raw.severity, "Medium") as IncidentSeverity,
    domain: asString(raw.domain, "backend") as IncidentDomain,
    affectedComponent: asString(raw.affectedComponent ?? raw.affected_component),
    affectedDataset: asNullableString(raw.affectedDataset ?? raw.affected_dataset),
    workerId: asNullableString(raw.workerId ?? raw.worker_id),
    providerId: asNullableString(raw.providerId ?? raw.provider_id),
    status: asString(raw.status, "open") as IncidentStatus,
    approvalStatus: asString(
      raw.approvalStatus ?? raw.approval_status,
      "not_required"
    ) as SystemIncidentRecord["approvalStatus"],
    requiresHumanApproval: Boolean(
      raw.requiresHumanApproval ?? raw.requires_human_approval
    ),
    safeIdempotentAction: asNullableString(
      raw.safeIdempotentAction ?? raw.safe_idempotent_action
    ) as SystemIncidentRecord["safeIdempotentAction"],
    firstDetectedAt: asString(
      raw.firstDetectedAt ?? raw.first_detected_at,
      new Date().toISOString()
    ),
    lastDetectedAt: asString(
      raw.lastDetectedAt ?? raw.last_detected_at,
      new Date().toISOString()
    ),
    occurrenceCount: asNumber(raw.occurrenceCount ?? raw.occurrence_count, 1),
    errorDescription: asString(raw.errorDescription ?? raw.error_description),
    redactedTrace: asNullableString(raw.redactedTrace ?? raw.redacted_trace),
    rootCause: asNullableString(raw.rootCause ?? raw.root_cause),
    rootCauseVerified: Boolean(raw.rootCauseVerified ?? raw.root_cause_verified),
    investigationSource: asString(
      raw.investigationSource ?? raw.investigation_source,
      "insufficient_evidence"
    ) as SystemIncidentRecord["investigationSource"],
    recommendedFix: asNullableString(raw.recommendedFix ?? raw.recommended_fix),
    regressionTestRef: asNullableString(
      raw.regressionTestRef ?? raw.regression_test_ref
    ),
    recoveryVerification: (raw.recoveryVerification ??
      raw.recovery_verification ??
      null) as SystemIncidentRecord["recoveryVerification"],
    timeline: Array.isArray(raw.timeline)
      ? (raw.timeline as SystemIncidentRecord["timeline"])
      : [],
    metadata: asRecord(raw.metadata),
    resolvedAt: asNullableString(raw.resolvedAt ?? raw.resolved_at),
    updatedAt: asString(raw.updatedAt ?? raw.updated_at, new Date().toISOString()),
  };
}

export function mapRealtimePayloadRecord(
  table: RealtimeTableName,
  raw: Record<string, unknown>
): RealtimeDispatchEvent["record"] {
  switch (table) {
    case "latest_values":
      return mapRealtimeLatestValue(raw);
    case "market_quotes":
      return mapRealtimeMarketQuote(raw);
    case "data_health":
      return mapRealtimeDataHealth(raw);
    case "sync_runs":
      return mapRealtimeSyncRun(raw);
    case "macro_insights":
      return mapRealtimeMacroInsight(raw);
    case "system_incidents":
      return mapRealtimeIncident(raw);
  }
}

export function shouldAcceptMonotonicLatestValue(
  existing: LatestValueRecord | undefined,
  incoming: LatestValueRecord
): boolean {
  if (!incoming.seriesKey || !Number.isFinite(incoming.value)) return false;
  if (!existing) return true;
  if (incoming.observationDate > existing.observationDate) return true;
  if (incoming.observationDate < existing.observationDate) return false;
  const inPub = Date.parse(incoming.publishedAt);
  const exPub = Date.parse(existing.publishedAt);
  if (Number.isFinite(inPub) && Number.isFinite(exPub)) {
    if (inPub > exPub) return true;
    if (inPub < exPub) return false;
  }
  return incoming.revisionNumber >= existing.revisionNumber;
}

export function shouldAcceptMonotonicMarketQuote(
  existing: MarketQuoteRecord | undefined,
  incoming: MarketQuoteRecord
): boolean {
  if (!incoming.symbol || !Number.isFinite(incoming.price) || incoming.price <= 0) {
    return false;
  }
  if (!existing) return true;

  // Accept immediately if price or status changed
  if (incoming.price !== existing.price || incoming.status !== existing.status) {
    return true;
  }

  const inTs = Date.parse(incoming.quoteTimestamp);
  const exTs = Date.parse(existing.quoteTimestamp);
  if (Number.isFinite(inTs) && Number.isFinite(exTs)) {
    if (inTs > exTs) return true;
    if (inTs < exTs) return false;
  }

  // If same dedup hash, accept if incoming has a strictly newer verification timestamp (receivedAt/updatedAt)
  if (incoming.dedupHash && incoming.dedupHash === existing.dedupHash) {
    const inRec = Date.parse(incoming.receivedAt || incoming.updatedAt || "");
    const exRec = Date.parse(existing.receivedAt || existing.updatedAt || "");
    if (Number.isFinite(inRec) && Number.isFinite(exRec) && inRec > exRec) {
      return true;
    }
    return false;
  }

  return (incoming.tickSeq ?? 0) >= (existing.tickSeq ?? 0);
}

export function getActiveRealtimeChannelCount(): number {
  return channelRegistry.size;
}

export function subscribeToMacroRealtimeRegistry(
  listener: RealtimeListener,
  clientOverride?: SupabaseClient | null
): () => void {
  const client =
    clientOverride !== undefined ? clientOverride : getSupabaseBrowserClient();

  if (!client) {
    listener.onStatus("DISCONNECTED");
    return () => {};
  }

  let entry = channelRegistry.get(REALTIME_CHANNEL_NAME);
  if (!entry) {
    let channel = client.channel(REALTIME_CHANNEL_NAME);
    const createdEntry: ChannelEntry = {
      client,
      channel,
      listeners: new Set([listener]),
      status: "DISCONNECTED",
    };

    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: {
          eventType?: string;
          new?: Record<string, unknown>;
          old?: Record<string, unknown>;
        }) => {
          const eventType = (payload.eventType ?? "UPDATE") as
            | "INSERT"
            | "UPDATE"
            | "DELETE";
          const raw =
            eventType === "DELETE"
              ? asRecord(payload.old)
              : asRecord(payload.new);
          if (Object.keys(raw).length === 0) return;

          const record = mapRealtimePayloadRecord(table, raw);
          const dispatch: RealtimeDispatchEvent = {
            table,
            eventType,
            record,
          };
          for (const sub of createdEntry.listeners) {
            sub.onEvent(dispatch);
          }
        }
      );
    }

    createdEntry.channel = channel;
    channelRegistry.set(REALTIME_CHANNEL_NAME, createdEntry);

    channel.subscribe((status: string) => {
      const mapped: RealtimeConnectionStatus =
        status === "SUBSCRIBED" ? "LIVE" : "DISCONNECTED";
      createdEntry.status = mapped;
      for (const sub of createdEntry.listeners) {
        sub.onStatus(mapped);
      }
    });

    entry = createdEntry;
  } else {
    entry.listeners.add(listener);
    listener.onStatus(entry.status);
  }

  return () => {
    const active = channelRegistry.get(REALTIME_CHANNEL_NAME);
    if (!active) return;
    active.listeners.delete(listener);
    if (active.listeners.size === 0) {
      channelRegistry.delete(REALTIME_CHANNEL_NAME);
      try {
        void active.client.removeChannel(active.channel);
      } catch {
        // ignore unsubscribe errors on teardown
      }
    }
  };
}

function indexSnapshot(snapshot: SyncSystemSnapshot | null | undefined) {
  const latestValues: Record<string, LatestValueRecord> = {};
  const marketQuotes: Record<string, MarketQuoteRecord> = {};
  const health: Record<string, DataHealthRecord> = {};

  if (snapshot) {
    for (const lv of snapshot.latestValues) {
      latestValues[lv.seriesKey] = lv;
    }
    for (const mq of snapshot.marketQuotes) {
      marketQuotes[mq.symbol] = mq;
    }
    for (const h of snapshot.health) {
      health[h.id] = h;
    }
  }

  return {
    latestValues,
    marketQuotes,
    health,
    recentRuns: snapshot?.recentRuns ?? [],
    insights: snapshot?.insights ?? [],
  };
}

export interface UseMacroRealtimeOptions {
  initialSnapshot?: SyncSystemSnapshot | null;
  enabled?: boolean;
  fetchOnMount?: boolean;
  pollIntervalMs?: number;
  autoSyncPeriod?: AutoSyncPeriod;
}

export interface MacroRealtimeState {
  connectionStatus: RealtimeConnectionStatus;
  supabaseConfigured: boolean;
  persistenceMode: SyncSystemSnapshot["persistenceMode"] | null;
  overallStatus: SyncStatusType | null;
  adminAuthRequired: boolean | null;
  snapshot: SyncSystemSnapshot | null;
  latestValues: Record<string, LatestValueRecord>;
  marketQuotes: Record<string, MarketQuoteRecord>;
  health: Record<string, DataHealthRecord>;
  recentRuns: SyncRunRecord[];
  insights: MacroInsightRecord[];
  lastEventAt: string | null;
  isRefreshing: boolean;
  isSyncing: boolean;
  refreshError: string | null;
  refresh: () => Promise<SyncSystemSnapshot | null>;
  triggerSync: (options?: {
    force?: boolean;
    workerId?: WorkerId;
    backfill?: boolean;
  }) => Promise<{ ok: boolean; snapshot?: SyncSystemSnapshot | null; error?: string }>;
  applySnapshot: (next: SyncSystemSnapshot) => void;
  autoSyncPeriod: AutoSyncPeriod;
  setAutoSyncPeriod: (period: AutoSyncPeriod) => void;
  nextAutoSyncSec: number | null;
  lastAutoSyncedAt: string | null;
  lastSyncDurationMs: number | null;
  lastSyncOk: boolean | null;
}

export function useMacroRealtime(
  options: UseMacroRealtimeOptions = {}
): MacroRealtimeState {
  const {
    initialSnapshot = null,
    enabled = true,
    fetchOnMount = !initialSnapshot,
    pollIntervalMs = 0,
  } = options;

  const supabaseConfigured = isSupabaseConfigured();
  const initialIndexed = indexSnapshot(initialSnapshot);

  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("DISCONNECTED");
  const [autoSyncPeriod, setAutoSyncPeriod] = useState<AutoSyncPeriod>(
    options.autoSyncPeriod ?? "60s"
  );
  const [nextAutoSyncSec, setNextAutoSyncSec] = useState<number | null>(() =>
    parseAutoSyncSeconds(options.autoSyncPeriod ?? "60s")
  );
  const [lastAutoSyncedAt, setLastAutoSyncedAt] = useState<string | null>(null);
  const [lastSyncDurationMs, setLastSyncDurationMs] = useState<number | null>(null);
  const [lastSyncOk, setLastSyncOk] = useState<boolean | null>(null);
  const nextTargetMsRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSystemSnapshot | null>(
    initialSnapshot
  );
  const [latestValues, setLatestValues] = useState<
    Record<string, LatestValueRecord>
  >(initialIndexed.latestValues);
  const [marketQuotes, setMarketQuotes] = useState<
    Record<string, MarketQuoteRecord>
  >(initialIndexed.marketQuotes);
  const [health, setHealth] = useState<Record<string, DataHealthRecord>>(
    initialIndexed.health
  );
  const [recentRuns, setRecentRuns] = useState<SyncRunRecord[]>(
    initialIndexed.recentRuns
  );
  const [insights, setInsights] = useState<MacroInsightRecord[]>(
    initialIndexed.insights
  );
  const [lastEventAt, setLastEventAt] = useState<string | null>(
    initialSnapshot?.generatedAt ?? null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [adminAuthRequired, setAdminAuthRequired] = useState<boolean | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<SyncSystemSnapshot | null> | null>(null);
  const syncInFlightRef = useRef<Promise<{
    ok: boolean;
    snapshot?: SyncSystemSnapshot | null;
    error?: string;
  }> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySnapshot = useCallback((next: SyncSystemSnapshot) => {
    if (!mountedRef.current) return;
    const idx = indexSnapshot(next);
    setSnapshot(next);
    setLatestValues((prev) => {
      const merged = { ...prev };
      for (const [k, lv] of Object.entries(idx.latestValues)) {
        if (shouldAcceptMonotonicLatestValue(merged[k], lv)) {
          merged[k] = lv;
        }
      }
      return merged;
    });
    setMarketQuotes((prev) => {
      const merged = { ...prev };
      for (const [k, mq] of Object.entries(idx.marketQuotes)) {
        if (shouldAcceptMonotonicMarketQuote(merged[k], mq)) {
          merged[k] = mq;
        }
      }
      return merged;
    });
    setHealth(idx.health);
    setRecentRuns(idx.recentRuns);
    setInsights(idx.insights);
    setLastEventAt(next.generatedAt);
    setRefreshError(null);
  }, []);

  const refresh = useCallback(async (): Promise<SyncSystemSnapshot | null> => {
    if (typeof window === "undefined") return null;
    if (inFlightRef.current) return inFlightRef.current;

    const task = (async () => {
      if (mountedRef.current) setIsRefreshing(true);
      try {
        const res = await fetch("/api/sync/status", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Status HTTP ${res.status}`);
        }
        const authHeader = res.headers.get("X-Sync-Admin-Auth-Required");
        if (mountedRef.current && authHeader !== null) {
          setAdminAuthRequired(authHeader === "true");
        }
        const json = (await res.json()) as
          | SyncSystemSnapshot
          | { snapshot?: SyncSystemSnapshot };
        const resolved =
          "snapshot" in json && json.snapshot
            ? json.snapshot
            : "overallStatus" in json && json.overallStatus
            ? json
            : null;
        if (resolved) {
          applySnapshot(resolved);
        }
        return resolved;
      } catch (err) {
        if (mountedRef.current) {
          setRefreshError(
            err instanceof Error ? err.message : "Failed to fetch sync status"
          );
        }
        return null;
      } finally {
        inFlightRef.current = null;
        if (mountedRef.current) setIsRefreshing(false);
      }
    })();

    inFlightRef.current = task;
    return task;
  }, [applySnapshot]);

  const triggerSync = useCallback(
    async (opts?: {
      force?: boolean;
      workerId?: WorkerId;
      backfill?: boolean;
    }): Promise<{ ok: boolean; snapshot?: SyncSystemSnapshot | null; error?: string }> => {
      if (typeof window === "undefined") {
        return { ok: false, error: "Server environment" };
      }
      if (syncInFlightRef.current) return syncInFlightRef.current;

      const task = (async () => {
        const startTimeMs = Date.now();
        if (mountedRef.current) setIsSyncing(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          SYNC_TRIGGER_TIMEOUT_MS
        );
        try {
          const res = await fetch("/api/sync/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({
              force: opts?.force ?? true,
              ...(opts?.workerId ? { workerId: opts.workerId } : {}),
              ...(opts?.backfill !== undefined ? { backfill: opts.backfill } : {}),
            }),
          });

          if (res.status === 401) {
            if (mountedRef.current) setAdminAuthRequired(true);
            const fallback = await refresh();
            return {
              ok: false,
              snapshot: fallback,
              error: "Authorization token required to trigger server sync.",
            };
          }

          const json = (await res.json()) as {
            ok?: boolean;
            error?: string;
            snapshot?: SyncSystemSnapshot;
          };

          if (json?.snapshot) {
            applySnapshot(json.snapshot);
          } else {
            await refresh();
          }

          const ok = Boolean(res.ok && json?.ok !== false);
          if (mountedRef.current) {
            setLastSyncDurationMs(Date.now() - startTimeMs);
            setLastSyncOk(ok);
            if (ok) {
              setLastAutoSyncedAt(new Date().toISOString());
              const totalSec = parseAutoSyncSeconds(autoSyncPeriod);
              if (totalSec) {
                nextTargetMsRef.current = Date.now() + totalSec * 1000;
                setNextAutoSyncSec(totalSec);
              }
            }
          }

          return {
            ok,
            snapshot: json?.snapshot ?? null,
            ...(json?.error ? { error: json.error } : {}),
          };
        } catch (err) {
          const message =
            err instanceof DOMException && err.name === "AbortError"
              ? "Sync request timed out; background sync may still be running."
              : err instanceof Error
              ? err.message
              : "Failed to trigger live sync";
          if (mountedRef.current) {
            setRefreshError(message);
            setLastSyncOk(false);
          }
          return { ok: false, error: message };
          return { ok: false, error: message };
        } finally {
          window.clearTimeout(timeoutId);
          syncInFlightRef.current = null;
          if (mountedRef.current) setIsSyncing(false);
        }
      })();

      syncInFlightRef.current = task;
      return task;
    },
    [applySnapshot, refresh, autoSyncPeriod]
  );

  // Deduplicated Supabase Realtime subscription
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToMacroRealtimeRegistry({
      onStatus: (nextStatus) => {
        if (mountedRef.current) {
          setConnectionStatus(nextStatus);
        }
      },
      onEvent: (event) => {
        if (!mountedRef.current) return;
        const now = new Date().toISOString();
        setLastEventAt(now);

        if (event.table === "latest_values") {
          const lv = event.record as LatestValueRecord;
          setLatestValues((prev) => {
            if (!shouldAcceptMonotonicLatestValue(prev[lv.seriesKey], lv)) {
              return prev;
            }
            return { ...prev, [lv.seriesKey]: lv };
          });
          setSnapshot((prev) => {
            if (!prev) return prev;
            const existing = prev.latestValues.find(
              (item) => item.seriesKey === lv.seriesKey
            );
            if (!shouldAcceptMonotonicLatestValue(existing, lv)) return prev;
            const others = prev.latestValues.filter(
              (item) => item.seriesKey !== lv.seriesKey
            );
            return {
              ...prev,
              generatedAt: now,
              latestValues: [lv, ...others],
            };
          });
        } else if (event.table === "market_quotes") {
          const mq = event.record as MarketQuoteRecord;
          setMarketQuotes((prev) => {
            if (!shouldAcceptMonotonicMarketQuote(prev[mq.symbol], mq)) {
              return prev;
            }
            return { ...prev, [mq.symbol]: mq };
          });
          setSnapshot((prev) => {
            if (!prev) return prev;
            const existing = prev.marketQuotes.find(
              (item) => item.symbol === mq.symbol
            );
            if (!shouldAcceptMonotonicMarketQuote(existing, mq)) return prev;
            const others = prev.marketQuotes.filter(
              (item) => item.symbol !== mq.symbol
            );
            return {
              ...prev,
              generatedAt: now,
              marketQuotes: [mq, ...others],
            };
          });
        } else if (event.table === "data_health") {
          const rec = event.record as DataHealthRecord;
          setHealth((prev) => ({ ...prev, [rec.id]: rec }));
          setSnapshot((prev) => {
            if (!prev) return prev;
            const others = prev.health.filter((item) => item.id !== rec.id);
            return {
              ...prev,
              generatedAt: now,
              health: [rec, ...others],
            };
          });
        } else if (event.table === "sync_runs") {
          const run = event.record as SyncRunRecord;
          setRecentRuns((prev) => {
            const others = prev.filter((item) => item.id !== run.id);
            return [run, ...others]
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
              .slice(0, 40);
          });
          setSnapshot((prev) => {
            if (!prev) return prev;
            const others = prev.recentRuns.filter((item) => item.id !== run.id);
            const nextRuns = [run, ...others]
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
              .slice(0, 40);
            return {
              ...prev,
              generatedAt: now,
              recentRuns: nextRuns,
            };
          });
        } else if (event.table === "macro_insights") {
          const insight = event.record as MacroInsightRecord;
          setInsights((prev) => {
            const others = prev.filter((item) => item.id !== insight.id);
            return [insight, ...others]
              .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
              .slice(0, 10);
          });
          setSnapshot((prev) => {
            if (!prev) return prev;
            const others = prev.insights.filter(
              (item) => item.id !== insight.id
            );
            const nextInsights = [insight, ...others]
              .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
              .slice(0, 10);
            return {
              ...prev,
              generatedAt: now,
              insights: nextInsights,
            };
          });
        }
      },
    });

    return unsubscribe;
  }, [enabled]);

  // Initial sync fetch when no SSR snapshot is provided
  useEffect(() => {
    if (!enabled || !fetchOnMount) return;
    void refresh();
  }, [enabled, fetchOnMount, refresh]);

  // Clean polling fallback (primarily when Supabase Realtime is not LIVE)
  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0 || connectionStatus === "LIVE") return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, connectionStatus, refresh]);

  // Periodic Auto-Sync Interval Runner (Wall-Clock Anchored & Visibility Resilient)
  useEffect(() => {
    if (!enabled || autoSyncPeriod === "off") {
      setNextAutoSyncSec(null);
      nextTargetMsRef.current = null;
      return;
    }

    const totalSec = parseAutoSyncSeconds(autoSyncPeriod);
    if (!totalSec) {
      setNextAutoSyncSec(null);
      nextTargetMsRef.current = null;
      return;
    }

    nextTargetMsRef.current = Date.now() + totalSec * 1000;
    setNextAutoSyncSec(totalSec);

    const checkAndTick = () => {
      if (!nextTargetMsRef.current) return;
      const now = Date.now();
      const diffMs = nextTargetMsRef.current - now;
      const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

      if (diffSec <= 0) {
        nextTargetMsRef.current = now + totalSec * 1000;
        setNextAutoSyncSec(totalSec);

        if (
          typeof document !== "undefined" &&
          document.visibilityState === "visible" &&
          !syncInFlightRef.current
        ) {
          void triggerSync({ force: true }).then((res) => {
            if (res.ok && mountedRef.current) {
              setLastAutoSyncedAt(new Date().toISOString());
            }
          });
        }
      } else {
        setNextAutoSyncSec(diffSec);
      }
    };

    const timer = window.setInterval(checkAndTick, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!nextTargetMsRef.current) return;

      const now = Date.now();
      if (now >= nextTargetMsRef.current) {
        nextTargetMsRef.current = now + totalSec * 1000;
        setNextAutoSyncSec(totalSec);
        if (!syncInFlightRef.current) {
          void triggerSync({ force: true }).then((res) => {
            if (res.ok && mountedRef.current) {
              setLastAutoSyncedAt(new Date().toISOString());
            }
          });
        }
      } else {
        checkAndTick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, autoSyncPeriod, triggerSync]);

  return {
    connectionStatus,
    supabaseConfigured,
    persistenceMode: snapshot?.persistenceMode ?? null,
    overallStatus: snapshot?.overallStatus ?? null,
    adminAuthRequired,
    snapshot,
    latestValues,
    marketQuotes,
    health,
    recentRuns,
    insights,
    lastEventAt,
    isRefreshing,
    isSyncing,
    refreshError,
    refresh,
    triggerSync,
    applySnapshot,
    autoSyncPeriod,
    setAutoSyncPeriod,
    nextAutoSyncSec,
    lastAutoSyncedAt,
    lastSyncDurationMs,
    lastSyncOk,
  };
}

export interface UseIncidentRealtimeOptions {
  initialSnapshot?: IncidentDashboardSnapshot | null;
  enabled?: boolean;
  fetchOnMount?: boolean;
  pollIntervalMs?: number;
}

export interface IncidentRealtimeState {
  connectionStatus: RealtimeConnectionStatus;
  adminAuthRequired: boolean | null;
  snapshot: IncidentDashboardSnapshot | null;
  isRefreshing: boolean;
  refreshError: string | null;
  refresh: () => Promise<IncidentDashboardSnapshot | null>;
  applySnapshot: (next: IncidentDashboardSnapshot) => void;
}

export function useIncidentRealtime(
  options: UseIncidentRealtimeOptions = {}
): IncidentRealtimeState {
  const {
    initialSnapshot = null,
    enabled = true,
    fetchOnMount = !initialSnapshot,
    pollIntervalMs = 0,
  } = options;

  const supabaseConfigured = isSupabaseConfigured();
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("DISCONNECTED");
  const [adminAuthRequired, setAdminAuthRequired] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<IncidentDashboardSnapshot | null>(
    initialSnapshot
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<IncidentDashboardSnapshot | null> | null>(
    null
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySnapshot = useCallback((next: IncidentDashboardSnapshot) => {
    if (!mountedRef.current) return;
    setSnapshot(next);
    setRefreshError(null);
  }, []);

  const refresh = useCallback(async (): Promise<IncidentDashboardSnapshot | null> => {
    if (typeof window === "undefined") return null;
    if (inFlightRef.current) return inFlightRef.current;

    const task = (async () => {
      if (mountedRef.current) setIsRefreshing(true);
      try {
        const res = await fetch("/api/incidents", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Incident status HTTP ${res.status}`);
        }
        const authHeader = res.headers.get("X-Sync-Admin-Auth-Required");
        if (mountedRef.current && authHeader !== null) {
          setAdminAuthRequired(authHeader === "true");
        }
        const resolved = (await res.json()) as IncidentDashboardSnapshot;
        if (resolved && Array.isArray(resolved.incidents)) {
          applySnapshot(resolved);
          return resolved;
        }
        return null;
      } catch (err) {
        if (mountedRef.current) {
          setRefreshError(
            err instanceof Error ? err.message : "Failed to fetch incidents"
          );
        }
        return null;
      } finally {
        inFlightRef.current = null;
        if (mountedRef.current) setIsRefreshing(false);
      }
    })();

    inFlightRef.current = task;
    return task;
  }, [applySnapshot]);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToMacroRealtimeRegistry({
      onStatus: (nextStatus) => {
        if (mountedRef.current) {
          setConnectionStatus(nextStatus);
        }
      },
      onEvent: (event) => {
        if (!mountedRef.current || event.table !== "system_incidents") return;
        const inc = event.record as SystemIncidentRecord;
        setSnapshot((prev) => {
          if (!prev) return prev;
          const others = prev.incidents.filter((item) => item.id !== inc.id);
          const nextIncidents = [inc, ...others].slice(0, 150);
          const counts = {
            total: nextIncidents.length,
            open: nextIncidents.filter((i) => i.status === "open").length,
            investigating: nextIncidents.filter((i) => i.status === "investigating")
              .length,
            remediating: nextIncidents.filter((i) => i.status === "remediating")
              .length,
            awaitingApproval: nextIncidents.filter(
              (i) => i.status === "awaiting_approval"
            ).length,
            resolved: nextIncidents.filter((i) => i.status === "resolved").length,
            dismissed: nextIncidents.filter((i) => i.status === "dismissed").length,
            criticalOpen: nextIncidents.filter(
              (i) =>
                i.severity === "Critical" &&
                i.status !== "resolved" &&
                i.status !== "dismissed"
            ).length,
            byDomain: {
              frontend: nextIncidents.filter((i) => i.domain === "frontend").length,
              backend: nextIncidents.filter((i) => i.domain === "backend").length,
              database: nextIncidents.filter((i) => i.domain === "database").length,
              sync: nextIncidents.filter((i) => i.domain === "sync").length,
            },
          };
          return {
            ...prev,
            generatedAt: new Date().toISOString(),
            incidents: nextIncidents,
            counts,
          };
        });
      },
    });

    return unsubscribe;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !fetchOnMount) return;
    void refresh();
  }, [enabled, fetchOnMount, refresh]);

  useEffect(() => {
    if (
      !enabled ||
      pollIntervalMs <= 0 ||
      (supabaseConfigured && connectionStatus === "LIVE")
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, supabaseConfigured, connectionStatus, refresh]);

  return {
    connectionStatus,
    adminAuthRequired,
    snapshot,
    isRefreshing,
    refreshError,
    refresh,
    applySnapshot,
  };
}
