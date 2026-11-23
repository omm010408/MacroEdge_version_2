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
  isCompact?: boolean;
}

function AssetBlock({ summary, href, isCompact = false }: AssetBlockProps) {
  const color = getBiasColor(summary.bias);
  const confidence = summary.confidence_pct ?? 71.6;
  const clampedConf = Math.min(100, Math.max(0, confidence));

  const content = (
    <div className="flex items-center gap-3 sm:gap-4 md:gap-5 lg:gap-6 shrink-0">
      {/* Asset Symbol - fixed min-width for vertical column alignment */}
      <span className="font-semibold text-white tracking-wide text-[13px] sm:text-[14px] min-w-[62px] sm:min-w-[66px] shrink-0">
        {summary.primary_asset}
      </span>

      {/* Directional bias in lowercase */}
      <span className={cn("font-medium text-[13px] sm:text-[14px] min-w-[48px] shrink-0", color)}>
        {summary.bias.toLowerCase()}
      </span>

      {/* Bias Score */}
      <span className={cn("font-mono font-medium text-[13px] sm:text-[14px] min-w-[44px] shrink-0", color)}>
        {formatScore(summary.bias_score)}
      </span>

      {/* Progress Bar Meter */}
      <div
        className={cn(
          "h-[3.5px] rounded-full bg-[#1F1F1F] overflow-hidden shrink-0",
          isCompact ? "w-16 sm:w-24 md:w-28 lg:w-32" : "w-20 sm:w-28 md:w-36 lg:w-44"
        )}
      >
        <div
          className="h-full rounded-full bg-white transition-all duration-300"
          style={{ width: `${clampedConf}%` }}
        />
      </div>

      {/* Confidence Label */}
      <span className="text-[#A1A1AA] text-[12px] sm:text-[13px] font-normal font-mono-num whitespace-nowrap">
        {formatConfidence(confidence)} confidence
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="transition-opacity hover:opacity-90 inline-flex items-center">
        {content}
      </Link>
    );
  }

  return content;
}

interface ViewSwitcherProps {
  activeTab: "DUAL" | "XAUUSD" | "US30";
  onChange: (tab: "DUAL" | "XAUUSD" | "US30") => void;
}

function ViewSwitcher({ activeTab, onChange }: ViewSwitcherProps) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-[#71717A] shrink-0">
      <button
        type="button"
        onClick={() => onChange("DUAL")}
        className={cn(
          "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
          activeTab === "DUAL"
            ? "bg-[#1C1C1C] text-white"
            : "hover:text-[#D4D4D8]"
        )}
      >
        Both
      </button>
      <button
        type="button"
        onClick={() => onChange("XAUUSD")}
        className={cn(
          "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
          activeTab === "XAUUSD"
            ? "bg-[#1C1C1C] text-white"
            : "hover:text-[#D4D4D8]"
        )}
      >
        XAU
      </button>
      <button
        type="button"
        onClick={() => onChange("US30")}
        className={cn(
          "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
          activeTab === "US30"
            ? "bg-[#1C1C1C] text-white"
            : "hover:text-[#D4D4D8]"
        )}
      >
        US30
      </button>
    </div>
  );
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
        "w-full border-t border-b border-[#1C1C1C] py-3.5 sm:py-4.5 px-3 sm:px-4 md:px-5 lg:px-6 bg-black transition-colors",
        className
      )}
    >
      {activeTab === "DUAL" ? (
        <>
          {/* DUAL VIEW: Two structured, balanced rows on screens < 1440px */}
          <div className="flex flex-col gap-3 sm:gap-3.5 w-full 2xl:hidden">
            {/* Row 1: XAUUSD + View Switcher */}
            <div className="flex items-center justify-between gap-4 w-full py-1">
              <AssetBlock
                summary={xauusd}
                href="/macrodashboard/tools/ai-bias?asset=XAUUSD"
              />
              <ViewSwitcher activeTab={activeTab} onChange={setActiveTab} />
            </div>

            {/* Hairline Row Separator */}
            <div className="h-px w-full bg-[#1C1C1C]/80" aria-hidden="true" />

            {/* Row 2: US30 + Details Link */}
            <div className="flex items-center justify-between gap-4 w-full py-1">
              <AssetBlock
                summary={us30}
                href="/macrodashboard/tools/ai-bias?asset=US30"
              />
              <Link
                href="/macrodashboard/tools/ai-bias?asset=US30"
                className="text-[#A1A1AA] hover:text-white transition-colors text-[12px] sm:text-[13px] font-medium inline-flex items-center gap-0.5 whitespace-nowrap shrink-0 px-1 py-0.5"
              >
                Details <span className="text-[14px] leading-none select-none">›</span>
              </Link>
            </div>
          </div>

          {/* DUAL VIEW: Single-line layout on ultra-wide screens (>= 1440px) */}
          <div className="hidden 2xl:flex items-center justify-between gap-6 w-full py-1">
            <div className="flex items-center gap-6 2xl:gap-8">
              <AssetBlock
                summary={xauusd}
                href="/macrodashboard/tools/ai-bias?asset=XAUUSD"
                isCompact
              />
              <div className="h-4 w-px bg-[#262626]" aria-hidden="true" />
              <AssetBlock
                summary={us30}
                href="/macrodashboard/tools/ai-bias?asset=US30"
                isCompact
              />
            </div>

            <div className="flex items-center gap-3.5 shrink-0">
              <ViewSwitcher activeTab={activeTab} onChange={setActiveTab} />
              <div className="h-4 w-px bg-[#262626]" aria-hidden="true" />
              <Link
                href={detailTarget}
                className="text-[#A1A1AA] hover:text-white transition-colors text-[12px] sm:text-[13px] font-medium inline-flex items-center gap-0.5 whitespace-nowrap px-1 py-0.5"
              >
                Details <span className="text-[14px] leading-none select-none">›</span>
              </Link>
            </div>
          </div>
        </>
      ) : (
        /* SINGLE ASSET FOCUS VIEW (XAUUSD or US30 on 1 clean row) */
        <div className="flex items-center justify-between gap-4 w-full py-1">
          <AssetBlock
            summary={activeTab === "US30" ? us30 : xauusd}
            href={detailTarget}
          />

          <div className="flex items-center gap-3.5 shrink-0">
            <ViewSwitcher activeTab={activeTab} onChange={setActiveTab} />
            <div className="h-4 w-px bg-[#262626]" aria-hidden="true" />
            <Link
              href={detailTarget}
              className="text-[#A1A1AA] hover:text-white transition-colors text-[12px] sm:text-[13px] font-medium inline-flex items-center gap-0.5 whitespace-nowrap px-1 py-0.5"
            >
              Details <span className="text-[14px] leading-none select-none">›</span>
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
