"use client";

import { Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

export interface TerminalSeriesPoint {
  date: string;
  value: number;
  secondary?: number;
}

interface TerminalSeriesCardProps {
  title: string;
  seriesCode: string;
  heroValue: string;
  deltaLabel: string;
  deltaPositive?: boolean;
  data: TerminalSeriesPoint[];
  accentColor?: "green" | "red" | "blue" | "cyan" | "yellow" | "white";
  valueFormatter?: (v: number) => string;
  yTickFormatter?: (v: number) => string;
  secondaryName?: string;
  primaryName?: string;
  referenceValue?: number;
  sourceNote?: string;
  showXAxis?: boolean;
  height?: number;
  className?: string;
}

function CardTooltip({
  active,
  payload,
  label,
  primaryName,
  secondaryName,
  valueFormatter,
  color,
}: {
  active?: boolean;
  payload?: { value?: number; dataKey?: string }[];
  label?: string;
  primaryName: string;
  secondaryName?: string;
  valueFormatter: (v: number) => string;
  color: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const primary = payload.find((p) => p.dataKey === "value");
  const secondary = payload.find((p) => p.dataKey === "secondary");

  return (
    <div className="rounded-md border border-[#1C1C1C] bg-[#0A0A0A] px-2.5 py-2 shadow-2xl backdrop-blur-sm">
      <div className="mb-1 font-mono-num text-[10px] text-[#6B6B6B]">{label}</div>
      {primary?.value !== undefined && (
        <div className="flex items-center justify-between gap-4 font-mono-num text-[11px]">
          <span className="flex items-center gap-1.5 text-[#A3A3A3]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
            {primaryName}
          </span>
          <span className="font-semibold text-[#FFFFFF]">
            {valueFormatter(primary.value)}
          </span>
        </div>
      )}
      {secondary?.value !== undefined && secondaryName && (
        <div className="mt-0.5 flex items-center justify-between gap-4 font-mono-num text-[11px]">
          <span className="flex items-center gap-1.5 text-[#A3A3A3]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6B6B6B]" />
            {secondaryName}
          </span>
          <span className="font-semibold text-[#FFFFFF]">
            {valueFormatter(secondary.value)}
          </span>
        </div>
      )}
    </div>
  );
}

export function TerminalSeriesCard({
  title,
  seriesCode,
  heroValue,
  deltaLabel,
  deltaPositive = true,
  data,
  accentColor = "green",
  valueFormatter = (v) => v.toFixed(2),
  yTickFormatter,
  primaryName,
  secondaryName,
  referenceValue,
  sourceNote,
  showXAxis = false,
  height = 176,
  className,
}: TerminalSeriesCardProps) {
  const trendColor =
    accentColor === "red" || (!deltaPositive && accentColor !== "white")
      ? "#EF4444"
      : accentColor === "green"
      ? "#22C55E"
      : "#FFFFFF";
  const fmtY = yTickFormatter ?? valueFormatter;

  return (
    <section
      className={cn(
        "flex flex-col justify-between rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E]",
        className
      )}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[12.5px] font-medium text-[#A3A3A3]">{title}</h3>
            {sourceNote && (
              <span title={sourceNote} className="text-[#6B6B6B] hover:text-[#A3A3A3]">
                <Info className="h-3 w-3" />
              </span>
            )}
          </div>
          <div className="mt-1 font-mono-num text-[22px] font-semibold leading-tight tracking-tight text-[#FFFFFF]">
            {heroValue}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono-num text-[11px] font-medium",
              deltaPositive ? "text-[#22C55E]" : "text-[#EF4444]"
            )}
          >
            {deltaLabel}
          </div>
        </div>

        <span className="shrink-0 font-mono-num text-[10px] uppercase tracking-wider text-[#6B6B6B]">
          {seriesCode}
        </span>
      </div>

      {/* Minimalist Clean Chart */}
      <div className="mt-3 w-full" style={{ height }}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={280}
          minHeight={height}
          initialDimension={{ width: 640, height }}
        >
          <AreaChart data={data} margin={{ top: 8, right: 6, left: -8, bottom: 0 }}>
            <CartesianGrid
              stroke="#1C1C1C"
              strokeDasharray="2 3"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              hide={!showXAxis}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B6B6B", fontSize: 9.5, fontFamily: "IBM Plex Mono" }}
              minTickGap={34}
            />
            <YAxis
              domain={["auto", "auto"]}
              axisLine={false}
              tickLine={false}
              tickCount={4}
              tick={{ fill: "#6B6B6B", fontSize: 9.5, fontFamily: "IBM Plex Mono" }}
              tickFormatter={fmtY}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
              content={
                <CardTooltip
                  primaryName={primaryName ?? title}
                  secondaryName={secondaryName}
                  valueFormatter={valueFormatter}
                  color={trendColor}
                />
              }
            />
            {referenceValue !== undefined && (
              <ReferenceLine
                y={referenceValue}
                stroke="#2E2E2E"
                strokeDasharray="3 3"
              />
            )}
            {secondaryName && (
              <Line
                type="monotone"
                dataKey="secondary"
                stroke="#A3A3A3"
                strokeWidth={1.2}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 3, fill: "#A3A3A3", stroke: "#0A0A0A", strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={trendColor}
              strokeWidth={1.75}
              fill={trendColor}
              fillOpacity={0.05}
              dot={false}
              activeDot={{ r: 3.5, fill: trendColor, stroke: "#0A0A0A", strokeWidth: 1.5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {secondaryName && (
        <div className="mt-2 flex flex-wrap items-center gap-4 font-mono-num text-[10px] text-[#A3A3A3]">
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-3" style={{ backgroundColor: trendColor }} />
            {primaryName ?? title}
          </span>
          <span className="flex items-center gap-1.5 text-[#6B6B6B]">
            <span className="h-[1px] w-3 border-t border-dashed border-[#A3A3A3]" />
            {secondaryName}
          </span>
        </div>
      )}
    </section>
  );
}
