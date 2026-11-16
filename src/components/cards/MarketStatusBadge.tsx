import { cn } from "@/lib/utils";
import type { FeedMode, RegimeTone } from "@/lib/types";
import type { SyncStatusType } from "@/lib/sync/types";

interface MarketStatusBadgeProps {
  label: string;
  tone?: RegimeTone;
  size?: "sm" | "md";
}

const TONE_MAP: Record<RegimeTone, string> = {
  bullish: "border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]",
  bearish: "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]",
  mixed: "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3]",
  neutral: "border-[#1C1C1C] bg-[#0A0A0A] text-[#A3A3A3]",
};

export function MarketStatusBadge({
  label,
  tone = "neutral",
  size = "sm",
}: MarketStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-mono-num font-medium tracking-tight",
        size === "sm" ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-0.5 text-[11.5px]",
        TONE_MAP[tone]
      )}
    >
      {label}
    </span>
  );
}

const SYNC_STYLE_MAP: Record<
  SyncStatusType,
  { badge: string; dot: string; title: string }
> = {
  LIVE: {
    badge: "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#22C55E]",
    dot: "bg-[#22C55E]",
    title: "Real-time streaming feed active",
  },
  CURRENT: {
    badge: "border-[#FFFFFF] bg-[#FFFFFF] text-[#000000]",
    dot: "bg-[#000000]",
    title: "Periodic series current within schedule",
  },
  DELAYED: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3]",
    dot: "bg-[#A3A3A3]",
    title: "Delayed relative to provider cadence",
  },
  STALE: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#6B6B6B]",
    dot: "bg-[#6B6B6B]",
    title: "Exceeded freshness threshold — refresh pending",
  },
  FAILED: {
    badge: "border-[#EF4444]/40 bg-[#EF4444]/12 text-[#EF4444]",
    dot: "bg-[#EF4444]",
    title: "Sync worker encountered an error",
  },
  DISCONNECTED: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#6B6B6B]",
    dot: "bg-[#6B6B6B]",
    title: "Stream or provider disconnected / unconfigured",
  },
};

export function SyncStatusBadge({
  status,
  size = "sm",
  label,
  className,
}: {
  status: SyncStatusType;
  size?: "xs" | "sm" | "md";
  label?: string;
  className?: string;
}) {
  const style = SYNC_STYLE_MAP[status] ?? SYNC_STYLE_MAP.DISCONNECTED;
  return (
    <span
      title={style.title}
      className={cn(
        "inline-flex items-center gap-1 rounded border font-mono-num font-semibold uppercase tracking-wider",
        size === "xs" && "px-1.5 py-0.5 text-[9px]",
        size === "sm" && "px-1.5 py-0.5 text-[9.5px]",
        size === "md" && "px-2 py-0.5 text-[10.5px]",
        style.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {label ?? status}
    </span>
  );
}

const FEED_MODE_STYLE_MAP: Record<
  FeedMode,
  { badge: string; dot: string; shortLabel: string; longLabel: string; title: string }
> = {
  LIVE_API: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]",
    dot: "bg-[#22C55E]",
    shortLabel: "LIVE",
    longLabel: "LIVE API",
    title: "Live API feed",
  },
  AWAITING_SYNC: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3]",
    dot: "bg-[#6B6B6B]",
    shortLabel: "AWAITING SYNC",
    longLabel: "AWAITING SYNC",
    title: "Provider configured — awaiting live data sync",
  },
  UNCONFIGURED: {
    badge: "border-[#1C1C1C] bg-[#141414] text-[#6B6B6B]",
    dot: "bg-[#6B6B6B]",
    shortLabel: "UNCONFIGURED",
    longLabel: "UNCONFIGURED",
    title: "Provider API key or live feed unconfigured",
  },
};

export function FeedModeBadge({
  mode,
  compact = false,
  suffix,
  className,
}: {
  mode: FeedMode;
  compact?: boolean;
  suffix?: string;
  className?: string;
}) {
  const style = FEED_MODE_STYLE_MAP[mode] ?? FEED_MODE_STYLE_MAP.UNCONFIGURED;
  const label = compact ? style.shortLabel : style.longLabel;

  return (
    <span
      title={style.title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono-num text-[9.5px] font-semibold uppercase tracking-wider",
        style.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {label}
      {suffix ? ` · ${suffix}` : ""}
    </span>
  );
}
