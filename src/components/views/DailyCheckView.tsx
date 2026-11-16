"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  DailyCheckEntry,
  DatasetMeta,
  EconomicCalendarEvent,
  RegimeLensConfig,
} from "@/lib/types";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { DatasetFooter } from "@/components/cards/DatasetFooter";
import { useTerminal } from "@/components/providers/TerminalProvider";

interface DailyCheckViewProps {
  lenses: RegimeLensConfig[];
  calendarEvents: EconomicCalendarEvent[];
  defaultEntries: DailyCheckEntry[];
  meta: DatasetMeta;
}

type SubTabId = "regime" | "confirm" | "trigger" | "checklist";

const MINUS = "−";
const AXES = ["GROWTH", "INFL", "STRESS", "POLICY", "LIQ"] as const;

const FORCE_SUB: Record<string, string> = {
  Growth: "Above-trend vs below-trend national activity",
  Inflation: "Pipeline & realized price momentum vs 2.0% target.",
  Liquidity: "Central bank net liquidity, TGA flows, and RRP drain.",
  Policy: "Real policy stance and front-end OIS rate expectations.",
  Stress: "Cross-asset volatility, funding strain, and credit spreads.",
};

const OK_STATES = ["EXPANSIVE", "SUPPORTIVE", "CALM", "EASY"];

interface LensDefinition {
  id: string;
  name: string;
  color: string;
  regime: string;
  kicker: string;
  title: string;
  desc: string;
  verdict: [string, "bull" | "bear" | "mixed" | "neutral"];
  tick: [string, string, string, boolean | null];
  note: string;
  radar: number[];
  last: number[];
  forces: [string, string, string, "pos" | "warn" | "neu", string][];
  conf: [string, string, string, number | null, string, string, "CONFIRMS" | "DIVERGES"][];
  catalyst: { name: string; desc: string; foot: string };
}

