import type { RegimeLensId, RegimeTone } from "@/lib/types";
import type {
  DataHealthRecord,
  LatestValueRecord,
  MarketQuoteRecord,
  SyncRunRecord,
} from "@/lib/sync/types";
import { buildDailyCheckRegimeLenses } from "@/services/data/daily-check-regime";

export interface SectionRadarAxis {
  id: string;
  label: string;
  code: string;
  todayScore: number;
  lastWeekScore: number;
  delta: number | null;
  synced: boolean;
}

export interface SectionRadarModel {
  sectionId: string;
  sectionLabel: string;
  tone: RegimeTone;
  syncedCount: number;
  totalAxes: number;
  axes: SectionRadarAxis[];
}

export interface SectionRadarTelemetry {
  latestValues: Record<string, LatestValueRecord>;
  marketQuotes: Record<string, MarketQuoteRecord>;
  health: DataHealthRecord[] | Record<string, DataHealthRecord>;
  recentRuns: SyncRunRecord[];
  activeRegimeLens: RegimeLensId;
}

function clampScore(value: number): number {
  return Math.max(10, Math.min(95, Math.round(value)));
}

function getLatest(
  map: Record<string, LatestValueRecord>,
  keys: string[]
): LatestValueRecord | undefined {
  for (const key of keys) {
    const rec = map[key];
    if (rec && Number.isFinite(rec.value) && rec.status !== "FAILED") {
      return rec;
    }
  }
  return undefined;
}

function getQuote(
  map: Record<string, MarketQuoteRecord>,
  keys: string[]
): MarketQuoteRecord | undefined {
  for (const key of keys) {
    const q = map[key];
    if (
      q &&
      Number.isFinite(q.price) &&
      q.price > 0 &&
      q.status !== "DISCONNECTED" &&
      q.status !== "FAILED"
    ) {
      return q;
    }
  }
  return undefined;
}

function axisFromSeries(
  id: string,
  label: string,
  code: string,
  rec: LatestValueRecord | undefined,
  midpoint: number,
  scale: number,
  invert = false
): SectionRadarAxis {
  if (!rec) {
    return {
      id,
      label,
      code,
      todayScore: 50,
      lastWeekScore: 50,
      delta: null,
      synced: false,
    };
  }
  const dir = invert ? -1 : 1;
  const todayScore = clampScore(50 + dir * (rec.value - midpoint) * scale);
  const prevVal =
    rec.previousValue !== null && Number.isFinite(rec.previousValue)
      ? rec.previousValue
      : rec.changeValue !== null && Number.isFinite(rec.changeValue)
      ? rec.value - rec.changeValue
      : null;
  const lastWeekScore =
    prevVal !== null ? clampScore(50 + dir * (prevVal - midpoint) * scale) : todayScore;
  return {
    id,
    label,
    code,
    todayScore,
    lastWeekScore,
    delta: todayScore - lastWeekScore,
    synced: true,
  };
}

function axisFromQuote(
  id: string,
  label: string,
  code: string,
  q: MarketQuoteRecord | undefined,
  pctScale = 8
): SectionRadarAxis {
  if (!q) {
    return {
      id,
      label,
      code,
      todayScore: 50,
      lastWeekScore: 50,
      delta: null,
      synced: false,
    };
  }
  const pct =
    Number.isFinite(q.changePct) && q.changePct !== 0
      ? q.changePct
      : q.previousClose && q.previousClose > 0
      ? ((q.price - q.previousClose) / q.previousClose) * 100
      : 0;
  const todayScore = clampScore(50 + pct * pctScale);
  const lastWeekScore = 50;
  return {
    id,
    label,
    code,
    todayScore,
    lastWeekScore,
    delta: todayScore - lastWeekScore,
    synced: true,
  };
}

function axisFromStatus(
  id: string,
  label: string,
  code: string,
  records: DataHealthRecord[]
): SectionRadarAxis {
  if (records.length === 0) {
    return {
      id,
      label,
      code,
      todayScore: 50,
      lastWeekScore: 50,
      delta: null,
      synced: false,
    };
  }
  const weight = (s: DataHealthRecord["status"]) =>
    s === "LIVE" ? 90 : s === "CURRENT" ? 78 : s === "DELAYED" ? 54 : s === "STALE" ? 36 : 18;
  const avg = records.reduce((acc, r) => acc + weight(r.status), 0) / records.length;
  const todayScore = clampScore(avg);
  return {
    id,
    label,
    code,
    todayScore,
    lastWeekScore: 50,
    delta: todayScore - 50,
    synced: true,
  };
}

