"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DatasetMeta, InternationalEconomy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader, TimeframeSelector } from "@/components/dashboard/FilterControls";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { ChartCard } from "@/components/charts/ChartCard";
import { TerminalTooltip } from "@/components/charts/TerminalTooltip";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface G10ViewProps {
  economies: InternationalEconomy[];
  meta: DatasetMeta;
}

export function G10View({ economies, meta }: G10ViewProps) {
  const [stanceFilter, setStanceFilter] = useState<"ALL" | "Hawkish" | "Neutral" | "Dovish">("ALL");

  const filtered = useMemo(() => {
    if (stanceFilter === "ALL") return economies;
    return economies.filter((e) => e.stance === stanceFilter);
  }, [economies, stanceFilter]);

  const realRateBars = useMemo(
    () =>
      filtered.map((e) => ({
        currency: e.currency,
        realPolicyRate: Number((e.policyRate - e.cpiYoy).toFixed(2)),
        impliedDeltaBps: Math.round((e.implied6MRate - e.policyRate) * 100),
      })),
    [filtered]
  );

  const columns: DataColumn<InternationalEconomy>[] = [
    {
      key: "region",
      header: "Economy",
      sortValue: (r) => r.region,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[10.5px] font-semibold text-[#FFFFFF]">
            {r.currency}
          </span>
          <span className="font-medium text-[#F0F2F5]">{r.region}</span>
        </div>
      ),
    },
    {
      key: "fx",
      header: "FX Spot",
      align: "right",
      sortValue: (r) => r.fxChangePct,
      render: (r) => (
        <div className="font-mono-num">
          <span className="text-[#F0F2F5]">{r.fxSpot}</span>{" "}
          <span className={r.fxChangePct >= 0 ? "text-[#00C985]" : "text-[#F05454]"}>
            ({r.fxChangePct >= 0 ? "+" : ""}
            {r.fxChangePct.toFixed(2)}%)
          </span>
        </div>
      ),
    },
    {
      key: "policy",
      header: "Policy Rate",
      align: "right",
      sortValue: (r) => r.policyRate,
      render: (r) => <span className="font-mono-num font-semibold text-[#FFFFFF]">{r.policyRate.toFixed(2)}%</span>,
    },
    {
      key: "implied",
      header: "6M Implied",
      align: "right",
      sortValue: (r) => r.implied6MRate,
      render: (r) => {
        const diffBps = Math.round((r.implied6MRate - r.policyRate) * 100);
        return (
          <div className="font-mono-num">
            <span>{r.implied6MRate.toFixed(2)}%</span>{" "}
            <span className={diffBps >= 0 ? "text-[#F05454]" : "text-[#00C985]"}>
              ({diffBps > 0 ? "+" : ""}
              {diffBps}bp)
            </span>
          </div>
        );
      },
    },
    {
      key: "realRate",
      header: "Real Rate",
      align: "right",
      sortValue: (r) => r.policyRate - r.cpiYoy,
      render: (r) => {
        const real = r.policyRate - r.cpiYoy;
        return (
          <span className={cn("font-mono-num font-medium", real >= 0 ? "text-[#00C985]" : "text-[#F05454]")}>
            {real >= 0 ? "+" : ""}
            {real.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: "cpi",
      header: "CPI YoY",
      align: "right",
      sortValue: (r) => r.cpiYoy,
      render: (r) => <span className="font-mono-num">{r.cpiYoy.toFixed(1)}%</span>,
    },
    {
      key: "gdp",
      header: "GDP YoY",
      align: "right",
      sortValue: (r) => r.gdpYoy,
      render: (r) => (
        <span className={cn("font-mono-num", r.gdpYoy >= 0 ? "text-[#F0F2F5]" : "text-[#F05454]")}>
          {r.gdpYoy.toFixed(1)}%
        </span>
      ),
    },
    {
      key: "unrate",
      header: "Unrate",
      align: "right",
      sortValue: (r) => r.unemployment,
      render: (r) => <span className="font-mono-num text-[#9299A3]">{r.unemployment.toFixed(1)}%</span>,
    },
    {
      key: "y10",
      header: "10Y Yield",
      align: "right",
      sortValue: (r) => r.yield10Y,
      render: (r) => <span className="font-mono-num text-[#F0F2F5]">{r.yield10Y.toFixed(2)}%</span>,
    },
    {
      key: "stance",
      header: "CB Bias",
      align: "right",
      sortValue: (r) => r.stance,
      render: (r) => (
        <MarketStatusBadge
          label={r.stance}
          tone={
            r.stance === "Hawkish"
              ? "bearish"
              : r.stance === "Dovish"
              ? "bullish"
              : "neutral"
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="G10 Macroeconomic Indicators"
        subtitle="Comparative G10 matrix across growth, inflation, sovereign yields, real rates, and OIS pricing."
        meta={meta}
        actions={
          <TimeframeSelector
            options={["ALL", "Hawkish", "Neutral", "Dovish"] as const}
            value={stanceFilter}
            onChange={setStanceFilter}
          />
        }
      />

      {/* Sortable G10 Table */}
      {economies.length === 0 ? (
        <DataOpsEmptyState
          title="G10 Macroeconomic Indicators Awaiting Live Sync"
          detail="Configure global macro and FX providers and trigger Data Operations sync to populate the G10 matrix."
        />
      ) : (
        <>
          <DataTable
            data={filtered}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSortKey="policy"
            defaultSortDir="desc"
          />

          {/* Real Policy Rate vs 6M Priced Move */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title="G10 Real Policy Rate (Policy − CPI YoY)"
          subtitle="Restrictive vs accommodative real short-rate differentials."
        >
          <div className="h-68 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={realRateBars} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <XAxis dataKey="currency" stroke="#555D68" tick={{ fill: "#F0F2F5", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                <YAxis orientation="right" stroke="#555D68" tick={{ fill: "#9299A3", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => `${v}%`} width={42} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TerminalTooltip valueFormatter={(v) => `${Number(v).toFixed(2)}%`} />} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Bar dataKey="realPolicyRate" name="Real Policy Rate" radius={[3, 3, 0, 0]}>
                  {realRateBars.map((entry, idx) => (
                    <Cell key={idx} fill={entry.realPolicyRate >= 0 ? "#00C985" : "#F05454"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="6M OIS Priced Rate Adjustment (bps)"
          subtitle="Market-implied easing vs tightening over the next 6 months."
        >
          <div className="h-68 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={realRateBars} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <XAxis dataKey="currency" stroke="#555D68" tick={{ fill: "#F0F2F5", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                <YAxis orientation="right" stroke="#555D68" tick={{ fill: "#9299A3", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => `${v}bp`} width={46} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TerminalTooltip valueFormatter={(v) => `${v} bps`} />} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Bar dataKey="impliedDeltaBps" name="6M Implied Δ (bps)" radius={[3, 3, 0, 0]}>
                  {realRateBars.map((entry, idx) => (
                    <Cell key={idx} fill={entry.impliedDeltaBps >= 0 ? "#F05454" : "#FFFFFF"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
          </div>
        </>
      )}

      <DatasetFooter meta={meta} />
    </div>
  );
}