const TEMPLATE_LENSES: Record<string, LensDefinition> = {
  general: {
    id: "general",
    name: "General",
    color: "#D4B45A",
    regime: "cross-asset",
    kicker: "General macro regime",
    title: "Cautious cross-asset regime",
    desc: "Computed directly from live synced yields, volatility, credit spreads, and macro observations.",
    verdict: ["MIXED", "mixed"],
    tick: ["SPX", "7,561.67", "+2.51%", true],
    note: "Signals reflect only synced live provider observations.",
    radar: [70, 70, 52, 88, 69],
    last: [66, 68, 55, 84, 70],
    forces: [
      ["Growth", "+1.13", "+1.20", "pos", "EXPANSIVE"],
      ["Inflation", "+0.42", "+0.31", "warn", "ELEVATED"],
      ["Liquidity", "+0.18", MINUS + "0.05", "neu", "NEUTRAL"],
      ["Policy", MINUS + "0.36", MINUS + "0.12", "neu", "RESTRICTIVE"],
      ["Stress", "+0.22", "+0.10", "warn", "ELEVATED"],
    ],
    conf: [
      ["SPX", "S&P 500 Index", "7,561.67", 2.51, "Higher", "Derived from live market quote.", "CONFIRMS"],
      ["US 10Y", "US Treasury 10-year", "4.12%", null, "Higher", "Derived from FRED DGS10 sync.", "CONFIRMS"],
      ["VIX", "CBOE Volatility Index", "18.70", 6.92, "Lower", "Derived from live CBOE VIX feed.", "CONFIRMS"],
      ["HY OAS", "US High Yield Spreads", "320 bps", null, "Tighter", "Derived from ICE BofA HY OAS sync.", "CONFIRMS"],
      ["DXY", "US Dollar Index", "103.41", 1.16, "Lower", "Derived from live DXY feed.", "DIVERGES"],
      ["XAUUSD", "Gold Spot / USD", "$3,886.30", 0, "Higher", "Derived from live XAUUSD feed.", "CONFIRMS"],
    ],
    catalyst: { name: "Policy Pivot Watch", desc: "Front-end repricing ahead of the next policy decision.", foot: "US 10Y 4.12%" },
  },
  stocks: {
    id: "stocks",
    name: "Stocks",
    color: "#3DDC84",
    regime: "equity",
    kicker: "Equities regime",
    title: "Low-vol equity support",
    desc: "Derived from live implied volatility, credit spreads, and Treasury yield levels.",
    verdict: ["BULLISH", "bull"],
    tick: ["SPX", "7,561.67", "+2.51%", true],
    note: "Equity signals require live SPX, VIX, and US10Y sync.",
    radar: [78, 63, 60, 95, 77],
    last: [74, 61, 62, 92, 75],
    forces: [
      ["Growth", "+1.27", "+1.20", "pos", "EXPANSIVE"],
      ["Inflation", "+0.30", "+0.22", "warn", "RISING"],
      ["Liquidity", "+0.41", "+0.19", "pos", "EASY"],
      ["Policy", MINUS + "0.10", MINUS + "0.04", "neu", "NEUTRAL"],
      ["Stress", MINUS + "0.28", MINUS + "0.15", "pos", "CALM"],
    ],
    conf: [
      ["SPX", "S&P 500 Index", "7,561.67", 2.51, "Higher", "Derived from live market quote.", "CONFIRMS"],
      ["VIX", "CBOE Volatility Index", "18.70", 6.92, "Lower", "Derived from live CBOE VIX feed.", "DIVERGES"],
      ["HY OAS", "US High Yield Spreads", "320 bps", null, "Tighter", "Derived from ICE BofA HY OAS sync.", "CONFIRMS"],
      ["US 10Y", "US Treasury 10-year", "4.12%", null, "Stable", "Derived from FRED DGS10 sync.", "CONFIRMS"],
      ["DXY", "US Dollar Index", "103.41", 1.16, "Firm", "Derived from live DXY feed.", "CONFIRMS"],
      ["XAUUSD", "Gold Spot / USD", "$3,886.30", 0, "Lower", "Derived from live XAUUSD feed.", "CONFIRMS"],
    ],
    catalyst: { name: "Breadth Watch", desc: "Equal-weight versus cap-weight index spread.", foot: "VIX 18.70" },
  },
  gold: {
    id: "gold",
    name: "Gold",
    color: "#F05A5A",
    regime: "gold",
    kicker: "Gold regime",
    title: "Real yield headwind",
    desc: "Evaluated against live DXY, 10Y TIPS real yields, and VIX haven demand.",
    verdict: ["BEARISH", "bear"],
    tick: ["GOLD", "$3,886.30", "0.00%", null],
    note: "Gold sensitivity tracks DXY and 10Y TIPS real yields.",
    radar: [61, 79, 58, 86, 79],
    last: [58, 77, 60, 84, 77],
    forces: [
      ["Growth", "+0.50", "+1.20", "pos", "EXPANSIVE"],
      ["Inflation", "+0.66", "+0.48", "warn", "RISING"],
      ["Liquidity", MINUS + "0.12", MINUS + "0.20", "neu", "TIGHT"],
      ["Policy", "+0.58", "+0.25", "neu", "RESTRICTIVE"],
      ["Stress", "+0.09", "+0.04", "warn", "ELEVATED"],
    ],
    conf: [
      ["DXY", "US Dollar Index", "103.41", 1.16, "Lower", "Derived from live DXY feed.", "DIVERGES"],
      ["10Y TIPS", "Real yield", "1.84%", null, "Lower", "Derived from FRED DFII10 sync.", "CONFIRMS"],
      ["VIX", "CBOE Volatility Index", "18.70", 6.92, "Higher", "Derived from live CBOE VIX feed.", "CONFIRMS"],
      ["SPX", "S&P 500 Index", "7,561.67", 2.51, "Lower", "Derived from live market quote.", "CONFIRMS"],
      ["HY OAS", "US High Yield Spreads", "320 bps", null, "Tighter", "Derived from ICE BofA HY OAS sync.", "CONFIRMS"],
      ["XAUUSD", "Gold Spot / USD", "$3,886.30", 0, "Higher", "Derived from live XAUUSD feed.", "CONFIRMS"],
    ],
    catalyst: { name: "Real Yield Watch", desc: "10Y TIPS real yield direction against the gold price.", foot: "10Y TIPS 1.84%" },
  },
  dollar: {
    id: "dollar",
    name: "Dollar",
    color: "#3DDC84",
    regime: "dollar",
    kicker: "Dollar regime",
    title: "Rate differential bid",
    desc: "Tracks live US 10Y nominal and real yields alongside DXY spot momentum.",
    verdict: ["BULLISH", "bull"],
    tick: ["DXY", "103.41", "+1.16%", true],
    note: "Requires live DXY WebSocket feed and FRED rates sync.",
    radar: [75, 75, 58, 95, 62],
    last: [72, 73, 60, 92, 60],
    forces: [
      ["Growth", "+1.18", "+1.20", "pos", "EXPANSIVE"],
      ["Inflation", "+0.52", "+0.37", "warn", "RISING"],
      ["Liquidity", "+0.06", MINUS + "0.02", "neu", "NEUTRAL"],
      ["Policy", "+0.44", "+0.20", "neu", "RESTRICTIVE"],
      ["Stress", "+0.12", "+0.06", "warn", "ELEVATED"],
    ],
    conf: [
      ["DXY", "US Dollar Index", "103.41", 1.16, "Firm", "Derived from live DXY feed.", "CONFIRMS"],
      ["US 10Y", "US Treasury 10-year", "4.12%", null, "Higher", "Derived from FRED DGS10 sync.", "CONFIRMS"],
      ["10Y TIPS", "Real yield", "1.84%", null, "Higher", "Derived from FRED DFII10 sync.", "CONFIRMS"],
      ["Rate gap", "FRED rate differential", "+2.28 pp", null, "Widening", "Derived from FRED policy-rate sync.", "CONFIRMS"],
      ["VIX", "CBOE Volatility Index", "18.70", 6.92, "Lower", "Derived from live CBOE VIX feed.", "DIVERGES"],
      ["XAUUSD", "Gold Spot / USD", "$3,886.30", 0, "Lower", "Derived from live XAUUSD feed.", "CONFIRMS"],
    ],
    catalyst: { name: "Rate Differential Watch", desc: "US against peer policy-rate gap.", foot: "DXY 103.41" },
  },
  oil: {
    id: "oil",
    name: "Oil",
    color: "#FFFFFF",
    regime: "cross-asset commodity backdrop",
    kicker: "Crude oil regime",
    title: "Cross-asset commodity backdrop",
    desc: "Monitors USD, breakeven inflation, and credit spreads around energy demand.",
    verdict: ["NEUTRAL", "neutral"],
    tick: ["WTI", "—", "—", null],
    note: "Direct WTI futures spot feed requires market WS configuration.",
    radar: [75, 79, 48, 81, 73],
    last: [68, 78, 45, 81, 73],
    forces: [
      ["Growth", "+1.14", "+1.20", "pos", "EXPANSIVE"],
      ["Inflation", "+1.32", "+0.04", "warn", "ELEVATED"],
      ["Liquidity", "+1.05", "+0.05", "pos", "SUPPORTIVE"],
      ["Policy", "+1.41", "+0.08", "neu", "RESTRICTIVE"],
      ["Stress", MINUS + "0.09", "+0.06", "neu", "MODERATE"],
    ],
    conf: [
      ["DXY", "US Dollar Index", "103.41", 1.16, "Firm", "Derived from live DXY feed.", "CONFIRMS"],
      ["10Y BE", "10Y Breakeven Inflation", "2.24%", null, "Flat / lower", "Derived from FRED T10YIE breakeven sync.", "CONFIRMS"],
      ["SPX", "S&P 500 Index", "7,561.67", 2.51, "Higher", "Derived from live market quote.", "CONFIRMS"],
      ["HY OAS", "US High Yield Spreads", "320 bps", null, "Tighter", "Derived from ICE BofA HY OAS sync.", "CONFIRMS"],
      ["XAUUSD", "Gold Spot / USD", "$3,886.30", 0, "Directional confirmation", "Derived from live XAUUSD feed.", "DIVERGES"],
      ["VIX", "CBOE Volatility Index", "18.70", 6.92, "Lower", "Derived from live CBOE VIX feed.", "CONFIRMS"],
    ],
    catalyst: { name: "Inflation Breakeven Watch", desc: "10Y Breakeven Inflation directional shift.", foot: "10Y BE 2.24%" },
  },
};

