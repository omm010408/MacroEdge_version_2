"use client";

import { useMemo, useState } from "react";
import type { CotHistoryPoint, CotInstrument, DatasetMeta } from "@/lib/types";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";

interface CotViewProps {
  instruments: CotInstrument[];
  reportDate: string;
  releaseDate: string;
  meta: DatasetMeta;
}

type CotTab = "overview" | "instant" | "extremes";
type TimeRange = "3M" | "6M" | "1Y" | "2Y" | "MAX";
type InspectorTab = "net" | "ls" | "oscillator" | "table";

const RANGE_N: Record<TimeRange, number> = {
  "3M": 13,
  "6M": 26,
  "1Y": 52,
  "2Y": 73,
  MAX: 73,
};

const CATEGORIES: CotInstrument["assetClass"][] = [
  "FX",
  "Metals",
  "Rates",
  "Energy",
  "Equities",
  "Crypto",
];

const PREFERRED_RANK_ORDER = [
  "GC",
  "6E",
  "6J",
  "6B",
  "DX",
  "6A",
  "ZN",
  "ZT",
  "ES",
  "NQ",
  "CL",
  "SI",
  "HG",
  "BTC",
];

function sig(p: number): "short" | "long" | "neutral" {
  if (p <= 20) return "short";
  if (p >= 80) return "long";
  return "neutral";
}

const SIGTXT: Record<"short" | "long" | "neutral", string> = {
  short: "Extreme short",
  long: "Extreme long",
  neutral: "Neutral",
};

function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtNet(v: number): string {
  const valInK = v / 1000;
  const a = Math.abs(valInK);
  const s = valInK < 0 ? "−" : "+";
  return a >= 1000 ? s + (a / 1000).toFixed(2) + "M" : s + a.toFixed(1) + "K";
}

function fmtWk(v: number): string {
  const valInK = v / 1000;
  const a = Math.abs(valInK);
  const s = valInK < 0 ? "−" : "+";
  return a < 1 ? s + Math.round(a * 1000) : s + a.toFixed(1) + "K";
}

function fmtQty(v: number): string {
  const valInK = v / 1000;
  const a = Math.abs(valInK);
  return a >= 1000 ? (a / 1000).toFixed(2) + "M" : a.toFixed(1) + "K";
}

