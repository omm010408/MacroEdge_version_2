"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DatasetMeta,
  TreasuryAuctionRow,
  YieldCurveSnapshotPoint,
  YieldHistoryPoint,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader, TimeframeSelector } from "@/components/dashboard/FilterControls";
import { TerminalSeriesCard } from "@/components/charts/TerminalSeriesCard";
import { TerminalTooltip } from "@/components/charts/TerminalTooltip";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface FixedIncomeViewProps {
  curve: YieldCurveSnapshotPoint[];
  history: YieldHistoryPoint[];
  auctions: TreasuryAuctionRow[];
  meta: DatasetMeta;
}

export function FixedIncomeView({
  curve,
  history,
  auctions,
  meta,
}: FixedIncomeViewProps) {
  const uid = useId().replace(/:/g, "");
  const [timeframe, setTimeframe] = useState<"13W" | "26W" | "52W">("52W");
  const [show1M, setShow1M] = useState(true);
  const [show1Y, setShow1Y] = useState(true);
  const [showReal, setShowReal] = useState(true);

  const sliced = useMemo(() => {
    const count = timeframe === "13W" ? 13 : timeframe === "26W" ? 26 : history.length;
    return history.slice(-count);
  }, [history, timeframe]);

  const latest = sliced[sliced.length - 1];
  const monthAgo = sliced[Math.max(0, sliced.length - 5)];

  const hasHistory = Boolean(latest && monthAgo);
  const y10DeltaBps = hasHistory ? Math.round((latest.y10 - monthAgo.y10) * 100) : 0;
  const y2DeltaBps = hasHistory ? Math.round((latest.y2 - monthAgo.y2) * 100) : 0;
  const real10DeltaBps = hasHistory ? Math.round((latest.real10 - monthAgo.real10) * 100) : 0;
  const spread2s10sDelta = hasHistory
    ? latest.spread2s10sBps - monthAgo.spread2s10sBps
    : 0;
  const tpDeltaBps = hasHistory
    ? Math.round((latest.termPremium10Y - monthAgo.termPremium10Y) * 100)
    : 0;

  const auctionCols: DataColumn<TreasuryAuctionRow>[] = [
    { key: "date", header: "Date", sortValue: (r) => r.date, render: (r) => <span className="font-mono-num text-[#9299A3]">{r.date}</span> },
    { key: "tenor", header: "Tenor", sortValue: (r) => r.tenor, render: (r) => <span className="font-mono-num font-semibold text-[#FFFFFF]">{r.tenor}</span> },
    { key: "size", header: "Size", align: "right", sortValue: (r) => r.sizeBn, render: (r) => <span className="font-mono-num">${r.sizeBn}B</span> },
    { key: "hy", header: "High Yield", align: "right", sortValue: (r) => r.highYield, render: (r) => <span className="font-mono-num">{r.highYield.toFixed(3)}%</span> },
    {
      key: "tail",
      header: "Tail",
      align: "right",
      sortValue: (r) => r.tailBps,
      render: (r) => (
        <span className={cn("font-mono-num", r.tailBps <= 0 ? "text-[#00C985]" : "text-[#F05454]")}>
          {r.tailBps > 0 ? `+${r.tailBps.toFixed(1)}` : r.tailBps.toFixed(1)} bps
        </span>
      ),
    },
    { key: "btc", header: "Bid/Cover", align: "right", sortValue: (r) => r.bidToCover, render: (r) => <span className="font-mono-num">{r.bidToCover.toFixed(2)}x</span> },
  ];

  const curveGrad = `ust-curve-${uid}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fixed Income & Rates"
        subtitle="US Treasury nominal and real curves, key curve spreads, term premium, and auction clears."
        meta={meta}
        actions={
          <TimeframeSelector
            options={["13W", "26W", "52W"] as const}
            value={timeframe}
            onChange={setTimeframe}
          />
        }
      />

      {curve.length === 0 && !hasHistory && auctions.length === 0 ? (
        <DataOpsEmptyState
          title="Fixed Income & Yield Curve Data Awaiting Live Sync"
          detail="Configure FRED API key and ENABLE_PUBLIC_TREASURY_LIVE, then trigger Data Operations sync."
        />
      ) : (
        <>
          {/* Clean Minimalist Yield Curve Card */}
          {curve.length === 0 || !latest ? (
            <DataOpsEmptyState
              title="US Treasury Yield Curve Snapshot Awaiting Live Sync"
              detail="Configure FRED API key and trigger Data Operations sync to plot the nominal & real curve."
            />
          ) : (
            <section className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-medium text-[#9299A3]">
                    US Treasury Yield Curve Term Structure
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <span className="font-mono-num text-[22px] font-semibold text-[#F0F2F5]">
                      {latest.y10.toFixed(2)}% <span className="text-[13px] text-[#9299A3]">10Y</span>
                    </span>
                    <span
                      className={cn(
                        "font-mono-num text-[12px] font-medium",
                        latest.spread2s10sBps >= 0 ? "text-[#00C985]" : "text-[#F05454]"
                      )}
                    >
                      2s10s {latest.spread2s10sBps > 0 ? "+" : ""}
                      {latest.spread2s10sBps} bps
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { label: "1M Ago", active: show1M, toggle: () => setShow1M((v) => !v) },
                      { label: "1Y Ago", active: show1Y, toggle: () => setShow1Y((v) => !v) },
                      { label: "TIPS Real", active: showReal, toggle: () => setShowReal((v) => !v) },
                    ] as const
                  ).map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      aria-pressed={btn.active}
                      onClick={btn.toggle}
                      className={cn(
                        "rounded border px-2.5 py-1 font-mono-num text-[10.5px] transition",
                        btn.active
                          ? "border-[#FFFFFF]/40 bg-[#FFFFFF]/10 text-[#F0F2F5]"
                          : "border-white/[0.08] bg-[#07090D] text-[#7A8390] hover:text-[#9299A3]"
                      )}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curve} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id={curveGrad} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.18} />
                        <stop offset="90%" stopColor="#FFFFFF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.045)" strokeDasharray="2 3" vertical={false} />
                    <XAxis
                      dataKey="tenor"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#9299A3", fontSize: 10.5, fontFamily: "JetBrains Mono" }}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      axisLine={false}
                      tickLine={false}
                      tickCount={5}
                      tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      width={44}
                    />
                    <Tooltip
                      cursor={{ stroke: "rgba(255,255,255,0.28)", strokeWidth: 1 }}
                      content={<TerminalTooltip valueFormatter={(v) => `${Number(v).toFixed(2)}%`} />}
                    />
                    {show1M && (
                      <Line
                        type="monotone"
                        dataKey="oneMonthAgo"
                        name="1M Ago"
                        stroke="#D9B45C"
                        strokeWidth={1.1}
                        strokeDasharray="3 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                    {show1Y && (
                      <Line
                        type="monotone"
                        dataKey="oneYearAgo"
                        name="1Y Ago"
                        stroke="#7A8390"
                        strokeWidth={1.1}
                        strokeDasharray="2 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                    {showReal && (
                      <Line
                        type="monotone"
                        dataKey="realYield"
                        name="Real Yield (TIPS)"
                        stroke="#00C985"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="current"
                      name="Current Nominal"
                      stroke="#FFFFFF"
                      strokeWidth={1.8}
                      fill={`url(#${curveGrad})`}
                      dot={{ r: 2.5, fill: "#FFFFFF", stroke: "#0A0D12" }}
                      activeDot={{ r: 4, fill: "#FFFFFF", stroke: "#F0F2F5", strokeWidth: 1.5 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono-num text-[10.5px] text-[#9299A3]">
                <span className="flex items-center gap-1.5">
                  <span className="h-[2px] w-3 bg-[#FFFFFF]" />
                  Current Nominal
                </span>
                {show1M && (
                  <span className="flex items-center gap-1.5 text-[#D9B45C]">
                    <span className="h-[1px] w-3 border-t border-dashed border-[#D9B45C]" />
                    1M Ago
                  </span>
                )}
                {show1Y && (
                  <span className="flex items-center gap-1.5 text-[#7A8390]">
                    <span className="h-[1px] w-3 border-t border-dotted border-[#7A8390]" />
                    1Y Ago
                  </span>
                )}
                {showReal && (
                  <span className="flex items-center gap-1.5 text-[#00C985]">
                    <span className="h-[2px] w-3 bg-[#00C985]" />
                    TIPS Real Yield
                  </span>
                )}
              </div>
            </section>
          )}

          {/* 2-Column Clean Benchmark Rate Cards */}
          {!hasHistory ? (
            <DataOpsEmptyState
              title="Benchmark Yield History Awaiting Live Sync"
              detail="Configure FRED API key and trigger Data Operations sync to ingest DGS10, DGS2, T10Y2Y, and DFII10 series."
            />
          ) : (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TerminalSeriesCard
                title="US 10Y Treasury Yield"
                seriesCode="DGS10"
                heroValue={`${latest.y10.toFixed(2)}%`}
                deltaLabel={`${y10DeltaBps >= 0 ? "+" : ""}${y10DeltaBps} bps · 1M`}
                deltaPositive={y10DeltaBps <= 0}
                data={sliced.map((p) => ({ date: p.date, value: p.y10, secondary: p.y30 }))}
                primaryName="10Y Yield"
                secondaryName="30Y Yield"
                accentColor="blue"
                valueFormatter={(v) => `${v.toFixed(2)}%`}
                sourceNote="US Treasury Constant Maturity 10Y vs 30Y"
              />

              <TerminalSeriesCard
                title="US 2Y Treasury Yield"
                seriesCode="DGS2"
                heroValue={`${latest.y2.toFixed(2)}%`}
                deltaLabel={`${y2DeltaBps >= 0 ? "+" : ""}${y2DeltaBps} bps · 1M`}
                deltaPositive={y2DeltaBps <= 0}
                data={sliced.map((p) => ({ date: p.date, value: p.y2, secondary: p.y5 }))}
                primaryName="2Y Yield"
                secondaryName="5Y Yield"
                accentColor="cyan"
                valueFormatter={(v) => `${v.toFixed(2)}%`}
                sourceNote="US Treasury Constant Maturity 2Y vs 5Y"
              />

              <TerminalSeriesCard
                title="2s10s Yield Curve Spread"
                seriesCode="T10Y2Y"
                heroValue={`${latest.spread2s10sBps > 0 ? "+" : ""}${latest.spread2s10sBps} bps`}
                deltaLabel={`${spread2s10sDelta >= 0 ? "+" : ""}${spread2s10sDelta} bps · 1M`}
                deltaPositive={latest.spread2s10sBps >= 0}
                data={sliced.map((p) => ({
                  date: p.date,
                  value: p.spread2s10sBps,
                  secondary: p.spread5s30sBps,
                }))}
                primaryName="2s10s (bps)"
                secondaryName="5s30s (bps)"
                referenceValue={0}
                accentColor="green"
                valueFormatter={(v) => `${Math.round(v)} bps`}
                yTickFormatter={(v) => `${Math.round(v)}`}
                sourceNote="10Y minus 2Y Treasury Spread"
              />

              <TerminalSeriesCard
                title="US 10Y Real Yield & Term Premium"
                seriesCode="DFII10 · ACMTP10"
                heroValue={`${latest.real10.toFixed(2)}%`}
                deltaLabel={`Real ${real10DeltaBps >= 0 ? "+" : ""}${real10DeltaBps}bp · TP ${tpDeltaBps >= 0 ? "+" : ""}${tpDeltaBps}bp`}
                deltaPositive={real10DeltaBps <= 0}
                data={sliced.map((p) => ({
                  date: p.date,
                  value: p.real10,
                  secondary: p.termPremium10Y,
                }))}
                primaryName="10Y Real Yield"
                secondaryName="10Y Term Premium"
                accentColor="yellow"
                valueFormatter={(v) => `${v.toFixed(2)}%`}
                sourceNote="10Y TIPS Real Yield vs ACM Term Premium"
              />
            </section>
          )}

          {/* Treasury Auctions */}
          <section className="space-y-3">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
              Treasury Auction Results
            </h2>
            {auctions.length === 0 ? (
              <DataOpsEmptyState
                title="Treasury Auction Results Awaiting Live Sync"
                detail="Enable ENABLE_PUBLIC_TREASURY_LIVE and trigger Data Operations sync to ingest auction clears."
              />
            ) : (
              <DataTable data={auctions} columns={auctionCols} rowKey={(r) => `${r.date}-${r.tenor}`} />
            )}
          </section>
        </>
      )}

      <DatasetFooter meta={meta} />
    </div>
  );
}