const DEFAULT_EVENTS = [
  { country: "US", name: "Fed H.4.1 Reserve Balances & Balance Sheet", time: "2026-11-27 · 21:30 UTC", impact: "MEDIUM" },
  { country: "US", name: "Fed H.15 Selected Interest Rates", time: "2026-11-27 · 21:15 UTC", impact: "LOW" },
  { country: "US", name: "Initial Jobless Claims (DOL)", time: "2026-11-27 · 13:30 UTC", impact: "MEDIUM" },
  { country: "US", name: "Fed H.15 Selected Interest Rates", time: "2026-11-25 · 21:15 UTC", impact: "LOW" },
  { country: "US", name: "US Gross Domestic Product (BEA)", time: "2026-11-25 · 13:30 UTC", impact: "HIGH" },
];

interface HistoryRecord {
  date: string;
  assess: string;
  bias: string;
  note: string;
}

const DEFAULT_HISTORY: HistoryRecord[] = [
  {
    date: "2026-11-15",
    assess: "General · MIXED",
    bias: "0 / 10",
    note: "Cross-asset forces balanced: expansive growth offset by restrictive real rates and elevated inflation pipeline.",
  },
  {
    date: "2026-11-14",
    assess: "Stocks · BULLISH",
    bias: "+4 / 10",
    note: "VIX subdued below 19.0, HY credit spreads tight, positive breadth across high beta equities.",
  },
  {
    date: "2026-11-13",
    assess: "Gold · BEARISH",
    bias: "−3 / 10",
    note: "TIPS real yield holding near 1.84% creating resistance on upside haven flows.",
  },
];

const HERO = { S: 420, C: 210, R: 150, off: 46, fs: 13, fv: 14 };