export function CotView({
  instruments,
  reportDate,
  releaseDate,
  meta,
}: CotViewProps) {
  const [tab, setTab] = useState<CotTab>("overview");
  const [mode, setMode] = useState<"chart" | "list">("chart");
  const [selectedCode, setSelectedCode] = useState<string>(
    instruments.find((i) => i.symbol === "GC")?.symbol ??
      instruments[0]?.symbol ??
      "GC"
  );
  const [range, setRange] = useState<TimeRange>("MAX");
  const [itab, setItab] = useState<InspectorTab>("net");

  const extremeLongCount = useMemo(
    () => instruments.filter((i) => sig(i.percentile) === "long").length,
    [instruments]
  );
  const extremeShortCount = useMemo(
    () => instruments.filter((i) => sig(i.percentile) === "short").length,
    [instruments]
  );

  const activeInstrument = useMemo(() => {
    return (
      instruments.find((i) => i.symbol === selectedCode) ??
      instruments[0] ??
      null
    );
  }, [instruments, selectedCode]);

  const rankedCodes = useMemo(() => {
    const present = new Set(instruments.map((i) => i.symbol));
    const sortedPreferred = PREFERRED_RANK_ORDER.filter((c) => present.has(c));
    const remaining = instruments
      .map((i) => i.symbol)
      .filter((c) => !sortedPreferred.includes(c));
    return [...sortedPreferred, ...remaining];
  }, [instruments]);

  const extremeCodes = useMemo(() => {
    return rankedCodes.filter((code) => {
      const inst = instruments.find((i) => i.symbol === code);
      return inst && sig(inst.percentile) !== "neutral";
    });
  }, [rankedCodes, instruments]);

  const groupedInstruments = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      category: cat,
      rows: instruments.filter((i) => i.assetClass === cat),
    })).filter((g) => g.rows.length > 0);
  }, [instruments]);

  // Sliced history for inspector
  const slicedHistory = useMemo(() => {
    if (!activeInstrument) return [];
    const n = RANGE_N[range];
    return activeInstrument.history.slice(-n);
  }, [activeInstrument, range]);

  const prevPoint = useMemo(() => {
    if (!activeInstrument || activeInstrument.history.length < 2) return null;
    return activeInstrument.history[activeInstrument.history.length - 2];
  }, [activeInstrument]);

  const longWkDelta = useMemo(() => {
    if (!activeInstrument || !prevPoint) return 0;
    return activeInstrument.longPositions - prevPoint.long;
  }, [activeInstrument, prevPoint]);

  const shortWkDelta = useMemo(() => {
    if (!activeInstrument || !prevPoint) return 0;
    return activeInstrument.shortPositions - prevPoint.short;
  }, [activeInstrument, prevPoint]);

  if (instruments.length === 0) {
    return (
      <div className="space-y-5">
        <Breadcrumbs />
        <DataOpsEmptyState
          title="CFTC Commitments of Traders Awaiting Live Sync"
          detail="Enable ENABLE_PUBLIC_CFTC_LIVE and trigger Data Operations sync to ingest weekly CFTC Legacy Futures reports."
        />
        <DatasetFooter meta={meta} />
      </div>
    );
  }

  return (
    <div className="cot-container space-y-5">
      {/* Breadcrumb */}
      <Breadcrumbs />

      {/* Header section */}
      <header className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div>
          <h1 className="text-[28px] sm:text-[30px] font-semibold tracking-tight text-[#FFFFFF] flex flex-wrap items-center gap-3">
            Institutional positioning
            <span className="cot-badge">
              <span className="cot-dot bg-white animate-pulse" />
              Live · {reportDate}
            </span>
          </h1>
          <p className="mt-1.5 text-[14px] text-[#A3A3A3]">
            Weekly disclosure of open futures positions across relevant instruments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 font-mono-num text-[12.5px] text-[#6B6B6B]">
          <span>Close {reportDate}</span>
          <span>·</span>
          <span>Released {releaseDate}</span>
          <span className="cot-badge long">{extremeLongCount} long</span>
          <span className="cot-badge short">{extremeShortCount} short</span>
        </div>
      </header>

      {/* Primary view tabs + display segmented mode */}
      <div className="cot-bar-row">
        <div className="cot-vtabs" role="tablist" aria-label="Views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "instant"}
            onClick={() => setTab("instant")}
          >
            Instant COT
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "extremes"}
            onClick={() => setTab("extremes")}
          >
            Extremes
          </button>
        </div>

        <div className="cot-seg" role="group" aria-label="Display mode">
          <button
            type="button"
            aria-pressed={mode === "chart"}
            onClick={() => setMode("chart")}
          >
            Chart
          </button>
          <button
            type="button"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            List
          </button>
        </div>
      </div>

      {/* Tab View Content */}
      {tab === "overview" && (
        <div className="cot-ov">
          {/* Left Column: Grouped Instrument Tables */}
          <div className="space-y-4">
            {groupedInstruments.map((group) => (
              <section key={group.category} className="cot-panel cot-grp">
                <div className="cot-ph">
                  <h3>{group.category}</h3>
                  <span className="cnt">
                    {group.rows.length} contract
                    {group.rows.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="cot-tbl mt-2">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className="n">NC net</th>
                        <th className="n">Wk chg</th>
                        <th>Pctile</th>
                        <th className="text-right">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => {
                        const isSelected = row.symbol === selectedCode;
                        const rowSignal = sig(row.percentile);
                        const isPosNet = row.netContracts >= 0;
                        const isPosWk = row.weeklyChange >= 0;

                        return (
                          <tr
                            key={row.symbol}
                            className="row"
                            tabIndex={0}
                            aria-selected={isSelected}
                            onClick={() => setSelectedCode(row.symbol)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedCode(row.symbol);
                              }
                            }}
                          >
                            <td>
                              {row.instrument.replace(/\s*\([^)]*\)/, "")}
                              <span className="code">{row.symbol}</span>
                            </td>
                            <td className={`n ${isPosNet ? "cot-up" : "cot-down"}`}>
                              {fmtNet(row.netContracts)}
                            </td>
                            <td className={`n ${isPosWk ? "cot-up" : "cot-down"}`}>
                              {fmtWk(row.weeklyChange)}
                            </td>
                            <td>
                              <span className="cot-pb">
                                <i
                                  className={rowSignal === "neutral" ? "" : rowSignal}
                                  style={{ left: `${Math.min(100, Math.max(0, row.percentile))}%` }}
                                />
                              </span>
                              <span className="cot-pbl">{ord(row.percentile)}</span>
                            </td>
                            <td className="text-right">
                              <span
                                className={`cot-badge ${
                                  rowSignal === "long"
                                    ? "long"
                                    : rowSignal === "short"
                                    ? "short"
                                    : ""
                                }`}
                              >
                                {SIGTXT[rowSignal]}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          {/* Right Column: Sticky Inspector */}
          {activeInstrument && (
            <InspectorPanel
              instrument={activeInstrument}
              range={range}
              setRange={setRange}
              itab={itab}
              setItab={setItab}
              slicedHistory={slicedHistory}
              longWkDelta={longWkDelta}
              shortWkDelta={shortWkDelta}
            />
          )}
        </div>
      )}

      {tab === "instant" && (
        <div className="space-y-4">
          {mode === "chart" ? (
            <section className="cot-panel">
              <div className="cot-ph">
                <div>
                  <h3>Instant COT percentile ranking</h3>
                  <p>Click any bar or row to load that contract into the inspector.</p>
                </div>
                <span className="cot-badge">Active: {selectedCode}</span>
              </div>
              <div className="cot-rank">
                <RankingChartSvg
                  codes={rankedCodes}
                  instruments={instruments}
                  selectedCode={selectedCode}
                  onSelectCode={(c) => setSelectedCode(c)}
                />
              </div>
            </section>
          ) : (
            <section className="cot-panel">
              <div className="cot-ph">
                <div>
                  <h3>Instant COT percentile ranking</h3>
                  <p>Tabular view of percentile ranking across all contracts.</p>
                </div>
                <span className="cot-badge">Active: {selectedCode}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="cot-tbl mt-2">
                  <thead>
                    <tr>
                      <th>Contract</th>
                      <th className="n">NC net</th>
                      <th className="n">Wk chg</th>
                      <th>Percentile</th>
                      <th className="text-right">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedCodes.map((code) => {
                      const c = instruments.find((i) => i.symbol === code);
                      if (!c) return null;
                      const isSel = code === selectedCode;
                      const sg = sig(c.percentile);
                      return (
                        <tr
                          key={code}
                          className="row"
                          tabIndex={0}
                          aria-selected={isSel}
                          onClick={() => setSelectedCode(code)}
                        >
                          <td>
                            {c.instrument.replace(/\s*\([^)]*\)/, "")}
                            <span className="code">{code}</span>
                          </td>
                          <td className={`n ${c.netContracts >= 0 ? "cot-up" : "cot-down"}`}>
                            {fmtNet(c.netContracts)}
                          </td>
                          <td className={`n ${c.weeklyChange >= 0 ? "cot-up" : "cot-down"}`}>
                            {fmtWk(c.weeklyChange)}
                          </td>
                          <td>
                            <span className="cot-pb">
                              <i
                                className={sg === "neutral" ? "" : sg}
                                style={{ left: `${c.percentile}%` }}
                              />
                            </span>
                            <span className="cot-pbl">{ord(c.percentile)}</span>
                          </td>
                          <td className="text-right">
                            <span
                              className={`cot-badge ${
                                sg === "long" ? "long" : sg === "short" ? "short" : ""
                              }`}
                            >
                              {SIGTXT[sg]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeInstrument && (
            <div className="cot-ov">
              <div className="col-span-full">
                <InspectorPanel
                  instrument={activeInstrument}
                  range={range}
                  setRange={setRange}
                  itab={itab}
                  setItab={setItab}
                  slicedHistory={slicedHistory}
                  longWkDelta={longWkDelta}
                  shortWkDelta={shortWkDelta}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "extremes" && (
        <div className="space-y-4">
          {mode === "chart" ? (
            <section className="cot-panel">
              <div className="cot-ph">
                <div>
                  <h3>Extremes</h3>
                  <p>Contracts at or beyond the 20th and 80th percentile.</p>
                </div>
                <span className="cot-badge">{extremeCodes.length} flagged</span>
              </div>
              <div className="cot-rank">
                <RankingChartSvg
                  codes={extremeCodes}
                  instruments={instruments}
                  selectedCode={selectedCode}
                  onSelectCode={(c) => setSelectedCode(c)}
                />
              </div>
            </section>
          ) : (
            <section className="cot-panel">
              <div className="cot-ph">
                <div>
                  <h3>Extremes</h3>
                  <p>Contracts at or beyond the 20th and 80th percentile.</p>
                </div>
                <span className="cot-badge">{extremeCodes.length} flagged</span>
              </div>
              <div className="overflow-x-auto">
                <table className="cot-tbl mt-2">
                  <thead>
                    <tr>
                      <th>Contract</th>
                      <th className="n">NC net</th>
                      <th className="n">Wk chg</th>
                      <th>Percentile</th>
                      <th className="text-right">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extremeCodes.map((code) => {
                      const c = instruments.find((i) => i.symbol === code);
                      if (!c) return null;
                      const isSel = code === selectedCode;
                      const sg = sig(c.percentile);
                      return (
                        <tr
                          key={code}
                          className="row"
                          tabIndex={0}
                          aria-selected={isSel}
                          onClick={() => setSelectedCode(code)}
                        >
                          <td>
                            {c.instrument.replace(/\s*\([^)]*\)/, "")}
                            <span className="code">{code}</span>
                          </td>
                          <td className={`n ${c.netContracts >= 0 ? "cot-up" : "cot-down"}`}>
                            {fmtNet(c.netContracts)}
                          </td>
                          <td className={`n ${c.weeklyChange >= 0 ? "cot-up" : "cot-down"}`}>
                            {fmtWk(c.weeklyChange)}
                          </td>
                          <td>
                            <span className="cot-pb">
                              <i
                                className={sg}
                                style={{ left: `${c.percentile}%` }}
                              />
                            </span>
                            <span className="cot-pbl">{ord(c.percentile)}</span>
                          </td>
                          <td className="text-right">
                            <span className={`cot-badge ${sg === "long" ? "long" : "short"}`}>
                              {SIGTXT[sg]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Extremes Table */}
          <section className="cot-panel cot-grp">
            <div className="cot-ph">
              <h3>Extreme contracts</h3>
              <span className="cnt">{extremeCodes.length} flagged</span>
            </div>
            <div className="overflow-x-auto">
              <table className="cot-tbl mt-2">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="n">NC net</th>
                    <th className="n">Wk chg</th>
                    <th>Pctile</th>
                    <th className="text-right">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {extremeCodes.map((code) => {
                    const c = instruments.find((i) => i.symbol === code);
                    if (!c) return null;
                    const isSel = code === selectedCode;
                    const sg = sig(c.percentile);
                    return (
                      <tr
                        key={code}
                        className="row"
                        tabIndex={0}
                        aria-selected={isSel}
                        onClick={() => setSelectedCode(code)}
                      >
                        <td>
                          {c.instrument.replace(/\s*\([^)]*\)/, "")}
                          <span className="code">{code}</span>
                        </td>
                        <td className={`n ${c.netContracts >= 0 ? "cot-up" : "cot-down"}`}>
                          {fmtNet(c.netContracts)}
                        </td>
                        <td className={`n ${c.weeklyChange >= 0 ? "cot-up" : "cot-down"}`}>
                          {fmtWk(c.weeklyChange)}
                        </td>
                        <td>
                          <span className="cot-pb">
                            <i className={sg} style={{ left: `${c.percentile}%` }} />
                          </span>
                          <span className="cot-pbl">{ord(c.percentile)}</span>
                        </td>
                        <td className="text-right">
                          <span className={`cot-badge ${sg === "long" ? "long" : "short"}`}>
                            {SIGTXT[sg]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {activeInstrument && (
            <div className="cot-ov">
              <div className="col-span-full">
                <InspectorPanel
                  instrument={activeInstrument}
                  range={range}
                  setRange={setRange}
                  itab={itab}
                  setItab={setItab}
                  slicedHistory={slicedHistory}
                  longWkDelta={longWkDelta}
                  shortWkDelta={shortWkDelta}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dataset footer with metadata */}
      <DatasetFooter meta={meta} />
    </div>
  );
}

/* ==========================================================================
   Contract Inspector Panel
   ========================================================================== */
interface InspectorPanelProps {
  instrument: CotInstrument;
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  itab: InspectorTab;
  setItab: (t: InspectorTab) => void;
  slicedHistory: CotHistoryPoint[];
  longWkDelta: number;
  shortWkDelta: number;
}

function InspectorPanel({
  instrument,
  range,
  setRange,
  itab,
  setItab,
  slicedHistory,
  longWkDelta,
  shortWkDelta,
}: InspectorPanelProps) {
  const sg = sig(instrument.percentile);
  const isPosNet = instrument.netContracts >= 0;
  const isPosWk = instrument.weeklyChange >= 0;

  return (
    <section className="cot-panel cot-insp" aria-label="Contract inspector">
      <h2>
        {instrument.instrument.replace(/\s*\([^)]*\)/, "")}
        <small>
          {instrument.symbol} · CFTC
        </small>
      </h2>

      {/* 5 KPI Stat Tiles */}
      <div className="cot-kgrid">
        <div className="cot-kc">
          <span>NC NET</span>
          <b className={isPosNet ? "cot-up" : "cot-down"}>
            {fmtNet(instrument.netContracts)}
          </b>
          <small className={isPosWk ? "cot-up" : "cot-down"}>
            {fmtWk(instrument.weeklyChange)} wk
          </small>
        </div>

        <div className="cot-kc">
          <span>NC LONG</span>
          <b>{fmtQty(instrument.longPositions)}</b>
          <small className={longWkDelta >= 0 ? "cot-up" : "cot-down"}>
            {longWkDelta !== 0 ? fmtWk(longWkDelta) + " wk" : "—"}
          </small>
        </div>

        <div className="cot-kc">
          <span>NC SHORT</span>
          <b>{fmtQty(instrument.shortPositions)}</b>
          <small className={shortWkDelta >= 0 ? "cot-up" : "cot-down"}>
            {shortWkDelta !== 0 ? fmtWk(shortWkDelta) + " wk" : "—"}
          </small>
        </div>

        <div className="cot-kc">
          <span>OPEN INT</span>
          <b>{fmtQty(instrument.openInterest)}</b>
          <small>{instrument.reportDate.slice(5)}</small>
        </div>

        <div className="cot-kc">
          <span>PCTILE</span>
          <b>{ord(instrument.percentile)}</b>
          <small className={sg === "long" ? "cot-up" : sg === "short" ? "cot-down" : ""}>
            {SIGTXT[sg]}
          </small>
        </div>
      </div>

      {/* Timeframe Range Selector */}
      <div
        className="cot-seg"
        role="group"
        aria-label="Range"
        style={{ marginTop: 16 }}
      >
        {(["3M", "6M", "1Y", "2Y", "MAX"] as const).map((r) => (
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

      {/* Inspector Underline Tabs */}
      <div className="cot-itabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={itab === "net"}
          onClick={() => setItab("net")}
        >
          Net positions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={itab === "ls"}
          onClick={() => setItab("ls")}
        >
          Long vs short
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={itab === "oscillator"}
          onClick={() => setItab("oscillator")}
        >
          Oscillator
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={itab === "table"}
          onClick={() => setItab("table")}
        >
          Table
        </button>
      </div>

      {/* Chart Canvas / SVG */}
      <div className="cot-chart">
        {itab === "net" && (
          <InspectorLineChart
            history={slicedHistory}
            mode="net"
            unit="K"
          />
        )}
        {itab === "ls" && (
          <InspectorLineChart
            history={slicedHistory}
            mode="ls"
            unit="K"
          />
        )}
        {itab === "oscillator" && (
          <InspectorLineChart
            history={slicedHistory}
            mode="oscillator"
            unit="%"
          />
        )}
        {itab === "table" && (
          <div className="h-full overflow-y-auto rounded border border-[#1C1C1C]">
            <table className="cot-tbl text-[11px] font-mono-num">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="n">NC Net</th>
                  <th className="n">Long</th>
                  <th className="n">Short</th>
                  <th className="n">Comm Net</th>
                  <th className="n">Pct</th>
                </tr>
              </thead>
              <tbody>
                {[...slicedHistory].reverse().map((pt) => (
                  <tr key={pt.date}>
                    <td className="text-[#A3A3A3]">{pt.date}</td>
                    <td className={`n ${pt.net >= 0 ? "cot-up" : "cot-down"}`}>
                      {fmtNet(pt.net)}
                    </td>
                    <td className="n text-[#22C55E]">{fmtQty(pt.long)}</td>
                    <td className="n text-[#EF4444]">{fmtQty(pt.short)}</td>
                    <td className="n text-[#A3A3A3]">{fmtNet(pt.commercialNet)}</td>
                    <td className="n">{pt.oscillator}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      {itab === "net" && (
        <div className="cot-legend">
          <span>
            <i style={{ background: "#FFFFFF" }} />
            NC net
          </span>
          <span>
            <i className="dash" style={{ color: "#A3A3A3" }} />
            Commercial net
          </span>
        </div>
      )}
      {itab === "ls" && (
        <div className="cot-legend">
          <span style={{ color: "#22C55E" }}>
            <i style={{ background: "#22C55E" }} />
            NC long
          </span>
          <span style={{ color: "#EF4444" }}>
            <i style={{ background: "#EF4444" }} />
            NC short
          </span>
        </div>
      )}
      {itab === "oscillator" && (
        <div className="cot-legend">
          <span style={{ color: "#FFFFFF" }}>
            <i style={{ background: "#FFFFFF" }} />
            3Y Percentile
          </span>
          <span style={{ color: "#22C55E" }}>
            <i className="dash" style={{ color: "#22C55E" }} />
            80% Extreme Long
          </span>
          <span style={{ color: "#EF4444" }}>
            <i className="dash" style={{ color: "#EF4444" }} />
            20% Extreme Short
          </span>
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   Inspector Line/Area Chart SVG
   ========================================================================== */
function InspectorLineChart({
  history,
  mode,
  unit,
}: {
  history: CotHistoryPoint[];
  mode: "net" | "ls" | "oscillator";
  unit: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = history.length;
  if (n === 0) return null;

  const W = 620;
  const H = 280;
  const pl = 54;
  const pr = 12;
  const pt = 14;
  const pb = 28;

  let lo = 0;
  let hi = 100;

  if (mode === "net") {
    const allVals = history.flatMap((p) => [p.net / 1000, p.commercialNet / 1000]);
    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    lo = Math.min(0, Math.floor(minVal / 10) * 10);
    hi = Math.ceil(Math.max(10, maxVal) / 10) * 10;
  } else if (mode === "ls") {
    const allVals = history.flatMap((p) => [p.long / 1000, p.short / 1000]);
    const minVal = Math.min(0, ...allVals);
    const maxVal = Math.max(10, ...allVals);
    lo = Math.floor(minVal / 10) * 10;
    hi = Math.ceil(maxVal / 10) * 10;
  } else {
    lo = 0;
    hi = 100;
  }

  const span = Math.max(1, hi - lo);
  const x = (i: number) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / span);

  // Y-axis grid ticks (5 ticks)
  const gridTicks = [0, 1, 2, 3, 4].map((k) => lo + (span * k) / 4);

  // X-axis label step
  const step = Math.max(1, Math.round(n / 5));
  const dateLabels = history.map((pt, i) => {
    const isLast = i === n - 1;
    const isFirst = i === 0;
    const show = isLast || (i % step === 0 && n - 1 - i >= step * 0.6);
    return {
      text: pt.date.slice(5),
      x: x(i),
      anchor: (isLast ? "end" : isFirst ? "start" : "middle") as "start" | "middle" | "end",
      show,
    };
  });

  // Series definitions
  const series: {
    points: [number, number][];
    color: string;
    width: number;
    dash?: string;
    area?: boolean;
    name: string;
    rawVals: number[];
  }[] = [];

  if (mode === "net") {
    const netVals = history.map((p) => p.net / 1000);
    const commVals = history.map((p) => p.commercialNet / 1000);
    const netPts: [number, number][] = history.map((p, i) => [x(i), y(netVals[i])]);
    const commPts: [number, number][] = history.map((p, i) => [x(i), y(commVals[i])]);

    series.push({
      points: netPts,
      color: "#FFFFFF",
      width: 2,
      area: true,
      name: "Non-Commercial Net",
      rawVals: netVals,
    });
    series.push({
      points: commPts,
      color: "#A3A3A3",
      width: 1.5,
      dash: "4 4",
      name: "Commercial Net",
      rawVals: commVals,
    });
  } else if (mode === "ls") {
    const longVals = history.map((p) => p.long / 1000);
    const shortVals = history.map((p) => p.short / 1000);
    const longPts: [number, number][] = history.map((p, i) => [x(i), y(longVals[i])]);
    const shortPts: [number, number][] = history.map((p, i) => [x(i), y(shortVals[i])]);

    series.push({
      points: longPts,
      color: "#22C55E",
      width: 2,
      name: "Non-Comm Longs",
      rawVals: longVals,
    });
    series.push({
      points: shortPts,
      color: "#EF4444",
      width: 2,
      name: "Non-Comm Shorts",
      rawVals: shortVals,
    });
  } else {
    const oscVals = history.map((p) => p.oscillator);
    const oscPts: [number, number][] = history.map((p, i) => [x(i), y(oscVals[i])]);
    series.push({
      points: oscPts,
      color: "#FFFFFF",
      width: 2,
      name: "COT Index",
      rawVals: oscVals,
    });
  }

  const zeroY = y(0);
  const showZero = lo < 0 && hi > 0;
  const activeX = hoverIdx !== null ? x(hoverIdx) : null;

  return (
    <div
      className="relative w-full h-full cursor-crosshair select-none"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const ratio = (px - pl) / Math.max(1, rect.width - pl - pr);
        const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
        setHoverIdx(idx);
      }}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Positioning history"
      >
        <defs>
          <linearGradient id="cot-inspector-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Vertical Grid Lines */}
        {dateLabels
          .filter((l) => l.show)
          .map((l, idx) => (
            <line
              key={`vgl-${idx}`}
              x1={l.x}
              x2={l.x}
              y1={pt}
              y2={H - pb}
              stroke="var(--cot-line)"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.35}
            />
          ))}

        {/* Grid lines and Y labels */}
        {gridTicks.map((val, idx) => {
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
                {Math.round(val)}
                {unit}
              </text>
            </g>
          );
        })}

        {/* Threshold lines for oscillator */}
        {mode === "oscillator" && (
          <>
            <line
              x1={pl}
              x2={W - pr}
              y1={y(80)}
              y2={y(80)}
              stroke="#22C55E"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <line
              x1={pl}
              x2={W - pr}
              y1={y(20)}
              y2={y(20)}
              stroke="#EF4444"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
          </>
        )}

        {/* Zero line */}
        {showZero && (
          <line
            x1={pl}
            x2={W - pr}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--cot-line-strong)"
            strokeWidth={1.25}
          />
        )}

        {/* Date labels */}
        {dateLabels
          .filter((l) => l.show)
          .map((l, idx) => (
            <text
              key={idx}
              x={l.x}
              y={H - 6}
              textAnchor={l.anchor}
              className="cot-ax"
            >
              {l.text}
            </text>
          ))}

        {/* Series paths */}
        {series.map((ser, sIdx) => {
          const d = ser.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
            .join(" ");

          const areaD =
            ser.area && ser.points.length > 0
              ? `${d} L${ser.points[ser.points.length - 1][0].toFixed(1)},${(
                  H - pb
                ).toFixed(1)} L${ser.points[0][0].toFixed(1)},${(H - pb).toFixed(1)} Z`
              : null;

          return (
            <g key={sIdx}>
              {areaD && (
                <path
                  d={areaD}
                  fill="url(#cot-inspector-grad)"
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={ser.color}
                strokeWidth={ser.width}
                strokeLinejoin="round"
                strokeDasharray={ser.dash}
              />
            </g>
          );
        })}

        {/* Hover Crosshair Guide and Dots */}
        {hoverIdx !== null && activeX !== null && (
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
            {series.map((ser, si) => (
              <circle
                key={si}
                r={4.5}
                cx={activeX}
                cy={y(ser.rawVals[hoverIdx])}
                fill={ser.color}
                stroke="#000000"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Floating Hover Tooltip */}
      {hoverIdx !== null && activeX !== null && (
        <div
          className="absolute top-1 pointer-events-none flex flex-col gap-1 px-3 py-1.5 bg-[#000000] border border-[#2E2E2E] rounded-md font-mono-num text-[11.5px] text-[#A3A3A3] whitespace-nowrap shadow-xl z-10"
          style={{
            left: `${Math.max(0, Math.min(W - 160, (activeX / W) * 100 - 15))}%`,
          }}
        >
          <span className="font-semibold text-[#FFFFFF]">{history[hoverIdx].date}</span>
          {series.map((ser, si) => {
            const val = ser.rawVals[hoverIdx];
            const prevVal = hoverIdx > 0 ? ser.rawVals[hoverIdx - 1] : null;
            const delta = prevVal !== null ? val - prevVal : null;
            return (
              <span key={si} className="flex items-center gap-2" style={{ color: ser.color }}>
                <span>{ser.name}:</span>
                <b className="text-[#FFFFFF]">
                  {val.toFixed(1)}
                  {unit}
                </b>
                {delta !== null && (
                  <span className={`text-[10px] ${delta >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    ({delta >= 0 ? "+" : ""}{delta.toFixed(1)}{unit})
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

/* ==========================================================================
   Ranking Chart SVG for Instant COT & Extremes
   ========================================================================== */
interface RankingChartSvgProps {
  codes: string[];
  instruments: CotInstrument[];
  selectedCode: string;
  onSelectCode: (code: string) => void;
}

function RankingChartSvg({
  codes,
  instruments,
  selectedCode,
  onSelectCode,
}: RankingChartSvgProps) {
  const W = 960;
  const H = 320;
  const pl = 44;
  const pr = 12;
  const pt = 14;
  const pb = 34;

  const n = Math.max(1, codes.length);
  const slot = (W - pl - pr) / n;
  const bw = Math.min(48, Math.max(12, slot * 0.58));
  const y = (p: number) => pt + (H - pt - pb) * (1 - p / 100);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      role="img"
      aria-label="Percentile ranking by contract"
    >
      {/* 0%, 25%, 50%, 75%, 100% grid lines */}
      {[0, 25, 50, 75, 100].map((v) => {
        const yy = y(v);
        return (
          <g key={v}>
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
              {v}%
            </text>
          </g>
        );
      })}

      {/* 80% and 20% thresholds */}
      <line
        x1={pl}
        x2={W - pr}
        y1={y(80)}
        y2={y(80)}
        stroke="#22C55E"
        strokeDasharray="4 4"
        strokeOpacity={0.6}
      />
      <line
        x1={pl}
        x2={W - pr}
        y1={y(20)}
        y2={y(20)}
        stroke="#EF4444"
        strokeDasharray="4 4"
        strokeOpacity={0.6}
      />

      {/* Bars */}
      {codes.map((code, i) => {
        const inst = instruments.find((item) => item.symbol === code);
        if (!inst) return null;

        const cx = pl + slot * (i + 0.5);
        const sg = sig(inst.percentile);
        const fill =
          sg === "long" ? "#22C55E" : sg === "short" ? "#EF4444" : "#FFFFFF";
        const top = y(inst.percentile);
        const base = y(0);
        const active = code === selectedCode;
        const barHeight = Math.max(3, base - top);

        return (
          <g
            key={code}
            className="cursor-pointer"
            onClick={() => onSelectCode(code)}
          >
            <rect
              x={cx - bw / 2}
              y={top}
              width={bw}
              height={barHeight}
              rx={3}
              fill={fill}
              fillOpacity={active ? 1 : 0.78}
              stroke={active ? "#FFFFFF" : "none"}
              strokeWidth={active ? 2 : 0}
            />
            <text
              x={cx}
              y={Math.max(pt + 10, top - 6)}
              textAnchor="middle"
              className="cot-ax"
              fill={active ? "#FFFFFF" : "#A3A3A3"}
              fontSize={10}
            >
              {Math.round(inst.percentile)}%
            </text>
            <text
              x={cx}
              y={H - 12}
              textAnchor="middle"
              className="cot-lbl"
              fill={active ? "#FFFFFF" : "#A3A3A3"}
            >
              {code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
