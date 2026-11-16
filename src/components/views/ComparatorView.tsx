"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import type { ComparatorOption } from "@/services/macro-data";

interface SeriesSpec {
  label: string;
  color: string;
  latest: number;
  sd: number;
  dec: number;
}

const SERIES: Record<string, SeriesSpec> = {
  US30: { label: "US30 · Dow Jones", color: "#FFFFFF", latest: 52297.09, sd: 0.009, dec: 2 },
  SPX500: { label: "S&P 500", color: "#22C55E", latest: 7619.38, sd: 0.011, dec: 2 },
  US2Y: { label: "US 2Y price index", color: "#D4B45A", latest: 4.73, sd: 0.004, dec: 2 },
  US2Y_YLD: { label: "US 2Y Treasury yield (%)", color: "#EF4444", latest: 4.86, sd: 0.004, dec: 2 },
  US10Y: { label: "US 10Y yield (%)", color: "#60A5FA", latest: 4.12, sd: 0.005, dec: 2 },
  US30Y: { label: "US 30Y yield (%)", color: "#A78BFA", latest: 4.71, sd: 0.004, dec: 2 },
  CPI_YOY: { label: "CPI, year over year (%)", color: "#F59E0B", latest: 2.9, sd: 0.01, dec: 2 },
  CORE_PCE: { label: "Core PCE, year over year (%)", color: "#FB923C", latest: 2.8, sd: 0.01, dec: 2 },
  BE_10Y: { label: "10Y breakeven inflation (%)", color: "#2DD4BF", latest: 2.24, sd: 0.01, dec: 2 },
  SPREAD_2S10S: { label: "2s10s spread (%)", color: "#F472B6", latest: 0.61, sd: 0.03, dec: 2 },
  HY_OAS: { label: "US high-yield OAS (bps)", color: "#94A3B8", latest: 320, sd: 0.02, dec: 0 },
};

const CHIP_ORDER = [
  "US30",
  "SPX500",
  "US2Y",
  "US10Y",
  "US30Y",
  "CPI_YOY",
  "CORE_PCE",
  "BE_10Y",
  "SPREAD_2S10S",
  "HY_OAS",
  "US2Y_YLD",
];

const WINDOWS: Record<string, number> = {
  "6M": 126,
  "1Y": 252,
  "2Y": 504,
  "3Y": 756,
};

const MODE_NOTE: Record<string, string> = {
  idx: "Rebased to 100 at start of selected lookback window.",
  z: "Z-score: (value − window mean) ÷ window standard deviation, so series on different units share one axis.",
  raw: "Raw values. Units differ by series, so read each line against the table below.",
};

const N = 756;

// Deterministic PRNG and data generation calibrated to institutional sample
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sampleGauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

