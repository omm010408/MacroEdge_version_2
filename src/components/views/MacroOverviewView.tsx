"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { AutoSyncDebugModal } from "@/components/dashboard/AutoSyncDebugModal";
import { EconomicCalendar } from "@/components/dashboard/EconomicCalendar";
import type {
  CorrelationAssetSeries,
  DatasetMeta,
  EconomicCalendarEvent,
  MacroRegimeFactor,
  MarketOverviewCardData,
} from "@/lib/types";
import type { AiBiasSummary } from "@/lib/ai-models/types";
import type { FilteredMarketauxArticle } from "@/services/marketaux/ai-filter";

interface AssetSpec {
  name: string;
  cls: string;
  v: number;
  dec: number;
  unit: string;
  drift: number;
}

const ASSETS: Record<string, AssetSpec> = {
  DXY:    { name: "DXY",          cls: "FX",          v: 103.17,  dec: 2, unit: "",  drift: 0.012 },
  US10Y:  { name: "US10Y yield",  cls: "Rates",       v: 4.98,    dec: 2, unit: "%", drift: -0.0496 },
  US02Y:  { name: "US02Y yield",  cls: "Rates",       v: 4.73,    dec: 2, unit: "%", drift: -0.0312 },
  US10YR: { name: "US10YR",       cls: "Rates",       v: 2.78,    dec: 2, unit: "%", drift: 0.0215 },
  VIX:    { name: "VIX",          cls: "Volatility",  v: 17.49,   dec: 2, unit: "",  drift: -0.12 },
  XAUUSD: { name: "XAUUSD",       cls: "Commodities", v: 3885.30, dec: 2, unit: "",  drift: 0.18 },
  SPX:    { name: "S&P 500",      cls: "Equities",    v: 7619.38, dec: 2, unit: "",  drift: 0.1034 },
  BTCUSD: { name: "BTCUSD",       cls: "Crypto",      v: 68726,   dec: 0, unit: "",  drift: 0.0821 },
};

const RANGES: Record<string, { n: number; days: number }> = {
  "1M": { n: 30, days: 30 },
  "3M": { n: 46, days: 90 },
  "6M": { n: 53, days: 182 },
  "1Y": { n: 53, days: 364 },
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TICKERS = ["DIA", "SPY", "TLT", "IEF", "QQQ", "GLD", "DXY", "US10Y", "XAUUSD", "IAU"];

const nf = (n: number, d: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtVal = (a: AssetSpec, v: number) =>
  a.unit === "%" ? v.toFixed(2) + "%" : nf(v, a.dec);
const hhmm = () =>
  new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

const seedOf = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const rnd = (seed: number) => () =>
  ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function computeSeries(key: string, r: string, livePrice?: number): number[] {
  const a = ASSETS[key] ?? ASSETS.US10Y;
  const targetVal =
    livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : a.v;
  const R = RANGES[r] ?? RANGES["1Y"];
  const span = R.days / 364;
  const start = targetVal / (1 + a.drift * span);
  const rand = rnd(seedOf(key + r));
  const ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const amp = targetVal * 0.0045 * Math.sqrt(span) + Math.abs(targetVal - start) * 0.12;
  const out: number[] = [];
  for (let i = 0; i < R.n; i++) {
    const t = i / (R.n - 1);
    const wob =
      Math.sin(t * 7.1 + ph[0]) * 0.55 +
      Math.sin(t * 19.3 + ph[1]) * 0.3 +
      Math.sin(t * 43.7 + ph[2]) * 0.15;
    out.push(start + (targetVal - start) * t + wob * amp);
  }
  out[0] = start;
  out[out.length - 1] = targetVal;
  return out;
}

function computeDates(r: string, end: Date): Date[] {
  const R = RANGES[r] ?? RANGES["1Y"];
  const out: Date[] = [];
  for (let i = 0; i < R.n; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - Math.round(R.days * (1 - i / (R.n - 1))));
    out.push(d);
  }
  return out;
}

function curve(p: [number, number][]): string {
  if (p.length === 0) return "";
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

interface NewsItem {
  id: number;
  url?: string;
  assets: string[];
  tickers: string[];
  tag: string;
  tagClass?: string;
  match: string;
  theme: string;
  title: string;
  signals?: { label: string; cls?: string }[];
  catalyst?: string;
  transmission?: string;
  drivers?: string;
  sourceDate: string;
  isSkeleton?: boolean;
}

function formatNewsStamp(isoOrStr?: string): string {
  if (!isoOrStr) {
    const d = new Date();
    return (
      d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    );
  }
  try {
    const d = new Date(isoOrStr);
    if (!Number.isNaN(d.getTime())) {
      return (
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }) + " IST"
      );
    }
  } catch {
    // fallback
  }
  return isoOrStr;
}

function mapArticleToNewsItem(item: FilteredMarketauxArticle, idx: number): NewsItem {
  const assets: string[] =
    item.targetAsset === "BOTH"
      ? ["XAU", "US30"]
      : item.targetAsset === "GOLD"
      ? ["XAU"]
      : ["US30"];

  const tag =
    item.targetAsset === "BOTH"
      ? "Dual impact (XAU & US30)"
      : item.targetAsset === "GOLD"
      ? "Gold (XAUUSD)"
      : "Dow Jones (US30)";

  const signals: { label: string; cls?: string }[] = [];
  signals.push({ label: "AI signal" });
  if (item.goldImpact) {
    signals.push({
      label: `XAUUSD ${item.goldImpact.toLowerCase()}`,
      cls:
        item.goldImpact === "BULLISH"
          ? "sig bull"
          : item.goldImpact === "BEARISH"
          ? "sig bear"
          : "sig neu",
    });
  }
  if (item.us30Impact) {
    signals.push({
      label: `US30 ${item.us30Impact.toLowerCase()}`,
      cls:
        item.us30Impact === "BULLISH"
          ? "sig bull"
          : item.us30Impact === "BEARISH"
          ? "sig bear"
          : "sig neu",
    });
  }
  if (typeof item.sentimentScore === "number") {
    const sign = item.sentimentScore >= 0 ? "+" : "−";
    signals.push({
      label: `Sentiment ${sign}${Math.abs(item.sentimentScore).toFixed(2)}`,
    });
  }

  const dt = new Date(item.publishedAt);
  const formattedDate = !Number.isNaN(dt.getTime())
    ? dt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : item.publishedAt;

  return {
    id: idx + 1,
    url: item.url,
    assets,
    tickers: item.entities || [],
    tag,
    match: `${item.relevanceScore || 92}% AI match`,
    theme: item.transmissionChannel || "Macro Transmission",
    title: item.title,
    signals,
    catalyst: item.summary,
    transmission: item.aiRationale,
    drivers: Array.isArray(item.keyDrivers) ? item.keyDrivers.join(", ") : "",
    sourceDate: `${item.source || "Marketaux"}, ${formattedDate}`,
  };
}

