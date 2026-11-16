"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  IncidentActionType,
  IncidentDashboardSnapshot,
  IncidentDomain,
  IncidentSeverity,
  IncidentStatus,
  RuntimeTelemetryRecord,
  SystemIncidentRecord,
} from "@/lib/incidents/types";
import { useIncidentRealtime } from "@/lib/realtime/useMacroRealtime";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/FilterControls";
import { SyncStatusBadge } from "@/components/cards/MarketStatusBadge";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { EmptyState } from "@/components/dashboard/FeedbackStates";

interface IncidentDashboardViewProps {
  initialSnapshot: IncidentDashboardSnapshot;
}

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  Critical: "border-[#F05454]/45 bg-[#F05454]/15 text-[#F05454]",
  High: "border-[#D9B45C]/45 bg-[#D9B45C]/15 text-[#D9B45C]",
  Medium: "border-[#FFFFFF]/45 bg-[#FFFFFF]/15 text-[#FFFFFF]",
  Low: "border-white/15 bg-white/[0.04] text-[#9299A3]",
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  open: "border-[#F05454]/40 bg-[#F05454]/10 text-[#F05454]",
  investigating: "border-[#F0F2F5]/40 bg-[#F0F2F5]/10 text-[#F0F2F5]",
  remediating: "border-[#FFFFFF]/40 bg-[#FFFFFF]/10 text-[#FFFFFF]",
  awaiting_approval: "border-[#D9B45C]/45 bg-[#D9B45C]/15 text-[#D9B45C]",
  resolved: "border-[#00C985]/40 bg-[#00C985]/12 text-[#00C985]",
  dismissed: "border-white/10 bg-white/[0.04] text-[#7A8390]",
};

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function formatUtc(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function IncidentDashboardView({
  initialSnapshot,
}: IncidentDashboardViewProps) {
  const realtime = useIncidentRealtime({
    initialSnapshot,
    fetchOnMount: true,
    pollIntervalMs: 10000,
  });

  const snapshot = realtime.snapshot ?? initialSnapshot;

  const [adminToken, setAdminToken] = useState("");
  const [domainFilter, setDomainFilter] = useState<"ALL" | IncidentDomain>("ALL");
  const [severityFilter, setSeverityFilter] = useState<"ALL" | IncidentSeverity>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ALL" | IncidentStatus>("ACTIVE");
  const [selectedId, setSelectedId] = useState<string | null>(
    snapshot.incidents[0]?.id ?? null
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    tone: "positive" | "negative" | "neutral";
    message: string;
  } | null>(null);

  const filteredIncidents = useMemo(() => {
    return snapshot.incidents.filter((inc) => {
      if (domainFilter !== "ALL" && inc.domain !== domainFilter) return false;
      if (severityFilter !== "ALL" && inc.severity !== severityFilter) return false;
      if (statusFilter === "ACTIVE") {
        if (inc.status === "resolved" || inc.status === "dismissed") return false;
      } else if (statusFilter !== "ALL" && inc.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [snapshot.incidents, domainFilter, severityFilter, statusFilter]);

  const selectedIncident = useMemo(() => {
    return (
      snapshot.incidents.find((i) => i.id === selectedId) ??
      filteredIncidents[0] ??
      snapshot.incidents[0] ??
      null
    );
  }, [snapshot.incidents, filteredIncidents, selectedId]);

  const latestRuntimeMetrics = useMemo(() => {
    const memSample = snapshot.telemetry.find(
      (t) => t.metricType === "memory_rss"
    );
    const dbSample = snapshot.telemetry.find(
      (t) => t.metricType === "db_query"
    );
    const failedClientCount = snapshot.telemetry.filter(
      (t) =>
        !t.ok &&
        (t.metricType === "ui_error" ||
          t.metricType === "hydration_error" ||
          t.metricType === "api_latency")
    ).length;

    return {
      memRssMb: memSample?.memoryRssMb ?? null,
      heapUsedMb: memSample?.heapUsedMb ?? null,
      lagMs: memSample?.eventLoopLagMs ?? null,
      dbLatencyMs: dbSample?.latencyMs ?? null,
      failedClientCount,
    };
  }, [snapshot.telemetry]);

  async function runSweep(invokeAi: boolean) {
    const key = invokeAi ? "sweep:ai" : "sweep:det";
    setBusyAction(key);
    setBanner(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (adminToken.trim()) {
        headers.Authorization = `Bearer ${adminToken.trim()}`;
      }
      const res = await fetch("/api/incidents/sweep", {
        method: "POST",
        headers,
        body: JSON.stringify({
          runDbProbe: true,
          autoRemediate: true,
          invokeAi,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sweep?: {
          incidentsDetected: number;
          autoRemediatedCount: number;
          awaitingApprovalCount: number;
          resolvedCount: number;
          durationMs: number;
        };
        snapshot?: IncidentDashboardSnapshot;
      };
      if (!res.ok) {
        setBanner({
          tone: "negative",
          message: json.error ?? `Diagnostic sweep failed (${res.status})`,
        });
        return;
      }
      if (json.snapshot) {
        realtime.applySnapshot(json.snapshot);
      }
      setBanner({
        tone: "positive",
        message: json.sweep
          ? `Agent 7 sweep finished in ${json.sweep.durationMs}ms · detected ${json.sweep.incidentsDetected}, auto-remediated ${json.sweep.autoRemediatedCount}, awaiting approval ${json.sweep.awaitingApprovalCount}, resolved ${json.sweep.resolvedCount}.`
          : "Agent 7 diagnostic sweep complete.",
      });
    } catch (err) {
      setBanner({
        tone: "negative",
        message: err instanceof Error ? err.message : "Sweep request failed",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function dispatchIncidentAction(
    incidentId: string,
    action: IncidentActionType,
    note?: string
  ) {
    const key = `action:${incidentId}:${action}`;
    setBusyAction(key);
    setBanner(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (adminToken.trim()) {
        headers.Authorization = `Bearer ${adminToken.trim()}`;
      }
      const res = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/action`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          actor: "terminal-operator",
          note,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        incident?: SystemIncidentRecord | null;
        snapshot?: IncidentDashboardSnapshot;
      };
      if (!res.ok) {
        setBanner({
          tone: "negative",
          message: json.error ?? `Action failed (${res.status})`,
        });
        return;
      }
      if (json.snapshot) {
        realtime.applySnapshot(json.snapshot);
      }
      if (json.incident) {
        setSelectedId(json.incident.id);
      }
      setBanner({
        tone: json.ok ? "positive" : "neutral",
        message: json.message ?? `Executed ${action} on ${incidentId}`,
      });
    } catch (err) {
      setBanner({
        tone: "negative",
        message: err instanceof Error ? err.message : "Incident action request failed",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const incidentColumns: DataColumn<SystemIncidentRecord>[] = [
    {
      key: "id",
      header: "Incident ID",
      sortValue: (r) => r.id,
      render: (r) => (
        <button
          type="button"
          onClick={() => setSelectedId(r.id)}
          className="text-left font-mono-num text-[11px] font-semibold text-[#FFFFFF] hover:underline"
        >
          {r.id}
        </button>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      sortValue: (r) => SEVERITY_RANK[r.severity],
      render: (r) => (
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 font-mono-num text-[10px] font-semibold uppercase",
            SEVERITY_COLORS[r.severity]
          )}
        >
          {r.severity}
        </span>
      ),
    },
    {
      key: "component",
      header: "Affected Component",
      sortValue: (r) => r.affectedComponent,
      render: (r) => (
        <div>
          <div className="font-mono-num text-[11.5px] font-medium text-[#F0F2F5]">
            {r.affectedComponent}
          </div>
          <div className="font-mono-num text-[10px] uppercase text-[#7A8390]">
            {r.domain}
            {r.affectedDataset ? ` · ${r.affectedDataset}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "firstDetected",
      header: "First Detected",
      sortValue: (r) => r.firstDetectedAt,
      render: (r) => (
        <div>
          <div className="font-mono-num text-[11px] text-[#F0F2F5]">
            {formatUtc(r.firstDetectedAt)}
          </div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            ×{r.occurrenceCount} seen
          </div>
        </div>
      ),
    },
    {
      key: "error",
      header: "Error Description",
      render: (r) => (
        <p className="max-w-[230px] line-clamp-2 text-[11.5px] text-[#F0F2F5]">
          {r.errorDescription}
        </p>
      ),
    },
    {
      key: "rootCause",
      header: "Root Cause",
      render: (r) => (
        <div className="max-w-[220px]">
          <p className="line-clamp-2 text-[11px] text-[#9299A3]">
            {r.rootCause ?? "Insufficient evidence — pending investigation"}
          </p>
          <span className="mt-0.5 inline-block font-mono-num text-[9.5px] uppercase text-[#F0F2F5]">
            {r.investigationSource}
            {r.rootCauseVerified ? " · VERIFIED" : " · UNVERIFIED"}
          </span>
        </div>
      ),
    },
    {
      key: "fix",
      header: "Recommended Fix",
      render: (r) => (
        <div className="max-w-[210px]">
          <p className="line-clamp-2 text-[11px] text-[#9299A3]">
            {r.recommendedFix ?? "—"}
          </p>
          {r.requiresHumanApproval && (
            <span className="mt-0.5 inline-flex items-center gap-1 font-mono-num text-[9.5px] text-[#D9B45C]">
              <Lock className="h-2.5 w-2.5" />
              {r.approvalStatus.replace("_", " ").toUpperCase()}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => r.status,
      render: (r) => (
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 font-mono-num text-[10px] font-medium uppercase",
            STATUS_COLORS[r.status]
          )}
        >
          {r.status.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "verification",
      header: "Recovery Verification",
      render: (r) =>
        r.recoveryVerification ? (
          <div>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-mono-num text-[10.5px] font-semibold",
                r.recoveryVerification.verified
                  ? "text-[#00C985]"
                  : "text-[#F05454]"
              )}
            >
              {r.recoveryVerification.verified ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {r.recoveryVerification.verified ? "VERIFIED" : "FAILED"}
            </span>
            <div className="font-mono-num text-[9.5px] text-[#7A8390]">
              {r.recoveryVerification.checks.filter((c) => c.passed).length}/
              {r.recoveryVerification.checks.length} checks ·{" "}
              {formatUtc(r.recoveryVerification.verifiedAt)}
            </div>
          </div>
        ) : (
          <span className="font-mono-num text-[10.5px] text-[#555D68]">
            Not verified yet
          </span>
        ),
    },
  ];

  const telemetryColumns: DataColumn<RuntimeTelemetryRecord>[] = [
    {
      key: "time",
      header: "Recorded",
      sortValue: (r) => r.recordedAt,
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#7A8390]">
          {formatUtc(r.recordedAt)}
        </span>
      ),
    },
    {
      key: "component",
      header: "Component",
      sortValue: (r) => r.sourceComponent,
      render: (r) => (
        <span className="font-mono-num text-[11px] font-medium text-[#F0F2F5]">
          {r.sourceComponent}
        </span>
      ),
    },
    {
      key: "metric",
      header: "Metric Type",
      render: (r) => (
        <span className="font-mono-num text-[10.5px] uppercase text-[#FFFFFF]">
          {r.metricType}
        </span>
      ),
    },
    {
      key: "metrics",
      header: "Values",
      render: (r) => (
        <span className="font-mono-num text-[11px] text-[#9299A3]">
          {r.latencyMs !== null ? `${r.latencyMs}ms ` : ""}
          {r.memoryRssMb !== null ? `RSS ${r.memoryRssMb}MB ` : ""}
          {r.eventLoopLagMs !== null ? `Lag ${r.eventLoopLagMs}ms` : ""}
        </span>
      ),
    },
    {
      key: "state",
      header: "Health",
      render: (r) => (
        <span
          className={cn(
            "font-mono-num text-[10.5px] font-semibold",
            r.ok ? "text-[#00C985]" : "text-[#F05454]"
          )}
        >
          {r.ok ? "OK" : "ERROR"}
        </span>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      render: (r) => (
        <span className="text-[11px] text-[#9299A3]">{r.detail ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent 7 — Autonomous Debugger & Incident Response"
        subtitle="Continuous deterministic monitoring, root-cause diagnostics, safe idempotent auto-recovery, and human-approval safety gating."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SyncStatusBadge
              status={
                snapshot.counts.criticalOpen > 0
                  ? "FAILED"
                  : snapshot.counts.open + snapshot.counts.awaitingApproval > 0
                  ? "DELAYED"
                  : "CURRENT"
              }
              size="md"
              label={
                snapshot.counts.criticalOpen > 0
                  ? `${snapshot.counts.criticalOpen} CRITICAL`
                  : `${snapshot.counts.open + snapshot.counts.awaitingApproval} ACTIVE`
              }
            />
            <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.09] bg-[#0A0D12] px-2.5 py-1 font-mono-num text-[10.5px] text-[#9299A3]">
              <Database className="h-3 w-3 text-[#FFFFFF]" />
              {snapshot.persistenceMode}
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
              href="/macrodashboard/tools/data-ops"
              className="inline-flex items-center gap-1.5 rounded border border-white/[0.09] bg-[#0A0D12] px-2.5 py-1 font-mono-num text-[10.5px] text-[#9299A3] transition hover:text-[#F0F2F5]"
            >
              <Activity className="h-3 w-3 text-[#FFFFFF]" />
              Data Ops
            </Link>
          </div>
        }
      />

      {/* Safety & Execution Bar */}
      <section className="flex flex-col gap-3 rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex items-center">
            <KeyRound className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#7A8390]" />
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              aria-label="Incident operator admin token"
              placeholder={
                realtime.adminAuthRequired
                  ? "SYNC_ADMIN_TOKEN required"
                  : "Optional SYNC_ADMIN_TOKEN"
              }
              className="w-full rounded-md border border-white/[0.09] bg-[#07090D] py-1.5 pl-8 pr-2.5 font-mono-num text-[11.5px] text-[#F0F2F5] placeholder-[#7A8390] focus:border-[#FFFFFF] focus:outline-none sm:w-56"
            />
          </div>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            Updated {formatUtc(snapshot.generatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runSweep(false)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#FFFFFF] px-3 py-1.5 text-[11.5px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {busyAction === "sweep:det" ? "Sweeping..." : "Run Diagnostic Sweep"}
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runSweep(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#0E1115] px-3 py-1.5 text-[11.5px] font-medium text-[#F0F2F5] transition hover:border-[#FFFFFF]/40 disabled:opacity-50"
          >
            <BrainCircuit className="h-3.5 w-3.5 text-[#F0F2F5]" />
            {busyAction === "sweep:ai" ? "Investigating..." : "AI Debug Sweep"}
          </button>
          <button
            type="button"
            disabled={realtime.isRefreshing}
            onClick={() => void realtime.refresh()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#07090D] px-3 py-1.5 text-[11.5px] text-[#9299A3] transition hover:text-[#F0F2F5]"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", realtime.isRefreshing && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </section>

      {banner && (
        <div
          className={cn(
            "rounded-md border px-3.5 py-2 font-mono-num text-[11.5px]",
            banner.tone === "positive"
              ? "border-[#00C985]/35 bg-[#00C985]/10 text-[#00C985]"
              : banner.tone === "negative"
              ? "border-[#F05454]/35 bg-[#F05454]/10 text-[#F05454]"
              : "border-[#D9B45C]/35 bg-[#D9B45C]/10 text-[#D9B45C]"
          )}
        >
          {banner.message}
        </div>
      )}

      {/* Telemetry & Severity Strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            Critical Open
          </div>
          <div className="mt-1 font-mono-num text-[22px] font-semibold text-[#F05454]">
            {snapshot.counts.criticalOpen}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            Awaiting Approval
          </div>
          <div className="mt-1 font-mono-num text-[22px] font-semibold text-[#D9B45C]">
            {snapshot.counts.awaitingApproval}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            Open / Active
          </div>
          <div className="mt-1 font-mono-num text-[22px] font-semibold text-[#FFFFFF]">
            {snapshot.counts.open + snapshot.counts.investigating + snapshot.counts.remediating}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            Resolved Verified
          </div>
          <div className="mt-1 font-mono-num text-[22px] font-semibold text-[#00C985]">
            {snapshot.counts.resolved}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="flex items-center gap-1 font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            <Cpu className="h-3 w-3 text-[#F0F2F5]" />
            Node Memory / Lag
          </div>
          <div className="mt-1 font-mono-num text-[15px] font-semibold text-[#F0F2F5]">
            {latestRuntimeMetrics.memRssMb !== null
              ? `${latestRuntimeMetrics.memRssMb} MB`
              : "—"}
          </div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            Loop lag:{" "}
            {latestRuntimeMetrics.lagMs !== null
              ? `${latestRuntimeMetrics.lagMs} ms`
              : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-3.5">
          <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#7A8390]">
            DB Read Latency
          </div>
          <div className="mt-1 font-mono-num text-[15px] font-semibold text-[#F0F2F5]">
            {latestRuntimeMetrics.dbLatencyMs !== null
              ? `${latestRuntimeMetrics.dbLatencyMs} ms`
              : "—"}
          </div>
          <div className="font-mono-num text-[10px] text-[#7A8390]">
            Client err samples: {latestRuntimeMetrics.failedClientCount}
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.09] bg-[#0A0D12] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["ALL", "frontend", "backend", "database", "sync"] as const).map((dom) => (
            <button
              key={dom}
              type="button"
              onClick={() => setDomainFilter(dom)}
              className={cn(
                "rounded px-2.5 py-1 font-mono-num text-[11px] uppercase transition",
                domainFilter === dom
                  ? "bg-[#FFFFFF]/15 text-[#FFFFFF] border border-[#FFFFFF]/35"
                  : "text-[#9299A3] hover:text-[#F0F2F5]"
              )}
            >
              {dom}
              {dom !== "ALL" ? ` (${snapshot.counts.byDomain[dom] ?? 0})` : ""}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Severity filter"
            value={severityFilter}
            onChange={(e) =>
              setSeverityFilter(e.target.value as "ALL" | IncidentSeverity)
            }
            className="rounded border border-white/[0.09] bg-[#07090D] px-2 py-1 font-mono-num text-[11px] text-[#F0F2F5]"
          >
            <option value="ALL">All Severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            aria-label="Status filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "ACTIVE" | "ALL" | IncidentStatus)
            }
            className="rounded border border-white/[0.09] bg-[#07090D] px-2 py-1 font-mono-num text-[11px] text-[#F0F2F5]"
          >
            <option value="ACTIVE">Active Incidents</option>
            <option value="ALL">All Statuses</option>
            <option value="open">Open</option>
            <option value="awaiting_approval">Awaiting Approval</option>
            <option value="investigating">Investigating</option>
            <option value="remediating">Remediating</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
      </section>

      {/* Main Incident Register Table */}
      <section className="space-y-3">
        {filteredIncidents.length > 0 ? (
          <DataTable
            columns={incidentColumns}
            data={filteredIncidents}
            rowKey={(r) => r.id}
            selectedRowKey={selectedIncident?.id ?? null}
            onRowClick={(r) => setSelectedId(r.id)}
          />
        ) : (
          <EmptyState
            title="Zero matching incidents"
            detail="All monitored frontend, backend, database, and data-synchronization checks matching these filters are clean."
          />
        )}
      </section>

      {/* Selected Incident Detail & Response Panel */}
      {selectedIncident && (
        <section className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.08] pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#FFFFFF]" />
                <span className="font-mono-num text-[13px] font-semibold text-[#F0F2F5]">
                  {selectedIncident.id}
                </span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono-num text-[10px] uppercase",
                    SEVERITY_COLORS[selectedIncident.severity]
                  )}
                >
                  {selectedIncident.severity}
                </span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono-num text-[10px] uppercase",
                    STATUS_COLORS[selectedIncident.status]
                  )}
                >
                  {selectedIncident.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-[#F0F2F5]">
                {selectedIncident.errorDescription}
              </p>
            </div>

            {/* Safe Action Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void dispatchIncidentAction(selectedIncident.id, "investigate")
                }
                className="inline-flex items-center gap-1 rounded border border-white/[0.09] bg-[#0E1115] px-2.5 py-1.5 font-mono-num text-[11px] text-[#F0F2F5] hover:border-[#FFFFFF]/40 disabled:opacity-50"
              >
                <BrainCircuit className="h-3.5 w-3.5 text-[#F0F2F5]" />
                Investigate
              </button>

              {selectedIncident.requiresHumanApproval &&
                selectedIncident.approvalStatus !== "approved" && (
                  <>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void dispatchIncidentAction(selectedIncident.id, "approve")
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#00C985]/40 bg-[#00C985]/12 px-2.5 py-1.5 font-mono-num text-[11px] font-medium text-[#00C985] hover:bg-[#00C985]/20 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Approve Fix
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void dispatchIncidentAction(selectedIncident.id, "reject")
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#F05454]/40 bg-[#F05454]/10 px-2.5 py-1.5 font-mono-num text-[11px] text-[#F05454] hover:bg-[#F05454]/20 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}

              <button
                type="button"
                disabled={
                  busyAction !== null ||
                  (selectedIncident.requiresHumanApproval &&
                    selectedIncident.approvalStatus !== "approved") ||
                  !selectedIncident.safeIdempotentAction ||
                  selectedIncident.safeIdempotentAction === "none"
                }
                onClick={() =>
                  void dispatchIncidentAction(selectedIncident.id, "remediate")
                }
                className="inline-flex items-center gap-1 rounded border border-[#FFFFFF]/40 bg-[#FFFFFF]/15 px-2.5 py-1.5 font-mono-num text-[11px] font-medium text-[#FFFFFF] hover:bg-[#FFFFFF]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Wrench className="h-3.5 w-3.5" />
                Run Safe Recovery
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void dispatchIncidentAction(selectedIncident.id, "resolve")
                }
                className="inline-flex items-center gap-1 rounded border border-white/[0.09] bg-[#0E1115] px-2.5 py-1.5 font-mono-num text-[11px] text-[#00C985] hover:border-[#00C985]/40 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Verify Recovery
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void dispatchIncidentAction(selectedIncident.id, "dismiss")
                }
                className="rounded border border-white/[0.09] px-2.5 py-1.5 font-mono-num text-[11px] text-[#7A8390] hover:text-[#F0F2F5] disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded border border-white/[0.08] bg-[#070809] p-3">
                <div className="font-mono-num text-[10px] uppercase text-[#7A8390]">
                  Root Cause & Evidence ({selectedIncident.investigationSource})
                </div>
                <p className="mt-1 text-[12px] text-[#F0F2F5]">
                  {selectedIncident.rootCause ??
                    "Insufficient evidence — manual investigation required."}
                </p>
              </div>
              <div className="rounded border border-white/[0.08] bg-[#070809] p-3">
                <div className="font-mono-num text-[10px] uppercase text-[#7A8390]">
                  Recommended Fix & Regression Test
                </div>
                <p className="mt-1 text-[12px] text-[#9299A3]">
                  {selectedIncident.recommendedFix ?? "—"}
                </p>
                {selectedIncident.regressionTestRef && (
                  <div className="mt-1.5 font-mono-num text-[10.5px] text-[#FFFFFF]">
                    Regression Ref: {selectedIncident.regressionTestRef}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded border border-white/[0.08] bg-[#070809] p-3">
                <div className="flex items-center gap-1.5 font-mono-num text-[10px] uppercase text-[#7A8390]">
                  <Terminal className="h-3 w-3" />
                  Redacted Trace / Context
                </div>
                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono-num text-[10.5px] text-[#9299A3]">
                  {selectedIncident.redactedTrace ?? "No trace recorded."}
                </pre>
              </div>

              <div className="rounded border border-white/[0.08] bg-[#070809] p-3">
                <div className="font-mono-num text-[10px] uppercase text-[#7A8390]">
                  Audit Timeline
                </div>
                <ul className="mt-1.5 max-h-36 space-y-1 overflow-auto font-mono-num text-[10.5px]">
                  {selectedIncident.timeline
                    .slice()
                    .reverse()
                    .map((ev) => (
                      <li key={ev.id} className="text-[#9299A3]">
                        <span className="text-[#7A8390]">{formatUtc(ev.timestamp)}</span>{" "}
                        <span className="text-[#FFFFFF]">[{ev.actor}]</span>{" "}
                        <span className="text-[#F0F2F5]">{ev.action}</span>: {ev.detail}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Runtime Telemetry Table */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#F0F2F5]">
            Runtime Telemetry Samples (Backend Memory/Lag, DB Latency & Frontend Events)
          </h3>
          <span className="font-mono-num text-[10.5px] text-[#7A8390]">
            {snapshot.telemetry.length} sample(s)
          </span>
        </div>
        {snapshot.telemetry.length > 0 ? (
          <DataTable
            columns={telemetryColumns}
            data={snapshot.telemetry.slice(0, 25)}
            rowKey={(r) => r.id}
          />
        ) : (
          <EmptyState
            title="No telemetry samples yet"
            detail="Run a diagnostic sweep to record live memory, event-loop lag, DB latency, and client checks."
          />
        )}
      </section>
    </div>
  );
}
