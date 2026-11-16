"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import type {
  DatasetMeta,
  DealerMaturityBucket,
  LiquiditySeriesPoint,
  TreasuryAuctionRow,
} from "@/lib/types";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface PrimaryDealerViewProps {
  buckets: DealerMaturityBucket[];
  auctions: TreasuryAuctionRow[];
  liquiditySeries: LiquiditySeriesPoint[];
  meta: DatasetMeta;
}

type TimeframeOption = "13W" | "26W" | "52W";

const RANGE_COUNTS: Record<TimeframeOption, number> = {
  "13W": 13,
  "26W": 26,
  "52W": 52,
};

type SortKey = "date" | "tenor" | "size" | "yield" | "tail" | "btc" | "ind";

interface SvgChartLine {
  key: string;
  name?: string;
  vals: number[];
  color: string;
  dash?: boolean;
}

interface SvgChartProps {
  lines: SvgChartLine[];
  labels: string[];
  fmt: (v: number) => string;
  zero?: boolean;
  label: string;
}

function SvgInteractiveChart({
  lines,
  labels,
  fmt,
  zero = false,
  label,
}: SvgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = labels.length;
  const pl = 56;
  const pr = 8;
  const pt = 8;
  const pb = 24;
  const W = 520;
  const H = 220;

  const allVals = useMemo(() => lines.flatMap((l) => l.vals), [lines]);
  const { lo, hi } = useMemo(() => {
    let min = Math.min(...allVals);
    let max = Math.max(...allVals);
    const pad = (max - min) * 0.12 || 1;
    min = zero ? 0 : min - pad;
    max = max + pad;
    return { lo: min, hi: max };
  }, [allVals, zero]);

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
    () => (mainLine?.vals.filter((v): v is number => Number.isFinite(v)) ?? []),
    [mainLine]
  );
  const maxVal = validMainVals.length ? Math.max(...validMainVals) : null;
  const minVal = validMainVals.length ? Math.min(...validMainVals) : null;
  const gradId = useMemo(() => `pd-grad-${label.replace(/\s+/g, "-").toLowerCase()}`, [label]);

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
              <text
                className="pd-ax"
                x={pl - 8}
                y={yy + 4}
                textAnchor="end"
              >
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

        {/* Plot curves */}
        {lines.map((l, li) => {
          const pts = l.vals.map((v, i) => [x(i), y(v)]);
          const d = pts
            .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1))
            .join("");

          return (
            <g key={li}>
              {li === 0 && (
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

        {/* Hover crosshair guide & dot */}
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
              cy={y(mainLine.vals[hoverIdx])}
              fill={mainLine.color}
              stroke="#000000"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && mainLine && (
        <div
          className="pd-tip shadow-xl"
          style={{
            left: `${Math.max(
              0,
              Math.min(
                100,
                ((x(hoverIdx) - 40) / W) * 100
              )
            )}%`,
          }}
        >
          <span className="font-semibold text-[#FFFFFF]">{labels[hoverIdx]}</span>
          {lines.map((l, li) => {
            const v = l.vals[hoverIdx];
            const prevV = hoverIdx > 0 ? l.vals[hoverIdx - 1] : null;
            const delta = v !== null && prevV !== null ? v - prevV : null;
            return (
              <span key={li} className="flex items-center gap-2" style={{ color: l.color }}>
                <span>{l.name ?? l.key}:</span>
                <b>{fmt(v)}</b>
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

export function PrimaryDealerView({
  buckets,
  auctions,
  liquiditySeries,
  meta,
}: PrimaryDealerViewProps) {
  const [timeframe, setTimeframe] = useState<TimeframeOption>("52W");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "date",
    dir: -1,
  });

  const slicedSeries = useMemo(() => {
    const count = RANGE_COUNTS[timeframe];
    return liquiditySeries.slice(-count);
  }, [liquiditySeries, timeframe]);

  const labels = useMemo(() => {
    return slicedSeries.map((p) => p.date);
  }, [slicedSeries]);

  const latest = liquiditySeries[liquiditySeries.length - 1];
  const monthAgo =
    liquiditySeries[Math.max(0, liquiditySeries.length - 5)];

  // US Net Liquidity: WALCL - TGA - RRP ($B)
  const nlVals = useMemo(
    () => slicedSeries.map((p) => p.netLiquidityTn * 1000),
    [slicedSeries]
  );
  // Fed Assets: WALCL ($B)
  const taVals = useMemo(
    () => slicedSeries.map((p) => p.fedAssetsTn * 1000),
    [slicedSeries]
  );
  // RRP: RRPONTSYD ($B)
  const rrpVals = useMemo(
    () => slicedSeries.map((p) => p.rrpBn),
    [slicedSeries]
  );
  // SOFR & IORB (%)
  const sofrVals = useMemo(
    () => slicedSeries.map((p) => p.sofr),
    [slicedSeries]
  );
  const iorbVals = useMemo(
    () => slicedSeries.map((p) => p.iorb),
    [slicedSeries]
  );

  // Top metric numbers & 1M deltas
  const latestNlTn = latest?.netLiquidityTn ?? 5.85;
  const monthAgoNlTn = monthAgo?.netLiquidityTn ?? 5.88;
  const dNlB = Math.round((latestNlTn - monthAgoNlTn) * 1000);

  const latestSofr = latest?.sofr ?? 3.94;
  const latestIorb = latest?.iorb ?? 3.9;
  const sofrSpreadBps = Math.round((latestSofr - latestIorb) * 100);

  const latestTaTn = latest?.fedAssetsTn ?? 6.76;
  const monthAgoTaTn = monthAgo?.fedAssetsTn ?? 6.716;
  const dTaB = Math.round((latestTaTn - monthAgoTaTn) * 1000);

  const latestRrpBn = latest?.rrpBn ?? 0;
  const monthAgoRrpBn = monthAgo?.rrpBn ?? 0;
  const dRrpB = Math.round(latestRrpBn - monthAgoRrpBn);

  // Formatters
  const fmtTn = (v: number) => "$" + (v / 1000).toFixed(2) + "T";
  const fmtBn = (v: number) => "$" + Math.round(v).toLocaleString("en-US") + "B";
  const fmtRrp = (v: number) => "$" + v.toFixed(0) + "B";
  const fmtPct = (v: number) => v.toFixed(2) + "%";

  // Auction sorting
  const sortedAuctions = useMemo(() => {
    return [...auctions].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;

      switch (sort.key) {
        case "date":
          va = a.date;
          vb = b.date;
          break;
        case "tenor":
          va = a.tenor;
          vb = b.tenor;
          break;
        case "size":
          va = a.sizeBn;
          vb = b.sizeBn;
          break;
        case "yield":
          va = a.highYield;
          vb = b.highYield;
          break;
        case "tail":
          va = a.tailBps;
          vb = b.tailBps;
          break;
        case "btc":
          va = a.bidToCover;
          vb = b.bidToCover;
          break;
        case "ind":
          va = a.indirectPct;
          vb = b.indirectPct;
          break;
      }

      if (va > vb) return sort.dir;
      if (va < vb) return -sort.dir;
      return 0;
    });
  }, [auctions, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: (prev.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }
    );
  };

  const getSortArrow = (key: SortKey) => {
    if (sort.key !== key) return "⇅";
    return sort.dir > 0 ? "↑" : "↓";
  };

  const observationDate = meta.observationDate || "2026-11-11";

  return (
    <div className="cot-container space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Header section */}
      <header className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[30px] font-semibold tracking-tight text-[#FFFFFF] flex flex-wrap items-center gap-3">
            Primary dealer stats &amp; liquidity
            <span className="cot-badge">
              <span className="cot-dot bg-[#22C55E]" />
              Live · {observationDate}
            </span>
          </h1>
          <p className="mt-1.5 text-[14px] text-[#A3A3A3] max-w-[70ch]">
            Dealer Treasury inventories, Fed balance sheet drains, repo funding corridor, and Treasury auction clears.
          </p>
        </div>

        {/* Range Selector */}
        <div className="cot-range-bar" role="group" aria-label="Range">
          {(["13W", "26W", "52W"] as TimeframeOption[]).map((r) => (
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
      </header>

      {/* 2x2 Grid of Key Liquidity & Rates Panels */}
      <div className="pd-grid2">
        {/* Panel 1: US net liquidity */}
        <section className="cot-panel" aria-label="US net liquidity">
          <div className="pd-ch">
            <h3>
              US net liquidity <span className="pd-info">i</span>
            </h3>
            <span className="pd-code">WALCL−TGA−RRP</span>
          </div>
          <div className="pd-big">${latestNlTn.toFixed(2)}T</div>
          <div className={`pd-delta ${dNlB >= 0 ? "cot-up" : "cot-down"}`}>
            {dNlB >= 0 ? "+" : "−"}${Math.abs(dNlB)}B · 1M
          </div>
          <SvgInteractiveChart
            lines={[
              { key: "nl", vals: nlVals, color: "#EF4444" },
              { key: "ta", vals: taVals, color: "#A3A3A3", dash: true },
            ]}
            labels={labels}
            fmt={fmtTn}
            label="US net liquidity"
          />
          <div className="pd-legend">
            <span style={{ color: "#EF4444" }}>
              <i />Net liquidity
            </span>
            <span style={{ color: "#A3A3A3" }}>
              <i className="dash" />Fed assets
            </span>
          </div>
        </section>

        {/* Panel 2: SOFR and IORB */}
        <section className="cot-panel" aria-label="SOFR and IORB">
          <div className="pd-ch">
            <h3>
              Secured Overnight Financing Rate <span className="pd-info">i</span>
            </h3>
            <span className="pd-code">SOFR · IORB</span>
          </div>
          <div className="pd-big">{latestSofr.toFixed(2)}%</div>
          <div className={`pd-delta ${sofrSpreadBps >= 0 ? "cot-down" : "cot-up"}`}>
            {sofrSpreadBps >= 0 ? "+" : "−"}{Math.abs(sofrSpreadBps)} bps vs IORB
          </div>
          <SvgInteractiveChart
            lines={[
              { key: "sofr", vals: sofrVals, color: "#EF4444" },
              { key: "iorb", vals: iorbVals, color: "#A3A3A3", dash: true },
            ]}
            labels={labels}
            fmt={fmtPct}
            label="SOFR and IORB"
          />
          <div className="pd-legend">
            <span style={{ color: "#EF4444" }}>
              <i />SOFR
            </span>
            <span style={{ color: "#A3A3A3" }}>
              <i className="dash" />IORB
            </span>
          </div>
        </section>

        {/* Panel 3: Fed balance sheet assets */}
        <section className="cot-panel" aria-label="Fed balance sheet assets">
          <div className="pd-ch">
            <h3>
              Fed balance sheet assets <span className="pd-info">i</span>
            </h3>
            <span className="pd-code">WALCL</span>
          </div>
          <div className="pd-big">${latestTaTn.toFixed(2)}T</div>
          <div className={`pd-delta ${dTaB >= 0 ? "cot-up" : "cot-down"}`}>
            {dTaB >= 0 ? "+" : "−"}${Math.abs(dTaB)}B · 1M
          </div>
          <SvgInteractiveChart
            lines={[{ key: "ta", vals: taVals, color: "#FFFFFF" }]}
            labels={labels}
            fmt={fmtBn}
            label="Fed balance sheet assets"
          />
        </section>

        {/* Panel 4: ON reverse repo facility */}
        <section className="cot-panel" aria-label="ON reverse repo facility">
          <div className="pd-ch">
            <h3>
              ON reverse repo facility <span className="pd-info">i</span>
            </h3>
            <span className="pd-code">RRPONTSYD</span>
          </div>
          <div className="pd-big">${latestRrpBn.toFixed(0)}B</div>
          <div className={`pd-delta ${dRrpB >= 0 ? "cot-up" : "cot-down"}`}>
            {dRrpB >= 0 ? "+" : "−"}${Math.abs(dRrpB)}B · 1M
          </div>
          <SvgInteractiveChart
            lines={[{ key: "rrp", vals: rrpVals, color: "#EF4444" }]}
            labels={labels}
            fmt={fmtRrp}
            zero={true}
            label="ON reverse repo facility"
          />
        </section>
      </div>

      {/* Section: Primary Dealer Holdings */}
      <div>
        <div className="pd-sec">
          <h2>Primary dealer holdings</h2>
          <span>NY Fed FR 2004</span>
        </div>

        {buckets.length > 0 ? (
          <div className="pd-table-wrap">
            <table className="pd-tbl" aria-label="Dealer maturity buckets">
              <thead>
                <tr>
                  <th><button type="button">Bucket</button></th>
                  <th className="n"><button type="button">Net Position ($B)</button></th>
                  <th className="n"><button type="button">Weekly Change ($B)</button></th>
                  <th className="n"><button type="button">Purchases ($B)</button></th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td><span className="pd-pill">{b.bucket}</span></td>
                    <td className="n num">${b.netPositionBn.toFixed(1)}B</td>
                    <td className={`n num ${b.weeklyChangeBn >= 0 ? "cot-up" : "cot-down"}`}>
                      {b.weeklyChangeBn >= 0 ? "+" : ""}${b.weeklyChangeBn.toFixed(1)}B
                    </td>
                    <td className="n num">${b.purchasesBn.toFixed(1)}B</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <section className="cot-panel pd-empty" aria-label="Primary dealer holdings">
            <span className="ico" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              >
                <path d="M3 13l3-8h12l3 8v6H3z" />
                <path d="M3 13h5l1 2h6l1-2h5" />
              </svg>
            </span>
            <h3>Dealer holdings not synced yet</h3>
            <p>
              NY Fed FR 2004 holdings are not available in the connected feeds. Treasury auction clears remain available below.
            </p>
          </section>
        )}
      </div>

      {/* Section: Recent US Treasury auctions */}
      <div>
        <div className="pd-sec">
          <h2>Recent US Treasury auctions</h2>
          <span>Tail &lt; 0 = stop-through</span>
        </div>

        <div className="pd-table-wrap">
          <table className="pd-tbl" aria-label="Recent US Treasury auctions">
            <thead>
              <tr>
                <th aria-sort={sort.key === "date" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("date")}
                  >
                    Auction date
                    <span className="pd-arrows">{getSortArrow("date")}</span>
                  </button>
                </th>
                <th aria-sort={sort.key === "tenor" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("tenor")}
                  >
                    Tenor
                    <span className="pd-arrows">{getSortArrow("tenor")}</span>
                  </button>
                </th>
                <th className="n" aria-sort={sort.key === "size" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("size")}
                  >
                    Size ($B)
                    <span className="pd-arrows">{getSortArrow("size")}</span>
                  </button>
                </th>
                <th className="n" aria-sort={sort.key === "yield" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("yield")}
                  >
                    High yield
                    <span className="pd-arrows">{getSortArrow("yield")}</span>
                  </button>
                </th>
                <th className="n" aria-sort={sort.key === "tail" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("tail")}
                  >
                    Tail / stop
                    <span className="pd-arrows">{getSortArrow("tail")}</span>
                  </button>
                </th>
                <th className="n" aria-sort={sort.key === "btc" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("btc")}
                  >
                    Bid / cover
                    <span className="pd-arrows">{getSortArrow("btc")}</span>
                  </button>
                </th>
                <th className="n" aria-sort={sort.key === "ind" ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => toggleSort("ind")}
                  >
                    Indirect %
                    <span className="pd-arrows">{getSortArrow("ind")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAuctions.map((r, idx) => {
                const tailFormatted =
                  r.tailBps === 0 ? "0.0 bps" : `${r.tailBps > 0 ? "+" : ""}${r.tailBps.toFixed(1)} bps`;
                const tailClass =
                  r.tailBps === 0 ? "" : r.tailBps < 0 ? "cot-up" : "cot-down";

                return (
                  <tr key={`${r.date}-${r.tenor}-${idx}`}>
                    <td>{r.date}</td>
                    <td>
                      <span className="pd-pill">{r.tenor}</span>
                    </td>
                    <td className="n num">${r.sizeBn.toFixed(1)}B</td>
                    <td className="n num">{r.highYield.toFixed(3)}%</td>
                    <td className={`n num ${tailClass}`}>{tailFormatted}</td>
                    <td className="n num">{r.bidToCover.toFixed(2)}x</td>
                    <td className="n num">{r.indirectPct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dataset Footer */}
      <DatasetFooter meta={meta} />
    </div>
  );
}
