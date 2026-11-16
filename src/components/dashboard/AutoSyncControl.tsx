"use client";

import { useId } from "react";
import { Clock, RefreshCw, Zap } from "lucide-react";
import type { AutoSyncPeriod } from "@/lib/storage/preferences";
import { cn } from "@/lib/utils";

export interface AutoSyncControlProps {
  period: AutoSyncPeriod;
  onChange: (next: AutoSyncPeriod) => void;
  nextSec: number | null;
  isSyncing?: boolean;
  className?: string;
  variant?: "pill" | "compact";
}

const PERIOD_OPTIONS: { id: AutoSyncPeriod; label: string; desc: string }[] = [
  { id: "30s", label: "30s", desc: "30 seconds (High Frequency)" },
  { id: "60s", label: "60s", desc: "1 minute (Institutional Default)" },
  { id: "5m", label: "5m", desc: "5 minutes (Standard)" },
  { id: "15m", label: "15m", desc: "15 minutes (Low Load)" },
  { id: "off", label: "Off", desc: "Manual Sync Only" },
];

export function AutoSyncControl({
  period,
  onChange,
  nextSec,
  isSyncing = false,
  className,
  variant = "pill",
}: AutoSyncControlProps) {
  const selectId = useId();
  const isEnabled = period !== "off";

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-[#1C1C1C] bg-[#141414] px-2 py-1 text-[11px]",
          className
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isSyncing
              ? "bg-[#22C55E] animate-ping"
              : isEnabled
              ? "bg-[#22C55E]"
              : "bg-[#6B6B6B]"
          )}
        />
        <span className="font-mono-num text-[#A3A3A3]">Auto:</span>
        <select
          id={selectId}
          aria-label="Auto-Sync Time Period"
          value={period}
          onChange={(e) => onChange(e.target.value as AutoSyncPeriod)}
          className="bg-transparent font-mono-num text-[11px] font-medium text-[#FFFFFF] focus:outline-none cursor-pointer"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id} className="bg-[#0A0A0A] text-[#FFFFFF]">
              {opt.label}
            </option>
          ))}
        </select>
        {isEnabled && nextSec !== null && !isSyncing && (
          <span className="font-mono-num text-[10px] text-[#6B6B6B]">({nextSec}s)</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#141414] px-2.5 py-1.5 font-mono-num text-[11px] font-medium transition-colors hover:border-[#FFFFFF]",
        className
      )}
    >
      <div className="flex items-center gap-1.5">
        {isSyncing ? (
          <RefreshCw className="h-3 w-3 animate-spin text-[#22C55E]" />
        ) : isEnabled ? (
          <Zap className="h-3 w-3 text-[#22C55E]" />
        ) : (
          <Clock className="h-3 w-3 text-[#6B6B6B]" />
        )}
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isSyncing
              ? "bg-[#22C55E] animate-ping"
              : isEnabled
              ? "bg-[#22C55E]"
              : "bg-[#6B6B6B]"
          )}
        />
      </div>

      <span className="text-[#A3A3A3]">Auto:</span>

      <select
        id={selectId}
        aria-label="Auto-Sync Time Period"
        value={period}
        onChange={(e) => onChange(e.target.value as AutoSyncPeriod)}
        className="bg-transparent font-mono-num text-[11px] font-semibold text-[#FFFFFF] focus:outline-none cursor-pointer"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id} className="bg-[#0A0A0A] text-[#FFFFFF]">
            {opt.label}
          </option>
        ))}
      </select>

      {isEnabled && nextSec !== null && (
        <span
          className={cn(
            "rounded px-1 py-0.2 font-mono-num text-[10px]",
            nextSec <= 5
              ? "bg-[#22C55E]/20 text-[#22C55E] font-bold animate-pulse"
              : "text-[#6B6B6B]"
          )}
          title={`Next automated background sync in ${nextSec} seconds`}
        >
          {isSyncing ? "syncing..." : `${nextSec}s`}
        </span>
      )}
    </div>
  );
}