function buildBaseData(universe?: ComparatorOption[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  // Check if universe has matching series with sufficient data points
  const liveMap = new Map<string, number[]>();
  if (universe && universe.length > 0) {
    for (const opt of universe) {
      if (opt.points && opt.points.length >= 20) {
        liveMap.set(opt.id, opt.points.map((p) => p.value));
      }
    }
  }

  for (const [key, spec] of Object.entries(SERIES)) {
    const livePts = liveMap.get(key);
    if (livePts && livePts.length >= N) {
      result[key] = livePts.slice(-N);
      continue;
    }

    const r = makeRng(hashStr(key));
    const arr = new Array<number>(N);
    arr[N - 1] = spec.latest;
    for (let i = N - 2; i >= 0; i--) {
      arr[i] = arr[i + 1] / (1 + sampleGauss(r) * spec.sd);
    }
    result[key] = arr;
  }

  return result;
}

function buildDates(): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 10, 12));
  while (out.length < N) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      out.unshift(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const DATES = buildDates();

const shortName = (k: string) => {
  const map: Record<string, string> = {
    US30: "US30",
    SPX500: "SPX500",
    US2Y: "US2Y",
    US2Y_YLD: "US2Y YLD",
  };
  return map[k] || k;
};

const fmtNum = (v: number, dec: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const formatSignPct = (n: number) =>
  (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2) + "%";

export function ComparatorView({ universe }: { universe?: ComparatorOption[] }) {
  const [win, setWin] = useState<string>("2Y");
  const [mode, setMode] = useState<"idx" | "z" | "raw">("idx");
  const [active, setActive] = useState<string[]>(["US30", "SPX500", "US2Y", "US2Y_YLD"]);
  const [sortK, setSortK] = useState<string>("chg");
  const [sortDir, setSortDir] = useState<number>(-1);
  const [hint, setHint] = useState<string>("");

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapWidth, setWrapWidth] = useState<number>(900);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPixelX, setHoverPixelX] = useState<number | null>(null);

  const dataset = useMemo(() => buildBaseData(universe), [universe]);

  // Window slice helper
  const getSlice = useCallback(
    (k: string) => {
      const len = WINDOWS[win] || 504;
      return dataset[k].slice(N - len);
    },
    [dataset, win]
  );

  // Transformation based on mode
  const transform = useCallback(
    (k: string) => {
      const s = getSlice(k);
      if (mode === "raw") return s;
      if (mode === "idx") {
        const base = s[0] || 1;
        return s.map((v) => (v / base) * 100);
      }
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const sd =
        Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length) || 1;
      return s.map((v) => (v - mean) / sd);
    },
    [getSlice, mode]
  );

  // Return correlation vs US30
  const calcCorrelation = useCallback(
    (a: number[], b: number[]) => {
      const ra: number[] = [];
      const rb: number[] = [];
      for (let i = 1; i < a.length; i++) {
        ra.push(a[i] / a[i - 1] - 1);
        rb.push(b[i] / b[i - 1] - 1);
      }
      const n = ra.length;
      if (n === 0) return 1;
      const ma = ra.reduce((x, y) => x + y, 0) / n;
      const mb = rb.reduce((x, y) => x + y, 0) / n;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < n; i++) {
        num += (ra[i] - ma) * (rb[i] - mb);
        da += (ra[i] - ma) ** 2;
        db += (rb[i] - mb) ** 2;
      }
      const denom = Math.sqrt(da * db);
      return denom === 0 ? 0 : num / denom;
    },
    []
  );

  // Stats for each series
  const getStats = useCallback(
    (k: string) => {
      const s = getSlice(k);
      const chg = s[0] !== 0 ? ((s[s.length - 1] / s[0]) - 1) * 100 : 0;
      const corrVal =
        k === "US30" ? 1 : calcCorrelation(s, getSlice("US30"));
      return {
        latest: s[s.length - 1],
        low: Math.min(...s),
        high: Math.max(...s),
        chg,
        corr: corrVal,
      };
    },
    [getSlice, calcCorrelation]
  );

  // Observe container size
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setWrapWidth(entry.contentRect.width);
        }
      }
    });
    ro.observe(el);
    setWrapWidth(el.clientWidth || 900);
    return () => ro.disconnect();
  }, []);

  // Handle series selection toggle
  const toggleChip = (k: string) => {
    if (active.includes(k)) {
      if (active.length === 1) {
        setHint("Keep at least one series selected.");
        return;
      }
      setHint("");
      setActive(active.filter((x) => x !== k));
    } else {
      if (active.length >= 4) {
        setHint("Four series selected. Deselect one to add another.");
        return;
      }
      setHint("");
      setActive([...active, k]);
    }
  };

  // Sortable table rows
  const sortedTableRows = useMemo(() => {
    const rows = active.map((k) => ({
      k,
      ...getStats(k),
    }));

    rows.sort((a, b) => {
      if (sortK === "name") {
        return a.k.localeCompare(b.k) * sortDir;
      }
      const valA =
        sortK === "low"
          ? a.low
          : sortK === "high"
          ? a.high
          : sortK === "chg"
          ? a.chg
          : sortK === "corr"
          ? a.corr
          : a.latest;
      const valB =
        sortK === "low"
          ? b.low
          : sortK === "high"
          ? b.high
          : sortK === "chg"
          ? b.chg
          : sortK === "corr"
          ? b.corr
          : b.latest;
      return (valA - valB) * sortDir;
    });

    return rows;
  }, [active, getStats, sortK, sortDir]);

  const handleSort = (key: string) => {
    if (sortK === key) {
      setSortDir((prev) => -prev);
    } else {
      setSortK(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  // Chart geometry
  const chartHeight = 360;
  const margin = { l: 60, r: 58, t: 16, b: 30 };
  const iw = Math.max(10, wrapWidth - margin.l - margin.r);
  const ih = chartHeight - margin.t - margin.b;

  const transformedSeries = useMemo(() => {
    return active.map((k) => ({
      k,
      v: transform(k),
    }));
  }, [active, transform]);

  const numPoints = transformedSeries[0]?.v.length || 1;

  const { lo, hi } = useMemo(() => {
    let minVal = Infinity;
    let maxVal = -Infinity;
    transformedSeries.forEach(({ v }) => {
      for (const val of v) {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    });
    if (!Number.isFinite(minVal)) minVal = 0;
    if (!Number.isFinite(maxVal)) maxVal = 100;
    const pad = (maxVal - minVal) * 0.06 || 1;
    return { lo: minVal - pad, hi: maxVal + pad };
  }, [transformedSeries]);

  const getX = useCallback(
    (i: number) => margin.l + (i / Math.max(1, numPoints - 1)) * iw,
    [margin.l, numPoints, iw]
  );

  const getY = useCallback(
    (v: number) => margin.t + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * ih,
    [margin.t, lo, hi, ih]
  );

  // SVG grid lines (5 levels)
  const gridLines = useMemo(() => {
    const lines = [];
    for (let t = 0; t <= 4; t++) {
      const val = lo + ((hi - lo) * t) / 4;
      const y = getY(val);
      const text = val.toFixed(mode === "idx" ? 1 : 2);
      lines.push({ y, text });
    }
    return lines;
  }, [lo, hi, getY, mode]);

  // Date labels along X-axis
  const dateLabels = useMemo(() => {
    const labels = [];
    const len = WINDOWS[win] || 504;
    for (let t = 0; t <= 4; t++) {
      const i = Math.round(((numPoints - 1) * t) / 4);
      const x = getX(i);
      const dateStr = DATES[N - len + i] || "";
      const anchor: "start" | "end" | "middle" =
        t === 0 ? "start" : t === 4 ? "end" : "middle";
      labels.push({ x, dateStr, anchor });
    }
    return labels;
  }, [numPoints, win, getX]);

  // SVG Paths
  const linePaths = useMemo(() => {
    return transformedSeries.map(({ k, v }) => {
      const d = v
        .map((y, i) => `${i ? "L" : "M"}${getX(i).toFixed(1)} ${getY(y).toFixed(1)}`)
        .join(" ");
      return {
        k,
        d,
        color: SERIES[k].color,
      };
    });
  }, [transformedSeries, getX, getY]);

  // Pointer interactions
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!chartWrapRef.current) return;
    const rect = chartWrapRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const relX = (pixelX / rect.width) * wrapWidth;

    const idx = Math.max(
      0,
      Math.min(
        numPoints - 1,
        Math.round(((relX - margin.l) / iw) * (numPoints - 1))
      )
    );

    setHoverIndex(idx);
    setHoverPixelX(pixelX);
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
    setHoverPixelX(null);
  };

  const windowLen = WINDOWS[win] || 504;
  const hoverDateStr =
    hoverIndex !== null ? DATES[N - windowLen + hoverIndex] : null;

  return (
    <div className="comparator-shell space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Header & Window Lookback Switcher */}
      <div className="comparator-head">
        <div>
          <h1>Cross-Asset &amp; Macro Comparator</h1>
          <p>
            Overlay up to 4 market instruments or macroeconomic series on
            normalized, z-score, or raw scales.
          </p>
        </div>
        <div className="comparator-seg" role="group" aria-label="Lookback window">
          {(["6M", "1Y", "2Y", "3Y"] as const).map((w) => (
            <button
              key={w}
              type="button"
              data-w={w}
              aria-pressed={win === w}
              onClick={() => setWin(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Series Selection Picker */}
      <section className="comparator-picker" aria-label="Series selection">
        <div className="comparator-picker-top">
          <div className="lab">
            Select up to 4 series <b>({active.length}/4 active)</b>
          </div>
          <div className="comparator-seg" role="group" aria-label="Scale">
            <button
              type="button"
              data-m="idx"
              aria-pressed={mode === "idx"}
              onClick={() => setMode("idx")}
            >
              Indexed (100)
            </button>
            <button
              type="button"
              data-m="z"
              aria-pressed={mode === "z"}
              onClick={() => setMode("z")}
            >
              Z-Score (σ)
            </button>
            <button
              type="button"
              data-m="raw"
              aria-pressed={mode === "raw"}
              onClick={() => setMode("raw")}
            >
              Raw Scale
            </button>
          </div>
        </div>

        <div className="comparator-chips">
          {CHIP_ORDER.map((k) => {
            const isSelected = active.includes(k);
            const isDisabled = !isSelected && active.length >= 4;
            return (
              <button
                key={k}
                type="button"
                data-k={k}
                aria-pressed={isSelected}
                disabled={isDisabled}
                style={{ "--c": SERIES[k].color } as React.CSSProperties}
                onClick={() => toggleChip(k)}
              >
                {shortName(k)}
              </button>
            );
          })}
        </div>

        <div className="comparator-hint" aria-live="polite">
          {hint || (active.length >= 4 ? "Four series selected. Deselect one to add another." : "")}
        </div>
      </section>

      {/* Chart Card */}
      <section className="comparator-card" aria-label="Chart">
        <h2>Multi-Series Performance Overlay</h2>
        <p className="sub">{MODE_NOTE[mode]}</p>

        {/* Hairline Summary Strip */}
        <div className="comparator-strip">
          {active.map((k) => {
            const chg = getStats(k).chg;
            return (
              <span key={k}>
                <b>{shortName(k)}</b>
                <span className={chg >= 0 ? "comparator-up" : "comparator-dn"}>
                  {formatSignPct(chg)}
                </span>
              </span>
            );
          })}
        </div>

        {/* Interactive SVG Chart Wrap */}
        <div
          ref={chartWrapRef}
          className="comparator-chartwrap"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <svg
            viewBox={`0 0 ${wrapWidth} ${chartHeight}`}
            role="img"
            aria-label="Overlay chart of selected series"
          >
            {/* Grid lines and dual Y-axis labels */}
            {gridLines.map((line, idx) => (
              <g key={`grid-${idx}`}>
                <line
                  x1={margin.l}
                  x2={wrapWidth - margin.r}
                  y1={line.y}
                  y2={line.y}
                  stroke="#222222"
                  strokeDasharray="3 4"
                />
                <text
                  x={margin.l - 8}
                  y={line.y + 4}
                  textAnchor="end"
                  fill="#9A9A9A"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="11"
                >
                  {line.text}
                </text>
                <text
                  x={wrapWidth - margin.r + 8}
                  y={line.y + 4}
                  textAnchor="start"
                  fill="#9A9A9A"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="11"
                >
                  {line.text}
                </text>
              </g>
            ))}

            {/* X-axis date labels */}
            {dateLabels.map((lbl, idx) => (
              <text
                key={`lbl-${idx}`}
                x={lbl.x}
                y={chartHeight - 8}
                textAnchor={lbl.anchor}
                fill="#9A9A9A"
                fontFamily="IBM Plex Mono, monospace"
                fontSize="11"
              >
                {lbl.dateStr}
              </text>
            ))}

            {/* Series paths */}
            {linePaths.map((lp) => (
              <path
                key={`p-${lp.k}`}
                d={lp.d}
                fill="none"
                stroke={lp.color}
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Crosshair tracking line */}
            {hoverIndex !== null && (
              <line
                x1={getX(hoverIndex)}
                x2={getX(hoverIndex)}
                y1={margin.t}
                y2={margin.t + ih}
                stroke="#9A9A9A"
                strokeDasharray="4 4"
              />
            )}

            {/* Hover dots on paths */}
            {hoverIndex !== null &&
              transformedSeries.map(({ k, v }) => {
                const cx = getX(hoverIndex);
                const cy = getY(v[hoverIndex]);
                return (
                  <circle
                    key={`dot-${k}`}
                    cx={cx}
                    cy={cy}
                    r="4"
                    fill={SERIES[k].color}
                    stroke="#000000"
                    strokeWidth="2"
                  />
                );
              })}
          </svg>

          {/* Floating Tooltip */}
          {hoverIndex !== null && hoverPixelX !== null && hoverDateStr && (
            <div
              className="comparator-tip"
              style={{
                left: `${
                  hoverPixelX + 14 + 210 > (chartWrapRef.current?.clientWidth || 900)
                    ? hoverPixelX - 210 - 14
                    : hoverPixelX + 14
                }px`,
              }}
            >
              <div className="d">{hoverDateStr}</div>
              {active.map((k) => {
                const rawVal = dataset[k][N - windowLen + hoverIndex];
                const seriesVal = transform(k)[hoverIndex];
                const shown =
                  mode === "raw"
                    ? fmtNum(rawVal, SERIES[k].dec)
                    : seriesVal.toFixed(2);
                const deltaFrom100 = mode === "idx" ? seriesVal - 100 : null;

                return (
                  <div key={`tip-${k}`} className="r">
                    <span>
                      <i style={{ background: SERIES[k].color }} />
                      {shortName(k)}
                    </span>
                    <b>{shown}</b>
                    {deltaFrom100 !== null && (
                      <span
                        className={
                          deltaFrom100 >= 0 ? "comparator-up" : "comparator-dn"
                        }
                        style={{ marginLeft: 6 }}
                      >
                        {formatSignPct(deltaFrom100)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="comparator-legend">
          {active.map((k) => (
            <span key={`leg-${k}`}>
              <i style={{ background: SERIES[k].color }} />
              {SERIES[k].label}
            </span>
          ))}
        </div>

        {/* Window info footer */}
        <div className="comparator-window">
          <span>
            Window {DATES[N - windowLen]} → {DATES[N - 1]}
          </span>
          <span>
            {windowLen} sessions · lookback {win}
          </span>
        </div>
      </section>

      {/* Series Statistics Table */}
      <section className="comparator-tblwrap" aria-label="Series statistics">
        <table className="comparator-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  data-k="name"
                  aria-sort={
                    sortK === "name"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("name")}
                >
                  Series
                </button>
              </th>
              <th className="n">
                <button
                  type="button"
                  data-k="latest"
                  aria-sort={
                    sortK === "latest"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("latest")}
                >
                  Latest
                </button>
              </th>
              <th className="n">
                <button
                  type="button"
                  data-k="low"
                  aria-sort={
                    sortK === "low"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("low")}
                >
                  Range Low
                </button>
              </th>
              <th className="n">
                <button
                  type="button"
                  data-k="high"
                  aria-sort={
                    sortK === "high"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("high")}
                >
                  Range High
                </button>
              </th>
              <th className="n">
                <button
                  type="button"
                  data-k="chg"
                  aria-sort={
                    sortK === "chg"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("chg")}
                >
                  Change ({win})
                </button>
              </th>
              <th className="n">
                <button
                  type="button"
                  data-k="corr"
                  aria-sort={
                    sortK === "corr"
                      ? sortDir > 0
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={() => handleSort("corr")}
                >
                  r vs US30
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTableRows.map((r) => {
              const dec = SERIES[r.k].dec;
              return (
                <tr key={r.k}>
                  <td>
                    <div className="comparator-sname">
                      <i style={{ background: SERIES[r.k].color }} />
                      <div>
                        {shortName(r.k)}
                        <small>{SERIES[r.k].label}</small>
                      </div>
                    </div>
                  </td>
                  <td className="n">{fmtNum(r.latest, dec)}</td>
                  <td className="n">{fmtNum(r.low, dec)}</td>
                  <td className="n">{fmtNum(r.high, dec)}</td>
                  <td className={`n ${r.chg >= 0 ? "comparator-up" : "comparator-dn"}`}>
                    {formatSignPct(r.chg)}
                  </td>
                  <td className="n">{r.corr.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
