"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DatasetMeta, InternationalEconomy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/FilterControls";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { ChartCard } from "@/components/charts/ChartCard";
import { TerminalTooltip } from "@/components/charts/TerminalTooltip";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface InternationalViewProps {
  economies: InternationalEconomy[];
  usReference: InternationalEconomy | null;
  meta: DatasetMeta;
}

export function InternationalView({
  economies,
  usReference,
  meta,
}: InternationalViewProps) {
  const [selectedId, setSelectedId] = useState<string>(economies[0]?.id ?? "");

  const active = useMemo(
    () => economies.find((e) => e.id === selectedId) ?? economies[0],
    [economies, selectedId]
  );

  const comparisonData = useMemo(
    () =>
      [...(usReference ? [usReference] : []), ...economies].map((eco) => ({
        code: eco.code,
        gdp: eco.gdpYoy,
        cpi: eco.cpiYoy,
        policy: eco.policyRate,
        yield10Y: eco.yield10Y,
      })),
    [economies, usReference]
  );

  if (economies.length === 0 || !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="International Macroeconomics"
          subtitle="Growth, inflation, central-bank policy rates, sovereign yields, and FX across major non-US economies."
          meta={meta}
        />
        <DataOpsEmptyState
          title="International Macroeconomic Data Awaiting Live Sync"
          detail="Configure global macro providers and trigger Data Operations sync to ingest non-US growth, inflation, yields, and FX."
        />
        <DatasetFooter meta={meta} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="International Macroeconomics"
        subtitle="Growth, inflation, central-bank policy rates, sovereign yields, and FX across major non-US economies."
        meta={meta}
      />

      {/* Country Selector Grid */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {economies.map((eco) => {
          const isSelected = eco.id === active.id;
          const isUp = eco.fxChangePct >= 0;
          return (
            <button
              key={eco.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedId(eco.id)}
              className={cn(
                "flex flex-col justify-between rounded-lg border p-3.5 text-left transition-colors",
                isSelected
                  ? "border-[#FFFFFF]/60 bg-[#0E1218]"
                  : "border-white/[0.09] bg-[#0A0D12] hover:border-white/[0.18]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-num text-[11px] font-semibold text-[#FFFFFF]">
                  {eco.code}
                </span>
                <span
                  className={cn(
                    "font-mono-num text-[10.5px]",
                    isUp ? "text-[#00C985]" : "text-[#F05454]"
                  )}
                >
                  {isUp ? "+" : ""}
                  {eco.fxChangePct.toFixed(2)}%
                </span>
              </div>
              <div className="mt-1 truncate text-[13px] font-semibold text-[#F0F2F5]">{eco.region}</div>
              <div className="mt-2 font-mono-num text-[11.5px] text-[#9299A3]">
                {eco.fxPair} {eco.fxSpot}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2 font-mono-num text-[10.5px]">
                <span className="text-[#9299A3]">CPI {eco.cpiYoy.toFixed(1)}%</span>
                <span className="text-[#F0F2F5]">Rate {eco.policyRate.toFixed(2)}%</span>
              </div>
            </button>
          );
        })}
      </section>

      {/* Selected Economy Snapshot + Trajectory */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:p-5 xl:col-span-5">
          <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
            <div>
              <div className="font-mono-num text-[11px] text-[#FFFFFF]">
                {active.code} · {active.currency}
              </div>
              <h2 className="text-[16px] font-semibold text-[#F0F2F5]">{active.region}</h2>
            </div>
            <MarketStatusBadge
              label={active.stance}
              tone={
                active.stance === "Hawkish"
                  ? "bearish"
                  : active.stance === "Dovish"
                  ? "bullish"
                  : "neutral"
              }
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">GDP YoY</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#F0F2F5]">
                {active.gdpYoy.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">CPI / Core YoY</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#F0F2F5]">
                {active.cpiYoy.toFixed(1)}% <span className="text-[13px] text-[#9299A3]">/ {active.coreCpiYoy.toFixed(1)}%</span>
              </div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">Policy Rate</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#FFFFFF]">
                {active.policyRate.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">10Y Gov Yield</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#F0F2F5]">
                {active.yield10Y.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">Composite PMI</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#F0F2F5]">
                {active.pmiComposite.toFixed(1)}
              </div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-3">
              <div className="text-[10.5px] text-[#9299A3]">Unemployment</div>
              <div className="mt-1 font-mono-num text-[18px] font-semibold text-[#F0F2F5]">
                {active.unemployment.toFixed(1)}%
              </div>
            </div>
          </div>
        </section>

        <ChartCard
          title={`${active.region} · Quarterly Growth, Inflation & 10Y Yield`}
          subtitle="Multi-quarter macro trajectory."
          className="xl:col-span-7"
          stats={[
            { label: "GDP", value: `${active.gdpYoy.toFixed(1)}%`, tone: "positive" },
            { label: "CPI", value: `${active.cpiYoy.toFixed(1)}%`, tone: "negative" },
            { label: "10Y", value: `${active.yield10Y.toFixed(2)}%`, tone: "accent" },
          ]}
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={active.history} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#555D68" tick={{ fill: "#9299A3", fontSize: 10.5, fontFamily: "JetBrains Mono" }} />
                <YAxis orientation="right" stroke="#555D68" tick={{ fill: "#9299A3", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={44} />
                <Tooltip cursor={{ stroke: "#FFFFFF", strokeWidth: 1, strokeDasharray: "3 3" }} content={<TerminalTooltip valueFormatter={(v) => `${Number(v).toFixed(2)}%`} />} />
                <ReferenceLine y={2} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="gdpYoy" name="GDP YoY %" stroke="#00C985" strokeWidth={1.9} />
                <Line type="monotone" dataKey="cpiYoy" name="CPI YoY %" stroke="#F05454" strokeWidth={1.9} />
                <Line type="monotone" dataKey="yield10Y" name="10Y Yield %" stroke="#FFFFFF" strokeWidth={1.9} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-5 font-mono-num text-[10.5px] text-[#9299A3]">
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-3 bg-[#00C985]" />
              GDP YoY %
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-3 bg-[#F05454]" />
              CPI YoY %
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-3 bg-[#FFFFFF]" />
              10Y Yield %
            </span>
          </div>
        </ChartCard>
      </div>

      {/* Cross-Region Comparison */}
      <ChartCard
        title="Cross-Region Policy Rate vs Inflation & GDP"
        subtitle="Benchmark comparison including United States reference."
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis dataKey="code" stroke="#555D68" tick={{ fill: "#F0F2F5", fontSize: 11, fontFamily: "JetBrains Mono" }} />
              <YAxis orientation="right" stroke="#555D68" tick={{ fill: "#9299A3", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => `${v}%`} width={40} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TerminalTooltip valueFormatter={(v) => `${Number(v).toFixed(2)}%`} />} />
              <Bar dataKey="policy" name="Policy Rate %" fill="#FFFFFF" radius={[2, 2, 0, 0]} />
              <Bar dataKey="cpi" name="CPI YoY %" fill="#D9B45C" radius={[2, 2, 0, 0]} />
              <Bar dataKey="gdp" name="GDP YoY %" fill="#00C985" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-5 font-mono-num text-[10.5px] text-[#9299A3]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-[#FFFFFF]" />
            Policy Rate %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-[#D9B45C]" />
            CPI YoY %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-[#00C985]" />
            GDP YoY %
          </span>
        </div>
      </ChartCard>

      <DatasetFooter meta={meta} />
    </div>
  );
}