const DEFAULT_NEWS_ITEMS: NewsItem[] = [
  {
    id: 1,
    assets: ["US30"],
    tickers: ["DIA", "SPY", "TLT", "IEF", "QQQ"],
    tag: "Dow Jones (US30)",
    tagClass: "",
    match: "92% AI match",
    theme: "Producer inflation and corporate discount rates",
    title: "Markets edge higher following inflation data; Dow Jones (DIA) and Treasuries in focus",
    signals: [
      { label: "AI signal" },
      { label: "XAUUSD neutral", cls: "sig neu" },
      { label: "US30 bullish", cls: "sig bull" },
      { label: "Sentiment +0.36" },
    ],
    catalyst:
      "U.S. equity markets held a steady trajectory as institutional investors digested the latest Producer Price Index print. The tech-heavy QQQ and the Dow Jones Industrial Average (DIA) reacted to shifts in long-duration Treasury yields.",
    transmission:
      "In-line producer inflation figures eased fears of renewed Federal Reserve tightening, reducing discount-rate drag on Dow blue-chip earnings.",
    drivers: "Producer price index, Dow Jones, Treasury yields",
    sourceDate: "The Stock Market Watch, 17 Nov, 03:37 AM IST",
  },
  {
    id: 2,
    assets: ["XAU", "US30"],
    tickers: ["GLD", "DXY", "DIA", "SPY", "US10Y"],
    tag: "Dual impact (XAU & US30)",
    tagClass: "",
    match: "96% AI match",
    theme: "US real yields and dollar pressure",
    title: "Treasury yields and the US dollar break out as yield curve tightens",
    signals: [
      { label: "AI signal" },
      { label: "XAUUSD bearish", cls: "sig bear" },
      { label: "US30 bearish", cls: "sig bear" },
      { label: "Sentiment −0.22" },
    ],
    catalyst:
      "Equity volatility rose as Treasury yields surged. The US 10-year touched 5.13%, the 2-year held near 4.90%, and the US Dollar Index broke out toward key resistance. Gold spot faced technical headwinds on dollar strength.",
    transmission:
      "10-year Treasury yields above 5.10%, combined with a firmer dollar, raise the cost of holding gold and the financing costs for cyclical Dow industrials.",
    drivers: "10-year yield, dollar index, gold price, Treasury yields",
    sourceDate: "Mott Capital Management, 17 Nov, 03:29 AM IST",
  },
  {
    id: 3,
    assets: ["XAU"],
    tickers: [],
    tag: "Gold (XAUUSD)",
    tagClass: "",
    match: "94% AI match",
    theme: "Central bank allocation and monetary premium",
    title: "Gold bullion supported by central bank reserves and geopolitical hedging demand",
    signals: [
      { label: "AI signal" },
      { label: "XAUUSD bullish", cls: "sig bull" },
      { label: "US30 neutral", cls: "sig neu" },
      { label: "Sentiment +0.28" },
    ],
    catalyst:
      "Official-sector gold purchases and renewed geopolitical hedging are supporting bullion demand despite a firmer dollar.",
    transmission:
      "Central-bank allocation reinforces gold's monetary premium and offsets part of the pressure from higher real yields.",
    drivers: "Central-bank reserves, gold demand, geopolitical risk",
    sourceDate: "MacroEdge Research Feed, 17 Nov, 01:34 PM IST",
  },
  {
    id: 4,
    assets: ["US30"],
    tickers: [],
    tag: "Dow Jones (US30)",
    tagClass: "",
    match: "95% AI match",
    theme: "Industrial capex and blue-chip order books",
    title: "Caterpillar and Boeing lead industrial order rebound amid resilient infrastructure spending",
    signals: [
      { label: "AI signal" },
      { label: "XAUUSD neutral", cls: "sig neu" },
      { label: "US30 bullish", cls: "sig bull" },
      { label: "Sentiment +0.31" },
    ],
    catalyst:
      "Resilient infrastructure spending is improving industrial order visibility for large-cap manufacturers.",
    transmission:
      "Stronger order books support Dow earnings expectations and help offset valuation pressure from elevated yields.",
    drivers: "Industrial orders, infrastructure spending, Dow earnings",
    sourceDate: "MacroEdge Research Feed, 17 Nov, 01:34 PM IST",
  },
];

interface MacroOverviewViewProps {
  cards?: MarketOverviewCardData[];
  regimeFactors?: MacroRegimeFactor[];
  calendarEvents?: EconomicCalendarEvent[];
  correlationAssets?: CorrelationAssetSeries[];
  meta?: DatasetMeta;
  aiSummary?: AiBiasSummary | null;
  news?: FilteredMarketauxArticle[];
  newsLastUpdated?: string;
}

