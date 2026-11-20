"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AiBiasSummary } from "@/lib/ai-models/types";
import { cn } from "@/lib/utils";

export interface AiBiasBannerProps {
  initialSummary?: AiBiasSummary | null;
  initialUs30Summary?: AiBiasSummary | null;
  className?: string;
  defaultView?: "DUAL" | "XAUUSD" | "US30";
}

const FALLBACK_XAUUSD: AiBiasSummary = {
  primary_asset: "XAUUSD",
  bias: "BEARISH",
  bias_score: -15.4,
  confidence_pct: 71.6,
  dominant_regime: "State 0 (Tight Policy/Yields)",
};

const FALLBACK_US30: AiBiasSummary = {
  primary_asset: "US30",
  bias: "BEARISH",
  bias_score: -13.7,
  confidence_pct: 71.6,
  dominant_regime: "State 0 (Tight Policy/Yields)",
};

function getBiasColor(bias?: string) {
  const upper = (bias || "NEUTRAL").toUpperCase();
  if (upper === "BULLISH") return "text-[#22C55E]"; // green
  if (upper === "BEARISH") return "text-[#EF4444]"; // red
  return "text-[#EAB308]"; // yellow/amber
}

function formatScore(score?: number | null): string {
  if (score == null || !Number.isFinite(score)) return "0.0";
  return score > 0 ? `+${score.toFixed(1)}` : `${score.toFixed(1)}`;
}

function formatConfidence(conf?: number | null): string {
  if (conf == null || !Number.isFinite(conf)) return "71.6%";
  return `${conf.toFixed(1)}%`;
}

interface AssetBlockProps {
  summary: AiBiasSummary;
  href?: string;
}

function AssetBlock({ summary, href }: AssetBlockProps) {
  const color = getBiasColor(summary.bias);
  const confidence = summary.confidence_pct ?? 71.6;
  const clampedConf = Math.min(100, Math.max(0, confidence));

  const content = (
    <div className="flex items-center gap-3 sm:gap-4 md:gap-5">
      {/* Asset Symbol */}
      <span className="font-semibold text-white tracking-wide text-[13px] sm:text-[14px]">
        {summary.primary_asset}
      </span>

      {/* Directional bias in lowercase */}
      <span className={cn("font-medium text-[13px] sm:text-[14px]", color)}>
        {summary.bias.toLowerCase()}
      </span>

      {/* Bias Score */}
      <span className={cn("font-mono font-medium text-[13px] sm:text-[14px]", color)}>
        {formatScore(summary.bias_score)}
      </span>

      {/* Progress Bar Meter */}
      <div className="h-[3.5px] w-20 sm:w-28 md:w-36 lg:w-44 rounded-full bg-[#1F1F1F] overflow-hidden shrink-0">
        <div
          className="h-full rounded-full bg-white transition-all duration-300"
          style={{ width: `${clampedConf}%` }}
        />
      </div>

      {/* Confidence Label */}
      <span className="text-[#A1A1AA] text-[12px] sm:text-[13px] font-normal whitespace-nowrap">
        {formatConfidence(confidence)} confidence
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="transition-opacity hover:opacity-90">
        {content}
      </Link>
    );
  }

  return content;
}

