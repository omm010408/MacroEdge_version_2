import type { FeedMode, InflationCardMetric } from "@/lib/types";
import type { SyncStatusType } from "@/lib/sync/types";
import { FeedModeBadge, SyncStatusBadge } from "@/components/cards/MarketStatusBadge";
import { cn } from "@/lib/utils";

export function MacroIndicatorCard({
  metric,
  fallbackMode,
  syncStatus,
}: {
  metric: InflationCardMetric;
  fallbackMode?: FeedMode;
  syncStatus?: SyncStatusType;
}) {
  const hasLatest = metric.latest !== null && Number.isFinite(metric.latest);
  const hasPrev = metric.previous !== null && Number.isFinite(metric.previous);
  const hasCons = metric.consensus !== null && Number.isFinite(metric.consensus);
  const hasActual = metric.actual !== null && Number.isFinite(metric.actual);
  const delta = metric.change !== null && Number.isFinite(metric.change) ? metric.change : null;
  const isUp = delta !== null && delta > 0;
  const isFlat = delta === null || delta === 0;
  const surprise =
    hasActual && hasCons ? Number((metric.actual! - metric.consensus!).toFixed(2)) : null;
  const resolvedMode: FeedMode =
    metric.mode ?? metric.meta?.mode ?? fallbackMode ?? "UNCONFIGURED";
  const isLive = resolvedMode === "LIVE_API";
  const displayDate = metric.observationDate ?? metric.releaseDate;

  return (
    <div className="terminal-card flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] hover:bg-[#141414]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[12px] font-medium text-[#A3A3A3]">{metric.label}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 font-mono-num text-[9.5px] font-medium text-[#A3A3A3]">
            {metric.cadence}
          </span>
          {isLive && syncStatus ? (
            <SyncStatusBadge status={syncStatus} size="xs" />
          ) : (
            <FeedModeBadge mode={resolvedMode} compact className="text-[9px]" />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="font-mono-num text-[22px] font-semibold tracking-tight text-[#FFFFFF]">
          {hasLatest ? `${metric.latest!.toFixed(2)}${metric.unit}` : "—"}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono-num text-[11px] font-medium",
            isFlat
              ? "bg-[#141414] text-[#6B6B6B]"
              : isUp
              ? "bg-[#EF4444]/12 text-[#EF4444]"
              : "bg-[#22C55E]/12 text-[#22C55E]"
          )}
        >
          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} pp`}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#1C1C1C] pt-2.5 font-mono-num text-[10.5px]">
        <div>
          <div className="text-[#6B6B6B]">Prev</div>
          <div className="mt-0.5 text-[#A3A3A3]">
            {hasPrev ? `${metric.previous!.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[#6B6B6B]">Cons</div>
          <div className="mt-0.5 text-[#A3A3A3]">
            {hasCons ? `${metric.consensus!.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[#6B6B6B]">Surprise</div>
          <div
            className={cn(
              "mt-0.5",
              surprise === null
                ? "text-[#A3A3A3]"
                : surprise > 0
                ? "text-[#EF4444]"
                : surprise < 0
                ? "text-[#22C55E]"
                : "text-[#A3A3A3]"
            )}
          >
            {surprise === null ? "—" : `${surprise > 0 ? "+" : ""}${surprise.toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#1C1C1C] pt-2 font-mono-num text-[10px] text-[#6B6B6B]">
        <span className="truncate">{metric.source}</span>
        <span className="shrink-0">{displayDate}</span>
      </div>
    </div>
  );
}
