"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Database,
  History,
  KeyRound,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
} from "lucide-react";
import type {
  DataAnomalyRecord,
  DataHealthRecord,
  DataSourceRecord,
  LatestValueRecord,
  MarketQuoteRecord,
  ProviderAuthStatus,
  ProviderId,
  SyncCheckpointRecord,
  SyncRunRecord,
  SyncSystemSnapshot,
  WorkerId,
} from "@/lib/sync/types";
import { useMacroRealtime } from "@/lib/realtime/useMacroRealtime";
import { cn, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/FilterControls";
import {
  MarketStatusBadge,
  SyncStatusBadge,
} from "@/components/cards/MarketStatusBadge";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { EmptyState } from "@/components/dashboard/FeedbackStates";
import { AutoSyncControl } from "@/components/dashboard/AutoSyncControl";
import { AutoSyncDebugModal } from "@/components/dashboard/AutoSyncDebugModal";
import { useTerminal } from "@/components/providers/TerminalProvider";

interface DataOpsViewProps {
  initialSnapshot: SyncSystemSnapshot;
}

type LogTab = "runs" | "dlq" | "anomalies" | "checkpoints";

const WORKER_LABELS: Record<WorkerId, { title: string; role: string }> = {
  orchestrator: {
    title: "Worker 1 · Orchestrator",
    role: "Schedule dispatch, locks & rate limits",
  },
  "market-engine": {
    title: "Worker 2 · Market Data Engine",
    role: "Real-time WS quotes & OHLCV bars",
  },
  "macro-engine": {
    title: "Worker 3 · Macro Data Engine",
    role: "FRED / BLS / BEA economic vintages",
  },
  "positioning-engine": {
    title: "Worker 4 · Positioning Engine",
    role: "CFTC COT weekly disclosures",
  },
  "liquidity-risk-engine": {
    title: "Worker 5 · Liquidity & Risk",
    role: "Yields, Fed H.4.1, credit & vol",
  },
  "validation-recovery": {
    title: "Worker 6 · Validation & Recovery",
    role: "Outliers, monotonic guard & DLQ",
  },
  "ai-supervisor": {
    title: "Worker 7 · AI Research Supervisor",
    role: "Gemini post-validation briefs",
  },
};

const WORKER_ORDER: WorkerId[] = [
  "orchestrator",
  "market-engine",
  "macro-engine",
  "positioning-engine",
  "liquidity-risk-engine",
  "validation-recovery",
  "ai-supervisor",
];

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return `${iso.slice(0, 19).replace("T", " ")}Z`;
}

function formatDurationSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function getSourceFeedClass(source: DataSourceRecord): string {
  if (source.transport === "websocket") return "Real-Time Market Stream";
  if (source.transport === "ai") return "AI Supervisor";
  return "Periodic Economic Stat";
}