export function AiBiasBanner({
  initialSummary = null,
  initialUs30Summary = null,
  className,
  defaultView = "DUAL",
}: AiBiasBannerProps) {
  const [xauusd, setXauusd] = useState<AiBiasSummary>(() => {
    if (initialSummary && initialSummary.primary_asset === "XAUUSD") return initialSummary;
    return initialSummary || FALLBACK_XAUUSD;
  });

  const [us30, setUs30] = useState<AiBiasSummary>(() => {
    if (initialUs30Summary) return initialUs30Summary;
    if (initialSummary && initialSummary.primary_asset === "US30") return initialSummary;
    return FALLBACK_US30;
  });

  const [activeTab, setActiveTab] = useState<"DUAL" | "XAUUSD" | "US30">(defaultView);

  // Poll for live AI bias updates
  useEffect(() => {
    let active = true;
    fetch("/api/ai-models?summary=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.ok) return;

        if (data.summaries) {
          if (data.summaries.xauusd) setXauusd(data.summaries.xauusd);
          if (data.summaries.us30) setUs30(data.summaries.us30);
        } else if (data.summary) {
          if (data.summary.primary_asset === "US30") {
            setUs30(data.summary);
          } else {
            setXauusd(data.summary);
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const detailTarget =
    activeTab === "US30"
      ? "/macrodashboard/tools/ai-bias?asset=US30"
      : "/macrodashboard/tools/ai-bias?asset=XAUUSD";

  return (
    <section
      aria-label="AI Macro Bias Telemetry"
      className={cn(
        "w-full border-t border-b border-[#1C1C1C] py-2.5 sm:py-3 bg-black transition-colors",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4 w-full">
        {/* Desktop Dual Mode (side-by-side with hairline divider) */}
        <div
          className={cn(
            "items-center gap-6 md:gap-8 flex-wrap",
            activeTab === "DUAL" ? "hidden lg:flex" : "hidden"
          )}
        >
          <AssetBlock
            summary={xauusd}
            href="/macrodashboard/tools/ai-bias?asset=XAUUSD"
          />

          <div className="h-3.5 w-px bg-[#262626] hidden md:block" aria-hidden="true" />

          <AssetBlock
            summary={us30}
            href="/macrodashboard/tools/ai-bias?asset=US30"
          />
        </div>

        {/* Single Mode (or Mobile / Tablet View) */}
        <div
          className={cn(
            "flex items-center gap-3 sm:gap-4 overflow-x-auto no-scrollbar",
            activeTab === "DUAL" ? "flex lg:hidden" : "flex"
          )}
        >
          {/* Subtle Asset Switcher Pill */}
          <div className="flex items-center gap-1.5 shrink-0 pr-1">
            <button
              type="button"
              onClick={() => setActiveTab("XAUUSD")}
              className={cn(
                "text-[13px] sm:text-[14px] font-semibold tracking-wide transition-colors",
                activeTab === "XAUUSD" || (activeTab === "DUAL" && true)
                  ? "text-white"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              )}
              title="Focus Gold (XAUUSD) AI Bias"
            >
              XAUUSD
            </button>
            <span className="text-[#3F3F46] text-xs font-mono">/</span>
            <button
              type="button"
              onClick={() => setActiveTab("US30")}
              className={cn(
                "text-[13px] sm:text-[14px] font-semibold tracking-wide transition-colors",
                activeTab === "US30"
                  ? "text-white"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              )}
              title="Focus Dow Jones (US30) AI Bias"
            >
              US30
            </button>
          </div>

          {/* Active Asset Values */}
          <AssetBlock
            summary={activeTab === "US30" ? us30 : xauusd}
            href={detailTarget}
          />
        </div>

        {/* Right Section: View Switcher (Desktop) & Details Link */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 ml-auto">
          {/* Desktop Asset Focus Toggle */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-[#71717A] border-r border-[#262626] pr-4">
            <button
              type="button"
              onClick={() => setActiveTab("DUAL")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                activeTab === "DUAL"
                  ? "bg-[#1C1C1C] text-white"
                  : "hover:text-[#D4D4D8]"
              )}
            >
              Both
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("XAUUSD")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                activeTab === "XAUUSD"
                  ? "bg-[#1C1C1C] text-white"
                  : "hover:text-[#D4D4D8]"
              )}
            >
              XAU
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("US30")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                activeTab === "US30"
                  ? "bg-[#1C1C1C] text-white"
                  : "hover:text-[#D4D4D8]"
              )}
            >
              US30
            </button>
          </div>

          {/* Details Link matching screenshot: "Details ›" */}
          <Link
            href={detailTarget}
            className="text-[#A1A1AA] hover:text-white transition-colors text-[12px] sm:text-[13px] font-medium inline-flex items-center gap-0.5 whitespace-nowrap"
          >
            Details <span className="text-[14px] leading-none select-none">›</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
