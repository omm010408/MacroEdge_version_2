"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Copy,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Terminal,
  X,
} from "lucide-react";
import type { AutoSyncDiagnostics, AutoSyncProbeResult } from "@/services/sync/debug";
import { cn } from "@/lib/utils";

interface AutoSyncDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTriggerSync?: () => Promise<void>;
  nextAutoSyncSec?: number | null;
  autoSyncPeriod?: string;
  isSyncing?: boolean;
}

export function AutoSyncDebugModal({
  isOpen,
  onClose,
  onTriggerSync,
  nextAutoSyncSec,
  autoSyncPeriod = "60s",
  isSyncing = false,
}: AutoSyncDebugModalProps) {
  const [data, setData] = useState<AutoSyncDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<AutoSyncProbeResult | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");

  const fetchDiagnostics = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/sync/debug", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.diagnostics) {
          setData(json.diagnostics);
          setLastRefreshedAt(new Date().toLocaleTimeString());
        }
      }
    } catch (err) {
      console.error("[AutoSyncDebugModal] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchDiagnostics();
      const iv = setInterval(() => {
        void fetchDiagnostics();
      }, 5000);
      return () => clearInterval(iv);
    }
  }, [isOpen, fetchDiagnostics]);

  const handleRunAction = async (action: "probe" | "clear-locks" | "reset-rate-history") => {
    setActionBusy(action);
    try {
      const res = await fetch("/api/sync/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const json = await res.json();
        if (action === "probe" && json.result) {
          setProbeResult(json.result as AutoSyncProbeResult);
        }
        if (json.diagnostics) {
          setData(json.diagnostics);
        }
      }
    } catch (err) {
      console.error(`[AutoSyncDebugModal] Action ${action} error:`, err);
    } finally {
      setActionBusy(null);
    }
  };

  const handleSyncProvider = async (providerId: string) => {
    setActionBusy(`sync:${providerId}`);
    try {
      const res = await fetch("/api/sync/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-provider", providerId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.diagnostics) {
          setData(json.diagnostics);
        }
      }
    } catch (err) {
      console.error(`[AutoSyncDebugModal] Sync provider ${providerId} error:`, err);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCopyJson = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  const verdict = data?.verdict ?? "HEALTHY";
  const verdictColors = {
    HEALTHY: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30",
    DEGRADED: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30",
    LOCKED: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30",
    RATE_LIMITED: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30",
    STALE: "bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30",
    AWAITING_SYNC: "bg-[#A1A1AA]/15 text-[#A1A1AA] border-[#A1A1AA]/30",
  }[verdict];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] shadow-2xl font-mono text-xs">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-[#1F1F1F] px-4 py-3 bg-[#000000]">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-[#22C55E]" />
            <span className="font-semibold tracking-wider text-[#FFFFFF] uppercase">
              AutoSync Telemetry & Diagnostics
            </span>
            <span
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] font-bold uppercase",
                verdictColors
              )}
            >
              {verdict}
            </span>
            {isSyncing && (
              <span className="animate-pulse rounded bg-[#22C55E]/20 px-1.5 py-0.5 text-[10px] text-[#22C55E]">
                SYNC IN FLIGHT
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#71717A]">
              Refreshed: {lastRefreshedAt || "—"}
            </span>
            <button
              type="button"
              onClick={() => void fetchDiagnostics()}
              disabled={isLoading}
              title="Refresh Diagnostics"
              className="rounded p-1 text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Top Metric Bar */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Auto-Sync Period</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-base font-semibold text-white">{autoSyncPeriod}</span>
                {nextAutoSyncSec != null && (
                  <span className="text-[11px] text-[#22C55E]">({nextAutoSyncSec}s)</span>
                )}
              </div>
            </div>

            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Event Loop Lag</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-base font-semibold",
                    (data?.eventLoopLagMs ?? 0) > 150 ? "text-[#EF4444]" : "text-white"
                  )}
                >
                  {data?.eventLoopLagMs ?? 0}
                  <span className="text-xs font-normal text-[#71717A]">ms</span>
                </span>
              </div>
            </div>

            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Memory RSS</span>
              <div className="mt-1 text-base font-semibold text-white">
                {data?.memoryUsageMb?.rss ?? "—"}
                <span className="text-xs font-normal text-[#71717A]">MB</span>
              </div>
            </div>

            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Active Locks</span>
              <div className="mt-1 text-base font-semibold text-white">
                {data?.activeLocks?.length ?? 0}
              </div>
            </div>

            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Stored Observations</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-base font-semibold text-[#22C55E]">
                  {(data?.counts?.totalLatestValues ?? 0) + (data?.counts?.totalMarketQuotes ?? 0)}
                </span>
                <span className="text-[10px] text-[#71717A]">
                  ({data?.counts?.totalLatestValues ?? 0} macro, {data?.counts?.totalMarketQuotes ?? 0} quotes)
                </span>
              </div>
            </div>

            <div className="rounded border border-[#1F1F1F] bg-[#050505] p-2.5">
              <span className="text-[10px] uppercase text-[#71717A]">Persistence Mode</span>
              <div className="mt-1 text-[11px] font-semibold text-[#A1A1AA] truncate">
                {data?.persistenceMode ?? "LOCAL"}
              </div>
            </div>
          </div>

          {/* Quick Actions Control Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#1F1F1F] py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => void handleRunAction("probe")}
                className="inline-flex items-center gap-1.5 rounded border border-[#22C55E]/40 bg-[#22C55E]/10 px-2.5 py-1 text-[11px] font-semibold text-[#22C55E] hover:bg-[#22C55E]/20 disabled:opacity-50"
              >
                <Activity className="h-3 w-3" />
                {actionBusy === "probe" ? "Probing..." : "Run Latency Probe"}
              </button>

              {onTriggerSync && (
                <button
                  type="button"
                  disabled={isSyncing || actionBusy !== null}
                  onClick={async () => {
                    setActionBusy("sync");
                    try {
                      await onTriggerSync();
                      await fetchDiagnostics();
                    } finally {
                      setActionBusy(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  {isSyncing || actionBusy === "sync" ? "Syncing..." : "Force Full Sync"}
                </button>
              )}

              <button
                type="button"
                disabled={actionBusy !== null || (data?.activeLocks?.length ?? 0) === 0}
                onClick={() => void handleRunAction("clear-locks")}
                className="inline-flex items-center gap-1.5 rounded border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-2.5 py-1 text-[11px] text-[#F59E0B] hover:bg-[#F59E0B]/20 disabled:opacity-40"
              >
                <Lock className="h-3 w-3" />
                Clear Locks ({data?.activeLocks?.length ?? 0})
              </button>

              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => void handleRunAction("reset-rate-history")}
                className="inline-flex items-center gap-1.5 rounded border border-[#1F1F1F] bg-[#141414] px-2.5 py-1 text-[11px] text-[#A1A1AA] hover:text-white disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Rate Limits
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyJson()}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#71717A] hover:text-white"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied Diagnostics JSON!" : "Copy Diagnostics JSON"}
            </button>
          </div>

          {/* Diagnostic Issues & Alerts */}
          {data?.issues && data.issues.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#A1A1AA]">
                Active Diagnostic Alerts ({data.issues.length})
              </span>
              <div className="space-y-1">
                {data.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start gap-2 rounded border p-2 text-[11px]",
                      issue.severity === "CRITICAL"
                        ? "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]"
                        : issue.severity === "WARNING"
                        ? "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FDE68A]"
                        : "border-[#1F1F1F] bg-[#141414] text-[#A1A1AA]"
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="flex-1">
                      <span className="font-semibold">[{issue.code}]</span> {issue.message}
                      <div className="mt-0.5 text-[10px] opacity-80">
                        Recommendation: {issue.recommendation}
                      </div>
                      {issue.code.startsWith("PROVIDER_STALE_") && (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            disabled={actionBusy !== null}
                            onClick={() => {
                              const pid = issue.code.replace("PROVIDER_STALE_", "").toLowerCase();
                              void handleSyncProvider(pid);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-[#F59E0B]/40 bg-[#F59E0B]/20 px-2 py-0.5 text-[10px] font-semibold text-[#FDE68A] hover:bg-[#F59E0B]/30 disabled:opacity-50"
                          >
                            <Play className="h-2.5 w-2.5" />
                            {actionBusy?.startsWith("sync:") ? "Syncing..." : "Sync Provider Now"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Probe Result Card (if executed) */}
          {probeResult && (
            <div className="rounded border border-[#22C55E]/30 bg-[#22C55E]/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#22C55E]">
                  Diagnostic Probe Latencies (Total: {probeResult.totalDurationMs}ms)
                </span>
                <span className="text-[10px] text-[#71717A]">{probeResult.finishedAt}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(probeResult.workerLatenciesMs).map(([key, lat]) => (
                  <div key={key} className="rounded bg-[#0A0A0A] border border-[#1F1F1F] p-1.5">
                    <span className="text-[10px] text-[#71717A] block truncate">{key}</span>
                    <span className="font-semibold text-white">{lat}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Provider Matrix */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#A1A1AA]">
              Source Providers & Cadence Policies
            </span>
            <div className="overflow-x-auto rounded border border-[#1F1F1F]">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-[#1F1F1F] bg-[#121212] text-[10px] uppercase text-[#71717A]">
                  <tr>
                    <th className="p-2">Provider</th>
                    <th className="p-2">Cadence</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">RPM Usage</th>
                    <th className="p-2">Last Success</th>
                    <th className="p-2">Overdue?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F1F1F]">
                  {data?.providers &&
                    Object.values(data.providers).map((p) => (
                      <tr key={p.providerId} className="hover:bg-[#141414]">
                        <td className="p-2 font-semibold text-white">
                          {p.name}
                          <span className="ml-1.5 text-[10px] text-[#71717A]">({p.providerId})</span>
                        </td>
                        <td className="p-2 text-[#A1A1AA]">{p.cadence}</td>
                        <td className="p-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                              p.status === "LIVE" || p.status === "CURRENT"
                                ? "bg-[#22C55E]/15 text-[#22C55E]"
                                : p.status === "FAILED"
                                ? "bg-[#EF4444]/15 text-[#EF4444]"
                                : "bg-[#A1A1AA]/15 text-[#A1A1AA]"
                            )}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="p-2 text-white">
                          {p.rateLimitUsage.requestsInLastMinute} / {p.rateLimitUsage.maxAllowed}
                          <span className="text-[10px] text-[#71717A] ml-1">
                            ({p.rateLimitUsage.windowHeadroom} left)
                          </span>
                        </td>
                        <td className="p-2 text-[#A1A1AA]">
                          {p.lastSuccessAt
                            ? p.lastSuccessAt.slice(11, 19) + " UTC"
                            : data?.activeLocks?.some((l) => l.includes(p.providerId))
                            ? "Syncing..."
                            : "Never"}
                        </td>
                        <td className="p-2">
                          {p.overdue ? (
                            <span className="text-[#EF4444] font-bold">YES</span>
                          ) : !p.configured || p.status === "DISCONNECTED" ? (
                            <span className="text-[#52525B]">NO</span>
                          ) : p.lastSuccessAt == null ? (
                            <span className="text-[#F59E0B]/90 font-medium">PENDING</span>
                          ) : (
                            <span className="text-[#22C55E]">NO</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Worker Status Grid */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#A1A1AA]">
              Sync Worker Pipeline
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data?.workers &&
                Object.values(data.workers).map((w) => (
                  <div
                    key={w.workerId}
                    className="rounded border border-[#1F1F1F] bg-[#080808] p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{w.workerId}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                          w.status === "LIVE" || w.status === "CURRENT"
                            ? "bg-[#22C55E]/15 text-[#22C55E]"
                            : w.status === "FAILED"
                            ? "bg-[#EF4444]/15 text-[#EF4444]"
                            : "bg-[#A1A1AA]/15 text-[#A1A1AA]"
                        )}
                      >
                        {w.status}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-[#71717A] flex justify-between">
                      <span>Last run: {w.lastRunDurationMs != null ? `${w.lastRunDurationMs}ms` : "—"}</span>
                      <span>Records: {w.recordsUpdated}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#1F1F1F] px-4 py-2 bg-[#000000] text-[10px] text-[#71717A]">
          <span>MacroEdge Autonomous Sync Diagnostic Harness</span>
          <span>Press ESC or click close to dismiss</span>
        </div>
      </div>
    </div>
  );
}
