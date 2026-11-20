import Link from "next/link";
import { ArrowUpRight, Calendar, Compass, Zap } from "lucide-react";
import {
  DEFAULT_DAILY_CHECKS,
  getMacroOverviewData,
} from "@/services/macro-data";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { AiBiasBanner } from "@/components/cards/AiBiasBanner";
import { CrossAssetTelemetryBoard } from "@/components/dashboard/CrossAssetTelemetryBoard";
import { GoldUs30NewsSection } from "@/components/dashboard/GoldUs30NewsSection";
import { getDualAiBiasSummary } from "@/services/ai-models/runner";
import { getGoldAndUs30News } from "@/services/marketaux/client";

export const dynamic = "force-dynamic";

export default async function PersonalDashboardPage() {
  const [overview, dualAiSummary, newsData] = await Promise.all([
    getMacroOverviewData(),
    getDualAiBiasSummary(),
    getGoldAndUs30News(),
  ]);

  const latestCheck = DEFAULT_DAILY_CHECKS.at(0);
  const highImpactEvents = overview.calendarEvents
    .filter((e) => e.importance === "HIGH")
    .slice(0, 6);


  const modules = [
    {
      label: "Inflation Dashboard",
      href: "/macrodashboard/economy/inflation",
      tag: "CPI · Core PCE · Breakevens",
      description: "Realized inflation momentum against Fed 2% target & sticky components.",
    },
    {
      label: "Commitments of Traders",
      href: "/macrodashboard/positioning/commitments-of-traders",
      tag: "CFTC Legacy Futures",
      description: "Commercial vs speculative institutional positioning percentiles.",
    },
    {
      label: "Fixed Income & Rates",
      href: "/macrodashboard/economy/fixed-income-rates",
      tag: "US Treasury Curve & Auctions",
      description: "Full Treasury curve, 2Y/10Y inversion dynamics, and Primary Dealer stats.",
    },
    {
      label: "Daily Pre-Market Check",
      href: "/macrodashboard/tools/daily-check",
      tag: latestCheck ? `${latestCheck.netScore}/10 Composite` : "5-Force Regime Compass",
      description: "Systematic multi-factor pre-market checklist and regime alignment.",
    },
  ];

  return (
    <div className="dashboard-shell mx-auto max-w-[1360px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      {/* Dashboard Header Bar */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#1C1C1C] pb-4">
        <div>
          <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#6B6B6B]">
            MacroEdge Workspace
          </span>
          <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#FFFFFF]">
            Analyst Command Dashboard
          </h1>
        </div>
        <Link
          href="/macrodashboard"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#FFFFFF] px-3.5 py-1.5 text-[12px] font-semibold text-[#000000] transition hover:bg-[#FFFFFF]/90"
        >
          Open Full Macrodashboard
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* 1-Line Overall AI Bias Banner */}
      <AiBiasBanner
        initialSummary={dualAiSummary.xauusd}
        initialUs30Summary={dualAiSummary.us30}
      />

      {/* ============================================================== */}
      {/* BENTO GRID ARCHITECTURE                                        */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* BENTO TILE 1: Primary Cross-Asset Telemetry Station (col-span-8) */}
        <CrossAssetTelemetryBoard initialCards={overview.cards} />

        {/* BENTO TILE 2: Pre-Market Regime Compass & Composite Stance (col-span-4) */}
        <section className="dashboard-panel terminal-card flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] lg:col-span-4">
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-[#1C1C1C] pb-3">
              <div className="flex items-center gap-2">
                <span className="dashboard-icon rounded-md border border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]">
                  <Compass className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-[13px] font-semibold text-[#FFFFFF]">
                  Daily Pre-Market Stance
                </h2>
              </div>
              <span className="rounded border border-[#1C1C1C] bg-[#141414] px-2 py-0.5 font-mono-num text-[10.5px] font-medium text-[#FFFFFF]">
                {latestCheck ? `${latestCheck.netScore}/10 Score` : "Awaiting Check"}
              </span>
            </div>

            <p className="mt-2 text-[11px] text-[#6B6B6B]">
              Five-force quantitative posture across economic growth, inflation, liquidity, policy, and stress.
            </p>

            <div className="mt-3 space-y-2.5">
              {overview.regimeFactors.length > 0 ? (
                overview.regimeFactors.slice(0, 4).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-2 transition-colors hover:bg-[#141414]"
                  >
                    <div>
                      <div className="text-[11px] font-medium text-[#FFFFFF]">{f.label}</div>
                      <div className="font-mono-num text-[10px] text-[#6B6B6B]">{f.signalValue}</div>
                    </div>
                    <div className="text-right">
                      <MarketStatusBadge label={f.status} tone={f.tone} />
                      <div className="mt-0.5 font-mono-num text-[10px] font-bold text-[#FFFFFF]">
                        {f.score}/100
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-[#1C1C1C] bg-[#0A0A0A] p-3 text-center text-[11px] text-[#6B6B6B]">
                  Sync active to populate live 5-force posture.
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 border-t border-[#1C1C1C] pt-2.5">
            <Link
              href="/macrodashboard/tools/daily-check"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#141414] py-1.5 text-[11.5px] font-medium text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C]"
            >
              Run Daily Pre-Market Check
              <ArrowUpRight className="h-3 w-3 text-[#FFFFFF]" />
            </Link>
          </div>
        </section>

        {/* BENTO TILE 3: Priority Terminal Desks (col-span-6) */}
        <section className="dashboard-panel terminal-card flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] lg:col-span-6">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-[#1C1C1C] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="dashboard-icon rounded-md border border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]">
                  <Zap className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-[13px] font-semibold text-[#FFFFFF]">
                  Priority Terminal Desks
                </h2>
              </div>
              <span className="font-mono-num text-[10.5px] text-[#6B6B6B]">Direct Routes</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {modules.map((mod) => (
                <Link
                  key={mod.href}
                  href={mod.href}
                  className="flex flex-col justify-between rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-3 transition-colors hover:border-[#2E2E2E] hover:bg-[#141414]"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium text-[#FFFFFF]">{mod.label}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#FFFFFF]" />
                    </div>
                    <span className="mt-1 block font-mono-num text-[10.5px] font-medium text-[#A3A3A3]">{mod.tag}</span>
                    <p className="mt-1.5 text-[10.5px] text-[#6B6B6B]">{mod.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* BENTO TILE 4: Upcoming Tier-1 Event Docket (col-span-6) */}
        <section className="dashboard-panel terminal-card flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] lg:col-span-6">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-[#1C1C1C] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="dashboard-icon rounded-md border border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]">
                  <Calendar className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-[13px] font-semibold text-[#FFFFFF]">
                  Upcoming Tier-1 Event Docket
                </h2>
              </div>
              <MarketStatusBadge
                label={
                  overview.calendarEvents.length === 0
                    ? "Awaiting Sync"
                    : `${highImpactEvents.length} High Impact`
                }
                tone={highImpactEvents.length > 0 ? "bearish" : "neutral"}
              />
            </div>

            {overview.calendarEvents.length === 0 || highImpactEvents.length === 0 ? (
              <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-dashed border-[#1C1C1C] bg-[#0A0A0A] p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[12px] font-medium text-[#FFFFFF]">
                    {overview.calendarEvents.length === 0
                      ? "Awaiting Live Event Docket"
                      : "No High-Impact Releases Queued"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6B6B6B]">
                    Configure provider keys and trigger Data Operations sync to populate live macro releases.
                  </p>
                </div>
                <Link
                  href="/macrodashboard/tools/data-ops"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#FFFFFF] bg-[#FFFFFF] px-2.5 py-1.5 font-mono-num text-[11px] font-medium text-[#000000] transition hover:bg-[#FFFFFF]/90"
                >
                  Data Operations
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-[#1C1C1C]">
                {highImpactEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between gap-3 py-2 text-[11.5px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-[#FFFFFF]">
                        {ev.country}
                      </span>
                      <span className="font-medium text-[#FFFFFF]">{ev.event}</span>
                    </div>
                    <div className="shrink-0 font-mono-num text-[10.5px] text-[#6B6B6B]">
                      {ev.releaseTime} · Cons {ev.consensus}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[#1C1C1C] pt-2 text-[11px]">
            <span className="text-[#6B6B6B]">Institutional Economic Docket</span>
            <Link
              href="/macrodashboard"
              className="inline-flex items-center gap-1 font-medium text-[#FFFFFF] hover:underline"
            >
              View Full Calendar
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </section>
      </div>

      {/* AI Marketaux News Section (Exclusively Gold & US30) */}
      <GoldUs30NewsSection
        initialNews={newsData.news}
        lastUpdated={newsData.lastUpdated}
      />
    </div>
  );
}
