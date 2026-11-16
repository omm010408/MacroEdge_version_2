"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { Maximize2 } from "lucide-react";
import { reportChartAnomaly } from "@/lib/incidents/client-reporter";
import { useOptionalTerminal } from "@/components/providers/TerminalProvider";
import { cn } from "@/lib/utils";

export interface ChartPoint {
  time: string;
  value: number;
}

export interface HistogramPoint {
  time: string;
  value: number;
  color?: string;
}

export interface ReferenceLineSpec {
  value: number;
  label: string;
  color: string;
}

interface LightweightTerminalChartProps {
  primaryData: ChartPoint[];
  primaryLabel: string;
  primaryMode?: "area" | "baseline";
  baselineValue?: number;
  secondaryData?: ChartPoint[];
  secondaryLabel?: string;
  secondaryColor?: string;
  histogramData?: HistogramPoint[];
  histogramLabel?: string;
  maPeriod?: number;
  referenceLines?: ReferenceLineSpec[];
  valueFormatter?: (val: number) => string;
  histogramFormatter?: (val: number) => string;
  height?: number;
}

function dedupeAndSort<T extends { time: string; value?: number }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    if (typeof r.value === "number" && !Number.isFinite(r.value)) continue;
    map.set(r.time, r);
  }
  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
}

function computeSma(rows: ChartPoint[], period: number): ChartPoint[] {
  if (rows.length < period) return [];
  const out: ChartPoint[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].value;
    if (i >= period) sum -= rows[i - period].value;
    if (i >= period - 1) {
      out.push({
        time: rows[i].time,
        value: Number((sum / period).toFixed(4)),
      });
    }
  }
  return out;
}

