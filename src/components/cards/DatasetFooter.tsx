import type { DatasetMeta } from "@/lib/types";
import type { AutoSyncPeriod } from "@/lib/storage/preferences";
import { FeedModeBadge } from "@/components/cards/MarketStatusBadge";
import { cn } from "@/lib/utils";

export function DatasetFooter({
  meta,
  autoSyncPeriod,
  nextAutoSyncSec,
  className,
}: {
  meta: DatasetMeta;
  autoSyncPeriod?: AutoSyncPeriod;
  nextAutoSyncSec?: number | null;
  className?: string;
}) {
  const syncTimestamp = meta.lastUpdated
    ? `${meta.lastUpdated.slice(0, 16).replace("T", " ")}Z`
    : "—";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-[#1C1C1C] pt-3 font-mono-num text-[10.5px] text-[#6B6B6B]",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[#A3A3A3]">{meta.source}</span>
        <span>Obs: {meta.observationDate}</span>
        {meta.releaseDate && <span>Rel: {meta.releaseDate}</span>}
        <span>Freq: {meta.frequency}</span>
        <span>Units: {meta.units}</span>
      </div>

      <div className="flex items-center gap-2.5">
        {autoSyncPeriod && autoSyncPeriod !== "off" && (
          <span className="inline-flex items-center gap-1.5 rounded border border-[#22C55E]/30 bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-medium text-[#22C55E]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" />
            Auto-Sync: {autoSyncPeriod}
            {nextAutoSyncSec !== undefined && nextAutoSyncSec !== null && (
              <span className="text-[#22C55E]/80">({nextAutoSyncSec}s)</span>
            )}
          </span>
        )}
        <FeedModeBadge mode={meta.mode} />
        <span>Sync {syncTimestamp}</span>
      </div>
    </div>
  );
}
