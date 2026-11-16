"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import type { DatasetMeta, EconomyLaborPoint } from "@/lib/types";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";
import {
  getBenchmarkEconomyLaborDataQuality,
  getBenchmarkEconomyLaborSeries,
  getBenchmarkIndicatorStatus,
} from "@/services/data/benchmark-economy-labor";

interface EconomyLaborViewProps {
  series: EconomyLaborPoint[];
  meta: DatasetMeta;
}

type TimeframeOption = "12M" | "18M" | "24M";
type FilterOption = "all" | "growth" | "labor";

const RANGE_MONTHS: Record<TimeframeOption, number> = {
  "12M": 12,
  "18M": 18,
  "24M": 24,
};

const FILTERS: { id: FilterOption; label: string }[] = [
  { id: "all", label: "All sections" },
  { id: "growth", label: "Growth only" },
  { id: "labor", label: "Labor only" },
];

interface SvgLine {
  key: string;
  name: string;
  vals: number[];
  color: string;
  dash?: boolean;
  area?: boolean;
}

interface SvgChartProps {
  lines: SvgLine[];
  labels: string[];
  label: string;
  fmt: (v: number) => string;
  zeroFloor?: boolean;
}

function SvgInteractiveLineChart({
  lines,
  labels,
  label,
  fmt,
  zeroFloor = false,
}: SvgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = labels.length;
  const pl = 56;
  const pr = 8;
  const pt = 8;
  const pb = 24;
  const W = 520;
  const H = 230;

  const allVals = useMemo(
    () => lines.flatMap((l) => l.vals).filter((v) => Number.isFinite(v)),
    [lines]
  );

  const { lo, hi } = useMemo(() => {
    let min = Math.min(...(allVals.length > 0 ? allVals : [0]));
    let max = Math.max(...(allVals.length > 0 ? allVals : [1]));
    const pad = (max - min) * 0.12 || 0.5;
    min = min - pad;
    max = max + pad;
    if (zeroFloor && min > 0) min = 0;
    return { lo: min, hi: max };
  }, [allVals, zeroFloor]);

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

  const mainLine = lines[0];
  const base = H - pb;

  const validMainVals = useMemo(
    () => (mainLine?.vals.filter((v): v is number => v !== null && Number.isFinite(v)) ?? []),
    [mainLine]
  );
  const maxVal = validMainVals.length ? Math.max(...validMainVals) : null;
  const minVal = validMainVals.length ? Math.min(...validMainVals) : null;
  const gradId = useMemo(() => `econ-grad-${label.replace(/\s+/g, "-").toLowerCase()}`, [label]);

  return (
    <div
      ref={containerRef}
      className={`pd-chart ${hoverIdx !== null ? "on" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mainLine?.color ?? "#FFFFFF"} stopOpacity="0.22" />
            <stop offset="60%" stopColor={mainLine?.color ?? "#FFFFFF"} stopOpacity="0.05" />
            <stop offset="100%" stopColor={mainLine?.color ?? "#FFFFFF"} stopOpacity="0.0" />
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
                {fmt(v)}
              </text>
            </g>
          );
        })}

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
              H: {fmt(maxVal)}
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
              L: {fmt(minVal)}
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

        {lines.map((l, li) => {
          const pts = l.vals.map((v, i) => [x(i), y(v)]);
          const d = pts
            .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1))
            .join("");

          return (
            <g key={li}>
              {li === 0 && l.area !== false && (
                <path
                  d={`${d}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`}
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

        {hoverIdx !== null && mainLine && (
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
                <b>{v === null ? "no obs" : fmt(v)}</b>
                {delta !== null && (
                  <span className={`text-[10px] ${delta >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    ({delta >= 0 ? "+" : ""}{fmt(delta)})
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

function SvgNfpBarChart({
  vals,
  labels,
  fmt,
}: {
  vals: number[];
  labels: string[];
  fmt: (v: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = vals.length;
  const pl = 56;
  const pr = 8;
  const pt = 10;
  const pb = 24;
  const W = 520;
  const H = 230;

  const lim =
    Math.max(
      Math.abs(Math.min(...(vals.length ? vals : [-50]))),
      Math.abs(Math.max(...(vals.length ? vals : [100])))
    ) * 1.1;

  const y = (v: number) => pt + (H - pt - pb) * (1 - (v + lim) / (2 * lim || 1));
  const cx = (i: number) => pl + ((W - pl - pr) * (i + 0.5)) / (n || 1);
  const bw = ((W - pl - pr) / (n || 1)) * 0.6;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || n <= 1) return;
    const r = containerRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const scale = W / r.width;
    const scaledPx = px * scale;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((scaledPx - pl) / (W - pl - pr)) * n)));
    setHoverIdx(i);
  };

  return (
    <div
      ref={containerRef}
      className={`pd-chart ${hoverIdx !== null ? "on" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="NFP" preserveAspectRatio="none">
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
                {fmt(t)}
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

        {vals.map((v, i) => {
          const y0 = y(0);
          const y1 = y(v);
          const barY = Math.min(y0, y1);
          const barH = Math.max(1, Math.abs(y1 - y0));
          const isHovered = hoverIdx === i;
          const color = v >= 0 ? "#FFFFFF" : "#EF4444";

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

      {hoverIdx !== null && (
        <div
          className="pd-tip shadow-xl"
          style={{
            left: `${Math.max(0, Math.min(100, ((cx(hoverIdx) - 40) / W) * 100))}%`,
          }}
        >
          <span className="font-semibold text-[#FFFFFF]">{labels[hoverIdx]}</span>
          <b className={vals[hoverIdx] >= 0 ? "text-[#FFFFFF]" : "text-[#EF4444]"}>
            {vals[hoverIdx] >= 0 ? "+" : ""}
            {fmt(vals[hoverIdx])}
          </b>
          {hoverIdx > 0 && (
            <span className={`text-[10px] ${vals[hoverIdx] - vals[hoverIdx - 1] >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              Δ {vals[hoverIdx] - vals[hoverIdx - 1] >= 0 ? "+" : ""}{fmt(vals[hoverIdx] - vals[hoverIdx - 1])}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function EconomyLaborView({
  series: initialSeries,
  meta,
}: EconomyLaborViewProps) {
  const [sectionFilter, setSectionFilter] = useState<FilterOption>("all");
  const [timeframe, setTimeframe] = useState<TimeframeOption>("24M");

  const series = useMemo(() => {
    return initialSeries.length > 0 ? initialSeries : getBenchmarkEconomyLaborSeries();
  }, [initialSeries]);

  const statusRows = useMemo(() => getBenchmarkIndicatorStatus(), []);
  const dataQualityRows = useMemo(() => getBenchmarkEconomyLaborDataQuality(), []);

  const nMonths = RANGE_MONTHS[timeframe];
  const sliced = useMemo(() => {
    return series.slice(-nMonths);
  }, [series, nMonths]);

  const monthLabels = useMemo(() => {
    return sliced.map((p) => p.date);
  }, [sliced]);

  const gdpVals = useMemo(() => sliced.map((p) => p.gdpQoq), [sliced]);
  const nfpVals = useMemo(() => sliced.map((p) => p.nfpK), [sliced]);
  const unrVals = useMemo(() => sliced.map((p) => p.unrate), [sliced]);
  const claimsVals = useMemo(() => sliced.map((p) => p.initialClaimsK), [sliced]);
  const joltsVals = useMemo(() => sliced.map((p) => p.joltsM), [sliced]);

  // Formatters
  const fmtK = (v: number) => Math.round(v) + "K";
  const fmtPct = (v: number) => v.toFixed(1) + "%";
  const fmtM = (v: number) => v.toFixed(2) + "M";

  const observationDate = meta.observationDate || "2026Q3";

  return (
    <div className="cot-container space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Header section */}
      <header className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[30px] font-semibold tracking-tight text-[#FFFFFF] flex flex-wrap items-center gap-3">
            Economy &amp; labor market
            <span className="cot-badge">
              <span className="cot-dot bg-[#22C55E]" />
              Live · {observationDate}
            </span>
          </h1>
          <p className="mt-1.5 text-[14px] text-[#A3A3A3] max-w-[70ch]">
            Growth momentum indicators and labor-market capacity metrics, with feed status for every series.
          </p>
        </div>

        {/* Section filter & Range selector */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="cot-range-bar" role="group" aria-label="Section filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`cot-range-btn ${sectionFilter === f.id ? "active" : ""}`}
                onClick={() => setSectionFilter(f.id)}
                aria-pressed={sectionFilter === f.id}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="cot-range-bar" role="group" aria-label="Range">
            {(["12M", "18M", "24M"] as TimeframeOption[]).map((r) => (
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

      {/* SECTION 1: GROWTH & ECONOMIC ACTIVITY */}
      {(sectionFilter === "all" || sectionFilter === "growth") && (
        <div>
          <div className="pd-sec">
            <h2>Growth &amp; economic activity</h2>
            <span>BEA · ISM · Census</span>
          </div>

          <div className="pd-grid2">
            {/* Real GDP growth */}
            <section className="cot-panel" aria-label="Real GDP growth">
              <div className="pd-ch">
                <h3>
                  Real GDP growth (QoQ ann.) <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">A191RL1Q225SBEA</span>
              </div>
              <div className="pd-big">3.4%</div>
              <div className="pd-delta cot-up">Prior 3.4% · quarterly, shown as a step</div>
              <SvgInteractiveLineChart
                lines={[{ key: "gdp", name: "GDP", vals: gdpVals, color: "#FFFFFF" }]}
                labels={monthLabels}
                label="Real GDP growth"
                fmt={fmtPct}
                zeroFloor={true}
              />
            </section>

            {/* ISM services vs manufacturing PMI */}
            <section className="cot-panel" aria-label="ISM services and manufacturing">
              <div className="pd-ch">
                <h3>
                  ISM services vs manufacturing PMI <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">ISM SVC / MFG</span>
              </div>
              <div className="pd-big">
                0.0 <span className="el-flag">FEED ZERO</span>
              </div>
              <div className="pd-delta cot-down">Mfg 0.0 · 50 = neutral line</div>
              <div className="el-empty">
                <div>
                  <b>No ISM readings loaded</b>
                  <span>Feed returned 0.0 for both series. Run a sync in Data operations before reading this.</span>
                </div>
              </div>
            </section>

            {/* Advance retail sales */}
            <section className="cot-panel" aria-label="Advance retail sales">
              <div className="pd-ch">
                <h3>
                  Advance retail sales (MoM) <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">RSAFS</span>
              </div>
              <div className="pd-big">
                +0.00% <span className="el-flag">FEED ZERO</span>
              </div>
              <div className="pd-delta cot-muted">Prior +0.00%</div>
              <div className="el-empty">
                <div>
                  <b>No retail sales history loaded</b>
                  <span>Month-over-month values are zero; treat as missing.</span>
                </div>
              </div>
            </section>

            {/* Consumer confidence */}
            <section className="cot-panel" aria-label="Consumer confidence">
              <div className="pd-ch">
                <h3>
                  Consumer confidence index <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">CB / UMICH</span>
              </div>
              <div className="pd-big">
                0.0 <span className="el-flag">FEED ZERO</span>
              </div>
              <div className="pd-delta cot-muted">+0.0 m/m</div>
              <div className="el-empty">
                <div>
                  <b>No confidence readings loaded</b>
                  <span>Index and change are both zero.</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* SECTION 2: LABOR MARKET INDICATORS */}
      {(sectionFilter === "all" || sectionFilter === "labor") && (
        <div style={{ marginTop: 44 }}>
          <div className="pd-sec">
            <h2>Labor market indicators</h2>
            <span>BLS · DOL</span>
          </div>

          <div className="pd-grid2">
            {/* Nonfarm payrolls */}
            <section className="cot-panel" aria-label="Nonfarm payrolls">
              <div className="pd-ch">
                <h3>
                  Nonfarm payrolls (monthly Δ) <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">PAYEMS</span>
              </div>
              <div className="pd-big">+165K</div>
              <div className="pd-delta cot-up">
                Prior +165K · LFPR 0.0% <span className="el-flag">LFPR ZERO</span>
              </div>
              <SvgNfpBarChart vals={nfpVals} labels={monthLabels} fmt={fmtK} />
            </section>

            {/* Unemployment rate */}
            <section className="cot-panel" aria-label="Unemployment rate">
              <div className="pd-ch">
                <h3>
                  Unemployment rate (U-3) <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">UNRATE</span>
              </div>
              <div className="pd-big">4.1%</div>
              <div className="pd-delta cot-muted">
                AHE YoY 0.0% <span className="el-flag">AHE ZERO</span>
              </div>
              <SvgInteractiveLineChart
                lines={[{ key: "unr", name: "Unemployment", vals: unrVals, color: "#FFFFFF" }]}
                labels={monthLabels}
                label="Unemployment rate"
                fmt={fmtPct}
              />
              <div className="pd-legend">
                <span style={{ color: "#FFFFFF" }}>
                  <i />Unemployment %
                </span>
                <span style={{ color: "#6B6B6B" }}>
                  <i className="dash" />Avg hourly earnings YoY (not loaded)
                </span>
              </div>
            </section>

            {/* Initial jobless claims */}
            <section className="cot-panel" aria-label="Initial jobless claims">
              <div className="pd-ch">
                <h3>
                  Initial jobless claims <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">ICSA</span>
              </div>
              <div className="pd-big">200K</div>
              <div className="pd-delta cot-up">
                Continuing claims 0.00M <span className="el-flag">CONT ZERO</span>
              </div>
              <SvgInteractiveLineChart
                lines={[{ key: "claims", name: "Claims", vals: claimsVals, color: "#FFFFFF" }]}
                labels={monthLabels}
                label="Initial jobless claims"
                fmt={fmtK}
                zeroFloor={true}
              />
            </section>

            {/* JOLTS job openings */}
            <section className="cot-panel" aria-label="JOLTS job openings">
              <div className="pd-ch">
                <h3>
                  JOLTS job openings <span className="pd-info">i</span>
                </h3>
                <span className="pd-code">JTSJOL</span>
              </div>
              <div className="pd-big">7.52M</div>
              <div className="pd-delta cot-muted">
                +0.00M m/m <span className="el-flag">M/M ZERO</span>
              </div>
              <SvgInteractiveLineChart
                lines={[{ key: "jolts", name: "Openings", vals: joltsVals, color: "#FFFFFF" }]}
                labels={monthLabels}
                label="JOLTS job openings"
                fmt={fmtM}
              />
            </section>
          </div>
        </div>
      )}

      {/* SECTION 3: INDICATOR STATUS */}
      <div style={{ marginTop: 44 }}>
        <div className="pd-sec">
          <h2>Indicator status</h2>
          <span>Every series on this page, with feed state</span>
        </div>

        <div className="pd-table-wrap">
          <table className="pd-tbl" aria-label="Indicator status">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Series</th>
                <th className="n">Latest</th>
                <th className="n">Prior</th>
                <th>Source</th>
                <th>Obs</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.map((s, idx) => (
                <tr key={idx}>
                  <td>{s.indicator}</td>
                  <td className="text-[12px] text-[#A3A3A3] font-mono-num">{s.series}</td>
                  <td className="n num">{s.latest}</td>
                  <td className="n num text-[#6B6B6B]">{s.prior}</td>
                  <td className="text-[12px] text-[#A3A3A3]">{s.source}</td>
                  <td className="text-[12px] text-[#6B6B6B] font-mono-num">{s.obs}</td>
                  <td>
                    <span
                      className={`pd-pill ${
                        s.tone === "ok" ? "text-[#22C55E] border-[rgba(34,197,94,0.45)]" : "text-[#EF4444] border-[rgba(239,68,68,0.45)]"
                      }`}
                    >
                      {s.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 4: DATA QUALITY & RECONCILIATION */}
      <div style={{ marginTop: 44 }}>
        <div className="pd-sec">
          <h2>Data quality &amp; reconciliation</h2>
          <span>Read before using the numbers</span>
        </div>

        <section className="cot-panel inf-dq" aria-label="Data quality">
          <ul>
            {dataQualityRows.map((dq, idx) => (
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
