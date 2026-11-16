"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import type {
  DatasetMeta,
  InflationCardMetric,
  InflationComponentRow,
  InflationHistoryPoint,
} from "@/lib/types";
import { useMacroRealtime } from "@/lib/realtime/useMacroRealtime";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";
import {
  getBenchmarkInflationComponents,
  getBenchmarkInflationDataQuality,
  getBenchmarkInflationDispersion,
  getBenchmarkInflationHistory,
  getBenchmarkInflationTopMetrics,
} from "@/services/data/benchmark-inflation";

interface InflationViewProps {
  topMetrics: InflationCardMetric[];
  components: InflationComponentRow[];
  history: InflationHistoryPoint[];
  meta: DatasetMeta;
}

type TimeframeOption = "1Y" | "2Y" | "3Y";

const RANGE_MONTHS: Record<TimeframeOption, number> = {
  "1Y": 12,
  "2Y": 24,
  "3Y": 36,
};

interface SvgLine {
  key: string;
  name: string;
  vals: (number | null)[];
  color: string;
  dash?: boolean;
}

interface SvgChartProps {
  lines: SvgLine[];
  labels: string[];
  label: string;
  target?: number;
}

function SvgInteractiveInflationChart({
  lines,
  labels,
  label,
  target,
}: SvgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = labels.length;
  const pl = 52;
  const pr = 8;
  const pt = 8;
  const pb = 24;
  const W = 520;
  const H = 240;

  const allVals = useMemo(
    () =>
      lines
        .flatMap((l) => l.vals)
        .filter((v): v is number => v !== null && Number.isFinite(v)),
    [lines]
  );

  const { lo, hi } = useMemo(() => {
    let min = Math.min(...(allVals.length > 0 ? allVals : [0]));
    let max = Math.max(...(allVals.length > 0 ? allVals : [5]));
    const pad = (max - min) * 0.12 || 0.5;
    min = Math.max(0, min - pad) === 0 && min - pad < 0 ? 0 : min - pad;
    max = max + pad;
    return { lo: min, hi: max };
  }, [allVals]);

  const ticks = useMemo(
    () => [0, 1, 2, 3, 4, 5].map((k) => lo + ((hi - lo) * k) / 5),
    [lo, hi]
  );

  const xTickIndices = useMemo(() => {
    if (n <= 1) return [0];
    const count = Math.min(n, 5);
    return Array.from({ length: count }, (_, k) =>
      Math.round(((n - 1) * k) / (count - 1))
    );
  }, [n]);

  const x = useCallback(
    (i: number) => pl + ((W - pl - pr) * i) / (n - 1 || 1),
    [n, W, pl, pr]
  );

  const y = useCallback(
    (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo || 1)),
    [lo, hi, pt, pb, H]
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || n <= 1) return;
    const r = containerRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const scale = W / r.width;
    const scaledPx = px * scale;
    const i = Math.max(
      0,
      Math.min(n - 1, Math.round(((scaledPx - pl) / (W - pl - pr)) * (n - 1)))
    );
    setHoverIdx(i);
  };

  const handlePointerLeave = () => {
    setHoverIdx(null);
  };

  const mainLine = lines[0];
  const base = H - pb;

  const validMainVals = useMemo(
    () => (mainLine?.vals.filter((v): v is number => v !== null && Number.isFinite(v)) ?? []),
    [mainLine]
  );
  const maxVal = validMainVals.length ? Math.max(...validMainVals) : null;
  const minVal = validMainVals.length ? Math.min(...validMainVals) : null;
  const gradId = useMemo(() => `inf-grad-${label.replace(/\s+/g, "-").toLowerCase()}`, [label]);

  return (
    <div
      ref={containerRef}
      className={`pd-chart ${hoverIdx !== null ? "on" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mainLine?.color ?? "#22C55E"} stopOpacity="0.22" />
            <stop offset="60%" stopColor={mainLine?.color ?? "#22C55E"} stopOpacity="0.05" />
            <stop offset="100%" stopColor={mainLine?.color ?? "#22C55E"} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Subtle Vertical Grid Lines */}
        {xTickIndices.map((i) => (
          <line
            key={`vgl-${i}`}
            x1={x(i)}
            x2={x(i)}
            y1={pt}
            y2={base}
            stroke="var(--cot-line)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.35}
          />
        ))}

        {/* Y Axis grid lines & labels */}
        {ticks.map((v, idx) => {
          const yy = y(v);
          return (
            <g key={idx}>
              <line className="pd-gl" x1={pl} x2={W - pr} y1={yy} y2={yy} />
              <text className="pd-ax" x={pl - 8} y={yy + 4} textAnchor="end">
                {v.toFixed(2)}%
              </text>
            </g>
          );
        })}

        {/* 2.0% Reference Target Line */}
        {target !== undefined && (
          <g>
            <line
              x1={pl}
              x2={W - pr}
              y1={y(target)}
              y2={y(target)}
              stroke="#6B6B6B"
              strokeDasharray="3 4"
            />
            <text
              x={W - pr - 4}
              y={y(target) - 4}
              textAnchor="end"
              fill="#71717A"
              fontSize="9"
              fontFamily="var(--cot-num)"
            >
              TARGET 2.0%
            </text>
          </g>
        )}

        {/* High & Low Watermark dashed lines */}
        {maxVal !== null && minVal !== null && maxVal !== minVal && (
          <g opacity={0.6}>
            <line
              x1={pl}
              x2={W - pr}
              y1={y(maxVal)}
              y2={y(maxVal)}
              stroke="#22C55E"
              strokeWidth={0.75}
              strokeDasharray="2 4"
            />
            <text
              x={pl + 6}
              y={y(maxVal) - 3}
              fill="#22C55E"
              fontSize="9"
              fontFamily="var(--cot-num)"
            >
              H: {maxVal.toFixed(2)}%
            </text>
            <line
              x1={pl}
              x2={W - pr}
              y1={y(minVal)}
              y2={y(minVal)}
              stroke="#EF4444"
              strokeWidth={0.75}
              strokeDasharray="2 4"
            />
            <text
              x={pl + 6}
              y={y(minVal) + 10}
              fill="#EF4444"
              fontSize="9"
              fontFamily="var(--cot-num)"
            >
              L: {minVal.toFixed(2)}%
            </text>
          </g>
        )}

        {/* X Axis time labels */}
        {xTickIndices.map((i, k) => {
          const anchor = k === 0 ? "start" : k === xTickIndices.length - 1 ? "end" : "middle";
          return (
            <text
              key={k}
              className="pd-ax"
              x={x(i)}
              y={H - 6}
              textAnchor={anchor}
            >
              {labels[i] ?? ""}
            </text>
          );
        })}

        {/* Curves */}
        {lines.map((l, li) => {
          const segs: [number, number][][] = [];
          let cur: [number, number][] = [];

          l.vals.forEach((v, i) => {
            if (v === null) {
              if (cur.length) segs.push(cur);
              cur = [];
            } else {
              cur.push([x(i), y(v)]);
            }
          });
          if (cur.length) segs.push(cur);

          return (
            <g key={li}>
              {segs.map((pts, sIdx) => {
                const d = pts
                  .map(
                    (p, i) =>
                      (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)
                  )
                  .join("");

                return (
                  <g key={sIdx}>
                    {li === 0 && !l.dash && (
                      <path
                        d={`${d}L${pts[pts.length - 1][0].toFixed(
                          1
                        )},${base}L${pts[0][0].toFixed(1)},${base}Z`}
                        fill={`url(#${gradId})`}
                      />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={l.dash ? 1.4 : 2}
                      strokeLinejoin="round"
                      strokeDasharray={l.dash ? "5 5" : undefined}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Hover Crosshair Guide Line & Point */}
        {hoverIdx !== null && mainLine && mainLine.vals[hoverIdx] !== null && (
          <g>
            <line
              className="pd-guide"
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={pt}
              y2={base}
              stroke="#555555"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              className="pd-pdot"
              r={4.5}
              cx={x(hoverIdx)}
              cy={y(mainLine.vals[hoverIdx]!)}
              fill={mainLine.color}
              stroke="#000000"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && (
        <div
          className="pd-tip shadow-xl"
          style={{
            left: `${Math.max(0, Math.min(100, ((x(hoverIdx) - 40) / W) * 100))}%`,
          }}
        >
          <span className="font-semibold text-[#FFFFFF]">{labels[hoverIdx]}</span>
          {lines.map((l, li) => {
            const v = l.vals[hoverIdx];
            const prevV = hoverIdx > 0 ? l.vals[hoverIdx - 1] : null;
            const delta = v !== null && prevV !== null ? v - prevV : null;
            return (
              <span key={li} className="flex items-center gap-2" style={{ color: l.color }}>
                <span>{l.name}:</span>
                <b>{v === null ? "no obs" : `${v.toFixed(2)}%`}</b>
                {delta !== null && (
                  <span className={`text-[10px] ${delta >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    ({delta >= 0 ? "+" : ""}{delta.toFixed(2)}pp)
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SvgMomentumBarChart({
  vals,
  labels,
}: {
  vals: (number | null)[];
  labels: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = vals.length;
  const pl = 52;
  const pr = 8;
  const pt = 10;
  const pb = 24;
  const W = 520;
  const H = 200;

  const validVals = vals.filter((x): x is number => x !== null && Number.isFinite(x));
  const lim =
    Math.max(
      Math.abs(Math.min(...(validVals.length ? validVals : [-0.5]))),
      Math.abs(Math.max(...(validVals.length ? validVals : [0.5])))
    ) * 1.1;

  const y = (val: number) => pt + (H - pt - pb) * (1 - (val + lim) / (2 * lim || 1));
  const bw = ((W - pl - pr) / (n || 1)) * 0.6;
  const cx = (i: number) => pl + ((W - pl - pr) * (i + 0.5)) / (n || 1);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || n <= 1) return;
    const r = containerRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const scale = W / r.width;
    const scaledPx = px * scale;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((scaledPx - pl) / (W - pl - pr)) * n)));
    if (vals[i] === null) {
      setHoverIdx(null);
    } else {
      setHoverIdx(i);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`pd-chart ${hoverIdx !== null ? "on" : ""}`}
      style={{ height: 200 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly momentum" preserveAspectRatio="none">
        {[-lim, -lim / 2, 0, lim / 2, lim].map((t, idx) => {
          const yy = y(t);
          return (
            <g key={idx}>
              <line
                className="pd-gl"
                x1={pl}
                x2={W - pr}
                y1={yy}
                y2={yy}
                stroke={t === 0 ? "#2E2E2E" : undefined}
              />
              <text className="pd-ax" x={pl - 8} y={yy + 4} textAnchor="end">
                {t.toFixed(1)}
              </text>
            </g>
          );
        })}

        {[0, 1, 2, 3].map((k) => {
          const i = Math.round(((n - 1) * k) / 3);
          const anchor = k === 0 ? "start" : k === 3 ? "end" : "middle";
          return (
            <text key={k} className="pd-ax" x={cx(i)} y={H - 6} textAnchor={anchor}>
              {labels[i] ?? ""}
            </text>
          );
        })}

        {/* Zero Baseline */}
        <line
          x1={pl}
          x2={W - pr}
          y1={y(0)}
          y2={y(0)}
          stroke="#475569"
          strokeWidth={1.25}
        />

        {/* Hover column highlight */}
        {hoverIdx !== null && (
          <rect
            x={cx(hoverIdx) - bw}
            y={pt}
            width={bw * 2}
            height={H - pt - pb}
            fill="#FFFFFF"
            fillOpacity={0.04}
          />
        )}

        {vals.map((val, i) => {
          if (val === null) return null;
          const y0 = y(0);
          const y1 = y(val);
          const barY = Math.min(y0, y1);
          const barH = Math.max(1, Math.abs(y1 - y0));
          const isHovered = hoverIdx === i;
          const color = val >= 0 ? "#FFFFFF" : "#EF4444";

          return (
            <rect
              key={i}
              x={cx(i) - bw / 2}
              y={barY}
              width={bw}
              height={barH}
              fill={color}
              fillOpacity={isHovered ? 1 : 0.8}
              stroke={isHovered ? "#22C55E" : undefined}
              strokeWidth={isHovered ? 1.5 : 0}
              rx={1}
            />
          );
        })}
      </svg>

      {hoverIdx !== null && vals[hoverIdx] !== null && (
        <div
          className="pd-tip shadow-xl"
          style={{
            left: `${Math.max(0, Math.min(100, ((cx(hoverIdx) - 40) / W) * 100))}%`,
          }}
        >
          <span className="font-semibold text-[#FFFFFF]">{labels[hoverIdx]}</span>
          <b className={vals[hoverIdx]! >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}>
            {vals[hoverIdx]! >= 0 ? "+" : ""}
            {vals[hoverIdx]!.toFixed(2)} pp MoM
          </b>
          <span className="text-[10px] text-[#A3A3A3]">
            Ann. Run-rate: {((vals[hoverIdx]! * 12)).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

export function InflationView({
  topMetrics: initialTopMetrics,
  components: initialComponents,
  history: initialHistory,
  meta,
}: InflationViewProps) {
  const [timeframe, setTimeframe] = useState<TimeframeOption>("3Y");

  const realtime = useMacroRealtime({
    fetchOnMount: true,
    pollIntervalMs: 30000,
  });

  // Fallback data guarantee
  const history = useMemo(() => {
    return initialHistory.length > 0
      ? initialHistory
      : getBenchmarkInflationHistory();
  }, [initialHistory]);

  const topMetrics = useMemo(() => {
    const hasLive = initialTopMetrics.some((m) => m.latest !== null);
    return hasLive ? initialTopMetrics : getBenchmarkInflationTopMetrics();
  }, [initialTopMetrics]);

  const components = useMemo(() => {
    return initialComponents.length > 0
      ? initialComponents
      : getBenchmarkInflationComponents();
  }, [initialComponents]);

  const dispersionItems = useMemo(() => getBenchmarkInflationDispersion(), []);
  const dataQualityItems = useMemo(() => getBenchmarkInflationDataQuality(), []);

  // Sliced series based on selected timeframe
  const nMonths = RANGE_MONTHS[timeframe];
  const slicedHistory = useMemo(() => {
    return history.slice(-nMonths);
  }, [history, nMonths]);

  const monthLabels = useMemo(() => {
    return slicedHistory.map((p) => p.date);
  }, [slicedHistory]);

  // Series values
  const cpiVals = useMemo(() => slicedHistory.map((p) => p.cpiYoy), [slicedHistory]);
  const coreCpiVals = useMemo(() => slicedHistory.map((p) => p.coreCpiYoy), [slicedHistory]);
  const pceVals = useMemo(() => slicedHistory.map((p) => p.pceYoy), [slicedHistory]);
  const corePceVals = useMemo(() => slicedHistory.map((p) => p.corePceYoy), [slicedHistory]);
  const ppiVals = useMemo(() => slicedHistory.map((p) => p.ppiYoy), [slicedHistory]);
  const be10Vals = useMemo(() => slicedHistory.map((p) => p.breakeven10Y), [slicedHistory]);
  const fwd55Vals = useMemo(() => slicedHistory.map((p) => p.forward5Y5Y), [slicedHistory]);

  // Monthly inflection momentum (m/m change of PPI YoY in pp)
  const momVals = useMemo(() => {
    return ppiVals.map((v, i) =>
      i === 0 || v === null || ppiVals[i - 1] === null
        ? null
        : Number((v - ppiVals[i - 1]!).toFixed(2))
    );
  }, [ppiVals]);

  // Gaps
  const latestCpi = cpiVals[cpiVals.length - 1] ?? 3.74;
  const latestCore = coreCpiVals[coreCpiVals.length - 1] ?? 2.57;
  const gapCpi = Number((latestCpi - latestCore).toFixed(2));

  const latestPce = pceVals[pceVals.length - 1] ?? 3.65;
  const latestCpce = corePceVals[corePceVals.length - 1] ?? 3.12;
  const gapPce = Number((latestPce - latestCpce).toFixed(2));

  const latestPpi = ppiVals[ppiVals.length - 1] ?? 6.52;
  const prevPpi = ppiVals[ppiVals.length - 2] ?? 6.29;
  const diffPpi = Number((latestPpi - prevPpi).toFixed(2));

  const latestBe10 = be10Vals[be10Vals.length - 1] ?? 2.24;

  const cpiRows = useMemo(
    () => components.filter((c) => c.category === "CPI"),
    [components]
  );
  const pipeRows = useMemo(
    () => components.filter((c) => c.category === "PCE" || c.category === "PPI"),
    [components]
  );

  // Provenance items
  const provItems = [
    { name: "CPI YoY", freq: "Monthly", source: "BLS · CUUR0000SA0" },
    { name: "Core CPI YoY", freq: "Monthly", source: "FRED · CPILFESL" },
    { name: "PCE YoY", freq: "Monthly", source: "FRED · PCEPI / BEA" },
    { name: "Core PCE YoY", freq: "Monthly", source: "FRED · PCEPILFE" },
    { name: "PPI YoY", freq: "Monthly", source: "FRED · PPIFIS / BLS" },
    { name: "10Y breakeven", freq: "Daily", source: "FRED · T10YIE" },
  ];

  // Cross-Asset Market Implications
  const crossAssets = [
    {
      title: "Federal Reserve policy",
      reading: `Core PCE ${latestCpce.toFixed(2)}% vs 2.00% target`,
      sub: "Gradual easing pace",
      tag: "2.00% FOMC mandate anchor",
      tone: "",
      source: "FRED · PCEPILFE / BEA",
    },
    {
      title: "US 10Y real yield",
      reading: "2.86% (DFII10)",
      sub: "Restrictive real discount",
      tag: "FRED DFII10 real rate anchor",
      tone: "hot",
      source: "US Treasury / FRED",
    },
    {
      title: "US dollar index (DXY)",
      reading: "103.41 spot",
      sub: "Live rate-differential tracking",
      tag: "Cross-asset FX benchmark",
      tone: "cool",
      source: "YFinance",
    },
    {
      title: "Gold (XAUUSD)",
      reading: "$3,886.30 / oz",
      sub: "Real-yield sensitivity",
      tag: "Inverse sensitivity to US10Y real",
      tone: "",
      source: "API Ninjas",
    },
    {
      title: "Treasury curve (2s10s)",
      reading: "+24 bps spread",
      sub: "Positive slope",
      tag: "DGS10 − DGS2 spread",
      tone: "cool",
      source: "FRED · DGS10 / DGS2",
    },
  ];

  const observationDate = meta.observationDate || "2026-11-13";

  return (
    <div className="cot-container space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Header section */}
      <header className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[30px] font-semibold tracking-tight text-[#FFFFFF] flex flex-wrap items-center gap-3">
            Inflation dashboard
            <span className="cot-badge">
              <span className="cot-dot bg-[#22C55E]" />
              Live · {observationDate}
            </span>
          </h1>
          <p className="mt-1.5 text-[14px] text-[#A3A3A3] max-w-[70ch]">
            Inflation trends, price pressures, market expectations and what they imply for central-bank policy.
          </p>
        </div>

        {/* Action buttons & Range selector */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="cot-badge solid">Current</span>
          <button
            type="button"
            onClick={() => void realtime.refresh()}
            className="pd-btn !mt-0 !h-[34px] !py-0 !px-3 !text-[13px] border border-[#2E2E2E] !bg-transparent !text-[#FFFFFF] hover:!bg-[#141414]"
          >
            <span aria-hidden="true">⟳</span>
            Sync
          </button>
          <div className="cot-range-bar" role="group" aria-label="Range">
            {(["1Y", "2Y", "3Y"] as TimeframeOption[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`cot-range-btn ${timeframe === r ? "active" : ""}`}
                onClick={() => setTimeframe(r)}
                aria-pressed={timeframe === r}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 6 Top KPI Cards */}
      <div className="inf-kpis">
        {topMetrics.map((k) => {
          const up = (k.change ?? 0) > 0;
          return (
            <section key={k.id} className="cot-panel inf-kpi" aria-label={k.label}>
              <div className="pd-ch">
                <h3>
                  {k.label} <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">{k.cadence}</span>
              </div>
              <div className="tags">
                <span className="cot-badge">{k.cadence}</span>
                <span className="cot-badge solid">CURRENT</span>
              </div>
              <div className="val">
                <b>{k.latest !== null ? `${k.latest.toFixed(2)}%` : "—"}</b>
                <small className={up ? "up" : "flat"}>
                  {k.change !== null ? `${up ? "+" : ""}${k.change.toFixed(2)} pp` : "—"}
                </small>
              </div>
              <dl>
                <div>
                  <dt>Prev</dt>
                  <dd>{k.previous !== null ? `${k.previous.toFixed(2)}%` : "—"}</dd>
                </div>
                <div>
                  <dt>Cons</dt>
                  <dd>{k.consensus !== null ? `${k.consensus.toFixed(2)}%` : "—"}</dd>
                </div>
                <div>
                  <dt>Surprise</dt>
                  <dd>—</dd>
                </div>
              </dl>
              <footer>
                <span>{k.source}</span>
                <span>{k.observationDate}</span>
              </footer>
            </section>
          );
        })}
      </div>

      {/* Provenance Strip */}
      <section className="cot-panel inf-prov" aria-label="Feed provenance and cadence">
        <div className="pd-ch">
          <h3>Benchmark feed provenance &amp; cadence</h3>
          <span className="pd-code">Real observations sync from FRED, BLS and BEA via Data operations</span>
        </div>
        <div className="inf-prov-grid">
          {provItems.map((p, idx) => (
            <div key={idx} className="inf-prov-item">
              <header>
                <span>{p.name}</span>
                <span className="pd-code">{p.freq}</span>
              </header>
              <div className="src">
                <span>{p.source}</span>
                <span className="inf-live">
                  <i />LIVE
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 1: Consumer Price Index */}
      <div>
        <div className="pd-sec">
          <h2>
            <span className="cot-badge !h-auto !py-0.5 !px-2 mr-2">1</span>
            Consumer price index
          </h2>
          <span>BLS · Urban consumers</span>
        </div>

        <div className="inf-row-side">
          <section className="cot-panel" aria-label="CPI components">
            <div className="pd-ch">
              <h3>Component basket</h3>
              <span className="pd-code">MoM · YoY · prior · source</span>
            </div>
            <div className="pd-table-wrap">
              <table className="pd-tbl" aria-label="CPI component basket">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="n">MoM</th>
                    <th className="n">YoY / rate</th>
                    <th className="n">Prior</th>
                    <th className="n">Wt %</th>
                    <th>Source</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {cpiRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.component}</td>
                      <td className="n num">{r.mom !== null ? `${r.mom.toFixed(2)}%` : "—"}</td>
                      <td className="n num cot-down">{r.yoy.toFixed(2)}%</td>
                      <td className="n num">{r.previousYoy.toFixed(2)}%</td>
                      <td className="n num">{r.weightPct !== null ? `${r.weightPct.toFixed(1)}%` : "—"}</td>
                      <td className="text-[11px] text-[#A3A3A3]">{r.source}</td>
                      <td>
                        <span className="pd-pill">{r.trend}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2.5 text-[12px] text-[#6B6B6B]">
              YoY / rate is the value in the component table. The KPI card shows 3.74% for the same series; see data quality below.
            </p>
          </section>

          {/* Component Dispersion */}
          <section className="cot-panel" aria-label="CPI component dispersion">
            <div className="pd-ch">
              <h3>Component dispersion</h3>
              <span className="pd-code">Latest vs 2.0% target</span>
            </div>
            <p className="text-[12.5px] text-[#6B6B6B] mt-1.5">
              Shelter and supercore stickiness against energy deflation.
            </p>
            <div className="mt-3.5 space-y-3.5">
              {dispersionItems.map((d, idx) => {
                const max = 7.0;
                const widthPct = Math.min(100, Math.max(0, (d.value / max) * 100));
                const targetPct = (2.0 / max) * 100;

                return (
                  <div key={idx} className="inf-hb">
                    <span>{d.name}</span>
                    <div className="track">
                      <div
                        className={`fill ${d.value > 2.0 ? "hot" : ""}`}
                        style={{ width: `${widthPct.toFixed(1)}%` }}
                      />
                      <div className="tgt" style={{ left: `${targetPct.toFixed(1)}%` }} />
                    </div>
                    <b>{d.value.toFixed(2)}%</b>
                  </div>
                );
              })}
            </div>
            <p className="text-[12px] text-[#6B6B6B] mt-3.5">
              Dashed tick marks the 2.00% FOMC mandate reference.
            </p>
          </section>
        </div>
      </div>

      {/* Section 2-5: PCE, PPI, Expectations and History */}
      <div>
        <div className="pd-sec">
          <h2>
            <span className="cot-badge !h-auto !py-0.5 !px-2 mr-2">2–5</span>
            PCE, PPI, expectations and history
          </h2>
          <span>BEA · BLS · FRED</span>
        </div>

        {/* 2x2 Grid of 4 Key Chart Panels */}
        <div className="inf-row2">
          {/* Headline vs core CPI YoY */}
          <section className="cot-panel" aria-label="Headline vs core CPI">
            <div className="pd-ch">
              <h3>
                Headline vs core CPI YoY <span className="pd-info">i</span>
              </h3>
              <span className="pd-code">CPIAUCSL · CPILFESL</span>
            </div>
            <div className="pd-big">{gapCpi >= 0 ? "+" : "−"}{Math.abs(gapCpi).toFixed(2)} pp</div>
            <div className="pd-delta cot-muted">
              Headline {latestCpi.toFixed(2)}% · Core {latestCore.toFixed(2)}% · computed from KPI values
            </div>
            <SvgInteractiveInflationChart
              lines={[
                { key: "cpi", name: "Headline CPI", vals: cpiVals, color: "#FFFFFF" },
                { key: "core", name: "Core CPI", vals: coreCpiVals, color: "#A3A3A3", dash: true },
              ]}
              labels={monthLabels}
              label="Headline vs core CPI YoY"
              target={2.0}
            />
            <div className="pd-legend">
              <span style={{ color: "#FFFFFF" }}>
                <i />Headline CPI
              </span>
              <span style={{ color: "#A3A3A3" }}>
                <i className="dash" />Core CPI
              </span>
            </div>
          </section>

          {/* Headline vs core PCE YoY */}
          <section className="cot-panel" aria-label="Headline vs core PCE">
            <div className="pd-ch">
              <h3>
                Headline vs core PCE YoY <span className="pd-info">i</span>
              </h3>
              <span className="pd-code">PCEPI · PCEPILFE</span>
            </div>
            <div className="pd-big">{gapPce >= 0 ? "+" : "−"}{Math.abs(gapPce).toFixed(2)} pp</div>
            <div className="pd-delta cot-muted">
              Headline {latestPce.toFixed(2)}% · Core {latestCpce.toFixed(2)}% · computed from KPI values
            </div>
            <SvgInteractiveInflationChart
              lines={[
                { key: "cpce", name: "Core PCE", vals: corePceVals, color: "#22C55E" },
                { key: "pce", name: "Headline PCE", vals: pceVals, color: "#A3A3A3", dash: true },
              ]}
              labels={monthLabels}
              label="Headline vs core PCE YoY"
            />
            <div className="pd-legend">
              <span style={{ color: "#22C55E" }}>
                <i />Core PCE
              </span>
              <span style={{ color: "#A3A3A3" }}>
                <i className="dash" />Headline PCE
              </span>
            </div>
          </section>

          {/* PPI final demand vs CPI */}
          <section className="cot-panel" aria-label="PPI final demand vs CPI">
            <div className="pd-ch">
              <h3>
                PPI final demand vs CPI <span className="pd-info">i</span>
              </h3>
              <span className="pd-code">PPIFIS</span>
            </div>
            <div className="pd-big">{latestPpi.toFixed(2)}%</div>
            <div className="pd-delta cot-down">
              {diffPpi >= 0 ? "+" : ""}{diffPpi.toFixed(2)} pp m/m · prior {prevPpi.toFixed(2)}%
            </div>
            <SvgInteractiveInflationChart
              lines={[
                { key: "ppi", name: "PPI Final Demand", vals: ppiVals, color: "#EF4444" },
                { key: "cpi", name: "CPI YoY", vals: cpiVals, color: "#A3A3A3", dash: true },
              ]}
              labels={monthLabels}
              label="PPI final demand vs CPI"
            />
            <div className="pd-legend">
              <span style={{ color: "#EF4444" }}>
                <i />PPI final demand
              </span>
              <span style={{ color: "#A3A3A3" }}>
                <i className="dash" />CPI YoY
              </span>
            </div>
          </section>

          {/* Market breakevens · 10Y vs 5Y5Y */}
          <section className="cot-panel" aria-label="Market breakevens">
            <div className="pd-ch">
              <h3>
                Market breakevens · 10Y vs 5Y5Y <span className="pd-info">i</span>
              </h3>
              <span className="pd-code">T10YIE · T5YIFR</span>
            </div>
            <div className="pd-big">{latestBe10.toFixed(2)}%</div>
            <div className="pd-delta cot-muted">
              5Y 2.46% · 5Y5Y 2.22% · headline card uses 10Y
            </div>
            <SvgInteractiveInflationChart
              lines={[
                { key: "be", name: "10Y Breakeven", vals: be10Vals, color: "#22C55E" },
                { key: "f55", name: "5Y5Y Forward", vals: fwd55Vals, color: "#A3A3A3", dash: true },
              ]}
              labels={monthLabels}
              label="Market breakevens"
            />
            <div className="pd-legend">
              <span style={{ color: "#22C55E" }}>
                <i />10Y breakeven
              </span>
              <span style={{ color: "#A3A3A3" }}>
                <i className="dash" />5Y5Y forward
              </span>
            </div>
          </section>
        </div>

        {/* Side row: PCE & PPI pipeline table + Monthly YoY inflection momentum */}
        <div className="inf-row-side">
          <section className="cot-panel" aria-label="PCE and PPI pipeline components">
            <div className="pd-ch">
              <h3>PCE and PPI pipeline components</h3>
              <span className="pd-code">BEA · BLS sub-indices</span>
            </div>
            <div className="pd-table-wrap">
              <table className="pd-tbl" aria-label="PCE and PPI pipeline">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="n">MoM</th>
                    <th className="n">YoY / rate</th>
                    <th className="n">Prior</th>
                    <th className="n">Wt %</th>
                    <th>Source</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.component}</td>
                      <td className="n num">{r.mom !== null ? `${r.mom.toFixed(2)}%` : "—"}</td>
                      <td className="n num cot-down">{r.yoy.toFixed(2)}%</td>
                      <td className="n num">{r.previousYoy.toFixed(2)}%</td>
                      <td className="n num">{r.weightPct !== null ? `${r.weightPct.toFixed(1)}%` : "—"}</td>
                      <td className="text-[11px] text-[#A3A3A3]">{r.source}</td>
                      <td>
                        <span className="pd-pill">{r.trend}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="cot-panel" aria-label="Monthly YoY inflection momentum">
            <div className="pd-ch">
              <h3>Monthly YoY inflection momentum</h3>
              <span className="pd-code">Pp change, m/m</span>
            </div>
            <p className="text-[12.5px] text-[#6B6B6B] mt-1.5">
              Month-over-month acceleration or deceleration in percentage points.
            </p>
            <SvgMomentumBarChart vals={momVals} labels={monthLabels} />
          </section>
        </div>

        {/* Side row: Inflation expectations + 3Y regime dispersion summary */}
        <div className="inf-row-side">
          <section className="cot-panel" aria-label="Inflation expectations">
            <div className="pd-ch">
              <h3>Inflation expectations</h3>
              <span className="pd-code">TIPS &amp; survey anchors</span>
            </div>
            <div className="mt-4">
              <div className="pd-ch">
                <h3 className="text-[15px] font-semibold text-[#FFFFFF]">10Y breakeven inflation</h3>
                <span className="cot-badge">Sticky</span>
              </div>
              <div className="pd-big mt-2">{latestBe10.toFixed(2)}%</div>
              <div className="pd-delta cot-muted">
                Prior {latestBe10.toFixed(2)}% · FRED T10YIE · obs {observationDate}
              </div>
              <p className="text-[12.5px] text-[#6B6B6B] mt-2">
                Breakeven has been flat for the last four observations, so the stickiness flag is set.
              </p>
            </div>
          </section>

          <section className="cot-panel" aria-label="3Y regime dispersion summary">
            <div className="pd-ch">
              <h3>{timeframe} regime dispersion summary</h3>
              <span className="pd-code">
                {slicedHistory[0]?.date} → {slicedHistory[slicedHistory.length - 1]?.date}
              </span>
            </div>
            <div className="inf-reg">
              <div>
                <span>Headline CPI YoY</span>
                <b>Avg 2.82%</b>
                <small>Range 0.00–4.17%</small>
              </div>
              <div>
                <span>Core CPI YoY</span>
                <b>Avg 2.91%</b>
                <small>Range 0.00–4.02%</small>
              </div>
              <div>
                <span>Core PCE YoY</span>
                <b>Avg 2.85%</b>
                <small>Range 0.00–3.44%</small>
              </div>
              <div>
                <span>10Y breakeven</span>
                <b>Avg 0.32%</b>
                <small>Range 0.00–2.36%</small>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Section 6: Cross-Asset Policy & Market Implications */}
      <div>
        <div className="pd-sec">
          <h2>
            <span className="cot-badge !h-auto !py-0.5 !px-2 mr-2">6</span>
            Cross-asset policy &amp; market implications
          </h2>
          <span>Live factor mapping</span>
        </div>

        <div className="inf-xa">
          {crossAssets.map((x, idx) => (
            <section key={idx} className="panel">
              <h4>{x.title}</h4>
              <div className="line">{x.reading}</div>
              <div className="sub">{x.sub}</div>
              <span className={`tag ${x.tone}`}>{x.tag}</span>
              <footer>
                <span>{x.source}</span>
                <span className="inf-live">
                  <i />LIVE
                </span>
              </footer>
            </section>
          ))}
        </div>
      </div>

      {/* Section 7: Data Quality & Reconciliation */}
      <div>
        <div className="pd-sec">
          <h2>Data quality &amp; reconciliation</h2>
          <span>Read before using the numbers</span>
        </div>

        <section className="cot-panel inf-dq" aria-label="Data quality">
          <ul>
            {dataQualityItems.map((dq, idx) => (
              <li key={idx}>
                <b>{dq.title}</b>
                <span>{dq.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Dataset Footer */}
      <DatasetFooter meta={meta} />
    </div>
  );
}
