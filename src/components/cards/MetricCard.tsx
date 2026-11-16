import type { MarketOverviewCardData } from "@/lib/types";
import type { SyncStatusType } from "@/lib/sync/types";
import { FeedModeBadge, SyncStatusBadge } from "@/components/cards/MarketStatusBadge";
import { cn, formatNumber } from "@/lib/utils";

function SparklineSvg({
  id,
  points,
  previous,
  positive,
}: {
  id: string;
  points: { t: string; v: number }[];
  previous: number | null;
  positive: boolean;
}) {
  if (points.length < 2) {
    return (
      <svg
        viewBox="0 0 108 32"
        aria-hidden="true"
        className="h-8 w-26 opacity-45"
      >
        <line
          x1="2"
          y1="16"
          x2="106"
          y2="16"
          stroke="rgba(148, 163, 184, 0.25)"
          strokeDasharray="3 3"
          strokeWidth="1.25"
        />
        <circle cx="104" cy="16" r="2" fill="#7D8694" />
      </svg>
    );
  }

  const vals = points.map((p) => p.v);
  const hasPrev = previous !== null && Number.isFinite(previous);
  const min = hasPrev ? Math.min(...vals, previous) : Math.min(...vals);
  const max = hasPrev ? Math.max(...vals, previous) : Math.max(...vals);
  const range = max - min || 1;
  const w = 108;
  const h = 32;

  const coords = vals.map((v, idx) => {
    const x = (idx / (vals.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    return { x, y, v };
  });

  const prevY = hasPrev ? h - 3 - ((previous - min) / range) * (h - 6) : null;
  const last = coords[coords.length - 1];
  const color = positive ? "#00C985" : "#F05454";
  const gradId = `spark-${id}`;
  const linePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" L ");
  const areaPath = `M ${coords[0].x.toFixed(1)},${h} L ${linePts} L ${last.x.toFixed(1)},${h} Z`;
  const linePath = `M ${linePts}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-26 overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {prevY !== null && (
        <line
          x1="0"
          y1={prevY.toFixed(1)}
          x2={w}
          y2={prevY.toFixed(1)}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="2 2"
          strokeWidth="1"
        />
      )}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.2" fill={color} stroke="#0A0D12" strokeWidth="1" />
    </svg>
  );
}

export function MetricCard({
  card,
  syncStatus,
}: {
  card: MarketOverviewCardData;
  syncStatus?: SyncStatusType;
}) {
  const hasValue = card.value !== null && Number.isFinite(card.value);
  const hasPrev = card.previous !== null && Number.isFinite(card.previous);
  const hasChange = card.change !== null && Number.isFinite(card.change);
  const hasChangePct = card.changePercent !== null && Number.isFinite(card.changePercent);
  const hasDelta = card.deltaUnit === "bps" ? hasChange : hasChangePct;
  const isUp = (card.deltaUnit === "bps" ? (card.change ?? 0) : (card.changePercent ?? 0)) >= 0;
  const isLive = card.meta.mode === "LIVE_API";
  const showSyncBadge = isLive && syncStatus;

  const formattedValue = hasValue
    ? card.unit === "$"
      ? `$${formatNumber(card.value!, card.decimals)}`
      : `${formatNumber(card.value!, card.decimals)}${card.unit}`
    : "—";

  const formattedPrev = hasPrev
    ? card.unit === "$"
      ? `$${formatNumber(card.previous!, card.decimals)}`
      : `${formatNumber(card.previous!, card.decimals)}${card.unit}`
    : "—";

  const deltaLabel =
    card.deltaUnit === "bps"
      ? hasChange
        ? `${card.change! > 0 ? "+" : ""}${Math.round(card.change!)} bps`
        : "—"
      : hasChangePct
      ? `${card.changePercent! > 0 ? "+" : ""}${card.changePercent!.toFixed(2)}%`
      : "—";

  return (
    <div className="terminal-card group flex flex-col justify-between rounded-lg border border-white/[0.09] p-4 transition-all hover:border-[#FFFFFF]/30 hover:shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono-num text-[11px] font-semibold tracking-wider text-[#FFFFFF]">
              {card.symbol}
            </span>
            <span className="rounded border border-white/[0.07] bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[9.5px] font-medium text-[#9AA3B0]">
              {card.meta.frequency}
            </span>
            {showSyncBadge ? (
              <SyncStatusBadge status={syncStatus} size="xs" />
            ) : (
              <FeedModeBadge mode={card.meta.mode} compact className="text-[9px]" />
            )}
          </div>
          <div className="mt-1.5 truncate text-[12px] text-[#9AA3B0]">{card.name}</div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 font-mono-num text-[11px] font-medium",
            !hasDelta
              ? "bg-[#12161B] text-[#7D8694]"
              : isUp
              ? "bg-[#00C985]/12 text-[#00C985]"
              : "bg-[#F05454]/12 text-[#F05454]"
          )}
        >
          {deltaLabel}
        </span>
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono-num text-[21px] font-semibold leading-none tracking-tight text-[#F0F2F5]">
            {formattedValue}
          </div>
          <div className="mt-1.5 font-mono-num text-[10.5px] text-[#7D8694]">
            Prev {formattedPrev}
          </div>
        </div>
        <SparklineSvg
          id={card.id}
          points={card.sparkline}
          previous={card.previous}
          positive={isUp}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2 font-mono-num text-[10px] text-[#7D8694]">
        <span className="truncate">{card.meta.source}</span>
        <span className="shrink-0">{card.meta.observationDate}</span>
      </div>
    </div>
  );
}