export function MacroOverviewView(props?: MacroOverviewViewProps) {
  const [cards, setCards] = useState<MarketOverviewCardData[]>(() => props?.cards ?? []);
  const [regimeFactors, setRegimeFactors] = useState<MacroRegimeFactor[]>(() => props?.regimeFactors ?? []);
  const [calendarEvents, setCalendarEvents] = useState<EconomicCalendarEvent[]>(() => props?.calendarEvents ?? []);
  const [aiSummary, setAiSummary] = useState<AiBiasSummary | null | undefined>(() => props?.aiSummary);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");

  const [asset, setAsset] = useState<string>("US10Y");
  const [range, setRange] = useState<string>("1Y");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [tickerFilter, setTickerFilter] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string>(() => hhmm());
  const [newsArticles, setNewsArticles] = useState<FilteredMarketauxArticle[]>(() => props?.news ?? []);
  const [isSyncingNews, setIsSyncingNews] = useState<boolean>(false);
  const [newsSyncStatus, setNewsSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [newsStamp, setNewsStamp] = useState<string>(() => formatNewsStamp(props?.newsLastUpdated));
  const [timerSeconds, setTimerSeconds] = useState<number>(60);
  const [isDebugOpen, setIsDebugOpen] = useState<boolean>(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [asOfDate] = useState<Date>(() => new Date());
  const asOfDateLabel = asOfDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // In-flight and wall-clock target anchors
  const syncInFlightRef = useRef<boolean>(false);
  const nextTargetMsRef = useRef<number>(Date.now() + 60_000);

  // SVG Chart state
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartDim, setChartDim] = useState<{ w: number; h: number }>({ w: 600, h: 300 });
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    val: number;
    date: Date;
    visible: boolean;
  } | null>(null);

  const refreshBarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (props?.cards && props.cards.length > 0) setCards(props.cards);
    if (props?.regimeFactors && props.regimeFactors.length > 0) setRegimeFactors(props.regimeFactors);
    if (props?.calendarEvents && props.calendarEvents.length > 0) setCalendarEvents(props.calendarEvents);
    if (props?.aiSummary !== undefined) setAiSummary(props.aiSummary);
    if (props?.news && props.news.length > 0) setNewsArticles(props.news);
    if (props?.newsLastUpdated) setNewsStamp(formatNewsStamp(props.newsLastUpdated));
  }, [props]);

  // Initial news fetch on mount if not yet hydrated
  useEffect(() => {
    let mounted = true;
    if (newsArticles.length === 0) {
      fetch("/api/news/gold-us30")
        .then((r) => r.json())
        .then((data) => {
          if (!mounted) return;
          if (data.ok && Array.isArray(data.news) && data.news.length > 0) {
            setNewsArticles(data.news);
          }
          if (data.lastUpdated) {
            setNewsStamp(formatNewsStamp(data.lastUpdated));
          }
        })
        .catch(() => null);
    }
    return () => {
      mounted = false;
    };
  }, [newsArticles.length]);

  const cardMap = useMemo(() => {
    const map = new Map<string, MarketOverviewCardData>();
    for (const c of cards) {
      map.set(c.symbol, c);
      map.set(c.symbol.toUpperCase(), c);
      map.set(c.id, c);
      map.set(c.id.toUpperCase(), c);
      if (c.symbol === "SPX" || c.symbol === "SPX500") {
        map.set("SPX", c);
        map.set("SPX500", c);
      }
      if (c.symbol === "US02Y" || c.symbol === "US2Y") {
        map.set("US02Y", c);
        map.set("US2Y", c);
      }
    }
    return map;
  }, [cards]);

  // Real backend live sync execution with in-flight guard
  const handleSyncNow = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncStatus("syncing");
    nextTargetMsRef.current = Date.now() + 60_000;
    setTimerSeconds(60);

    if (refreshBarRef.current) {
      refreshBarRef.current.style.animation = "none";
      void refreshBarRef.current.offsetWidth;
      refreshBarRef.current.style.animation = "";
    }

    try {
      // 1. Dispatch backend multi-worker synchronization
      await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      }).catch(() => null);

      // 2. Fetch fresh updated overview data from backend
      const overviewRes = await fetch("/api/macro/overview", { cache: "no-store" });
      if (overviewRes.ok) {
        const data = await overviewRes.json();
        if (data.cards?.length > 0) setCards(data.cards);
        if (data.regimeFactors?.length > 0) setRegimeFactors(data.regimeFactors);
        if (data.calendarEvents?.length > 0) setCalendarEvents(data.calendarEvents);
      }

      // 3. Fetch fresh news
      const newsRes = await fetch("/api/news/gold-us30?refresh=1", { cache: "no-store" });
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        if (Array.isArray(newsData.news) && newsData.news.length > 0) {
          setNewsArticles(newsData.news);
        }
        if (newsData.lastUpdated) {
          setNewsStamp(formatNewsStamp(newsData.lastUpdated));
        }
      }

      // 4. Fetch fresh AI bias
      const aiRes = await fetch("/api/ai-models", { cache: "no-store" });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.summary) setAiSummary(aiData.summary);
      }

      setStamp(hhmm());
      setSyncStatus("success");
    } catch (err) {
      console.error("[MacroOverview] Sync error:", err);
      setSyncStatus("error");
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Targeted News Sync Handler
  const handleSyncNews = useCallback(async () => {
    if (isSyncingNews) return;
    setIsSyncingNews(true);
    setNewsSyncStatus("syncing");
    try {
      await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "marketaux", force: true }),
      }).catch(() => null);

      const res = await fetch("/api/news/gold-us30?refresh=1", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.news) && data.news.length > 0) {
          setNewsArticles(data.news);
        }
        if (data.lastUpdated) {
          setNewsStamp(formatNewsStamp(data.lastUpdated));
        }
        setNewsSyncStatus("success");
        setTimeout(() => setNewsSyncStatus("idle"), 3000);
      } else {
        setNewsSyncStatus("error");
        setTimeout(() => setNewsSyncStatus("idle"), 3000);
      }
    } catch (err) {
      console.error("[MacroOverview] Failed to sync news:", err);
      setNewsSyncStatus("error");
      setTimeout(() => setNewsSyncStatus("idle"), 3000);
    } finally {
      setIsSyncingNews(false);
    }
  }, [isSyncingNews]);

  // Initial sync on mount if not in-flight
  useEffect(() => {
    if (!syncInFlightRef.current) {
      void handleSyncNow();
    }
  }, [handleSyncNow]);

  // Periodic Auto-Sync Interval Runner (Wall-Clock Anchored & Visibility Resilient)
  useEffect(() => {
    const tick = () => {
      const remainingMs = nextTargetMsRef.current - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      if (remainingSec <= 0) {
        nextTargetMsRef.current = Date.now() + 60_000;
        setTimerSeconds(60);
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void handleSyncNow();
        }
      } else {
        setTimerSeconds(remainingSec);
      }
    };

    const iv = setInterval(tick, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() >= nextTargetMsRef.current) {
          nextTargetMsRef.current = Date.now() + 60_000;
          setTimerSeconds(60);
          void handleSyncNow();
        } else {
          tick();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleSyncNow]);

  // ResizeObserver for chart dimensions
  useEffect(() => {
    const el = chartHostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setChartDim({
          w: Math.round(entry.contentRect.width),
          h: Math.round(entry.contentRect.height),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const liveCard = cardMap.get(asset) ?? (asset === "SPX" ? cardMap.get("SPX500") : undefined);
  const baseSpec = ASSETS[asset] ?? ASSETS.US10Y;
  const livePrice =
    liveCard?.value != null && Number.isFinite(liveCard.value) && liveCard.value > 0
      ? liveCard.value
      : baseSpec.v;

  const curAsset: AssetSpec = useMemo(
    () => ({
      ...baseSpec,
      v: livePrice,
    }),
    [baseSpec, livePrice]
  );
  const vals = useMemo(() => computeSeries(asset, range, livePrice), [asset, range, livePrice]);
  const ds = useMemo(() => computeDates(range, asOfDate), [asOfDate, range]);
  const chg = vals.length > 0 ? (vals[vals.length - 1] - vals[0]) / vals[0] : 0;

  // Chart coordinate geometry
  const chartGeo = useMemo(() => {
    const { w: W, h: H } = chartDim;
    const n = vals.length;
    if (n === 0 || W <= 0 || H <= 0) return null;
    const pr = 58;
    const pt = 10;
    const pb = 26;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || 0.01;
    lo -= pad;
    hi += pad;
    const plot = W - pr;
    const x = (i: number) => (plot * i) / (n - 1);
    const y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
    const pts: [number, number][] = vals.map((v, i) => [x(i), y(v)]);
    const linePath = curve(pts);
    const base = (H - pb).toFixed(1);
    const areaPath = `${linePath}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;

    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);

    // 5 horizontal grid lines
    const gridLines: { y: number; val: number }[] = [];
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) / 4) * k;
      gridLines.push({ y: y(v), val: v });
    }

    // 5 X-axis date labels
    const xLabels: { x: number; text: string; anchor: "start" | "end" | "middle" }[] = [];
    [0, 0.25, 0.5, 0.75, 1].forEach((f, k) => {
      const idx = Math.round(f * (n - 1));
      const d = ds[idx] ?? asOfDate;
      const anchor: "start" | "end" | "middle" = k === 0 ? "start" : k === 4 ? "end" : "middle";
      xLabels.push({
        x: x(idx),
        text: `${MON[d.getMonth()]} ${d.getDate()}`,
        anchor,
      });
    });

    return {
      W,
      H,
      pr,
      pt,
      pb,
      plot,
      pts,
      linePath,
      areaPath,
      gridLines,
      xLabels,
      rawMin,
      rawMax,
      yMin: y(rawMin),
      yMax: y(rawMax),
      last: pts[pts.length - 1],
    };
  }, [asOfDate, chartDim, vals, ds]);

  // Pointer hover on chart
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!chartGeo || !chartHostRef.current) return;
      const box = chartHostRef.current.getBoundingClientRect();
      const px = Math.max(0, Math.min(chartGeo.plot, e.clientX - box.left));
      const i = Math.round((px / chartGeo.plot) * (vals.length - 1));
      const pt = chartGeo.pts[i];
      if (!pt) return;
      setHoverInfo({
        x: pt[0],
        y: pt[1],
        val: vals[i],
        date: ds[i],
        visible: true,
      });
    },
    [chartGeo, vals, ds]
  );

  const handlePointerLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  // Radar polygon computation
  const radarSvgContent = useMemo(() => {
    const factorScore = (idKey: string, labelKey: string, fallback: number) => {
      const match = regimeFactors.find(
        (f) =>
          f.id.toLowerCase() === idKey.toLowerCase() ||
          f.label.toLowerCase().includes(labelKey.toLowerCase())
      );
      return match?.score != null ? match.score : fallback;
    };

    const F: [string, number][] = [
      ["Growth", factorScore("growth", "growth", 70)],
      ["Inflation", factorScore("inflation", "inflation", 70)],
      ["Stress", factorScore("credit", "credit", factorScore("stress", "stress", 50))],
      ["Policy", factorScore("monetary-policy", "policy", 87)],
      ["Liquidity", factorScore("liquidity", "liquidity", 69)],
    ];
    const cx = 160;
    const cy = 124;
    const R = 88;
    const ang = (i: number) => ((-90 + i * 72) * Math.PI) / 180;
    const P = (r: number, i: number): [number, number] => [
      cx + Math.cos(ang(i)) * r,
      cy + Math.sin(ang(i)) * r,
    ];
    const pt2 = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;

    const rings = [25, 50, 75, 100].map((k) =>
      F.map((_, i) => pt2(P((R * k) / 100, i))).join(" ")
    );

    const axisLines = F.map((_, i) => {
      const [x, y] = P(R, i);
      return { x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) };
    });

    const scorePoly = F.map(([, v], i) => pt2(P((R * v) / 100, i))).join(" ");

    const vertices = F.map(([name, v], i) => {
      const [x, y] = P((R * v) / 100, i);
      const [lx, ly] = P(R + 18, i);
      const c = Math.cos(ang(i));
      const sn = Math.sin(ang(i));
      const anchor: "start" | "end" | "middle" = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
      const dy = sn < -0.5 ? -4 : sn > 0.5 ? 12 : 4;
      return {
        dotX: x.toFixed(1),
        dotY: y.toFixed(1),
        lblX: lx.toFixed(1),
        lblY: (ly + dy).toFixed(1),
        valY: (ly + dy + 14).toFixed(1),
        anchor,
        name,
        v,
      };
    });

    return { rings, axisLines, scorePoly, vertices };
  }, [regimeFactors]);

  const forceItems = useMemo(() => {
    const findFactor = (idKey: string, labelKey: string) =>
      regimeFactors.find(
        (f) =>
          f.id.toLowerCase() === idKey.toLowerCase() ||
          f.label.toLowerCase().includes(labelKey.toLowerCase())
      );

    const growth = findFactor("growth", "growth");
    const inflation = findFactor("inflation", "inflation");
    const stress = findFactor("credit", "stress") || findFactor("credit", "credit");
    const policy = findFactor("monetary-policy", "policy");
    const liquidity = findFactor("liquidity", "liquidity");

    return [
      {
        name: "Growth",
        percentile: growth?.score ?? 67,
        z: growth ? growth.signalValue : "+1.13σ",
        sub: "+1.2 this week",
        isUp: true,
        tag: growth?.status ?? "Expansive",
        tagClass: growth?.tone === "bullish" ? "pos" : growth?.tone === "bearish" ? "neg" : "acc",
      },
      {
        name: "Inflation",
        percentile: inflation?.score ?? 70,
        z: inflation ? inflation.signalValue : "+0.67σ",
        sub: "+0.04 this week",
        isUp: true,
        tag: inflation?.status ?? "Elevated",
        tagClass: inflation?.tone === "bullish" ? "pos" : inflation?.tone === "bearish" ? "neg" : "acc",
      },
      {
        name: "Stress",
        percentile: stress?.score ?? 50,
        z: stress ? stress.signalValue : "0.00σ",
        sub: "−0.1 this week",
        isUp: false,
        tag: stress?.status ?? "Moderate",
        tagClass: stress?.tone === "bullish" ? "pos" : stress?.tone === "bearish" ? "neg" : "",
      },
      {
        name: "Policy",
        percentile: policy?.score ?? 87,
        z: policy ? policy.signalValue : "+0.64σ",
        sub: "+0.12 this week",
        isUp: true,
        tag: policy?.status ?? "Restrictive",
        tagClass: policy?.tone === "bullish" ? "pos" : policy?.tone === "bearish" ? "neg" : "neg",
      },
      {
        name: "Liquidity",
        percentile: liquidity?.score ?? 69,
        z: liquidity ? liquidity.signalValue : "+0.95σ",
        sub: "+0.05 this week",
        isUp: true,
        tag: liquidity?.status ?? "Supportive",
        tagClass: liquidity?.tone === "bullish" ? "pos" : liquidity?.tone === "bearish" ? "neg" : "pos",
      },
    ];
  }, [regimeFactors]);

  // Copy headline to clipboard
  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
    } catch {
      // fallback
    }
    setTimeout(() => setCopiedIdx(null), 1400);
  };

  // News cards data: dynamic live articles with institutional fallback
  const newsItems = useMemo<NewsItem[]>(() => {
    if (newsArticles.length > 0) {
      return newsArticles.map((article, idx) => mapArticleToNewsItem(article, idx));
    }
    return DEFAULT_NEWS_ITEMS;
  }, [newsArticles]);

  const filteredNews = useMemo(() => {
    return newsItems.filter((c) => {
      const okA = assetFilter === "all" || c.assets.includes(assetFilter);
      const okT = !tickerFilter || c.tickers.includes(tickerFilter);
      return okA && okT;
    });
  }, [newsItems, assetFilter, tickerFilter]);

  const newsCounts = useMemo(() => {
    const xau = newsItems.filter((c) => c.assets.includes("XAU")).length;
    const us30 = newsItems.filter((c) => c.assets.includes("US30")).length;
    return { all: newsItems.length, xau, us30 };
  }, [newsItems]);

  const getTile = useCallback(
    (key: string, defVal: string, defCat: string, defChg: string, defIsUp: boolean, defLive: boolean) => {
      const card = cardMap.get(key);
      if (!card || card.value == null) {
        return {
          val: defVal,
          cat: defCat,
          chg: defChg,
          isUp: defIsUp,
          isLive: defLive,
          state: defLive ? "Live" : "Daily",
        };
      }
      const isUp = card.changePercent != null ? card.changePercent >= 0 : defIsUp;
      const isLive = card.meta.mode === "LIVE_API" || card.meta.frequency === "LIVE";
      const formattedVal =
        card.unit === "%"
          ? `${card.value.toFixed(2)}%`
          : card.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedChg =
        card.deltaUnit === "bps" && card.change != null
          ? `${card.change >= 0 ? "+" : "−"}${Math.abs(card.change)} bps`
          : card.changePercent != null
          ? `${card.changePercent >= 0 ? "+" : "−"}${Math.abs(card.changePercent).toFixed(2)}%`
          : defChg;
      return {
        val: formattedVal,
        cat: card.category || defCat,
        chg: formattedChg,
        isUp,
        isLive,
        state: isLive ? "Live" : (card.meta.frequency || "Daily"),
      };
    },
    [cardMap]
  );

  return (
    <div className="overview-ledger space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Page Header */}
      <header className="page-head !pt-0">
        <div>
          <h1>Macroeconomic overview</h1>
          <p>Cross-asset telemetry, regime scoring, the risk docket and rolling correlation, in one view.</p>
          <div className="status">
            <span className={`pill-live ${isSyncing ? "opacity-75 animate-pulse" : ""}`}>
              {isSyncing ? "Syncing..." : syncStatus === "error" ? "Stale" : "Live"}
            </span>
            <span className="num">{asOfDateLabel}</span>
            <span>
              Updated <span id="stamp">{stamp}</span>
            </span>
          </div>
        </div>
        <div className="tools">
          <span className="timer" id="timer" aria-hidden="true">
            {timerSeconds}s
          </span>
          <button
            className="btn"
            id="sync"
            type="button"
            disabled={isSyncing}
            onClick={handleSyncNow}
            style={{ opacity: isSyncing ? 0.7 : 1, cursor: isSyncing ? "wait" : "pointer" }}
          >
            {isSyncing ? "Syncing..." : "Sync now"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setIsDebugOpen(true)}
            title="Open AutoSync Telemetry & Diagnostics"
          >
            Debug AutoSync
          </button>
          <Link className="btn btn-primary" href="/macrodashboard/tools/daily-check">
            Daily check
          </Link>
        </div>
      </header>
      <div className="refresh" aria-hidden="true">
        <i ref={refreshBarRef} id="refreshBar"></i>
      </div>

      {/* AI Bias Band */}
      <section className="bias" aria-label="AI bias">
        <span className="bias-k">AI bias</span>
        <span className="bias-v">
          {aiSummary ? `${aiSummary.primary_asset || "XAUUSD"} ${aiSummary.bias.toLowerCase()}` : "XAUUSD neutral"}
        </span>
        <p className="bias-note">
          <span className="bias-score num">
            {aiSummary?.bias_score != null ? (aiSummary.bias_score > 0 ? `+${aiSummary.bias_score}` : aiSummary.bias_score) : "−7"}
          </span>
          &ensp;{aiSummary?.dominant_regime || "State 3: low volatility, expansion, tight policy and yields"}
        </p>
        <span className="bias-conf">
          <span className="meter" aria-hidden="true">
            <i style={{ "--v": `${aiSummary?.confidence_pct ?? 58}%` } as React.CSSProperties}></i>
          </span>
          {aiSummary?.confidence_pct ?? 58}% confidence
          <Link className="bias-link" href="/macrodashboard/tools/ai-bias">
            Details
          </Link>
        </span>
      </section>

      {/* Telemetry Strip: 8 hairline cards */}
      <section className="tele" id="tele" aria-label="Cross-asset benchmarks">
        {[
          { key: "DXY", defVal: "103.17", defCat: "FX", defChg: "+0.02%", defIsUp: true, defLive: true },
          { key: "US10Y", defVal: "4.98%", defCat: "Rates", defChg: "+10 bps", defIsUp: true, defLive: false },
          { key: "US02Y", defVal: "4.73%", defCat: "Rates", defChg: "+17 bps", defIsUp: true, defLive: false },
          { key: "US10YR", defVal: "2.78%", defCat: "Rates", defChg: "+12 bps", defIsUp: true, defLive: false },
          { key: "VIX", defVal: "17.49", defCat: "Volatility", defChg: "−10.12%", defIsUp: false, defLive: false },
          { key: "XAUUSD", defVal: "3,885.30", defCat: "Commodities", defChg: "+0.15%", defIsUp: true, defLive: true },
          { key: "SPX", defVal: "7,619.38", defCat: "Equities", defChg: "+1.31%", defIsUp: true, defLive: true },
          { key: "BTCUSD", defVal: "68,726", defCat: "Crypto", defChg: "−3.70%", defIsUp: false, defLive: true },
        ].map((bench) => {
          const t = getTile(bench.key, bench.defVal, bench.defCat, bench.defChg, bench.defIsUp, bench.defLive);
          return (
            <button
              key={bench.key}
              className="tile"
              type="button"
              data-key={bench.key}
              aria-pressed={asset === bench.key}
              onClick={() => setAsset(bench.key)}
            >
              <span className="tile-top">
                <span className="tile-sym">{bench.key}</span>
                <span className={`tile-state ${t.isLive ? "live" : ""}`}>{t.state}</span>
              </span>
              <span className="tile-val">{t.val}</span>
              <span className="tile-foot">
                <span>{t.cat}</span>
                <span className={`num ${t.isUp ? "up" : "down"}`}>{t.chg}</span>
              </span>
            </button>
          );
        })}
      </section>

            {/* Main Grid: Hero Chart + Five Forces */}
            <div className="grid-main">
              {/* Hero Chart Panel */}
              <section className="panel panel-chart" aria-labelledby="chartTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="chartTitle">
                      {curAsset.name}
                    </h2>
                    <p className="panel-sub" id="chartSub">
                      {curAsset.cls}, daily
                    </p>
                  </div>
                  <div className="seg" id="ranges" role="group" aria-label="Range">
                    {["1M", "3M", "6M", "1Y"].map((r) => (
                      <button
                        key={r}
                        type="button"
                        data-r={r}
                        aria-pressed={range === r}
                        onClick={() => setRange(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="quote">
                  <span className="quote-val" id="qVal">
                    {fmtVal(curAsset, curAsset.v)}
                  </span>
                  <span className="quote-chg">
                    <span id="qPct" className={chg >= 0 ? "up" : "down"}>
                      {(chg >= 0 ? "+" : "−") + Math.abs(chg * 100).toFixed(2) + "%"}
                    </span>
                    <small id="qRange">over {range}</small>
                  </span>
                </div>

                <div
                  className="chart"
                  id="chart"
                  ref={chartHostRef}
                  onPointerMove={handlePointerMove}
                  onPointerLeave={handlePointerLeave}
                >
                  {chartGeo && (
                    <svg
                      viewBox={`0 0 ${chartGeo.W} ${chartGeo.H}`}
                      role="img"
                      aria-label={`${curAsset.name} over ${range}`}
                    >
                      <defs>
                        <linearGradient id="hero-chart-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
                          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.03" />
                          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Vertical Grid Lines */}
                      {chartGeo.xLabels.map((xl, i) => (
                        <line
                          key={`vgl-${i}`}
                          className="gl"
                          x1={xl.x.toFixed(1)}
                          x2={xl.x.toFixed(1)}
                          y1={chartGeo.pt}
                          y2={chartGeo.H - chartGeo.pb}
                          strokeDasharray="2 3"
                          opacity={0.35}
                        />
                      ))}

                      {/* Horizontal Grid Lines + Y-axis labels */}
                      {chartGeo.gridLines.map((gl, i) => (
                        <g key={i}>
                          <line
                            className="gl"
                            x1="0"
                            x2={chartGeo.W - chartGeo.pr}
                            y1={gl.y.toFixed(1)}
                            y2={gl.y.toFixed(1)}
                          />
                          <text
                            className="ax"
                            x={chartGeo.W - chartGeo.pr + 10}
                            y={(gl.y + 4).toFixed(1)}
                          >
                            {fmtVal(curAsset, gl.val)}
                          </text>
                        </g>
                      ))}

                      {/* High & Low Watermark Dashed Lines */}
                      {chartGeo.rawMax !== chartGeo.rawMin && (
                        <g opacity={0.65}>
                          <line
                            x1="0"
                            x2={chartGeo.W - chartGeo.pr}
                            y1={chartGeo.yMax.toFixed(1)}
                            y2={chartGeo.yMax.toFixed(1)}
                            stroke="#22C55E"
                            strokeWidth={0.75}
                            strokeDasharray="2 4"
                          />
                          <text
                            x={10}
                            y={(chartGeo.yMax - 4).toFixed(1)}
                            fill="#22C55E"
                            fontSize="9"
                            fontFamily="var(--cot-num)"
                          >
                            H: {fmtVal(curAsset, chartGeo.rawMax)}
                          </text>
                          <line
                            x1="0"
                            x2={chartGeo.W - chartGeo.pr}
                            y1={chartGeo.yMin.toFixed(1)}
                            y2={chartGeo.yMin.toFixed(1)}
                            stroke="#EF4444"
                            strokeWidth={0.75}
                            strokeDasharray="2 4"
                          />
                          <text
                            x={10}
                            y={(chartGeo.yMin + 10).toFixed(1)}
                            fill="#EF4444"
                            fontSize="9"
                            fontFamily="var(--cot-num)"
                          >
                            L: {fmtVal(curAsset, chartGeo.rawMin)}
                          </text>
                        </g>
                      )}

                      {/* X-axis date labels */}
                      {chartGeo.xLabels.map((xl, i) => (
                        <text
                          key={i}
                          className="ax"
                          x={xl.x.toFixed(1)}
                          y={chartGeo.H - 6}
                          textAnchor={xl.anchor}
                        >
                          {xl.text}
                        </text>
                      ))}

                      {/* Area & Line */}
                      <path d={chartGeo.areaPath} fill="url(#hero-chart-grad)" />
                      <path className="ln" d={chartGeo.linePath} strokeWidth={2} />

                      {/* Interactive Crosshair & Hover Point */}
                      {hoverInfo && hoverInfo.visible && (
                        <>
                          <line
                            className="xh"
                            x1={hoverInfo.x.toFixed(1)}
                            x2={hoverInfo.x.toFixed(1)}
                            y1={chartGeo.pt}
                            y2={chartGeo.H - chartGeo.pb}
                            strokeDasharray="3 3"
                          />
                          <circle
                            className="pt"
                            r="4.5"
                            cx={hoverInfo.x.toFixed(1)}
                            cy={hoverInfo.y.toFixed(1)}
                            fill="#FFFFFF"
                            stroke="#000000"
                            strokeWidth={2}
                          />
                        </>
                      )}

                      {/* Last value dot */}
                      {chartGeo.last && (
                        <circle
                          className="pt"
                          cx={chartGeo.last[0].toFixed(1)}
                          cy={chartGeo.last[1].toFixed(1)}
                          r="4.5"
                          fill="#FFFFFF"
                          stroke="#000000"
                          strokeWidth={1.5}
                        />
                      )}
                    </svg>
                  )}

                  {/* Tooltip */}
                  {hoverInfo && hoverInfo.visible && chartGeo && (
                    <div
                      className="tip shadow-xl"
                      id="tip"
                      style={{
                        transform: `translate(${Math.max(
                          0,
                          Math.min(chartGeo.W - 140, hoverInfo.x - 70)
                        ).toFixed(1)}px, ${Math.max(0, hoverInfo.y - 54).toFixed(1)}px)`,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <b>{fmtVal(curAsset, hoverInfo.val)}</b>
                        {vals.length > 0 && vals[0] !== 0 && (
                          <span
                            className={`text-[10px] ${
                              hoverInfo.val - vals[0] >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"
                            }`}
                          >
                            ({hoverInfo.val - vals[0] >= 0 ? "+" : "−"}
                            {Math.abs(((hoverInfo.val - vals[0]) / vals[0]) * 100).toFixed(2)}%)
                          </span>
                        )}
                      </div>
                      <span>
                        {MON[hoverInfo.date.getMonth()]} {hoverInfo.date.getDate()},{" "}
                        {hoverInfo.date.getFullYear()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="foot-note">
                  <span>Daily closes, selected benchmark</span>
                  <span>Sample path until the feed is connected</span>
                </div>
              </section>

              {/* Five Forces Panel */}
              <section className="panel" aria-labelledby="forcesTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="forcesTitle">
                      Five forces
                    </h2>
                    <p className="panel-sub">Regime scores out of 100, with z-scores and weekly change</p>
                  </div>
                </div>

                {/* Radar SVG */}
                <svg
                  className="radar"
                  id="radar"
                  viewBox="0 0 320 250"
                  role="img"
                  aria-label="Five-force regime radar"
                >
                  {/* Concentric pentagon rings */}
                  {radarSvgContent.rings.map((pts, i) => (
                    <polygon key={i} className="rg" points={pts} />
                  ))}

                  {/* Axis lines */}
                  {radarSvgContent.axisLines.map((ln, i) => (
                    <line key={i} className="rx" x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
                  ))}

                  {/* Score polygon */}
                  <polygon className="rs" points={radarSvgContent.scorePoly} />

                  {/* Vertex dots & labels */}
                  {radarSvgContent.vertices.map((v, i) => (
                    <g key={i}>
                      <circle className="rd" cx={v.dotX} cy={v.dotY} r="3" />
                      <text className="rl" x={v.lblX} y={v.lblY} textAnchor={v.anchor}>
                        {v.name}
                      </text>
                      <text className="rv" x={v.lblX} y={v.valY} textAnchor={v.anchor}>
                        {v.v}
                      </text>
                    </g>
                  ))}
                </svg>

                {/* Forces List */}
                <ul className="forces">
                  {forceItems.map((item) => (
                    <li key={item.name} className="force">
                      <div className="force-name">
                        <b>{item.name}</b>
                        <small>{item.percentile}th percentile</small>
                      </div>
                      <div className="force-z">
                        <b>{item.z}</b>
                        <small className={item.isUp ? "up" : "down"}>{item.sub}</small>
                      </div>
                      <span className={`tag ${item.tagClass}`}>{item.tag}</span>
                      <div
                        className="force-track"
                        style={{ "--p": `${item.percentile}%` } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        <i></i>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Second Grid: Correlation + Economic Calendar */}
            <div className="grid-2">
              <section className="panel" aria-labelledby="corrTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="corrTitle">
                      Correlation
                    </h2>
                    <p className="panel-sub">US10Y and SPX, 90-day rolling</p>
                  </div>
                </div>
                <p className="corr-val">0.28</p>
                <div className="corr-scale" style={{ "--r": "0.28" } as React.CSSProperties} aria-hidden="true">
                  <i></i>
                </div>
                <div className="corr-ends" aria-hidden="true">
                  <span>−1</span>
                  <span>0</span>
                  <span>+1</span>
                </div>
                <p className="corr-note">
                  The full 5 × 5 matrix loads from the{" "}
                  <Link href="/macrodashboard/positioning/correlation-matrix" style={{ textDecoration: "underline" }}>
                    correlation desk
                  </Link>
                  .
                </p>
              </section>

              <EconomicCalendar events={calendarEvents} defaultRange="today" defaultTz="ist" />
            </div>

            {/* Desks Section */}
            <h2 className="section-title" id="desksTitle">
              Desks
            </h2>
            <nav className="desks" aria-labelledby="desksTitle">
              <Link className="desk" href="/macrodashboard/positioning/commitments-of-traders">
                <span className="desk-top">
                  Positioning (COT)
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="desk-metric num">Commercials +14.2k</span>
                <span className="desk-note">Asset manager vs leveraged money net positioning percentiles.</span>
                <span className="tag pos">Bullish</span>
              </Link>
              <Link className="desk" href="/macrodashboard/liquidity/monetary-policy">
                <span className="desk-top">
                  Central bank liquidity
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="desk-metric num">TGA $782B, RRP $145B</span>
                <span className="desk-note">Primary dealer balance sheet, TGA drain, and currency in circulation.</span>
                <span className="tag pos">Expanding</span>
              </Link>
              <Link className="desk" href="/macrodashboard/credit-risk">
                <span className="desk-top">
                  Credit and risk
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="desk-metric num">HY OAS 284 bp (−6 bp)</span>
                <span className="desk-note">Cross-asset volatility strain, financial conditions, and default risk.</span>
                <span className="tag">Tight</span>
              </Link>
              <Link className="desk" href="/macrodashboard/tools/ai-bias">
                <span className="desk-top">
                  AI macro bias
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="desk-metric num">Confidence 58.4%</span>
                <span className="desk-note">Statistical probability drift and regime distribution forecast.</span>
                <span className="tag pos">Upward</span>
              </Link>
            </nav>

            {/* News Intelligence Section */}
            <section className="news-section" aria-labelledby="newsTitle">
              <div className="news-head">
                <div>
                  <h2 id="newsTitle">News intelligence</h2>
                  <p>
                    Financial news parsed into structured signals for spot gold and Dow Jones. Unrelated items are
                    filtered out.
                  </p>
                </div>
                <div className="news-meta">
                  <span className="pill-live">Live feed</span>
                  <span>Strict causal NLP filter</span>
                  <span>
                    Updated <span id="newsStamp">{newsStamp}</span>, {newsItems.length} records
                  </span>
                  <button
                    className="btn"
                    id="syncNews"
                    type="button"
                    onClick={handleSyncNews}
                    disabled={isSyncingNews}
                  >
                    {isSyncingNews ? "Syncing..." : newsSyncStatus === "success" ? "Synced ✓" : "Sync news"}
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="filters">
                <div className="seg" id="assetTabs" role="group" aria-label="Asset">
                  <button
                    type="button"
                    data-a="all"
                    aria-pressed={assetFilter === "all"}
                    onClick={() => setAssetFilter("all")}
                  >
                    All {newsCounts.all}
                  </button>
                  <button
                    type="button"
                    data-a="XAU"
                    aria-pressed={assetFilter === "XAU"}
                    onClick={() => setAssetFilter("XAU")}
                  >
                    Gold (XAUUSD) {newsCounts.xau}
                  </button>
                  <button
                    type="button"
                    data-a="US30"
                    aria-pressed={assetFilter === "US30"}
                    onClick={() => setAssetFilter("US30")}
                  >
                    Dow Jones (US30) {newsCounts.us30}
                  </button>
                </div>
                <div className="chips" id="tickers" role="group" aria-label="Filter by ticker">
                  {TICKERS.map((t) => (
                    <button
                      key={t}
                      className="chip"
                      type="button"
                      aria-pressed={tickerFilter === t}
                      data-t={t}
                      onClick={() => setTickerFilter((prev) => (prev === t ? null : t))}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* News Grid */}
              <div className="news-grid" id="newsGrid">
                {filteredNews.map((card) => (
                  <article key={card.id} className="news" data-assets={card.assets.join(" ")}>
                    <div className="news-top">
                      <span className="tag">{card.tag}</span>
                      <span className="news-match num">{card.match}</span>
                    </div>
                    <p className="news-theme">{card.theme}</p>
                    <h3>
                      {card.url ? (
                        <a
                          href={card.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {card.title} <span style={{ fontSize: "12px", opacity: 0.7 }}>↗</span>
                        </a>
                      ) : (
                        card.title
                      )}
                    </h3>

                    {card.isSkeleton ? (
                      <div>
                        <span className="skel" style={{ width: "90%" }}></span>
                        <span className="skel" style={{ width: "70%" }}></span>
                        <p className="pending">Signal details load from the feed.</p>
                      </div>
                    ) : (
                      <>
                        <div className="signals">
                          {card.signals?.map((sig, i) =>
                            sig.cls ? (
                              <span key={i} className={sig.cls}>
                                {sig.label}
                              </span>
                            ) : (
                              <span key={i}>{sig.label}</span>
                            )
                          )}
                        </div>
                        <details className="more">
                          <summary>Catalyst and transmission</summary>
                          <div className="more-body">
                            <dl className="kv">
                              <dt>Catalyst</dt>
                              <dd>{card.catalyst}</dd>
                              <dt>Transmission</dt>
                              <dd>{card.transmission}</dd>
                              <dt>Drivers</dt>
                              <dd>{card.drivers}</dd>
                            </dl>
                          </div>
                        </details>
                      </>
                    )}

                    <div className="news-foot">
                      <span>{card.sourceDate}</span>
                      <button
                        className="ghost"
                        type="button"
                        data-copy
                        onClick={() => handleCopy(card.title, card.id)}
                      >
                        {copiedIdx === card.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {filteredNews.length === 0 && (
                <p className="empty" id="newsEmpty">
                  No items match this filter.
                </p>
              )}
            </section>

      <AutoSyncDebugModal
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        onTriggerSync={handleSyncNow}
        nextAutoSyncSec={timerSeconds}
        autoSyncPeriod="60s"
        isSyncing={isSyncing}
      />
    </div>
  );
}
