"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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
import type { CotInstrument } from "@/lib/types";
import { cn, formatCompactNumber, formatSignedContracts } from "@/lib/utils";

type DetailTab = "net" | "oscillator" | "longshort" | "history";

function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function CotTooltip({
  active,
  payload,
  label,
  unit = "contracts",
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  unit?: "contracts" | "pct";
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0A0D12]/95 px-3 py-2 shadow-2xl backdrop-blur-sm">
      <div className="mb-1.5 font-mono-num text-[10.5px] text-[#9299A3]">{label}</div>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div
            key={`${entry.name}-${idx}`}
            className="flex items-center justify-between gap-5 font-mono-num text-[11px]"
          >
            <span className="flex items-center gap-1.5 text-[#9299A3]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: entry.color ?? "#FFFFFF" }}
              />
              {entry.name}
            </span>
            <span className="font-semibold text-[#F0F2F5]">
              {unit === "pct"
                ? `${Math.round(Number(entry.value ?? 0))}%`
                : formatCompactNumber(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstrumentDetailPanel({
  instrument,
}: {
  instrument: CotInstrument;
}) {
  const uid = useId().replace(/:/g, "");
  const [timeframe, setTimeframe] = useState<"3M" | "6M" | "1Y" | "2Y" | "MAX">("MAX");
  const [chartMode, setChartMode] = useState<DetailTab>("net");

  const slicedHistory = useMemo(() => {
    const count =
      timeframe === "3M"
        ? 13
        : timeframe === "6M"
        ? 26
        : timeframe === "1Y"
        ? 52
        : timeframe === "2Y"
        ? 104
        : instrument.history.length;
    return instrument.history.slice(-count);
  }, [instrument, timeframe]);

  const prevPoint =
    instrument.history[instrument.history.length - 2] ?? instrument.history[0];
  const longDelta = instrument.longPositions - (prevPoint?.long ?? instrument.longPositions);
  const shortDelta = instrument.shortPositions - (prevPoint?.short ?? instrument.shortPositions);
  const gradId = `cot-net-${uid}`;

  return (
    <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 lg:p-5">
      {/* Header + Timeframes */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight text-[#F0F2F5]">
            {instrument.instrument.replace(/\s*\([^)]*\)/, "")}
          </h3>
          <span className="font-mono-num text-[10.5px] uppercase text-[#7A8390]">
            {instrument.symbol} · CFTC
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-0.5">
          {(["3M", "6M", "1Y", "2Y", "MAX"] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={timeframe === tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "rounded px-2 py-0.5 font-mono-num text-[10.5px] transition-colors",
                timeframe === tf
                  ? "border border-[#FFFFFF]/40 bg-[#FFFFFF]/12 font-semibold text-[#FFFFFF]"
                  : "border border-transparent text-[#7A8390] hover:text-[#9299A3]"
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* 5 Stat Tiles */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-2.5">
          <div className="font-mono-num text-[9.5px] uppercase tracking-wider text-[#7A8390]">
            NC NET
          </div>
          <div
            className={cn(
              "mt-1 font-mono-num text-[14px] font-semibold",
              instrument.netContracts >= 0 ? "text-[#00C985]" : "text-[#F05454]"
            )}
          >
            {instrument.netContracts > 0 ? "+" : ""}
            {formatCompactNumber(instrument.netContracts)}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono-num text-[10px]",
              instrument.weeklyChange >= 0 ? "text-[#00C985]" : "text-[#F05454]"
            )}
          >
            {instrument.weeklyChange > 0 ? "+" : ""}
            {formatCompactNumber(instrument.weeklyChange)} wk
          </div>
        </div>

        <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-2.5">
          <div className="font-mono-num text-[9.5px] uppercase tracking-wider text-[#7A8390]">
            NC LONG
          </div>
          <div className="mt-1 font-mono-num text-[14px] font-semibold text-[#00C985]">
            {formatCompactNumber(instrument.longPositions)}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono-num text-[10px]",
              longDelta >= 0 ? "text-[#00C985]" : "text-[#F05454]"
            )}
          >
            {longDelta > 0 ? "+" : ""}
            {formatCompactNumber(longDelta)} wk
          </div>
        </div>

        <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-2.5">
          <div className="font-mono-num text-[9.5px] uppercase tracking-wider text-[#7A8390]">
            NC SHORT
          </div>
          <div className="mt-1 font-mono-num text-[14px] font-semibold text-[#F0F2F5]">
            {formatCompactNumber(instrument.shortPositions)}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono-num text-[10px]",
              shortDelta >= 0 ? "text-[#00C985]" : "text-[#F05454]"
            )}
          >
            {shortDelta > 0 ? "+" : ""}
            {formatCompactNumber(shortDelta)} wk
          </div>
        </div>

        <div className="rounded-md border border-white/[0.08] bg-[#07090D] p-2.5">
          <div className="font-mono-num text-[9.5px] uppercase tracking-wider text-[#7A8390]">
            OPEN INT
          </div>
          <div className="mt-1 font-mono-num text-[14px] font-semibold text-[#F0F2F5]">
            {formatCompactNumber(instrument.openInterest)}
          </div>
          <div className="mt-0.5 font-mono-num text-[10px] text-[#7A8390]">
            {instrument.reportDate.slice(5)}
          </div>
        </div>

        <div className="col-span-2 rounded-md border border-white/[0.08] bg-[#07090D] p-2.5 sm:col-span-1">
          <div className="font-mono-num text-[9.5px] uppercase tracking-wider text-[#7A8390]">
            PCTILE (3Y)
          </div>
          <div className="mt-1 font-mono-num text-[14px] font-semibold text-[#F0F2F5]">
            {formatOrdinal(instrument.percentile)}
          </div>
          <div className="mt-0.5 font-mono-num text-[10px] text-[#7A8390]">
            {instrument.signal}
          </div>
        </div>
      </div>

      {/* Underline Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-white/[0.07]">
        {(
          [
            { id: "net", label: "Net Positions" },
            { id: "oscillator", label: "Oscillator" },
            { id: "longshort", label: "Long vs Short" },
            { id: "history", label: "History" },
          ] as const
        ).map((tab) => {
          const active = chartMode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setChartMode(tab.id)}
              className={cn(
                "relative pb-2 text-[12px] font-medium transition-colors",
                active
                  ? "text-[#F0F2F5]"
                  : "text-[#7A8390] hover:text-[#9299A3]"
              )}
            >
              {tab.label}
              {active && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#FFFFFF]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Chart Body */}
      <div className="mt-4">
        {chartMode === "net" ? (
          <>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={slicedHistory} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.18} />
                      <stop offset="90%" stopColor="#FFFFFF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.045)"
                    strokeDasharray="2 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                    minTickGap={34}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickCount={5}
                    tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                    tickFormatter={(v: number) => formatCompactNumber(v)}
                    width={52}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.28)", strokeWidth: 1 }}
                    content={<CotTooltip unit="contracts" />}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.14)" />
                  <Line
                    type="monotone"
                    dataKey="commercialNet"
                    name="Commercial Net"
                    stroke="#7A8390"
                    strokeWidth={1.1}
                    strokeDasharray="3 3"
                    dot={false}
                    activeDot={{ r: 3.5, fill: "#D1D5DB", stroke: "#0A0D12", strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    name="NC Net"
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                    fill={`url(#${gradId})`}
                    dot={false}
                    activeDot={{ r: 3.5, fill: "#FFFFFF", stroke: "#F0F2F5", strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2.5 flex items-center gap-5 font-mono-num text-[10.5px] text-[#9299A3]">
              <span className="flex items-center gap-1.5">
                <span className="h-[2px] w-3 bg-[#FFFFFF]" />
                NC Net
              </span>
              <span className="flex items-center gap-1.5 text-[#7A8390]">
                <span className="h-[1px] w-3 border-t border-dashed border-[#7A8390]" />
                Commercial Net
              </span>
            </div>
          </>
        ) : chartMode === "oscillator" ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={slicedHistory} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.045)" strokeDasharray="2 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                  minTickGap={34}
                />
                <YAxis
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.28)", strokeWidth: 1 }}
                  content={<CotTooltip unit="pct" />}
                />
                <ReferenceLine y={80} stroke="#00C985" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={20} stroke="#F05454" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Line
                  type="monotone"
                  dataKey="oscillator"
                  name="Percentile"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3.5, fill: "#FFFFFF", stroke: "#F0F2F5", strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : chartMode === "longshort" ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={slicedHistory.slice(-24)} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.045)" strokeDasharray="2 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                  minTickGap={26}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#7A8390", fontSize: 9.5, fontFamily: "JetBrains Mono" }}
                  tickFormatter={(v: number) => formatCompactNumber(v)}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={<CotTooltip unit="contracts" />}
                />
                <Bar dataKey="long" name="NC Long" fill="#00C985" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="short" name="NC Short" fill="#F05454" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-white/[0.07]">
            <table className="w-full text-left font-mono-num text-[11px]">
              <thead className="sticky top-0 bg-[#0A0D12] text-[10px] uppercase text-[#7A8390]">
                <tr className="border-b border-white/[0.07]">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">NC Net</th>
                  <th className="px-3 py-2 text-right">Comm Net</th>
                  <th className="px-3 py-2 text-right">Pct</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {[...slicedHistory].reverse().map((row) => (
                  <tr key={row.date} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 text-[#9299A3]">{row.date}</td>
                    <td className={cn("px-3 py-1.5 text-right", row.net >= 0 ? "text-[#00C985]" : "text-[#F05454]")}>
                      {formatSignedContracts(row.net)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[#9299A3]">
                      {formatSignedContracts(row.commercialNet)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[#F0F2F5]">{row.oscillator}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
