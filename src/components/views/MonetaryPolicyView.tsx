"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  CentralBankItem,
  DatasetMeta,
  FomcDecisionRow,
  LiquiditySeriesPoint,
} from "@/lib/types";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";

interface MonetaryPolicyViewProps {
  centralBanks: CentralBankItem[];
  fomcHistory: FomcDecisionRow[];
  liquiditySeries: LiquiditySeriesPoint[];
  meta: DatasetMeta;
}

type TimeRange = "3M" | "6M" | "1Y" | "MAX";

const RANGE_N: Record<TimeRange, number> = {
  "3M": 13,
  "6M": 26,
  "1Y": 52,
  MAX: 78,
};

const RANGES: TimeRange[] = ["3M", "6M", "1Y", "MAX"];

function money(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-US") + "B";
}

function signedMoney(d: number): string {
  return (d >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(d)) + "B";
}

function formatBasisPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "— bps";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value)} bps`;
}

export function MonetaryPolicyView({
  centralBanks,
  fomcHistory,
  liquiditySeries,
  meta,
}: MonetaryPolicyViewProps) {
  const [range, setRange] = useState<TimeRange>("1Y");

  const observationDate = meta.observationDate || "2026-11-12";
  const releaseDate = meta.releaseDate || observationDate;

  // Primary active bank is Fed
  const fedBank = useMemo(() => {
    return centralBanks.find((b) => b.id === "fed") ?? centralBanks[0] ?? null;
  }, [centralBanks]);

  // Sliced liquidity series based on range
  const slicedLiq = useMemo(() => {
    const n = RANGE_N[range];
    return liquiditySeries.slice(-n);
  }, [liquiditySeries, range]);

  // 1-month-ago comparison (4 weeks prior)
  const latestPt = slicedLiq[slicedLiq.length - 1];
  const back4Pt = slicedLiq[Math.max(0, slicedLiq.length - 5)];

  const latestTa = latestPt ? Math.round(latestPt.fedAssetsTn * 1000) : 6760;
  const back4Ta = back4Pt ? Math.round(back4Pt.fedAssetsTn * 1000) : 6760;
  const deltaTa = latestTa - back4Ta;

  const latestNl = latestPt ? Math.round(latestPt.netLiquidityTn * 1000) : 5850;
  const back4Nl = back4Pt ? Math.round(back4Pt.netLiquidityTn * 1000) : 5880;
  const deltaNl = latestNl - back4Nl;

  const latestRrp = latestPt ? latestPt.rrpBn : 0;
  const back4Rrp = back4Pt ? back4Pt.rrpBn : 0;
  const deltaRrp = latestRrp - back4Rrp;

  const latestTga = latestPt ? latestPt.tgaBn : 914;
  const back4Tga = back4Pt ? back4Pt.tgaBn : 883;
  const deltaTga = latestTga - back4Tga;

  // Chart data series
  const taVals = useMemo(
    () => slicedLiq.map((p) => Math.round(p.fedAssetsTn * 1000)),
    [slicedLiq]
  );
  const nlVals = useMemo(
    () => slicedLiq.map((p) => Math.round(p.netLiquidityTn * 1000)),
    [slicedLiq]
  );
  const rrpVals = useMemo(() => slicedLiq.map((p) => p.rrpBn), [slicedLiq]);
  const tgaVals = useMemo(() => slicedLiq.map((p) => p.tgaBn), [slicedLiq]);
  const dateLabels = useMemo(() => slicedLiq.map((p) => p.date), [slicedLiq]);

  // Rate history for Fed step chart
  const rateVals = useMemo(() => {
    if (!fedBank || fedBank.history.length === 0) {
      return slicedLiq.map((_, i) => (i < slicedLiq.length - 9 ? 3.63 : 3.88));
    }
    const n = RANGE_N[range];
    return fedBank.history.slice(-n).map((h) => h.rate);
  }, [fedBank, slicedLiq, range]);

  const rateLabels = useMemo(() => {
    if (!fedBank || fedBank.history.length === 0) {
      return dateLabels;
    }
    const n = RANGE_N[range];
    return fedBank.history.slice(-n).map((h) => h.date);
  }, [fedBank, dateLabels, range]);

  // OIS implied table rows
  const oisRows = useMemo(() => {
    if (fedBank && fedBank.impliedCurve && fedBank.impliedCurve.length > 0) {
      return fedBank.impliedCurve;
    }
    return [
      { meeting: "2026-12-09", impliedRate: 3.88, marketCutsBps: 0 },
      { meeting: "2027-01-27", impliedRate: 3.88, marketCutsBps: 0 },
      { meeting: "2027-03-17", impliedRate: 3.88, marketCutsBps: 0 },
      { meeting: "2027-05-05", impliedRate: 3.88, marketCutsBps: 0 },
      { meeting: "2027-06-16", impliedRate: 3.88, marketCutsBps: 0 },
    ];
  }, [fedBank]);

  return (
    <div className="cot-container space-y-5">
      {/* Breadcrumb */}
      <Breadcrumbs />

      {/* Header section */}
      <header className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[30px] font-semibold tracking-tight text-[#FFFFFF] flex flex-wrap items-center gap-3">
            Monetary policy &amp; central bank liquidity
            <span className="cot-badge">
              <span className="cot-dot bg-[#22C55E]" />
              Live · {observationDate}
            </span>
          </h1>
          <p className="mt-1.5 text-[14px] text-[#A3A3A3] max-w-[70ch]">
            Policy rates, OIS-implied rate paths, FOMC decisions, and Federal Reserve liquidity aggregates.
          </p>
        </div>

        {/* Range Selector */}
        <div className="cot-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {/* Top Hero Row: Fed Policy Rate Card (Left) + Liquidity Summary (Right) */}
      <div className="mp-row2">
        {/* Federal Reserve Policy Rate Card */}
        <section className="cot-panel" aria-label="Federal Reserve policy rate">
          <div className="mp-hero-top">
            <div>
              <span className="mp-hero-top ccy">USD</span>
              <h2>Federal Reserve</h2>
            </div>
            <span className="cot-badge">
              {fedBank?.trajectory ?? "Hold"}
            </span>
          </div>

          <div className="mp-rate">
            {(fedBank?.currentRate ?? 3.88).toFixed(3)}%
          </div>

          <div className="mp-hero-meta">
            <span>
              Next decision <b>{fedBank?.nextMeeting && fedBank.nextMeeting !== "—" ? fedBank.nextMeeting : "2026-12-09"}</b>
            </span>
            <span>
              Priced <b>+0 bps</b>
            </span>
          </div>
          <div className="mp-hero-meta" style={{ marginTop: 12, paddingTop: 0, borderTop: 0 }}>
            <span>Synced EFFR</span>
            <span>
              Year end <b>{(fedBank?.impliedYearEnd ?? 3.88).toFixed(2)}%</b>
            </span>
          </div>
        </section>

        {/* Liquidity Summary Card */}
        <section className="cot-panel" aria-label="Liquidity summary">
          <div className="mp-ch">
            <h3 style={{ color: "#FFFFFF", fontWeight: 600 }}>Liquidity summary</h3>
            <span className="mp-code">WEEKLY</span>
          </div>
          <div className="mp-liq">
            <div>
              <span>NET FED LIQUIDITY</span>
              <b>{money(latestNl)}</b>
              <small className={deltaNl >= 0 ? "cot-up" : "cot-down"}>
                {signedMoney(deltaNl)} · 1M
              </small>
            </div>
            <div>
              <span>REVERSE REPO</span>
              <b>${Math.round(latestRrp)}B</b>
              <small className={deltaRrp >= 0 ? "cot-up" : "cot-down"}>
                {signedMoney(deltaRrp)} · 1M
              </small>
            </div>
            <div>
              <span>TREASURY GENERAL</span>
              <b>{money(latestTga)}</b>
              <small className={deltaTga >= 0 ? "cot-up" : "cot-down"}>
                {signedMoney(deltaTga)} · 1M
              </small>
            </div>
          </div>
          <p className="mp-sum-note">
            Net liquidity is total assets less the general account and reverse repo. Sample series.
          </p>
        </section>
      </div>

      {/* 4 Liquidity Breakdown Cards */}
      <div className="mp-grid4">
        {/* Fed total assets */}
        <section className="cot-panel" aria-label="Fed total assets">
          <div className="mp-ch">
            <h3>
              Fed total assets <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">WALCL</span>
          </div>
          <div className="mp-big">{money(latestTa)}</div>
          <div className={`mp-delta ${deltaTa >= 0 ? "cot-up" : "cot-down"}`}>
            {signedMoney(deltaTa)} · 1M
          </div>
          <div className="mp-chart">
            <LiquidityChartSvg
              vals={taVals}
              labels={dateLabels}
              color="#22C55E"
              label="Fed total assets"
              formatter={(v) => money(v)}
            />
          </div>
        </section>

        {/* Net Fed liquidity */}
        <section className="cot-panel" aria-label="Net Fed liquidity">
          <div className="mp-ch">
            <h3>
              Net Fed liquidity <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">WALCL−TGA−RRP</span>
          </div>
          <div className="mp-big">{money(latestNl)}</div>
          <div className={`mp-delta ${deltaNl >= 0 ? "cot-up" : "cot-down"}`}>
            {signedMoney(deltaNl)} · 1M
          </div>
          <div className="mp-chart">
            <LiquidityChartSvg
              vals={nlVals}
              labels={dateLabels}
              color={deltaNl >= 0 ? "#22C55E" : "#EF4444"}
              label="Net Fed liquidity"
              formatter={(v) => money(v)}
            />
          </div>
        </section>

        {/* Overnight reverse repo */}
        <section className="cot-panel" aria-label="Overnight reverse repo">
          <div className="mp-ch">
            <h3>
              Overnight reverse repo <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">RRPONTSYD</span>
          </div>
          <div className="mp-big">${Math.round(latestRrp)}B</div>
          <div className={`mp-delta ${deltaRrp >= 0 ? "cot-up" : "cot-down"}`}>
            {signedMoney(deltaRrp)} · 1M
          </div>
          <div className="mp-chart">
            <LiquidityChartSvg
              vals={rrpVals}
              labels={dateLabels}
              color="#EF4444"
              zero
              label="Overnight reverse repo"
              formatter={(v) => `$${v.toFixed(1)}B`}
            />
          </div>
        </section>

        {/* Treasury General Account */}
        <section className="cot-panel" aria-label="Treasury General Account">
          <div className="mp-ch">
            <h3>
              Treasury General Account <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">WTREGEN</span>
          </div>
          <div className="mp-big">{money(latestTga)}</div>
          <div className={`mp-delta ${deltaTga >= 0 ? "cot-up" : "cot-down"}`}>
            {signedMoney(deltaTga)} · 1M
          </div>
          <div className="mp-chart">
            <LiquidityChartSvg
              vals={tgaVals}
              labels={dateLabels}
              color="#22C55E"
              label="Treasury General Account"
              formatter={(v) => money(v)}
            />
          </div>
        </section>
      </div>

      {/* 2 Path & Rate History Cards */}
      <div className="mp-grid2">
        {/* OIS implied path */}
        <section className="cot-panel" aria-label="OIS implied path">
          <div className="mp-ch">
            <h3>
              Federal Reserve · OIS implied path <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">USD OIS</span>
          </div>
          <div className="mp-big">
            {(fedBank?.currentRate ?? 3.88).toFixed(2)}%
          </div>
          <div className="mp-delta cot-muted">
            +0 bps priced through June 2027
          </div>
          <table className="mp-ois">
            <thead>
              <tr>
                <th>Meeting</th>
                <th className="n">Implied</th>
                <th className="n">Priced</th>
              </tr>
            </thead>
            <tbody>
              {oisRows.map((r) => (
                <tr key={r.meeting}>
                  <td className="font-mono-num">{r.meeting}</td>
                  <td className="n font-mono-num">{r.impliedRate.toFixed(2)}%</td>
                  <td className="n font-mono-num cot-muted">
                    {formatBasisPoints(r.marketCutsBps)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Policy rate history */}
        <section className="cot-panel" aria-label="Policy rate history">
          <div className="mp-ch">
            <h3>
              Federal Reserve · policy rate history <span className="mp-info">i</span>
            </h3>
            <span className="mp-code">USD RATE</span>
          </div>
          <div className="mp-big">
            {(fedBank?.currentRate ?? 3.88).toFixed(2)}%
          </div>
          <div className="mp-delta cot-muted">Synced EFFR</div>
          <div className="mp-chart tall">
            <LiquidityChartSvg
              vals={rateVals}
              labels={rateLabels}
              color="#FFFFFF"
              step
              lo={3.6}
              hi={3.9}
              ticks={[3.6, 3.7, 3.8, 3.9]}
              label="Policy rate history"
              formatter={(v) => `${v.toFixed(2)}%`}
            />
          </div>
        </section>
      </div>

      {/* FOMC Meeting Decision Log */}
      <div className="mp-sec">
        <h2>FOMC meeting decision log</h2>
        <span>Federal Reserve</span>
      </div>

      {fomcHistory.length === 0 ? (
        <section className="cot-panel mp-empty" aria-label="FOMC decision log">
          <span className="mp-ico inline-grid place-items-center w-11 h-11 border border-[#2E2E2E] rounded-xl text-[#A3A3A3] mx-auto">
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
          <h3 className="mt-4 text-[16px] font-semibold text-[#FFFFFF]">
            No decisions synced yet
          </h3>
          <p className="mt-1.5 text-[13.5px] text-[#6B6B6B] max-w-[52ch] mx-auto">
            Historical FOMC decisions are not included in the connected FRED/NY Fed rate feeds.
          </p>
          <Link href="/macrodashboard/tools/data-ops" className="mp-btn">
            Open Data operations <span aria-hidden="true">↗</span>
          </Link>
        </section>
      ) : (
        <section className="cot-panel overflow-x-auto">
          <table className="cot-tbl">
            <thead>
              <tr>
                <th>Meeting</th>
                <th>Decision</th>
                <th>Target Range</th>
                <th className="n">EFFR</th>
                <th className="n">Dissents</th>
                <th className="text-right">Stance</th>
              </tr>
            </thead>
            <tbody>
              {fomcHistory.map((row) => (
                <tr key={row.date}>
                  <td className="font-mono-num text-[#A3A3A3]">{row.date}</td>
                  <td
                    className={`font-mono-num font-semibold ${
                      row.decision.startsWith("-")
                        ? "cot-up"
                        : row.decision.startsWith("+")
                        ? "cot-down"
                        : "text-[#FFFFFF]"
                    }`}
                  >
                    {row.decision}
                  </td>
                  <td className="font-mono-num">{row.targetRange}</td>
                  <td className="n font-mono-num text-[#FFFFFF]">
                    {row.effr.toFixed(2)}%
                  </td>
                  <td className="n font-mono-num text-[#A3A3A3]">{row.dissents}</td>
                  <td className="text-right">
                    <span
                      className={`cot-badge ${
                        row.stance === "Dovish"
                          ? "long"
                          : row.stance === "Hawkish"
                          ? "short"
                          : ""
                      }`}
                    >
                      {row.stance}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Dataset footer with metadata */}
      <footer className="flex flex-wrap justify-between gap-2 sm:gap-4 mt-7 pt-3.5 border-t border-[#1C1C1C] font-mono-num text-[12px] text-[#6B6B6B]">
        <span>
          FRED · DFF · Obs {observationDate} · Released {releaseDate} · Freq daily · Units %
        </span>
        <span>Sample series, not live market data</span>
      </footer>

      <DatasetFooter meta={meta} />
    </div>
  );
}

/* ==========================================================================
   Liquidity Area & Step Chart SVG Component
   ========================================================================== */
interface LiquidityChartSvgProps {
  vals: number[];
  labels: string[];
  color: string;
  label: string;
  formatter: (v: number) => string;
  zero?: boolean;
  step?: boolean;
  lo?: number;
  hi?: number;
  ticks?: number[];
}

function LiquidityChartSvg({
  vals,
  labels,
  color,
  label,
  formatter,
  zero,
  step,
  lo: explicitLo,
  hi: explicitHi,
  ticks: explicitTicks,
}: LiquidityChartSvgProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const n = vals.length;
  if (n === 0) return null;

  const W = 480;
  const H = step ? 260 : 210;
  const pl = 54;
  const pr = 12;
  const pt = 10;
  const pb = 26;

  let lo = explicitLo;
  let hi = explicitHi;

  if (lo === undefined || hi === undefined) {
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = (mx - mn) * 0.12 || 1;
    lo = zero ? 0 : mn - pad;
    hi = mx + pad;
  }

  const span = Math.max(0.0001, hi - lo);
  const ticks =
    explicitTicks || [0, 1, 2, 3, 4].map((k) => lo! + (span * k) / 4);

  const x = (i: number) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo!) / span);

  // X ticks: 5 ticks
  const xTickIndices = [0, 1, 2, 3, 4].map((k) =>
    Math.min(n - 1, Math.round(((n - 1) * k) / 4))
  );
  const xTicks = xTickIndices.map((idx, k) => {
    const isFirst = k === 0;
    const isLast = k === xTickIndices.length - 1;
    return {
      idx,
      text: labels[idx] ?? "",
      x: x(idx),
      anchor: (isFirst ? "start" : isLast ? "end" : "middle") as
        | "start"
        | "middle"
        | "end",
    };
  });

  const maxVal = vals.length ? Math.max(...vals) : null;
  const minVal = vals.length ? Math.min(...vals) : null;
  const gradId = `mp-grad-${label.replace(/\s+/g, "-").toLowerCase()}`;

  // Calculate points
  const pts: [number, number][] = vals.map((v, i) => [x(i), y(v)]);

  let d = "";
  if (step) {
    d = pts
      .map((p, i) =>
        i
          ? `L${p[0].toFixed(1)},${pts[i - 1][1].toFixed(1)} L${p[0].toFixed(
              1
            )},${p[1].toFixed(1)}`
          : `M${p[0].toFixed(1)},${p[1].toFixed(1)}`
      )
      .join(" ");
  } else {
    d = pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`
      )
      .join(" ");
  }

  const base = (H - pb).toFixed(1);
  const areaD = `${d} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(
    1
  )},${base} Z`;

  const activeIdx =
    hoverIndex !== null ? Math.max(0, Math.min(n - 1, hoverIndex)) : null;
  const activeX = activeIdx !== null ? x(activeIdx) : null;
  const activeY = activeIdx !== null ? y(vals[activeIdx]) : null;

  return (
    <div
      className="relative w-full h-full cursor-crosshair select-none"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const ratio = (px - pl) / Math.max(1, rect.width - pl - pr);
        const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
        setHoverIndex(idx);
      }}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="60%" stopColor={color} stopOpacity="0.05" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Vertical Grid Lines */}
        {xTicks.map((xt, idx) => (
          <line
            key={`vgl-${idx}`}
            x1={xt.x}
            x2={xt.x}
            y1={pt}
            y2={H - pb}
            stroke="var(--cot-line)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.35}
          />
        ))}

        {/* Y ticks & grid lines */}
        {ticks.map((val, idx) => {
          const yy = y(val);
          return (
            <g key={idx}>
              <line
                x1={pl}
                x2={W - pr}
                y1={yy}
                y2={yy}
                stroke="var(--cot-line)"
                strokeWidth={1}
              />
              <text
                x={pl - 8}
                y={yy + 4}
                textAnchor="end"
                className="cot-ax"
              >
                {formatter(val)}
              </text>
            </g>
          );
        })}

        {/* High & Low Watermark Dashed Lines */}
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
              H: {formatter(maxVal)}
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
              L: {formatter(minVal)}
            </text>
          </g>
        )}

        {/* X date labels */}
        {xTicks.map((xt, idx) => (
          <text
            key={idx}
            x={xt.x}
            y={H - 6}
            textAnchor={xt.anchor}
            className="cot-ax"
          >
            {xt.text}
          </text>
        ))}

        {/* Shaded Area */}
        <path d={areaD} fill={`url(#${gradId})`} />

        {/* Stroke Line */}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Interactive Guide & Dot */}
        {activeX !== null && activeY !== null && (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={pt}
              y2={H - pb}
              stroke="#555555"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              r={4.5}
              cx={activeX}
              cy={activeY}
              fill={color}
              stroke="#000000"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Floating Tooltip */}
      {activeIdx !== null && activeX !== null && (
        <div
          className="absolute top-1 pointer-events-none flex flex-col gap-0.5 px-3 py-1.5 bg-[#000000] border border-[#2E2E2E] rounded-md font-mono-num text-[11.5px] text-[#A3A3A3] whitespace-nowrap shadow-xl z-10"
          style={{
            left: `${Math.max(
              0,
              Math.min(W - 140, (activeX / W) * 100 - 15)
            )}%`,
          }}
        >
          <span className="font-medium text-[#FFFFFF]">{labels[activeIdx]}</span>
          <b className="font-semibold text-[13px] text-[#FFFFFF]">
            {formatter(vals[activeIdx])}
          </b>
          {activeIdx > 0 && (
            <span className={`text-[10px] ${vals[activeIdx] - vals[activeIdx - 1] >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              Δ {vals[activeIdx] - vals[activeIdx - 1] >= 0 ? "+" : ""}{formatter(vals[activeIdx] - vals[activeIdx - 1])}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
