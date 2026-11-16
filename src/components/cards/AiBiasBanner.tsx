"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BrainCircuit } from "lucide-react";
import type { AiBiasSummary } from "@/lib/ai-models/types";
import { cn } from "@/lib/utils";

function getBiasBadgeClasses(bias: string) {
  if (bias === "BULLISH") {
    return {
      surface: "border-[#1C1C1C] bg-[#0A0A0A]",
      accent: "border-l-[#22C55E]",
      pill: "bg-[#22C55E]/12 text-[#22C55E] border border-[#22C55E]/30",
      score: "text-[#22C55E]",
    };
  }
  if (bias === "BEARISH") {
    return {
      surface: "border-[#1C1C1C] bg-[#0A0A0A]",
      accent: "border-l-[#EF4444]",
      pill: "bg-[#EF4444]/12 text-[#EF4444] border border-[#EF4444]/30",
      score: "text-[#EF4444]",
    };
  }
  return {
    surface: "border-[#1C1C1C] bg-[#0A0A0A]",
    accent: "border-l-[#FFFFFF]",
    pill: "bg-[#141414] text-[#A3A3A3] border border-[#1C1C1C]",
    score: "text-[#A3A3A3]",
  };
}

export function AiBiasBanner({
  initialSummary = null,
}: {
  initialSummary?: AiBiasSummary | null;
}) {
  const [summary, setSummary] = useState<AiBiasSummary | null>(initialSummary);

  useEffect(() => {
    if (summary) return;
    let active = true;
    fetch("/api/ai-models?summary=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.ok && data.summary) {
          setSummary(data.summary as AiBiasSummary);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [summary]);

  if (!summary) {
    return (
      <Link
        href="/macrodashboard/tools/ai-bias"
        className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[#1C1C1C] border-l-2 border-l-[#FFFFFF] bg-[#0A0A0A] px-3.5 py-2 text-xs transition-colors hover:bg-[#141414]"
      >
        <div className="flex min-w-0 items-center gap-2 truncate">
          <BrainCircuit className="h-4 w-4 shrink-0 text-[#FFFFFF]" strokeWidth={1.8} />
          <span className="font-mono-num text-[10px] font-semibold uppercase tracking-[0.18em] text-[#A3A3A3]">
            AI Bias
          </span>
          <span className="truncate text-[12px] text-[#6B6B6B]">
            Open AI Bias Engine for live macro &amp; XAUUSD bias.
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono-num text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3]">
          Open <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    );
  }

  const tone = getBiasBadgeClasses(summary.bias);

  return (
    <Link
      href="/macrodashboard/tools/ai-bias"
      className={cn(
        "group flex min-h-11 items-center justify-between gap-3 rounded-xl border border-l-2 px-3.5 py-2 transition-colors hover:bg-[#141414]",
        tone.surface,
        tone.accent
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-xs">
        <BrainCircuit className="h-4 w-4 shrink-0 text-[#FFFFFF]" strokeWidth={1.8} />
        <span className="font-mono-num text-[10px] font-semibold uppercase tracking-[0.18em] text-[#A3A3A3]">
          AI Bias
        </span>
        <span className={cn("rounded px-2 py-0.5 font-mono-num text-[10px] font-bold tracking-tight", tone.pill)}>
          {summary.primary_asset} {summary.bias}
        </span>
        <span className={cn("font-mono-num text-[15px] font-semibold leading-none", tone.score)}>
          {summary.bias_score > 0 ? `+${summary.bias_score}` : summary.bias_score}
        </span>
        <span className="hidden truncate text-[12px] text-[#FFFFFF] sm:inline">
          · {summary.dominant_regime}
        </span>
        {typeof summary.confidence_pct === "number" && (
          <span className="hidden font-mono-num text-[11px] text-[#6B6B6B] md:inline">
            · {Math.round(summary.confidence_pct)}% conf
          </span>
        )}
      </div>

      <span className="inline-flex shrink-0 items-center gap-1 font-mono-num text-[10px] font-semibold uppercase tracking-wider text-[#A3A3A3] transition-colors group-hover:text-[#FFFFFF]">
        Details <ArrowUpRight className="h-3 w-3 text-current" />
      </span>
    </Link>
  );
}