export function LightweightTerminalChart({
  primaryData,
  primaryLabel,
  primaryMode = "area",
  baselineValue,
  secondaryData,
  secondaryLabel,
  secondaryColor = "#D9B45C",
  histogramData,
  histogramLabel,
  maPeriod = 20,
  referenceLines = [],
  valueFormatter = (v) => v.toFixed(2),
  histogramFormatter = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`,
  height = 340,
}: LightweightTerminalChartProps) {
  const terminal = useOptionalTerminal();
  const isLight = terminal?.theme === "light";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const maSeriesRef = useRef<ISeriesApi<SeriesType, Time> | null>(null);
  const [showMa, setShowMa] = useState(true);
  const showMaRef = useRef(showMa);
  showMaRef.current = showMa;

  const cleanPrimary = useMemo(() => dedupeAndSort(primaryData), [primaryData]);
  const cleanSecondary = useMemo(
    () => (secondaryData ? dedupeAndSort(secondaryData) : []),
    [secondaryData]
  );
  const cleanHistogram = useMemo(
    () => (histogramData ? dedupeAndSort(histogramData) : []),
    [histogramData]
  );
  const smaData = useMemo(
    () => (maPeriod > 1 ? computeSma(cleanPrimary, maPeriod) : []),
    [cleanPrimary, maPeriod]
  );

  const summary = useMemo(() => {
    if (cleanPrimary.length === 0) {
      return { latest: 0, first: 0, min: 0, max: 0, mean: 0, date: "" };
    }
    const vals = cleanPrimary.map((p) => p.value);
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
      latest: vals[vals.length - 1],
      first: vals[0],
      min: Math.min(...vals),
      max: Math.max(...vals),
      mean: sum / vals.length,
      date: cleanPrimary[cleanPrimary.length - 1].time,
    };
  }, [cleanPrimary]);

  const [hovered, setHovered] = useState<{
    time: string;
    primary?: number;
    secondary?: number;
    ma?: number;
    histogram?: number;
  } | null>(null);

  useEffect(() => {
    setHovered(null);
  }, [cleanPrimary]);

  useEffect(() => {
    maSeriesRef.current?.applyOptions({ visible: showMa });
  }, [showMa]);

  useEffect(() => {
    const rawCount = primaryData.length;
    if (rawCount > 0) {
      const invalidCount = primaryData.filter((p) => !Number.isFinite(p.value)).length;
      if (invalidCount > 0) {
        reportChartAnomaly({
          chartComponent: "LightweightTerminalChart",
          seriesLabel: primaryLabel,
          issue: "Filtered non-finite primary chart data points before rendering.",
          invalidCount,
        });
      }
    }
  }, [primaryData, primaryLabel]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || cleanPrimary.length === 0) return;

    let chart: IChartApi;
    try {
      chart = createChart(el, {
      width: Math.max(el.clientWidth, 280),
      height,
      layout: {
        background: { type: ColorType.Solid, color: isLight ? "#FFFFFF" : "#070809" },
        textColor: isLight ? "#475569" : "#9299A3",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 10.5,
        attributionLogo: false,
      },
      grid: {
        vertLines: {
          color: isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.07)",
          style: LineStyle.Dotted,
          visible: true,
        },
        horzLines: {
          color: isLight ? "rgba(15, 23, 42, 0.09)" : "rgba(255, 255, 255, 0.08)",
          style: LineStyle.Dashed,
          visible: true,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
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
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: isLight ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.09)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    chartRef.current = chart;

    const baseVal = baselineValue ?? cleanPrimary[0]?.value ?? 0;

    let mainSeries: ISeriesApi<SeriesType, Time>;
    if (primaryMode === "baseline") {
      mainSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: baseVal },
        topLineColor: "#00C985",
        topFillColor1: "rgba(0, 201, 133, 0.22)",
        topFillColor2: "rgba(0, 201, 133, 0.02)",
        bottomLineColor: "#F05454",
        bottomFillColor1: "rgba(240, 84, 84, 0.02)",
        bottomFillColor2: "rgba(240, 84, 84, 0.22)",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: "rgba(255,255,255,0.12)",
        topColor: isLight ? "rgba(15, 23, 42, 0.18)" : "rgba(255, 255, 255, 0.24)",
        bottomColor: isLight ? "rgba(15, 23, 42, 0.01)" : "rgba(255, 255, 255, 0.01)",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    }
    mainSeries.setData(cleanPrimary);

    if (primaryMode === "area") {
      cleanPrimary.slice(1).forEach((point, index) => {
        const previous = cleanPrimary[index];
        const color =
          point.value > previous.value
            ? "#00C985"
            : point.value < previous.value
            ? "#F05454"
            : "#7A8390";
        const trendSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        trendSeries.setData([previous, point]);
      });
    }

    for (const ref of referenceLines) {
      mainSeries.createPriceLine({
        price: ref.value,
        color: ref.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: ref.label,
      });
    }

    if (cleanPrimary.length > 5 && summary.max !== summary.min) {
      mainSeries.createPriceLine({
        price: summary.max,
        color: "rgba(34, 197, 94, 0.45)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "HIGH",
      });
      mainSeries.createPriceLine({
        price: summary.min,
        color: "rgba(239, 68, 68, 0.45)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "LOW",
      });
    }

    let secSeries: ISeriesApi<SeriesType, Time> | null = null;
    if (cleanSecondary.length > 0) {
      secSeries = chart.addSeries(LineSeries, {
        color: secondaryColor,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      secSeries.setData(cleanSecondary);
    }

    let maSeries: ISeriesApi<SeriesType, Time> | null = null;
    if (smaData.length > 0) {
      maSeries = chart.addSeries(LineSeries, {
        color: isLight ? "#475569" : "#F0F2F5",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: showMaRef.current,
      });
      maSeries.setData(smaData);
      maSeriesRef.current = maSeries;
    }

    let histSeries: ISeriesApi<SeriesType, Time> | null = null;
    if (cleanHistogram.length > 0) {
      histSeries = chart.addSeries(
        HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: true,
        },
        1
      );
      histSeries.setData(
        cleanHistogram.map((h) => ({
          time: h.time,
          value: h.value,
          color:
            h.color ??
            (h.value >= 0 ? "rgba(0, 201, 133, 0.72)" : "rgba(240, 84, 84, 0.72)"),
        }))
      );
      const panes = chart.panes();
      panes[0]?.setStretchFactor(0.74);
      panes[1]?.setStretchFactor(0.26);
    }

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || param.point === undefined) {
        setHovered(null);
        return;
      }
      const pVal = param.seriesData.get(mainSeries) as { value?: number } | undefined;
      const sVal = secSeries
        ? (param.seriesData.get(secSeries) as { value?: number } | undefined)
        : undefined;
      const mVal = maSeries
        ? (param.seriesData.get(maSeries) as { value?: number } | undefined)
        : undefined;
      const hVal = histSeries
        ? (param.seriesData.get(histSeries) as { value?: number } | undefined)
        : undefined;

      setHovered({
        time: String(param.time),
        primary: pVal?.value,
        secondary: sVal?.value,
        ma: mVal?.value,
        histogram: hVal?.value,
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
      maSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
    } catch (err) {
      reportChartAnomaly({
        chartComponent: "LightweightTerminalChart",
        seriesLabel: primaryLabel,
        issue:
          err instanceof Error ? err.message : "Failed to initialize LightweightTerminalChart",
      });
      return;
    }
  }, [
    cleanPrimary,
    cleanSecondary,
    cleanHistogram,
    smaData,
    primaryLabel,
    primaryMode,
    baselineValue,
    secondaryColor,
    referenceLines,
    height,
    isLight,
    summary.max,
    summary.min,
  ]);

  const activePrimary = hovered?.primary ?? summary.latest;
  const activeDate = hovered?.time ?? summary.date;
  const periodDelta = summary.latest - summary.first;
  const pctChange = summary.first !== 0 ? ((periodDelta / Math.abs(summary.first)) * 100).toFixed(2) : "0.00";

  return (
    <div className="space-y-2">
      {/* Institutional Crosshair Telemetry HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-[#07090D] px-3 py-1.5 font-mono-num text-[11px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[#7A8390] font-medium">{activeDate}</span>
          <span className="text-[#F0F2F5]">
            <span className="text-[#FFFFFF]">{primaryLabel}:</span>{" "}
            <span className="font-semibold">{valueFormatter(activePrimary)}</span>
          </span>
          {secondaryLabel && hovered?.secondary !== undefined && (
            <span className="text-[#D9B45C]">
              {secondaryLabel}: {valueFormatter(hovered.secondary)}
            </span>
          )}
          {showMa && hovered?.ma !== undefined && (
            <span className="text-[#F0F2F5]">
              SMA({maPeriod}): {valueFormatter(hovered.ma)}
            </span>
          )}
          {histogramLabel && hovered?.histogram !== undefined && (
            <span
              className={
                hovered.histogram >= 0 ? "text-[#00C985]" : "text-[#F05454]"
              }
            >
              {histogramLabel}: {histogramFormatter(hovered.histogram)}
            </span>
          )}
          <span className="hidden text-[#9299A3] md:inline">
            H: <b className="text-[#22C55E] font-medium">{valueFormatter(summary.max)}</b> · L: <b className="text-[#EF4444] font-medium">{valueFormatter(summary.min)}</b> · Avg: <b className="text-[#FFFFFF] font-medium">{valueFormatter(summary.mean)}</b>
          </span>
          <span
            className={cn(
              "hidden sm:inline font-semibold",
              periodDelta >= 0 ? "text-[#00C985]" : "text-[#F05454]"
            )}
          >
            Δ {periodDelta >= 0 ? "+" : ""}
            {valueFormatter(periodDelta)} ({periodDelta >= 0 ? "+" : ""}{pctChange}%)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {maPeriod > 1 && smaData.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMa((prev) => !prev)}
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] transition",
                showMa
                  ? "border-[#F0F2F5]/40 bg-[#F0F2F5]/10 text-[#F0F2F5]"
                  : "border-white/[0.09] text-[#555D68] hover:text-[#9299A3]"
              )}
            >
              SMA {maPeriod}
            </button>
          )}
          <button
            type="button"
            onClick={() => chartRef.current?.timeScale().fitContent()}
            title="Reset zoom"
            className="inline-flex items-center gap-1 rounded border border-white/[0.09] px-2 py-0.5 text-[10px] text-[#9299A3] hover:text-[#F0F2F5]"
          >
            <Maximize2 className="h-2.5 w-2.5" />
            Fit
          </button>
        </div>
      </div>

      {/* Canvas Mount */}
      {cleanPrimary.length === 0 ? (
        <div
          className="flex w-full items-center justify-center rounded-md border border-dashed border-white/[0.10] bg-[#070809] px-4 text-center font-mono-num text-[11px] text-[#7A8390]"
          style={{ height }}
        >
          No valid chart series points available for {primaryLabel}.
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
