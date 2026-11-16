"use client";

import { useMemo, useState } from "react";
import type { CreditSpreadSeriesPoint, DatasetMeta } from "@/lib/types";
import { PageHeader, TimeframeSelector } from "@/components/dashboard/FilterControls";
import { TerminalSeriesCard } from "@/components/charts/TerminalSeriesCard";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface CreditRiskViewProps {
  series: CreditSpreadSeriesPoint[];
  meta: DatasetMeta;
}

export function CreditRiskView({ series, meta }: CreditRiskViewProps) {
  const [timeframe, setTimeframe] = useState<"13W" | "26W" | "52W">("52W");

  const sliced = useMemo(() => {
    const count = timeframe === "13W" ? 13 : timeframe === "26W" ? 26 : series.length;
    return series.slice(-count);
  }, [series, timeframe]);

  const latest = sliced[sliced.length - 1];
  const monthAgo = sliced[Math.max(0, sliced.length - 5)];

  if (!latest || !monthAgo) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Credit & Risk Regime"
          subtitle="Corporate OAS spreads, cross-asset volatility indices, financial stress gauge, and bank lending standards."
          meta={meta}
        />
        <DataOpsEmptyState
          title="Credit Spreads & Risk Regime Awaiting Live Sync"
          detail="Configure FRED API key and trigger Data Operations sync to ingest HY/IG OAS, STLFSI4, VIX, MOVE, and SLOOS series."
        />
        <DatasetFooter meta={meta} />
      </div>
    );
  }

  const hyDelta = latest.hyOasBps - monthAgo.hyOasBps;
  const igDelta = latest.igOasBps - monthAgo.igOasBps;
  const fsiDelta = Number((latest.stlFsi - monthAgo.stlFsi).toFixed(2));
  const vixDelta = Number((latest.vix - monthAgo.vix).toFixed(2));
  const moveDelta = Number((latest.move - monthAgo.move).toFixed(1));
  const bankDelta = Number((latest.bankTighteningPct - monthAgo.bankTighteningPct).toFixed(1));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit & Risk Regime"
        subtitle="Corporate OAS spreads, cross-asset volatility indices, financial stress gauge, and bank lending standards."
        meta={meta}
        actions={
          <TimeframeSelector
            options={["13W", "26W", "52W"] as const}
            value={timeframe}
            onChange={setTimeframe}
          />
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TerminalSeriesCard
          title="US High Yield OAS"
          seriesCode="BAMLH0A0HYM2"
          heroValue={`${latest.hyOasBps} bps`}
          deltaLabel={`${hyDelta >= 0 ? "+" : ""}${hyDelta} bps · 1M`}
          deltaPositive={hyDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.hyOasBps }))}
          accentColor={latest.hyOasBps < 340 ? "green" : "red"}
          valueFormatter={(v) => `${Math.round(v)} bps`}
          yTickFormatter={(v) => `${Math.round(v)}`}
          sourceNote="ICE BofA US High Yield Option-Adjusted Spread"
        />

        <TerminalSeriesCard
          title="US Investment Grade OAS"
          seriesCode="BAMLC0A0CM"
          heroValue={`${latest.igOasBps} bps`}
          deltaLabel={`${igDelta >= 0 ? "+" : ""}${igDelta} bps · 1M`}
          deltaPositive={igDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.igOasBps }))}
          accentColor="blue"
          valueFormatter={(v) => `${Math.round(v)} bps`}
          yTickFormatter={(v) => `${Math.round(v)}`}
          sourceNote="ICE BofA US Corporate IG Option-Adjusted Spread"
        />

        <TerminalSeriesCard
          title="St. Louis Financial Stress Index"
          seriesCode="STLFSI4"
          heroValue={latest.stlFsi.toFixed(2)}
          deltaLabel={`${fsiDelta >= 0 ? "+" : ""}${fsiDelta.toFixed(2)} · 1M`}
          deltaPositive={fsiDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.stlFsi }))}
          accentColor="green"
          referenceValue={0}
          valueFormatter={(v) => v.toFixed(2)}
          yTickFormatter={(v) => v.toFixed(2)}
          sourceNote="Zero line indicates historical average stress"
        />

        <TerminalSeriesCard
          title="CBOE Volatility Index"
          seriesCode="VIXCLS"
          heroValue={latest.vix.toFixed(2)}
          deltaLabel={`${vixDelta >= 0 ? "+" : ""}${vixDelta.toFixed(2)} · 1M`}
          deltaPositive={vixDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.vix }))}
          accentColor="cyan"
          valueFormatter={(v) => v.toFixed(2)}
          yTickFormatter={(v) => v.toFixed(0)}
          sourceNote="S&P 500 30-day implied volatility"
        />

        <TerminalSeriesCard
          title="ICE BofA MOVE Index"
          seriesCode="MOVE"
          heroValue={latest.move.toFixed(1)}
          deltaLabel={`${moveDelta >= 0 ? "+" : ""}${moveDelta.toFixed(1)} · 1M`}
          deltaPositive={moveDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.move }))}
          accentColor="yellow"
          valueFormatter={(v) => v.toFixed(1)}
          yTickFormatter={(v) => v.toFixed(0)}
          sourceNote="US Treasury 1M implied volatility"
        />

        <TerminalSeriesCard
          title="Bank C&I Loan Tightening (SLOOS)"
          seriesCode="DRTSCILM"
          heroValue={`${latest.bankTighteningPct.toFixed(1)}%`}
          deltaLabel={`${bankDelta >= 0 ? "+" : ""}${bankDelta.toFixed(1)}% · 1M`}
          deltaPositive={bankDelta <= 0}
          data={sliced.map((p) => ({ date: p.date, value: p.bankTighteningPct }))}
          accentColor="red"
          referenceValue={0}
          valueFormatter={(v) => `${v.toFixed(1)}%`}
          yTickFormatter={(v) => `${v.toFixed(0)}%`}
          sourceNote="Net % of domestic banks tightening C&I loans"
        />
      </section>

      <DatasetFooter meta={meta} />
    </div>
  );
}