function deriveToneFromAxes(axes: SectionRadarAxis[], preferInvertStress = false): RegimeTone {
  const active = axes.filter((a) => a.synced);
  if (active.length === 0) return "neutral";
  const avg = active.reduce((acc, a) => acc + a.todayScore, 0) / active.length;
  if (preferInvertStress) {
    if (avg >= 62) return "bearish";
    if (avg <= 42) return "bullish";
    return "mixed";
  }
  if (avg >= 58) return "bullish";
  if (avg <= 42) return "bearish";
  return "mixed";
}

function finalizeModel(
  sectionId: string,
  sectionLabel: string,
  axes: SectionRadarAxis[],
  toneOverride?: RegimeTone,
  preferInvertStress = false
): SectionRadarModel {
  const syncedCount = axes.filter((a) => a.synced).length;
  return {
    sectionId,
    sectionLabel,
    tone:
      syncedCount === 0
        ? "neutral"
        : toneOverride ?? deriveToneFromAxes(axes, preferInvertStress),
    syncedCount,
    totalAxes: axes.length,
    axes,
  };
}

export function buildSectionMacroRadar(
  pathname: string,
  telemetry: SectionRadarTelemetry
): SectionRadarModel {
  const { latestValues, marketQuotes, health, recentRuns, activeRegimeLens } = telemetry;

  const healthList = Array.isArray(health) ? health : Object.values(health);

  // Daily Check, Overview, and generic tools use the calibrated 5-force lens radar hydrated with live latestValues & quotes
  const lenses = buildDailyCheckRegimeLenses(
    Object.values(marketQuotes).map((q) => {
      const cardId =
        q.symbol === "SPX500"
          ? "spx"
          : q.symbol === "US2Y"
          ? "us02y"
          : q.symbol.toLowerCase();
      const cat =
        q.symbol === "XAUUSD"
          ? ("Commodities" as const)
          : q.symbol === "BTCUSD"
          ? ("Crypto" as const)
          : q.symbol === "SPX500" || q.symbol === "US30"
          ? ("Equities" as const)
          : q.symbol === "US2Y" || q.symbol === "US10Y" || q.symbol === "US30Y"
          ? ("Rates" as const)
          : ("FX" as const);
      return {
        id: cardId,
        symbol: q.symbol,
        name: q.symbol,
        category: cat,
        value: q.price,
        previous: q.previousClose,
        change: q.previousClose !== null ? q.price - q.previousClose : null,
        changePercent: q.changePct,
        unit: "",
        deltaUnit: "%",
        decimals: 2,
        sparkline: [],
        meta: {
          source: q.sourceId,
          observationDate: q.quoteTimestamp.slice(0, 10),
          lastUpdated: q.receivedAt,
          frequency: q.status === "LIVE" ? "LIVE" : "DAILY",
          units: "Level",
          mode: "LIVE_API",
        },
      };
    }),
    Object.values(latestValues)
  );

  if (pathname.startsWith("/macrodashboard/positioning/commitments-of-traders")) {
    const axes = [
      axisFromSeries("cot-gc", "GOLD", "GC", getLatest(latestValues, ["COT_NET_GC", "CFTC_COT_GC"]), 0, 0.00018),
      axisFromSeries("cot-es", "SPX", "ES", getLatest(latestValues, ["COT_NET_ES"]), 0, 0.00015),
      axisFromSeries("cot-dx", "DXY", "DX", getLatest(latestValues, ["COT_NET_DX"]), 0, 0.0009),
      axisFromSeries("cot-zn", "US10Y", "ZN", getLatest(latestValues, ["COT_NET_ZN"]), 0, 0.00008),
      axisFromSeries("cot-6e", "EUR", "6E", getLatest(latestValues, ["COT_NET_6E"]), 0, 0.00025),
    ];
    return finalizeModel("cot", "COT POSN", axes);
  }

  if (pathname.startsWith("/macrodashboard/positioning/correlation-matrix")) {
    const axes = [
      axisFromQuote("corr-xau", "GOLD", "XAU", getQuote(marketQuotes, ["XAUUSD"]), 12),
      axisFromQuote("corr-dxy", "DXY", "DXY", getQuote(marketQuotes, ["DXY"]), 18),
      axisFromQuote("corr-us10y", "10Y", "10Y", getQuote(marketQuotes, ["US10Y"]), 6),
      axisFromQuote("corr-spx", "SPX", "SPX", getQuote(marketQuotes, ["SPX500"]), 14),
      axisFromQuote("corr-btc", "BTC", "BTC", getQuote(marketQuotes, ["BTCUSD"]), 6),
    ];
    return finalizeModel("correlation", "CORR", axes);
  }

  if (pathname.startsWith("/macrodashboard/liquidity/monetary-policy")) {
    const axes = [
      axisFromSeries("mp-effr", "EFFR", "EFFR", getLatest(latestValues, ["EFFR", "FED_EFFR_OFFICIAL"]), 2.5, 11),
      axisFromSeries("mp-sofr", "SOFR", "SOFR", getLatest(latestValues, ["SOFR"]), 2.5, 11),
      axisFromSeries("mp-iorb", "IORB", "IORB", getLatest(latestValues, ["IORB"]), 2.5, 11),
      axisFromSeries("mp-walcl", "WALCL", "FED", getLatest(latestValues, ["FED_WALCL"]), 7_000_000, 0.000012),
      axisFromSeries("mp-real", "REAL10", "R10", getLatest(latestValues, ["US10Y_REAL"]), 1.25, 18),
    ];
    return finalizeModel("monetary-policy", "MON POL", axes);
  }

  if (pathname.startsWith("/macrodashboard/liquidity/primary-dealer-stats")) {
    const axes = [
      axisFromSeries("pd-nliq", "NET LIQ", "NLIQ", getLatest(latestValues, ["NET_LIQUIDITY_DERIVED"]), 5.5, 18),
      axisFromSeries("pd-rrp", "ON RRP", "RRP", getLatest(latestValues, ["FED_RRP"]), 300, 0.04, true),
      axisFromSeries("pd-tga", "TGA", "TGA", getLatest(latestValues, ["FED_TGA"]), 650, 0.05, true),
      axisFromSeries("pd-sofr", "SOFR", "SOFR", getLatest(latestValues, ["SOFR", "EFFR"]), 4.0, 10, true),
      axisFromSeries("pd-ust", "UST AVG", "UST", getLatest(latestValues, ["UST_AVG_NOTE_RATE"]), 3.0, 12),
    ];
    return finalizeModel("primary-dealer", "DEALER", axes);
  }

  if (pathname.startsWith("/macrodashboard/credit-risk")) {
    const axes = [
      axisFromSeries("cr-vix", "VIX", "VIX", getLatest(latestValues, ["VIX"]), 18, 2.2),
      axisFromSeries(
        "cr-hy",
        "HY OAS",
        "HY",
        getLatest(latestValues, ["HY_OAS"]),
        3.5,
        14
      ),
      axisFromSeries("cr-ig", "IG OAS", "IG", getLatest(latestValues, ["IG_OAS"]), 1.1, 25),
      axisFromSeries("cr-stl", "STLFSI", "FSI", getLatest(latestValues, ["STLFSI4"]), 0, 18),
      axisFromSeries("cr-real", "REAL10", "R10", getLatest(latestValues, ["US10Y_REAL"]), 1.5, 16),
    ];
    return finalizeModel("credit-risk", "CREDIT", axes, undefined, true);
  }

  if (pathname.startsWith("/macrodashboard/economy/economy-labor")) {
    const axes = [
      axisFromSeries("lb-gdp", "GDP", "GDP", getLatest(latestValues, ["REAL_GDP_QOQ"]), 2.0, 12),
      axisFromSeries("lb-nfp", "NFP", "NFP", getLatest(latestValues, ["NFP_PAYEMS"]), 150, 0.14),
      axisFromSeries("lb-unrate", "UNEMP", "UNR", getLatest(latestValues, ["UNRATE"]), 4.2, 18, true),
      axisFromSeries("lb-ism", "ISM", "ISM", getLatest(latestValues, ["ISM_SVC", "ISM_MFG"]), 50, 2.8),
      axisFromSeries("lb-icsa", "CLAIMS", "CLM", getLatest(latestValues, ["ICSA"]), 230_000, 0.0004, true),
    ];
    return finalizeModel("economy-labor", "LABOR", axes);
  }

  if (pathname.startsWith("/macrodashboard/economy/inflation")) {
    const axes = [
      axisFromSeries("in-cpi", "CPI", "CPI", getLatest(latestValues, ["CPI_YOY"]), 2.0, 18),
      axisFromSeries("in-ccpi", "C-CPI", "CCPI", getLatest(latestValues, ["CORE_CPI_YOY"]), 2.0, 18),
      axisFromSeries("in-pce", "PCE", "PCE", getLatest(latestValues, ["PCE_YOY"]), 2.0, 18),
      axisFromSeries("in-cpce", "C-PCE", "CPCE", getLatest(latestValues, ["CORE_PCE_YOY"]), 2.0, 18),
      axisFromSeries("in-be", "10Y BE", "BE10", getLatest(latestValues, ["BREAKEVEN_10Y"]), 2.1, 24),
    ];
    return finalizeModel("inflation", "INFL", axes, undefined, true);
  }

  if (pathname.startsWith("/macrodashboard/economy/fixed-income-rates")) {
    const axes = [
      axisFromSeries("fi-2y", "US 2Y", "2Y", getLatest(latestValues, ["US2Y"]), 3.5, 14),
      axisFromSeries("fi-10y", "US 10Y", "10Y", getLatest(latestValues, ["US10Y"]), 3.8, 14),
      axisFromSeries("fi-30y", "US 30Y", "30Y", getLatest(latestValues, ["US30Y"]), 4.0, 14),
      axisFromSeries("fi-2s10s", "2s10s", "2/10", getLatest(latestValues, ["SPREAD_2S10S"]), 0, 0.4),
      axisFromSeries("fi-5s30s", "5s30s", "5/30", getLatest(latestValues, ["SPREAD_5S30S"]), 0.25, 22),
    ];
    return finalizeModel("fixed-income", "RATES", axes);
  }

  if (pathname.startsWith("/macrodashboard/economy/international")) {
    const axes = [
      axisFromSeries("ix-dxy", "DXY", "DXY", getLatest(latestValues, ["DXY_BROAD"]), 122, 2.2),
      axisFromSeries("ix-6e", "EUR", "EUR", getLatest(latestValues, ["COT_NET_6E"]), 0, 0.00025),
      axisFromSeries("ix-6j", "JPY", "JPY", getLatest(latestValues, ["COT_NET_6J"]), 0, 0.00025),
      axisFromSeries("ix-6b", "GBP", "GBP", getLatest(latestValues, ["COT_NET_6B"]), 0, 0.0003),
      axisFromSeries("ix-6a", "AUD", "AUD", getLatest(latestValues, ["COT_NET_6A"]), 0, 0.00035),
    ];
    return finalizeModel("international", "INTL", axes);
  }

  if (pathname.startsWith("/macrodashboard/economy/g10-indicators")) {
    const axes = [
      axisFromQuote("g10-dxy", "USD", "USD", getQuote(marketQuotes, ["DXY"]), 15),
      axisFromQuote("g10-spx", "SPX", "SPX", getQuote(marketQuotes, ["SPX500"]), 12),
      axisFromSeries("g10-10y", "10Y", "10Y", getLatest(latestValues, ["US10Y"]), 3.8, 14),
      axisFromQuote("g10-xau", "GOLD", "XAU", getQuote(marketQuotes, ["XAUUSD"]), 10),
      axisFromQuote("g10-btc", "BTC", "BTC", getQuote(marketQuotes, ["BTCUSD"]), 6),
    ];
    return finalizeModel("g10", "G10 FX", axes);
  }

  if (pathname.startsWith("/macrodashboard/tools/ai-bias")) {
    const axes = [
      axisFromQuote("ai-xau", "GOLD", "XAU", getQuote(marketQuotes, ["XAUUSD"]), 12),
      axisFromQuote("ai-dxy", "DXY", "DXY", getQuote(marketQuotes, ["DXY"]), 16),
      axisFromSeries("ai-r10", "REAL10", "R10", getLatest(latestValues, ["US10Y_REAL"]), 1.5, 18, true),
      axisFromSeries("ai-cpi", "CPI", "CPI", getLatest(latestValues, ["CPI_YOY"]), 2.2, 16),
      axisFromSeries("ai-vix", "VIX", "VIX", getLatest(latestValues, ["VIX"]), 18, 2.2, true),
    ];
    return finalizeModel("ai-bias", "AI BIAS", axes);
  }

  if (pathname.startsWith("/macrodashboard/tools/data-ops")) {
    const axes = [
      axisFromStatus("ops-mkt", "MKT WS", "MKT", healthList.filter((h) => h.workerId === "market-engine")),
      axisFromStatus("ops-mac", "MACRO", "MAC", healthList.filter((h) => h.workerId === "macro-engine")),
      axisFromStatus("ops-pos", "CFTC", "COT", healthList.filter((h) => h.workerId === "positioning-engine")),
      axisFromStatus("ops-liq", "LIQ", "LIQ", healthList.filter((h) => h.workerId === "liquidity-risk-engine")),
      axisFromStatus("ops-all", "SYNC", "ALL", healthList),
    ];
    return finalizeModel("data-ops", "DATA OPS", axes);
  }

  if (pathname.startsWith("/macrodashboard/tools/incidents")) {
    const failedRuns = recentRuns.filter((r) => r.status === "FAILED").length;
    const totalRuns = Math.max(1, recentRuns.length);
    const runScore = clampScore(100 - (failedRuns / totalRuns) * 80);
    const syncedRuns = recentRuns.length > 0;
    const axes = [
      axisFromStatus("inc-mkt", "MKT", "MKT", healthList.filter((h) => h.workerId === "market-engine")),
      axisFromStatus("inc-mac", "MACRO", "MAC", healthList.filter((h) => h.workerId === "macro-engine")),
      axisFromStatus("inc-db", "STORE", "DB", healthList),
      axisFromStatus("inc-val", "VALID", "VAL", healthList.filter((h) => h.workerId === "validation-recovery")),
      {
        id: "inc-runs",
        label: "JOBS",
        code: "JOB",
        todayScore: syncedRuns ? runScore : 50,
        lastWeekScore: 50,
        delta: syncedRuns ? runScore - 50 : null,
        synced: syncedRuns,
      },
    ];
    return finalizeModel("incidents", "INCIDENT", axes);
  }

  if (pathname.startsWith("/macrodashboard/tools/comparator")) {
    const axes = [
      axisFromQuote("cmp-xau", "XAU", "XAU", getQuote(marketQuotes, ["XAUUSD"]), 12),
      axisFromQuote("cmp-spx", "SPX", "SPX", getQuote(marketQuotes, ["SPX500"]), 14),
      axisFromQuote("cmp-dxy", "DXY", "DXY", getQuote(marketQuotes, ["DXY"]), 16),
      axisFromQuote("cmp-10y", "10Y", "10Y", getQuote(marketQuotes, ["US10Y"]), 8),
      axisFromQuote("cmp-us30", "US30", "DOW", getQuote(marketQuotes, ["US30"]), 14),
    ];
    return finalizeModel("comparator", "COMPARE", axes);
  }

  if (pathname.startsWith("/macrodashboard/tools/watch-list")) {
    const axes = [
      axisFromQuote("wl-xau", "GOLD", "XAU", getQuote(marketQuotes, ["XAUUSD"]), 12),
      axisFromQuote("wl-btc", "BTC", "BTC", getQuote(marketQuotes, ["BTCUSD"]), 8),
      axisFromQuote("wl-spx", "SPX", "SPX", getQuote(marketQuotes, ["SPX500"]), 14),
      axisFromQuote("wl-dxy", "DXY", "DXY", getQuote(marketQuotes, ["DXY"]), 16),
      axisFromQuote("wl-2y", "US2Y", "2Y", getQuote(marketQuotes, ["US2Y"]), 8),
    ];
    return finalizeModel("watch-list", "WATCH", axes);
  }

  // Daily Check follows activeRegimeLens; Macro Overview defaults to General macro regime
  const targetLensId: RegimeLensId = pathname.startsWith("/macrodashboard/tools/daily-check")
    ? activeRegimeLens
    : "general";
  const lens = lenses.find((l) => l.id === targetLensId) ?? lenses[0];
  const axes: SectionRadarAxis[] = lens.forces.map((f) => {
    const isSynced = f.stateLabel !== "AWAITING SYNC";
    return {
      id: f.id,
      label: f.shortLabel,
      code: f.shortLabel.slice(0, 3),
      todayScore: f.todayScore,
      lastWeekScore: f.lastWeekScore,
      delta: isSynced ? f.todayScore - f.lastWeekScore : null,
      synced: isSynced,
    };
  });

  return finalizeModel(
    pathname.startsWith("/macrodashboard/tools/daily-check") ? `daily-${lens.id}` : "overview",
    pathname.startsWith("/macrodashboard/tools/daily-check")
      ? lens.tabLabel.toUpperCase()
      : "OVERVIEW",
    axes,
    lens.tone
  );
}