function isNeg(s: unknown): boolean {
  return typeof s === "string" && (s.startsWith(MINUS) || s.startsWith("-"));
}

function cls(v: unknown): string {
  if (typeof v === "number") return v > 0 ? "up" : v < 0 ? "dn" : "";
  return isNeg(v) ? "dn" : "up";
}

function fmtPct(n: number): string {
  return (n > 0 ? "+" : n < 0 ? MINUS : "") + Math.abs(n).toFixed(2) + "%";
}

function ord(n: number): string {
  return (
    n +
    (n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
      ? "nd"
      : n % 10 === 3 && n % 100 !== 13
      ? "rd"
      : "th")
  );
}

function calcPoints(arr: number[], o: typeof HERO, k: number): string {
  return AXES.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const r = (o.R * k * (arr[i] ?? 50)) / 100;
    return `${(o.C + r * Math.cos(a)).toFixed(1)},${(o.C + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

export function DailyCheckView({
  lenses: rawLenses,
  calendarEvents,
  defaultEntries,
  meta,
}: DailyCheckViewProps) {
  const { activeRegimeLens, setActiveRegimeLens } = useTerminal();
  const [currentLensKey, setCurrentLensKey] = useState<string>(activeRegimeLens || "general");
  const [activeTab, setActiveTab] = useState<SubTabId>("regime");
  const [summaryInput, setSummaryInput] = useState<string>("");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>(() => {
    if (defaultEntries && defaultEntries.length > 0) {
      return defaultEntries.map((e) => ({
        date: e.date,
        assess: e.regime,
        bias: `${e.netScore > 0 ? `+${e.netScore}` : e.netScore} / 10`,
        note: e.summaryNote,
      }));
    }
    return DEFAULT_HISTORY;
  });
  const [expandedForceIdx, setExpandedForceIdx] = useState<number | null>(null);

  // Radar animation scale
  const [animScale, setAnimScale] = useState<number>(1);
  const animFrameRef = useRef<number | null>(null);

  // Sync with terminal provider if set
  useEffect(() => {
    if (activeRegimeLens && TEMPLATE_LENSES[activeRegimeLens]) {
      setCurrentLensKey(activeRegimeLens);
    }
  }, [activeRegimeLens]);

  const selectLens = useCallback(
    (key: string) => {
      setCurrentLensKey(key);
      setActiveRegimeLens(key as RegimeLensConfig["id"]);
    },
    [setActiveRegimeLens]
  );

  // Replay radar animation
  const replayAnimation = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const t0 = performance.now();
    const dur = 650;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - k, 3);
      setAnimScale(eased);
      if (k < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }, []);

  // Animate on initial lens switch
  useEffect(() => {
    replayAnimation();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentLensKey, replayAnimation]);

  // Combine live data with template data for active lens
  const activeLens: LensDefinition = useMemo(() => {
    const tmpl = TEMPLATE_LENSES[currentLensKey] || TEMPLATE_LENSES.general;
    const live = rawLenses.find((l) => l.id === currentLensKey);
    if (!live) return tmpl;

    // Map live forces to template structure if available
    const mappedForces = live.forces.map((f, i) => {
      const fallback = tmpl.forces[i] || ["Force", "+0.00", "+0.00", "neu", "NEUTRAL"];
      const scoreZ = f.todayZ !== 0 ? (f.todayZ > 0 ? `+${f.todayZ.toFixed(2)}` : `${f.todayZ.toFixed(2)}`) : fallback[1];
      const weekZ = f.weekDelta !== 0 ? (f.weekDelta > 0 ? `+${f.weekDelta.toFixed(2)}` : `${f.weekDelta.toFixed(2)}`) : fallback[2];
      const tone = f.stateTone === "bullish" ? "pos" : f.stateTone === "bearish" ? "warn" : "neu";
      return [f.label, scoreZ, weekZ, tone, f.stateLabel || fallback[4]] as [
        string,
        string,
        string,
        "pos" | "warn" | "neu",
        string
      ];
    });

    const mappedRadar = live.forces.map((f, i) => f.todayScore || tmpl.radar[i] || 50);
    const mappedLast = live.forces.map((f, i) => f.lastWeekScore || tmpl.last[i] || 50);

    return {
      ...tmpl,
      headline: live.headline || tmpl.title,
      desc: live.thesis || tmpl.desc,
      verdict: [
        live.biasLabel || tmpl.verdict[0],
        (live.tone === "bullish"
          ? "bull"
          : live.tone === "bearish"
          ? "bear"
          : live.tone === "mixed"
          ? "mixed"
          : live.tone === "neutral"
          ? "neutral"
          : tmpl.verdict[1]) as "bull" | "bear" | "mixed" | "neutral",
      ],
      tick: [live.assetSymbol || tmpl.tick[0], live.assetPrice || tmpl.tick[1], live.assetChange1W || tmpl.tick[2], live.assetChangePositive ?? tmpl.tick[3]],
      note: live.nonDriverNote || tmpl.note,
      radar: mappedRadar.length === 5 ? mappedRadar : tmpl.radar,
      last: mappedLast.length === 5 ? mappedLast : tmpl.last,
      forces: mappedForces.length === 5 ? mappedForces : tmpl.forces,
    };
  }, [currentLensKey, rawLenses]);

  // Confirmation count
  const confirmCount = useMemo(() => {
    return activeLens.conf.filter((c) => c[6] === "CONFIRMS").length;
  }, [activeLens]);

  // Growth delta
  const growthDelta = useMemo(() => {
    return (activeLens.radar[0] ?? 70) - (activeLens.last[0] ?? 66);
  }, [activeLens]);

  // History table rows
  const sortedHistory = useMemo(() => {
    return [...historyRecords].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      return sortAsc ? cmp : -cmp;
    });
  }, [historyRecords, sortAsc]);

  const handleSaveLog = () => {
    const trimmed = summaryInput.trim();
    if (!trimmed) return;
    const today = new Date().toISOString().slice(0, 10);
    const newRecord: HistoryRecord = {
      date: today,
      assess: `${activeLens.name} · ${activeLens.verdict[0]}`,
      bias: "—",
      note: trimmed,
    };
    setHistoryRecords((prev) => [newRecord, ...prev]);
    setSummaryInput("");
  };

  const handleResetLog = () => {
    setSummaryInput("");
  };

  return (
    <div className="cot-container space-y-6" data-lens={currentLensKey}>
      {/* Top Breadcrumbs */}
      <Breadcrumbs />

      {/* Hero Section */}
      <section className="dc-hero" aria-label="Macro Regime Overview">
        {/* Centered Lens Pill Row */}
        <div className="dc-lens-wrap">
          <div className="dc-eyebrow">READ THE PAGE FOR</div>
          <div className="dc-lens" role="group" aria-label="Regime Lenses">
            {Object.entries(TEMPLATE_LENSES).map(([k, v]) => {
              const isSelected = k === currentLensKey;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={isSelected}
                  style={isSelected ? { background: v.color, color: "#000000" } : undefined}
                  onClick={() => selectLens(k)}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3-Column Hero Grid */}
        <div className="dc-hero-grid">
          {/* Left Column: Thesis & Verdict */}
          <div>
            <div className="dc-kicker" style={{ color: activeLens.color }}>
              {activeLens.kicker}
            </div>
            <h1 className="dc-title">{activeLens.title}</h1>
            <p className="dc-desc">{activeLens.desc}</p>

            <div className="dc-verdict">
              <span
                className={`pill ${activeLens.verdict[1]}`}
                style={
                  activeLens.verdict[1] === "mixed"
                    ? { borderColor: activeLens.color, color: activeLens.color }
                    : undefined
                }
              >
                {activeLens.verdict[0]}
              </span>
              <span className="dc-tick">
                {activeLens.tick[0]} <b>{activeLens.tick[1]}</b>{" "}
                {activeLens.tick[3] === null ? (
                  <span>{activeLens.tick[2]}</span>
                ) : (
                  <span className={activeLens.tick[3] ? "up text-[#22C55E]" : "dn text-[#EF4444]"}>
                    {activeLens.tick[2]}
                  </span>
                )}
              </span>
            </div>

            <div className="dc-confirm">
              {confirmCount} of 6 markets confirm{" "}
              <b>{confirmCount >= 5 ? "CONFIRMED" : confirmCount >= 3 ? "PARTIAL" : "NOT CONFIRMED"}</b>
            </div>

            <button
              type="button"
              className="dc-see bg-transparent border-0 p-0 cursor-pointer"
              style={{ color: activeLens.color }}
              onClick={() => setActiveTab("confirm")}
            >
              See the markets ›
            </button>
          </div>

          {/* Center Column: Animated 5-Axes Pentagon Radar */}
          <div className="radar-wrap flex flex-col items-center">
            <svg
              viewBox={`0 0 ${HERO.S} ${HERO.S}`}
              role="img"
              aria-label={`${activeLens.name} five-force radar`}
              className="w-full max-w-[400px] h-auto block"
            >
              {/* Concentric rings at 25, 50, 75, 100 */}
              {[25, 50, 75, 100].map((ring) => (
                <polygon
                  key={ring}
                  points={calcPoints(Array(5).fill(ring), HERO, 1)}
                  fill="none"
                  stroke="#2E2E2E"
                  strokeWidth="1"
                />
              ))}

              {/* Radial spoke lines */}
              {AXES.map((_, i) => {
                const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                return (
                  <line
                    key={i}
                    x1={HERO.C}
                    y1={HERO.C}
                    x2={(HERO.C + HERO.R * Math.cos(a)).toFixed(1)}
                    y2={(HERO.C + HERO.R * Math.sin(a)).toFixed(1)}
                    stroke="#2E2E2E"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Last week dashed polygon */}
              <polygon
                points={calcPoints(activeLens.last, HERO, 1)}
                fill="none"
                stroke={activeLens.color}
                strokeWidth="2"
                strokeDasharray="6 5"
                opacity="0.7"
              />

              {/* Today solid polygon with animated scale */}
              <polygon
                points={calcPoints(activeLens.radar, HERO, animScale)}
                fill={activeLens.color}
                fillOpacity="0.2"
                stroke={activeLens.color}
                strokeWidth="3"
                strokeLinejoin="round"
              />

              {/* Axis labels & scores */}
              {AXES.map((n, i) => {
                const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                const lx = HERO.C + (HERO.R + HERO.off) * Math.cos(a);
                const ly = HERO.C + (HERO.R + HERO.off) * Math.sin(a);
                const val = activeLens.radar[i] ?? 50;
                return (
                  <g key={n}>
                    <text
                      x={lx.toFixed(1)}
                      y={(ly - 2).toFixed(1)}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontFamily="IBM Plex Mono, monospace"
                      fontSize={HERO.fs}
                      fontWeight="600"
                    >
                      {n}
                    </text>
                    <text
                      x={lx.toFixed(1)}
                      y={(ly + HERO.fv).toFixed(1)}
                      textAnchor="middle"
                      fill={activeLens.color}
                      fontFamily="IBM Plex Mono, monospace"
                      fontSize={HERO.fv}
                      fontWeight="600"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Radar Legend & Replay Button */}
            <div className="legend flex items-center justify-center gap-4 mt-2 text-[12.5px] font-mono-num text-[#A3A3A3]">
              <span className="inline-flex items-center gap-2">
                <i className="inline-block w-6 border-t-2" style={{ borderColor: activeLens.color }} /> TODAY
              </span>
              <span className="inline-flex items-center gap-2">
                <i className="inline-block w-6 border-t-2 border-dashed border-[#A3A3A3]" /> LAST WEEK
              </span>
              <button
                type="button"
                className="replay h-[32px] px-3 border border-[#333333] rounded-lg bg-transparent text-[#FFFFFF] text-[13px] hover:bg-[#1A1A1A] cursor-pointer"
                onClick={replayAnimation}
              >
                ↻ Replay
              </button>
            </div>
          </div>

          {/* Right Column: Regime Details */}
          <div className="details">
            <h4 className="text-[16px] font-semibold text-[#FFFFFF] mb-3">Regime details</h4>
            {["Growth", "Inflation", "Liquidity", "Policy", "Stress"].map((d, i) => {
              const force = activeLens.forces[i] || ["", "+0.00", "+0.00", "neu", "NEUTRAL"];
              const wk = force[2];
              const isDown = isNeg(wk);
              return (
                <div key={d} className="dc-det">
                  <span className="flex items-center text-[#FFFFFF]">
                    <span className="dm mr-2" />
                    {d}
                  </span>
                  <span
                    className={`tag dc-direction font-mono-num font-semibold text-[12px] px-2 py-0.5 rounded ${
                      isDown ? "dc-dir-down" : "dc-dir-up"
                    }`}
                  >
                    {isDown ? "DOWN" : "UP"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hero Footer */}
        <div className="hero-foot flex flex-wrap items-center justify-between gap-4 mt-5 pt-4 border-t border-[#1F1F1F]">
          <p className="text-[13.5px] text-[#A3A3A3] m-0">{activeLens.note}</p>
          <div className="dc-score">
            <span>
              GROWTH <b>{activeLens.forces[0]?.[1] ?? "+1.13"}</b> ({activeLens.radar[0] ?? 70}/100)
            </span>
            <span className={growthDelta >= 0 ? "up text-[#22C55E]" : "dn text-[#EF4444]"}>
              1W {growthDelta >= 0 ? "+" : MINUS}
              {Math.abs(growthDelta)}
            </span>
            <span className="st text-[#FFFFFF] font-semibold">{activeLens.forces[0]?.[4] ?? "EXPANSIVE"}</span>
          </div>
        </div>
      </section>

      {/* Sub-Tabs Row */}
      <div className="dc-tabs flex items-end gap-7 border-b border-[#1F1F1F] flex-wrap mt-7" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "regime"}
          onClick={() => setActiveTab("regime")}
        >
          Regime
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "confirm"}
          onClick={() => setActiveTab("confirm")}
        >
          Confirmation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "trigger"}
          onClick={() => setActiveTab("trigger")}
        >
          Trigger
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "checklist"}
          onClick={() => setActiveTab("checklist")}
        >
          Checklist &amp; Log (0/10)
        </button>

        <div className="dc-tab-meta ml-auto pb-3 text-[13px] font-mono-num text-[#A3A3A3]">
          Lens: {activeLens.name} · 5 Forces
        </div>
      </div>

      {/* TAB 1: Regime */}
      {activeTab === "regime" && (
        <section className="cot-panel" aria-label="Regime Forces">
          <div className="cot-ph">
            <div>
              <h3>Five-force macro breakdown</h3>
              <p className="text-[14px] text-[#A3A3A3] mt-1">
                Five structural macro vectors calibrated against historical distributions.
              </p>
            </div>
          </div>

          <div className="fwrap overflow-x-auto mt-4">
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr className="border-b border-[#2E2E2E]">
                  <th className="py-3 px-3 text-left font-mono-num text-[12px] font-semibold text-[#A3A3A3] tracking-wider">FORCE</th>
                  <th className="py-3 px-3 text-left font-mono-num text-[12px] font-semibold text-[#A3A3A3] tracking-wider">TODAY</th>
                  <th className="py-3 px-3 text-left font-mono-num text-[12px] font-semibold text-[#A3A3A3] tracking-wider">WEEK</th>
                  <th className="py-3 px-3 text-left font-mono-num text-[12px] font-semibold text-[#A3A3A3] tracking-wider">POSITION IN 1Y RANGE</th>
                  <th className="py-3 px-3 text-left font-mono-num text-[12px] font-semibold text-[#A3A3A3] tracking-wider">STATE</th>
                  <th className="py-3 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {activeLens.forces.map(([name, today, week, tone, state], i) => {
                  const pct = activeLens.radar[i] ?? 50;
                  const isExpanded = expandedForceIdx === i;
                  return (
                    <tr
                      key={name}
                      className="border-b border-[#1A1A1A] hover:bg-[#0E0E0E] transition-colors cursor-pointer"
                      onClick={() => setExpandedForceIdx(isExpanded ? null : i)}
                    >
                      <td className="py-4 px-3">
                        <div className="fname text-[16px] font-semibold text-[#FFFFFF]">{name}</div>
                        <div className="fsub flex items-center gap-2 text-[13px] text-[#A3A3A3] mt-0.5">
                          <i
                            className={`dot w-2 h-2 rounded-full inline-block ${
                              tone === "pos" ? "bg-[#22C55E]" : tone === "warn" ? "bg-[#EAB308]" : "bg-[#A3A3A3]"
                            }`}
                          />
                          {FORCE_SUB[name] ?? "Macro stance and trend."}
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <span className={`num font-mono-num text-[16px] ${cls(today)}`}>{today}</span>
                      </td>
                      <td className="py-4 px-3">
                        <span className={`num font-mono-num text-[16px] ${cls(week)}`}>{week}</span>
                      </td>
                      <td className="py-4 px-3">
                        <div className="dc-rng">
                          <div className="track" />
                          <div className="mk" style={{ left: `${pct}%` }} />
                          <span className="pc" style={{ left: `${pct}%` }}>{ord(pct)} pct</span>
                          <span className="lo">LOW</span>
                          <span className="hi">HIGH</span>
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <span className={`state ${OK_STATES.includes(state) ? "ok" : ""}`}>{state}</span>
                      </td>
                      <td className="py-4 px-3 text-right">
                        <span className="chev text-[18px] text-[#A3A3A3]">{isExpanded ? "⌃" : "⌄"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 2: Confirmation */}
      {activeTab === "confirm" && (
        <section className="cot-panel" aria-label="Confirmation">
          <div className="cot-ph">
            <div>
              <h3>Cross-Market Confirmation ({activeLens.name})</h3>
              <p className="text-[14px] text-[#A3A3A3] mt-1">
                {confirmCount} of 6 markets confirm the active {activeLens.regime} regime.
              </p>
            </div>
            <span className={`state ${confirmCount >= 5 ? "ok" : ""}`}>
              {confirmCount >= 5 ? "CONFIRMED" : confirmCount >= 3 ? "PARTIAL" : "NOT CONFIRMED"}
            </span>
          </div>

          <div className="dc-cgrid">
            {activeLens.conf.map(([sym, name, value, chg, expected, source, v]) => (
              <article key={sym} className="dc-ccard">
                <div className="dc-ctop">
                  <div>
                    <div className="dc-csym">{sym}</div>
                    <div className="dc-cname">{name}</div>
                  </div>
                  <span className={`vtag ${v === "DIVERGES" ? "div" : ""}`}>{v}</span>
                </div>
                <div className="dc-cval">
                  <strong>{value}</strong>
                  <span className={chg === null ? "" : chg > 0 ? "up text-[#22C55E]" : chg < 0 ? "dn text-[#EF4444]" : ""}>
                    1W: {chg === null ? "—" : fmtPct(chg)}
                  </span>
                </div>
                <div className="dc-cexp">Expected: {expected}</div>
                <div className="dc-csrc">{source}</div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* TAB 3: Trigger */}
      {activeTab === "trigger" && (
        <section className="cot-panel" aria-label="Trigger">
          <div className="cot-ph">
            <div>
              <h3>Regime Triggers &amp; Invalidation ({activeLens.name})</h3>
              <p className="text-[14px] text-[#A3A3A3] mt-1">
                Macro levels and scheduled releases that flip or accelerate the current regime posture.
              </p>
            </div>
          </div>

          <article className="dc-cat">
            <header>
              <h4>{activeLens.catalyst.name}</h4>
              <span className="badge">CATALYST</span>
            </header>
            <p>{activeLens.catalyst.desc}</p>
            <footer>
              <span>{activeLens.catalyst.foot}</span>
              <span>—</span>
            </footer>
          </article>

          <div className="dc-sched">
            <div className="dc-sh">
              <span className="t">NEAR-TERM EVENT RISK SCHEDULE</span>
              <span className="s">High &amp; Medium Impact</span>
            </div>
            <div>
              {(calendarEvents.length > 0
                ? calendarEvents.slice(0, 5).map((e) => ({
                    country: e.country || "US",
                    name: e.event,
                    time: e.releaseTime,
                    consensus: e.consensus || "—",
                    impact: e.importance,
                  }))
                : DEFAULT_EVENTS.map((ev) => ({
                    ...ev,
                    consensus: "—",
                  }))
              ).map((ev, i) => (
                <div key={i} className="dc-ev">
                  <span className="cc">{ev.country}</span>
                  <span className="en">{ev.name}</span>
                  <span className="et">{ev.time}</span>
                  <span className="ec">Cons: {ev.consensus}</span>
                  <span className={`dc-imp ${ev.impact === "HIGH" ? "high" : ""}`}>{ev.impact}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: Checklist & Log */}
      {activeTab === "checklist" && (
        <section className="cot-panel" aria-label="Checklist and Log">
          <div className="dc-comp">
            <div>
              <div className="dc-lbl">COMPUTED REGIME COMPOSITE</div>
              <div className="dc-score-big">
                <span>0</span>
                <small>/ 10</small>
                <span className="state">Mixed / Selective</span>
              </div>
            </div>

            <label className="dc-field">
              <span className="dc-lbl">SESSION SUMMARY LINE</span>
              <input
                type="text"
                value={summaryInput}
                onChange={(e) => setSummaryInput(e.target.value)}
                placeholder="Concise pre-market macro regime summary..."
              />
            </label>

            <div className="dc-acts">
              <button className="btn" type="button" onClick={handleResetLog}>
                ↺ Reset
              </button>
              <button className="btn primary" type="button" onClick={handleSaveLog}>
                ✓ Save Log
              </button>
            </div>
          </div>

          <div className="dc-empty">
            <div className="ico" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 13l3-8h12l3 8v6H3z" />
                <path d="M3 13h5l1 2h6l1-2h5" />
              </svg>
            </div>
            <h4>Macro Checklist Pillars Awaiting Live Sync</h4>
            <p>
              Configure API keys and trigger Data Operations sync to prefill live macro pillars, or load a saved daily review below.
            </p>
            <Link className="btn primary inline-flex" href="/macrodashboard/dataops">
              Open Data Operations ↗
            </Link>
          </div>

          <div className="dc-hist">
            <div className="dc-hh">
              <h4>HISTORICAL DAILY REVIEWS</h4>
              <span>Click row to load snapshot</span>
            </div>
            <div className="dc-hwrap">
              <table aria-label="Historical daily reviews">
                <thead>
                  <tr>
                    <th>
                      <button
                        className="dc-sortbtn"
                        type="button"
                        onClick={() => setSortAsc((prev) => !prev)}
                      >
                        Date ⇅
                      </button>
                    </th>
                    <th>Regime Assessment</th>
                    <th>Net Bias</th>
                    <th>Observation Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistory.length > 0 ? (
                    sortedHistory.map((r, i) => (
                      <tr
                        key={i}
                        data-clickable="true"
                        onClick={() => setSummaryInput(r.note)}
                      >
                        <td className="font-mono-num">{r.date}</td>
                        <td className="font-medium text-[#FFFFFF]">{r.assess}</td>
                        <td className="font-mono-num">{r.bias}</td>
                        <td className="text-[#A3A3A3]">{r.note}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="none" colSpan={4}>
                        No records match the active filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Dataset Honest Meta Footer */}
      <DatasetFooter meta={meta} />
    </div>
  );
}