interface SourceMonitorRow {
  id: ProviderId;
  name: string;
  transport: DataSourceRecord["transport"];
  feedClass: string;
  cadence: DataSourceRecord["cadence"];
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
  requiresApiKey: boolean;
  configured: boolean;
  ownerWorker: WorkerId;
  status: DataHealthRecord["status"];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  freshnessSeconds: number | null;
  latencyMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export function DataOpsView({ initialSnapshot }: DataOpsViewProps) {
  const { prefs, updatePrefs } = useTerminal();
  const realtime = useMacroRealtime({
    initialSnapshot,
    fetchOnMount: true,
    pollIntervalMs: 10000,
    autoSyncPeriod: prefs.autoSyncPeriod,
  });

  const snapshot = realtime.snapshot ?? initialSnapshot;

  const [adminToken, setAdminToken] = useState("");
  const [activeLogTab, setActiveLogTab] = useState<LogTab>("runs");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [actionBanner, setActionBanner] = useState<{
    tone: "positive" | "negative" | "neutral";
    message: string;
  } | null>(null);

  const healthById = useMemo(
    () => new Map(snapshot.health.map((h) => [h.id, h])),
    [snapshot.health]
  );

  const providerAuthById = useMemo(
    () => new Map<ProviderId, ProviderAuthStatus>(snapshot.providers.map((p) => [p.providerId, p])),
    [snapshot.providers]
  );

  const latestBySeriesKey = useMemo(
    () => new Map(snapshot.latestValues.map((lv) => [lv.seriesKey, lv])),
    [snapshot.latestValues]
  );

  const sourceRows = useMemo<SourceMonitorRow[]>(() => {
    return snapshot.dataSources.map((src) => {
      const h = healthById.get(`source:${src.id}`);
      const auth = providerAuthById.get(src.id);
      const ownerWorker =
        auth?.ownerWorker ??
        ((src.metadata?.ownerWorker as WorkerId | undefined) ?? "macro-engine");

      return {
        id: src.id,
        name: src.name,
        transport: src.transport,
        feedClass: getSourceFeedClass(src),
        cadence: src.cadence,
        expectedIntervalSeconds: src.expectedIntervalSeconds,
        staleAfterSeconds: src.staleAfterSeconds,
        requiresApiKey: src.requiresApiKey,
        configured: auth?.configured ?? !src.requiresApiKey,
        ownerWorker,
        status: h?.status ?? auth?.status ?? "DISCONNECTED",
        lastSuccessAt: h?.lastSuccessAt ?? null,
        lastAttemptAt: h?.lastAttemptAt ?? null,
        freshnessSeconds: h?.freshnessSeconds ?? null,
        latencyMs: h?.latencyMs ?? null,
        consecutiveFailures: h?.consecutiveFailures ?? 0,
        lastError: h?.lastError ?? null,
      };
    });
  }, [snapshot.dataSources, healthById, providerAuthById]);

  const workerCards = useMemo(() => {
    return WORKER_ORDER.map((workerId) => {
      const h = healthById.get(`worker:${workerId}`);
      const workerCheckpoints = snapshot.checkpoints.filter(
        (cp) => cp.workerId === workerId
      );
      const retryCount = workerCheckpoints.reduce(
        (acc, cp) => acc + cp.retryCount,
        0
      );
      return {
        workerId,
        label: WORKER_LABELS[workerId].title,
        role: WORKER_LABELS[workerId].role,
        status: h?.status ?? "DISCONNECTED",
        lastSuccessAt: h?.lastSuccessAt ?? null,
        lastAttemptAt: h?.lastAttemptAt ?? null,
        latencyMs: h?.latencyMs ?? null,
        consecutiveFailures: h?.consecutiveFailures ?? 0,
        retryCount,
        lastError: h?.lastError ?? null,
      };
    });
  }, [healthById, snapshot.checkpoints]);

  const telemetrySummary = useMemo(() => {
    const runs = snapshot.recentRuns;
    const totalUpserted = runs.reduce((acc, r) => acc + r.recordsUpserted, 0);
    const totalValidated = runs.reduce((acc, r) => acc + r.recordsValidated, 0);
    const totalRejected = runs.reduce((acc, r) => acc + r.recordsRejected, 0);
    const failedRuns = runs.filter(
      (r) => r.status === "FAILED" || r.status === "DEAD_LETTER"
    ).length;
    const totalRetries =
      runs.reduce((acc, r) => acc + Math.max(0, r.attempt - 1), 0) +
      snapshot.checkpoints.reduce((acc, cp) => acc + cp.retryCount, 0);

    const latencies = sourceRows
      .map((s) => s.latencyMs)
      .filter((v): v is number => v !== null && v >= 0);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    const staleDatasets = sourceRows.filter((s) => s.status === "STALE").length;
    const missingObsAnomalies = snapshot.anomalies.filter(
      (a) => !a.resolved && (a.anomalyType === "MISSING_FIELD" || a.anomalyType === "STALE_DATA")
    ).length;
    const activeWorkers = workerCards.filter(
      (w) => w.status === "LIVE" || w.status === "CURRENT" || w.status === "DELAYED"
    ).length;

    const lastSuccess = sourceRows
      .map((s) => s.lastSuccessAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;
    const lastAttempt = sourceRows
      .map((s) => s.lastAttemptAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;

    return {
      activeWorkers,
      totalUpserted,
      totalValidated,
      totalRejected,
      failedRuns,
      totalRetries,
      avgLatencyMs,
      staleDatasets,
      missingObsAnomalies,
      lastSuccess,
      lastAttempt,
    };
  }, [snapshot.recentRuns, snapshot.checkpoints, snapshot.anomalies, sourceRows, workerCards]);

  const deadLetterRuns = useMemo(
    () =>
      snapshot.recentRuns.filter(
        (r) => r.deadLettered || r.status === "FAILED" || r.status === "DEAD_LETTER"
      ),
    [snapshot.recentRuns]
  );

  async function postControl(
    actionKey: string,
    endpoint: string,
    payload: Record<string, unknown>,
    successLabel: string
  ) {
    setBusyAction(actionKey);
    setActionBanner(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (adminToken.trim()) {
        headers.Authorization = `Bearer ${adminToken.trim()}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        snapshot?: SyncSystemSnapshot;
      };

      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      }

      if (body.snapshot) {
        realtime.applySnapshot(body.snapshot);
      } else {
        await realtime.refresh();
      }
      setActionBanner({ tone: "positive", message: successLabel });
    } catch (err) {
      setActionBanner({
        tone: "negative",
        message: err instanceof Error ? err.message : "Operation failed",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const sourceColumns: DataColumn<SourceMonitorRow>[] = [
    {
      key: "name",
      header: "Data Source",
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#F0F2F5]">{r.name}</span>
            {!r.configured && (
              <span className="rounded border border-white/[0.08] bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[9px] text-[#7A8390]">
                {r.requiresApiKey ? "KEY UNSET" : "DISABLED"}
              </span>
            )}
          </div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            {r.id} · {r.transport.toUpperCase()}
          </div>
        </div>
      ),
    },
    {
      key: "feedClass",
      header: "Stream Class",
      sortValue: (r) => r.feedClass,
      render: (r) => (
        <span
          className={cn(
            "font-mono-num text-[11px]",
            r.transport === "websocket"
              ? "text-[#00C985]"
              : r.transport === "ai"
              ? "text-[#F0F2F5]"
              : "text-[#9299A3]"
          )}
        >
          {r.feedClass}
        </span>
      ),
    },
    {
      key: "cadence",
      header: "Cadence",
      sortValue: (r) => r.expectedIntervalSeconds,
      render: (r) => (
        <div className="font-mono-num">
          <span className="text-[#F0F2F5]">{r.cadence}</span>
          <div className="text-[10px] text-[#7A8390]">
            Every {formatDurationSeconds(r.expectedIntervalSeconds)}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => r.status,
      render: (r) => <SyncStatusBadge status={r.status} size="sm" />,
    },
    {
      key: "lastSuccess",
      header: "Last Success",
      sortValue: (r) => r.lastSuccessAt ?? "",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {formatTs(r.lastSuccessAt)}
        </span>
      ),
    },
    {
      key: "lastAttempt",
      header: "Last Attempt",
      sortValue: (r) => r.lastAttemptAt ?? "",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#7A8390]">
          {formatTs(r.lastAttemptAt)}
        </span>
      ),
    },
    {
      key: "freshness",
      header: "Age",
      align: "right",
      sortValue: (r) => r.freshnessSeconds ?? 99999999,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {formatDurationSeconds(r.freshnessSeconds)}
        </span>
      ),
    },
    {
      key: "latency",
      header: "Latency",
      align: "right",
      sortValue: (r) => r.latencyMs ?? 999999,
      render: (r) => (
        <span className="font-mono-num text-[11.5px] text-[#F0F2F5]">
          {r.latencyMs !== null ? `${r.latencyMs} ms` : "—"}
        </span>
      ),
    },
    {
      key: "failures",
      header: "Failures",
      align: "right",
      sortValue: (r) => r.consecutiveFailures,
      render: (r) => (
        <span
          className={cn(
            "font-mono-num text-[11.5px] font-semibold",
            r.consecutiveFailures > 0 ? "text-[#F05454]" : "text-[#7A8390]"
          )}
        >
          {r.consecutiveFailures}
        </span>
      ),
    },
    {
      key: "action",
      header: "Control",
      align: "right",
      render: (r) => (
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() =>
            void postControl(
              `source:${r.id}`,
              "/api/sync/trigger",
              { providerId: r.id, workerId: r.ownerWorker },
              `Triggered sync for ${r.name}`
            )
          }
          className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-[#07090D] px-2 py-1 font-mono-num text-[10.5px] text-[#F0F2F5] transition hover:border-[#FFFFFF]/50 hover:text-[#FFFFFF] disabled:opacity-50"
        >
          <Play className="h-2.5 w-2.5" />
          {busyAction === `source:${r.id}` ? "Running" : "Sync"}
        </button>
      ),
    },
  ];

  const runColumns: DataColumn<SyncRunRecord>[] = [
    {
      key: "job",
      header: "Worker / Job",
      sortValue: (r) => r.workerId,
      render: (r) => (
        <div>
          <div className="font-medium text-[#F0F2F5]">{r.jobName}</div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            {r.workerId} · {r.sourceId ?? "all"}
          </div>
        </div>
      ),
    },
    {
      key: "trigger",
      header: "Trigger",
      sortValue: (r) => r.triggerType,
      render: (r) => (
        <span className="rounded border border-white/[0.08] bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[10px] uppercase text-[#9299A3]">
          {r.triggerType}
        </span>
      ),
    },
    {
      key: "status",
      header: "Run Status",
      sortValue: (r) => r.status,
      render: (r) => (
        <MarketStatusBadge
          label={r.deadLettered ? "DEAD LETTER" : r.status}
          tone={
            r.status === "SUCCEEDED"
              ? "bullish"
              : r.status === "PARTIAL"
              ? "mixed"
              : r.status === "RUNNING"
              ? "neutral"
              : "bearish"
          }
        />
      ),
    },
    {
      key: "records",
      header: "Upserted / Val / Rej",
      align: "right",
      sortValue: (r) => r.recordsUpserted,
      render: (r) => (
        <span className="font-mono-num text-[11.5px]">
          <span className="text-[#00C985]">{r.recordsUpserted}</span>
          <span className="text-[#7A8390]"> / {r.recordsValidated} / </span>
          <span className={r.recordsRejected > 0 ? "text-[#F05454]" : "text-[#7A8390]"}>
            {r.recordsRejected}
          </span>
        </span>
      ),
    },
    {
      key: "attempt",
      header: "Attempt",
      align: "right",
      sortValue: (r) => r.attempt,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {r.attempt}/{r.maxAttempts}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Latency",
      align: "right",
      sortValue: (r) => r.durationMs ?? 0,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {r.durationMs !== null ? `${r.durationMs} ms` : "—"}
        </span>
      ),
    },
    {
      key: "startedAt",
      header: "Started",
      sortValue: (r) => r.startedAt,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#7A8390]">
          {formatTs(r.startedAt)}
        </span>
      ),
    },
    {
      key: "action",
      header: "Recovery",
      align: "right",
      render: (r) =>
        r.status === "FAILED" || r.status === "DEAD_LETTER" || r.deadLettered ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void postControl(
                `retry:${r.id}`,
                "/api/sync/retry",
                { runId: r.id },
                `Retried job ${r.jobName}`
              )
            }
            className="inline-flex items-center gap-1 rounded border border-[#F05454]/35 bg-[#F05454]/10 px-2 py-1 font-mono-num text-[10.5px] font-medium text-[#F05454] transition hover:bg-[#F05454]/20 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            {busyAction === `retry:${r.id}` ? "Retrying" : "Retry"}
          </button>
        ) : (
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            {r.errorMessage ? r.errorMessage.slice(0, 28) : "OK"}
          </span>
        ),
    },
  ];

  const anomalyColumns: DataColumn<DataAnomalyRecord>[] = [
    {
      key: "severity",
      header: "Severity",
      sortValue: (r) => r.severity,
      render: (r) => (
        <MarketStatusBadge
          label={r.severity}
          tone={
            r.severity === "CRITICAL" || r.severity === "ERROR"
              ? "bearish"
              : r.severity === "WARN"
              ? "mixed"
              : "neutral"
          }
        />
      ),
    },
    {
      key: "series",
      header: "Series / Source",
      sortValue: (r) => r.seriesKey,
      render: (r) => (
        <div>
          <div className="font-mono-num font-semibold text-[#FFFFFF]">{r.seriesKey}</div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            {r.sourceId ?? r.workerId} · {r.anomalyType}
          </div>
        </div>
      ),
    },
    {
      key: "message",
      header: "Diagnostic",
      render: (r) => <span className="text-[12px] text-[#F0F2F5]">{r.message}</span>,
    },
    {
      key: "range",
      header: "Observed / Expected",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {r.observedValue ?? "—"} / {r.expectedRange ?? "—"}
        </span>
      ),
    },
    {
      key: "detectedAt",
      header: "Detected",
      sortValue: (r) => r.detectedAt,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#7A8390]">
          {formatTs(r.detectedAt)}
        </span>
      ),
    },
  ];

  const checkpointColumns: DataColumn<SyncCheckpointRecord>[] = [
    {
      key: "key",
      header: "Checkpoint",
      sortValue: (r) => r.checkpointKey,
      render: (r) => (
        <div>
          <div className="font-mono-num text-[11.5px] font-semibold text-[#F0F2F5]">
            {r.checkpointKey}
          </div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            {r.workerId} · {r.sourceId ?? "system"}
          </div>
        </div>
      ),
    },
    {
      key: "cursor",
      header: "Cursor",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#F0F2F5]">
          {r.cursorValue ?? "—"}
        </span>
      ),
    },
    {
      key: "obs",
      header: "Last Obs Date",
      sortValue: (r) => r.lastObservationDate ?? "",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {r.lastObservationDate ?? "—"}
        </span>
      ),
    },
    {
      key: "retries",
      header: "Retries",
      align: "right",
      sortValue: (r) => r.retryCount,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#F0F2F5]">{r.retryCount}</span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      sortValue: (r) => r.updatedAt,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#7A8390]">
          {formatTs(r.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Autonomous Data Operations & Sync Health"
        subtitle="Multi-worker ingestion telemetry, WebSocket vs periodic freshness, validation anomalies, and AI supervisor briefs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SyncStatusBadge status={snapshot.overallStatus} size="md" />
            <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.09] bg-[#0A0D12] px-2.5 py-1 font-mono-num text-[10.5px] text-[#9299A3]">
              <Database className="h-3 w-3 text-[#FFFFFF]" />
              {snapshot.persistenceMode === "SUPABASE_POSTGRES"
                ? "SUPABASE POSTGRES"
                : "LOCAL DURABLE STORE"}
            </span>
            <SyncStatusBadge
              status={realtime.connectionStatus}
              size="md"
              label={
                realtime.connectionStatus === "LIVE"
                  ? "REALTIME LIVE"
                  : "POLLING FALLBACK"
              }
            />
            <Link
              href="/macrodashboard/tools/incidents"
              className="inline-flex items-center gap-1.5 rounded border border-[#FFFFFF]/35 bg-[#FFFFFF]/10 px-2.5 py-1 font-mono-num text-[10.5px] font-medium text-[#FFFFFF] transition hover:bg-[#FFFFFF]/20"
            >
              <ShieldAlert className="h-3 w-3" />
              Incident Response (Agent 7)
            </Link>
          </div>
        }
      />

      {/* Authorized Operations Control Bar */}
      <section className="flex flex-col gap-3 rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex items-center">
            <KeyRound className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#7A8390]" />
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              aria-label="Sync admin bearer token"
              placeholder={
                realtime.adminAuthRequired
                  ? "SYNC_ADMIN_TOKEN required"
                  : "Optional SYNC_ADMIN_TOKEN"
              }
              className="w-full rounded-md border border-white/[0.09] bg-[#07090D] py-1.5 pl-8 pr-2.5 font-mono-num text-[11.5px] text-[#F0F2F5] placeholder-[#7A8390] focus:border-[#FFFFFF] focus:outline-none sm:w-56"
            />
          </div>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Snapshot: {formatTs(snapshot.generatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AutoSyncControl
            period={realtime.autoSyncPeriod}
            onChange={(next) => {
              realtime.setAutoSyncPeriod(next);
              void updatePrefs({ autoSyncPeriod: next });
            }}
            nextSec={realtime.nextAutoSyncSec}
            isSyncing={realtime.isSyncing}
          />

          <button
            type="button"
            onClick={() => setIsDebugOpen(true)}
            title="Open AutoSync Telemetry & Diagnostics"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#07090D] px-2.5 py-1.5 text-[11.5px] font-medium text-[#F0F2F5] transition hover:border-[#FFFFFF]/45 hover:text-[#FFFFFF]"
          >
            <Activity className="h-3.5 w-3.5 text-[#22C55E]" />
            Diagnostics
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void postControl(
                "trigger:all",
                "/api/sync/trigger",
                {},
                "Executed full multi-worker synchronization cycle"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-[#FFFFFF] px-3 py-1.5 text-[11.5px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {busyAction === "trigger:all" ? "Syncing..." : "Trigger Full Sync"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void postControl(
                "trigger:backfill",
                "/api/sync/trigger",
                { workerId: "macro-engine", backfill: true },
                "Executed macro historical backfill & vintage sync"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#07090D] px-3 py-1.5 text-[11.5px] font-medium text-[#F0F2F5] transition hover:border-[#FFFFFF]/45 hover:text-[#FFFFFF] disabled:opacity-50"
          >
            <History className="h-3.5 w-3.5" />
            {busyAction === "trigger:backfill" ? "Backfilling..." : "Backfill Macro"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void postControl(
                "insights:manual",
                "/api/sync/insights",
                {},
                "AI Supervisor research brief cycle completed"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-[#FFFFFF]/35 bg-[#FFFFFF]/10 px-3 py-1.5 text-[11.5px] font-medium text-[#FFFFFF] transition hover:bg-[#FFFFFF]/18 disabled:opacity-50"
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            {busyAction === "insights:manual" ? "Analyzing..." : "Generate AI Brief"}
          </button>

          <button
            type="button"
            disabled={realtime.isRefreshing}
            onClick={() => void realtime.refresh()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-[#07090D] px-3 py-1.5 text-[11.5px] font-medium text-[#9299A3] transition hover:text-[#F0F2F5] disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", realtime.isRefreshing && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </section>

      {(actionBanner || realtime.refreshError) && (
        <div
          className={cn(
            "rounded-lg border px-3.5 py-2.5 font-mono-num text-[11.5px]",
            actionBanner?.tone === "negative" || realtime.refreshError
              ? "border-[#F05454]/35 bg-[#F05454]/10 text-[#F05454]"
              : "border-[#00C985]/35 bg-[#00C985]/10 text-[#00C985]"
          )}
        >
          {actionBanner?.message ?? realtime.refreshError}
        </div>
      )}

      {/* 6 Telemetry Summary KPI Cards */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Active Workers</div>
          <div className="mt-1.5 font-mono-num text-[22px] font-semibold text-[#F0F2F5]">
            {telemetrySummary.activeWorkers} / {WORKER_ORDER.length}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Last Attempt: {formatTs(telemetrySummary.lastAttempt)}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Inserted / Updated</div>
          <div className="mt-1.5 font-mono-num text-[22px] font-semibold text-[#00C985]">
            {telemetrySummary.totalUpserted.toLocaleString("en-US")}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Obs: {snapshot.counts.observations} · Latest: {snapshot.counts.latestValues}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Avg API Latency</div>
          <div className="mt-1.5 font-mono-num text-[22px] font-semibold text-[#FFFFFF]">
            {telemetrySummary.avgLatencyMs !== null
              ? `${telemetrySummary.avgLatencyMs} ms`
              : "—"}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Last Success: {formatTs(telemetrySummary.lastSuccess)}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Failed / DLQ Jobs</div>
          <div
            className={cn(
              "mt-1.5 font-mono-num text-[22px] font-semibold",
              telemetrySummary.failedRuns > 0 || snapshot.counts.deadLetterRuns > 0
                ? "text-[#F05454]"
                : "text-[#F0F2F5]"
            )}
          >
            {telemetrySummary.failedRuns} / {snapshot.counts.deadLetterRuns}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Retries Recorded: {telemetrySummary.totalRetries}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Stale &amp; Missing</div>
          <div
            className={cn(
              "mt-1.5 font-mono-num text-[22px] font-semibold",
              telemetrySummary.staleDatasets > 0 || telemetrySummary.missingObsAnomalies > 0
                ? "text-[#D9B45C]"
                : "text-[#F0F2F5]"
            )}
          >
            {telemetrySummary.staleDatasets} / {telemetrySummary.missingObsAnomalies}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Stale Sources / Missing Obs
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4">
          <div className="text-[11px] font-medium text-[#9299A3]">Open Anomalies</div>
          <div
            className={cn(
              "mt-1.5 font-mono-num text-[22px] font-semibold",
              snapshot.counts.openAnomalies > 0 ? "text-[#D9B45C]" : "text-[#00C985]"
            )}
          >
            {snapshot.counts.openAnomalies}
          </div>
          <div className="mt-1 font-mono-num text-[10.5px] text-[#7A8390]">
            Quotes: {snapshot.counts.marketQuotes} · Bars: {snapshot.counts.marketBars}
          </div>
        </div>
      </section>

      {/* 7 Autonomous Workers Grid */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
            <Server className="h-3.5 w-3.5 text-[#FFFFFF]" />
            Autonomous Worker Swarm (7 Independent Workers)
          </h2>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Isolated Error Boundaries · Source-Specific Schedules
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {workerCards.map((w) => (
            <div
              key={w.workerId}
              className="flex flex-col justify-between rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5"
            >
              <div>
                <div className="flex items-start justify-between gap-1.5">
                  <span className="text-[12px] font-semibold text-[#F0F2F5]">
                    {w.label}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#9299A3]">{w.role}</div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <SyncStatusBadge status={w.status} size="xs" />
                  <span className="font-mono-num text-[10px] text-[#7A8390]">
                    {w.latencyMs !== null ? `${w.latencyMs}ms` : "—"}
                  </span>
                </div>
                {w.lastError && (
                  <div
                    title={w.lastError}
                    className="mt-1.5 truncate font-mono-num text-[9.5px] text-[#F05454]"
                  >
                    {w.lastError}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 font-mono-num text-[10px]">
                <span className="text-[#7A8390]">
                  Fail {w.consecutiveFailures} · Retry {w.retryCount}
                </span>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    void postControl(
                      `worker:${w.workerId}`,
                      "/api/sync/trigger",
                      { workerId: w.workerId },
                      `Executed worker ${w.workerId}`
                    )
                  }
                  className="text-[#FFFFFF] hover:underline disabled:opacity-50"
                >
                  {busyAction === `worker:${w.workerId}` ? "Running" : "Run"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Connected Data Sources Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
            <Activity className="h-3.5 w-3.5 text-[#FFFFFF]" />
            Connected Data Sources &amp; Cadence Health
          </h2>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Real-Time Market Streams vs Periodic Economic Releases
          </span>
        </div>

        <DataTable
          data={sourceRows}
          columns={sourceColumns}
          rowKey={(r) => r.id}
          defaultSortKey="name"
          defaultSortDir="asc"
        />
      </section>

      {/* Live Market Quotes & Validated Macro Latest Values */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
              Market Quotes Stream (market_quotes)
            </h2>
            <span className="font-mono-num text-[10.5px] text-[#7A8390]">
              {snapshot.marketQuotes.length} Active Symbols · {snapshot.counts.marketBars} OHLCV Bars
            </span>
          </div>

          {snapshot.marketQuotes.length === 0 ? (
            <EmptyState
              title="No live WebSocket quotes ingested yet"
              detail="Configure MARKET_WS_PROVIDER or trigger market-engine when a WebSocket feed is enabled."
            />
          ) : (
            <DataTable<MarketQuoteRecord>
              data={snapshot.marketQuotes}
              rowKey={(r) => r.symbol}
              columns={[
                {
                  key: "symbol",
                  header: "Symbol",
                  sortValue: (r) => r.symbol,
                  render: (r) => (
                    <div>
                      <span className="font-mono-num font-semibold text-[#FFFFFF]">
                        {r.symbol}
                      </span>
                      <div className="font-mono-num text-[10px] text-[#7A8390]">
                        {r.sourceId}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  sortValue: (r) => r.price,
                  render: (r) => (
                    <span className="font-mono-num font-semibold text-[#F0F2F5]">
                      {formatNumber(r.price, r.price > 1000 ? 1 : 2)}
                    </span>
                  ),
                },
                {
                  key: "chg",
                  header: "Change",
                  align: "right",
                  sortValue: (r) => r.changePct,
                  render: (r) => (
                    <span
                      className={cn(
                        "font-mono-num font-medium",
                        r.changePct >= 0 ? "text-[#00C985]" : "text-[#F05454]"
                      )}
                    >
                      {r.changePct >= 0 ? "+" : ""}
                      {r.changePct.toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Freshness",
                  sortValue: (r) => r.status,
                  render: (r) => <SyncStatusBadge status={r.status} size="xs" />,
                },
                {
                  key: "ts",
                  header: "Quote Time",
                  sortValue: (r) => r.quoteTimestamp,
                  render: (r) => (
                    <span className="font-mono-num text-[10.5px] text-[#7A8390]">
                      {formatTs(r.quoteTimestamp)}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>

        <div className="space-y-3 xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
              Validated Macro Latest Values (latest_values)
            </h2>
            <span className="font-mono-num text-[10.5px] text-[#7A8390]">
              Monotonic Observation Guard · {snapshot.latestValues.length} Series
            </span>
          </div>

          {snapshot.latestValues.length === 0 ? (
            <EmptyState
              title="No validated macro observations persisted yet"
              detail="Click Trigger Full Sync above to run Macro, Positioning, and Liquidity engines."
            />
          ) : (
            <DataTable<LatestValueRecord>
              data={snapshot.latestValues}
              rowKey={(r) => r.seriesKey}
              columns={[
                {
                  key: "series",
                  header: "Series",
                  sortValue: (r) => r.seriesKey,
                  render: (r) => (
                    <div>
                      <span className="font-mono-num font-semibold text-[#F0F2F5]">
                        {r.seriesKey}
                      </span>
                      <div className="font-mono-num text-[10px] text-[#7A8390]">
                        {r.sourceId} · v{r.revisionNumber}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  sortValue: (r) => r.value,
                  render: (r) => (
                    <span className="font-mono-num font-semibold text-[#FFFFFF]">
                      {formatNumber(r.value, 2)} {r.unit}
                    </span>
                  ),
                },
                {
                  key: "obsDate",
                  header: "Obs Date",
                  sortValue: (r) => r.observationDate,
                  render: (r) => (
                    <span className="font-mono-num text-[11px] text-[#9299A3]">
                      {r.observationDate}
                    </span>
                  ),
                },
                {
                  key: "pubDate",
                  header: "Published",
                  sortValue: (r) => r.publishedAt,
                  render: (r) => (
                    <span className="font-mono-num text-[10.5px] text-[#7A8390]">
                      {r.publishedAt.slice(0, 10)}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  sortValue: (r) => r.status,
                  render: (r) => <SyncStatusBadge status={r.status} size="xs" />,
                },
              ]}
            />
          )}
        </div>
      </section>

      {/* Sync Runs, Dead-Letter Queue, Anomalies & Checkpoints */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-2">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "runs", label: `Sync Runs (${snapshot.recentRuns.length})` },
                { id: "dlq", label: `Dead-Letter & Failed (${deadLetterRuns.length})` },
                { id: "anomalies", label: `Anomalies (${snapshot.anomalies.length})` },
                { id: "checkpoints", label: `Checkpoints (${snapshot.checkpoints.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeLogTab === tab.id}
                onClick={() => setActiveLogTab(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-1 font-mono-num text-[11px] font-medium transition-colors",
                  activeLogTab === tab.id
                    ? "border-[#FFFFFF]/45 bg-[#FFFFFF]/12 text-[#FFFFFF]"
                    : "border-white/[0.08] bg-[#0A0D12] text-[#9299A3] hover:text-[#F0F2F5]"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Worker 6 Validation &amp; Recovery Audit Trail
          </span>
        </div>

        {activeLogTab === "runs" && (
          <DataTable
            data={snapshot.recentRuns}
            columns={runColumns}
            rowKey={(r) => r.id}
            emptyMessage="No synchronization runs logged yet."
          />
        )}

        {activeLogTab === "dlq" && (
          <DataTable
            data={deadLetterRuns}
            columns={runColumns}
            rowKey={(r) => r.id}
            emptyMessage="Zero failed or dead-lettered jobs in the queue."
          />
        )}

        {activeLogTab === "anomalies" && (
          <DataTable
            data={snapshot.anomalies}
            columns={anomalyColumns}
            rowKey={(r) => r.id}
            emptyMessage="No open validation anomalies detected."
          />
        )}

        {activeLogTab === "checkpoints" && (
          <DataTable
            data={snapshot.checkpoints}
            columns={checkpointColumns}
            rowKey={(r) => r.checkpointKey}
            emptyMessage="No incremental sync checkpoints stored yet."
          />
        )}
      </section>

      {/* AI Research Supervisor Grounded Insights Panel */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-[#FFFFFF]" />
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
              AI Research Supervisor (Post-Validation Read-Only Briefs)
            </h2>
          </div>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Grounded strictly on validated observations · Zero synthetic writes
          </span>
        </div>

        {snapshot.insights.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.12] bg-[#0A0D12] p-6 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-[#7A8390]" />
            <div className="mt-2 text-[13px] font-medium text-[#F0F2F5]">
              No AI research insights generated yet
            </div>
            <p className="mt-1 text-[12px] text-[#9299A3]">
              Run validation sync first, then click Generate AI Brief to synthesize grounded macro commentary.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {snapshot.insights.map((insight) => (
              <article
                key={insight.id}
                className="flex flex-col justify-between rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:p-5"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-[#FFFFFF]/35 bg-[#FFFFFF]/10 px-1.5 py-0.5 font-mono-num text-[9.5px] font-semibold uppercase text-[#FFFFFF]">
                          {insight.scope}
                        </span>
                        <span className="font-mono-num text-[10px] text-[#7A8390]">
                          {insight.modelId}
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-[14.5px] font-semibold text-[#F0F2F5]">
                        {insight.title}
                      </h3>
                    </div>
                    <span className="font-mono-num text-[10px] text-[#7A8390]">
                      Gen {formatTs(insight.generatedAt)}
                    </span>
                  </div>

                  <p className="text-[12.5px] leading-relaxed text-[#D8DCE3]">
                    {insight.summary}
                  </p>

                  {insight.keyDrivers.length > 0 && (
                    <div className="rounded-md border border-white/[0.07] bg-[#07090D] p-3">
                      <div className="mb-1.5 font-mono-num text-[10px] font-semibold uppercase tracking-wider text-[#00C985]">
                        Key Grounded Drivers
                      </div>
                      <ul className="space-y-1 text-[12px] text-[#9299A3]">
                        {insight.keyDrivers.map((d, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#00C985]" />
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {insight.riskFlags.length > 0 && (
                    <div className="rounded-md border border-white/[0.07] bg-[#07090D] p-3">
                      <div className="mb-1.5 font-mono-num text-[10px] font-semibold uppercase tracking-wider text-[#D9B45C]">
                        Risk Flags
                      </div>
                      <ul className="space-y-1 text-[12px] text-[#9299A3]">
                        {insight.riskFlags.map((rf, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#D9B45C]" />
                            <span>{rf}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
                  {insight.sourceSeriesKeys.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono-num text-[10px] text-[#7A8390]">
                        Cited Series:
                      </span>
                      {insight.sourceSeriesKeys.map((sk) => {
                        const lv = latestBySeriesKey.get(sk);
                        return (
                          <span
                            key={sk}
                            className="rounded border border-white/[0.08] bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[9.5px] text-[#F0F2F5]"
                          >
                            {sk}
                            {lv ? ` · pub ${lv.publishedAt.slice(0, 10)}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono-num text-[10px] text-[#7A8390]">
                    <span>Based on latest: {formatTs(insight.basedOnLatestAt)}</span>
                    {insight.confidenceNote && <span>{insight.confidenceNote}</span>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <AutoSyncDebugModal
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        onTriggerSync={async () => {
          await realtime.triggerSync({ force: true });
        }}
        nextAutoSyncSec={realtime.nextAutoSyncSec}
        autoSyncPeriod={realtime.autoSyncPeriod}
        isSyncing={realtime.isSyncing}
      />
    </div>
  );
}
