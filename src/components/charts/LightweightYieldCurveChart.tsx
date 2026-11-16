"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createYieldCurveChart,
  type ISeriesApi,
  type IYieldCurveChartApi,
  type LineData,
  type WhitespaceData,
  type YieldCurveSeriesType,
} from "lightweight-charts";
import type { YieldCurveSnapshotPoint } from "@/lib/types";
import { reportChartAnomaly } from "@/lib/incidents/client-reporter";
import { useOptionalTerminal } from "@/components/providers/TerminalProvider";
import { cn } from "@/lib/utils";

interface LightweightYieldCurveChartProps {
  curve: YieldCurveSnapshotPoint[];
  height?: number;
}

type YieldSeriesRef = ISeriesApi<
  YieldCurveSeriesType,
  number,
  WhitespaceData<number> | LineData<number>
>;

export function LightweightYieldCurveChart({
  curve,
  height = 320,
}: LightweightYieldCurveChartProps) {
  const terminal = useOptionalTerminal();
  const isLight = terminal?.theme === "light";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const m1Ref = useRef<YieldSeriesRef | null>(null);
  const y1Ref = useRef<YieldSeriesRef | null>(null);
  const realRef = useRef<YieldSeriesRef | null>(null);

  const [show1M, setShow1M] = useState(true);
  const [show1Y, setShow1Y] = useState(true);
  const [showReal, setShowReal] = useState(true);

  const flagsRef = useRef({ show1M, show1Y, showReal });
  flagsRef.current = { show1M, show1Y, showReal };

  const [hovered, setHovered] = useState<{
    tenor: string;
    current?: number;
    oneMonthAgo?: number;
    oneYearAgo?: number;
    realYield?: number;
  } | null>(null);

  const tenorLookup = useMemo(() => {
    const map = new Map<number, string>();
    curve.forEach((p) => map.set(p.months, p.tenor));
    return map;
  }, [curve]);

  const spread2s10s = useMemo(() => {
    const y2 = curve.find((p) => p.tenor === "2Y")?.current ?? 0;
    const y10 = curve.find((p) => p.tenor === "10Y")?.current ?? 0;
    return Math.round((y10 - y2) * 100);
  }, [curve]);

  useEffect(() => {
    m1Ref.current?.applyOptions({ visible: show1M });
  }, [show1M]);

  useEffect(() => {
    y1Ref.current?.applyOptions({ visible: show1Y });
  }, [show1Y]);

  useEffect(() => {
    realRef.current?.applyOptions({ visible: showReal });
  }, [showReal]);

  const sanitizedCurve = useMemo(() => {
    const valid = curve.filter(
      (p) =>
        Number.isFinite(p.months) &&
        Number.isFinite(p.current) &&
        Number.isFinite(p.oneMonthAgo) &&
        Number.isFinite(p.oneYearAgo) &&
        Number.isFinite(p.realYield)
    );
    return valid;
  }, [curve]);

  useEffect(() => {
    if (curve.length > 0 && sanitizedCurve.length < curve.length) {
      reportChartAnomaly({
        chartComponent: "LightweightYieldCurveChart",
        seriesLabel: "US Treasury Yield Curve",
        issue: "Filtered non-finite yield curve coordinates before rendering.",
        invalidCount: curve.length - sanitizedCurve.length,
      });
    }
  }, [curve.length, sanitizedCurve.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || sanitizedCurve.length === 0) return;

    let chart: IYieldCurveChartApi;
    try {
      chart = createYieldCurveChart(el, {
      width: Math.max(el.clientWidth, 280),
      height,
      yieldCurve: {
        baseResolution: 1,
        minimumTimeRange: 360,
        startTimeRange: 0,
        formatTime: (months: number) => {
          if (months === 0) return "0M";
          return months >= 12 ? `${Math.round(months / 12)}Y` : `${months}M`;
        },
      },
      layout: {
        background: { type: ColorType.Solid, color: isLight ? "#FFFFFF" : "#070809" },
        textColor: isLight ? "#475569" : "#9299A3",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 10.5,
        attributionLogo: false,
      },
      grid: {
        vertLines: {
          color: isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.04)",
          style: LineStyle.Dotted,
        },
        horzLines: {
          color: isLight ? "rgba(15, 23, 42, 0.06)" : "rgba(255, 255, 255, 0.05)",
          style: LineStyle.Dashed,
        },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: isLight ? "rgba(15, 23, 42, 0.35)" : "rgba(255, 255, 255, 0.55)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isLight ? "#E2E8F0" : "#12161B",
        },
        horzLine: {
          color: isLight ? "rgba(15, 23, 42, 0.35)" : "rgba(255, 255, 255, 0.55)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isLight ? "#E2E8F0" : "#12161B",
        },
      },
      rightPriceScale: {
        borderColor: isLight ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.09)",
      },
      timeScale: {
        borderColor: isLight ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.09)",
      },
    });

    const curSeries = chart.addSeries(AreaSeries, {
      lineColor: isLight ? "#0F172A" : "#FFFFFF",
      topColor: isLight ? "rgba(15, 23, 42, 0.16)" : "rgba(255, 255, 255, 0.22)",
      bottomColor: isLight ? "rgba(15, 23, 42, 0.01)" : "rgba(255, 255, 255, 0.01)",
      lineWidth: 2,
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
      lastValueVisible: true,
    });
    curSeries.setData(sanitizedCurve.map((p) => ({ time: p.months, value: p.current })));

    const m1Series = chart.addSeries(LineSeries, {
      color: "#D9B45C",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      visible: flagsRef.current.show1M,
    });
    m1Series.setData(sanitizedCurve.map((p) => ({ time: p.months, value: p.oneMonthAgo })));
    m1Ref.current = m1Series;

    const y1Series = chart.addSeries(LineSeries, {
      color: isLight ? "#64748B" : "#9299A3",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      visible: flagsRef.current.show1Y,
    });
    y1Series.setData(sanitizedCurve.map((p) => ({ time: p.months, value: p.oneYearAgo })));
    y1Ref.current = y1Series;

    const realSeries = chart.addSeries(LineSeries, {
      color: "#00C985",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      visible: flagsRef.current.showReal,
    });
    realSeries.setData(sanitizedCurve.map((p) => ({ time: p.months, value: p.realYield })));
    realRef.current = realSeries;

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined || param.point === undefined) {
        setHovered(null);
        return;
      }
      const m = Number(param.time);
      const cur = param.seriesData.get(curSeries) as { value?: number } | undefined;
      const m1 = param.seriesData.get(m1Series) as { value?: number } | undefined;
      const y1 = param.seriesData.get(y1Series) as { value?: number } | undefined;
      const rl = param.seriesData.get(realSeries) as { value?: number } | undefined;

      setHovered({
        tenor: tenorLookup.get(m) ?? `${m}M`,
        current: cur?.value,
        oneMonthAgo: flagsRef.current.show1M ? m1?.value : undefined,
        oneYearAgo: flagsRef.current.show1Y ? y1?.value : undefined,
        realYield: flagsRef.current.showReal ? rl?.value : undefined,
      });
    });

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        chart.applyOptions({ width: rect.width });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      m1Ref.current = null;
      y1Ref.current = null;
      realRef.current = null;
      chart.remove();
    };
    } catch (err) {
      reportChartAnomaly({
        chartComponent: "LightweightYieldCurveChart",
        seriesLabel: "US Treasury Yield Curve",
        issue:
          err instanceof Error
            ? err.message
            : "Failed to initialize LightweightYieldCurveChart",
      });
      return;
    }
  }, [sanitizedCurve, height, tenorLookup, isLight]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-[#07090D] px-3 py-1.5 font-mono-num text-[11px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[#FFFFFF]">
            {hovered ? `Tenor ${hovered.tenor}` : `2s10s ${spread2s10s > 0 ? "+" : ""}${spread2s10s} bps`}
          </span>
          {hovered?.current !== undefined && (
            <span className="font-semibold text-[#F0F2F5]">
              Spot {hovered.current.toFixed(2)}%
            </span>
          )}
          {hovered?.oneMonthAgo !== undefined && (
            <span className="text-[#D9B45C]">
              1M {hovered.oneMonthAgo.toFixed(2)}%
            </span>
          )}
          {hovered?.oneYearAgo !== undefined && (
            <span className="text-[#9299A3]">
              1Y {hovered.oneYearAgo.toFixed(2)}%
            </span>
          )}
          {hovered?.realYield !== undefined && (
            <span className="text-[#00C985]">
              TIPS {hovered.realYield.toFixed(2)}%
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShow1M((v) => !v)}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px]",
              show1M
                ? "border-[#D9B45C]/40 bg-[#D9B45C]/10 text-[#D9B45C]"
                : "border-white/[0.09] text-[#555D68]"
            )}
          >
            1M Ago
          </button>
          <button
            type="button"
            onClick={() => setShow1Y((v) => !v)}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px]",
              show1Y
                ? "border-white/25 bg-white/[0.06] text-[#9299A3]"
                : "border-white/[0.09] text-[#555D68]"
            )}
          >
            1Y Ago
          </button>
          <button
            type="button"
            onClick={() => setShowReal((v) => !v)}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px]",
              showReal
                ? "border-[#00C985]/40 bg-[#00C985]/10 text-[#00C985]"
                : "border-white/[0.09] text-[#555D68]"
            )}
          >
            Real Curve
          </button>
        </div>
      </div>

      {sanitizedCurve.length === 0 ? (
        <div
          className="flex w-full items-center justify-center rounded-md border border-dashed border-white/[0.10] bg-[#070809] px-4 text-center font-mono-num text-[11px] text-[#7A8390]"
          style={{ height }}
        >
          No valid yield curve points available.
        </div>
      ) : (
        <div
          ref={containerRef}
          className="w-full overflow-hidden rounded-md border border-white/[0.08] bg-[#070809]"
          style={{ height }}
        />
      )}
    </div>
  );
}
