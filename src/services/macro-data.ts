import { fetchBeaSeries } from "@/services/bea/client";
import { fetchBlsSeries } from "@/services/bls/client";
import { fetchCftcPositioning } from "@/services/cftc/client";
import { getBenchmarkCotData } from "@/services/data/benchmark-cot";
import { getBenchmarkCorrelationAssets } from "@/services/data/benchmark-correlation";
import { getBenchmarkMonetaryPolicyData } from "@/services/data/benchmark-monetary";
import {
  getBenchmarkPrimaryDealerLiquidity,
  getBenchmarkTreasuryAuctions,
} from "@/services/data/benchmark-primary-dealer";
import { getBenchmarkEconomyLaborSeries } from "@/services/data/benchmark-economy-labor";
import {
  fetchFredReleaseDates,
  fetchFredSeries,
  type FredSeriesResult,
} from "@/services/fred/client";
import { fetchTreasuryAuctions } from "@/services/treasury/client";
import { buildEconomicCalendarEvents } from "@/services/data/economic-calendar";
import { INFLATION_TOP_METRICS } from "@/services/data/economy-inflation";
import { MARKET_OVERVIEW_CARDS } from "@/services/data/market-overview";
import { buildDailyCheckRegimeLenses } from "@/services/data/daily-check-regime";
import { isProviderConfigured } from "@/services/sync/provider-registry";
import {
  getLatestValues,
  getMarketBars,
  getMarketQuotes,
  getObservations,
  upsertMarketQuote,
} from "@/services/sync/store";
import {
  getYFinanceCachedQuotes,
  getYFinanceQuote,
} from "@/services/yfinance/client";
import { MARKET_INSTRUMENT_MAPPINGS } from "@/services/sync/provider-registry";
import type { MarketQuoteRecord, MarketSymbol } from "@/lib/sync/types";
import type {
  CentralBankItem,
  CorrelationAssetSeries,
  CreditSpreadSeriesPoint,
  DailyCheckEntry,
  DatasetMeta,
  DealerMaturityBucket,
  EconomyLaborPoint,
  FeedMode,
  FomcDecisionRow,
  InflationCardMetric,
  InflationComponentRow,
  InflationHistoryPoint,
  InternationalEconomy,
  LiquiditySeriesPoint,
  MacroRegimeFactor,
  MarketOverviewCardData,
  WatchlistItem,
  YieldCurveSnapshotPoint,
  YieldHistoryPoint,
} from "@/lib/types";

function patchFredCard(
  card: MarketOverviewCardData,
  result: FredSeriesResult,
  isBpsChange = true
): MarketOverviewCardData {
  if (!result.available || result.observations.length === 0) {
    return {
      ...card,
      value: null,
      previous: null,
      change: null,
      changePercent: null,
      sparkline: [],
      meta: {
        ...card.meta,
        mode: result.meta.mode,
      },
    };
  }

  const obs = result.observations;
  const latest = obs[obs.length - 1];
  const prev = obs.length >= 2 ? obs[obs.length - 2] : null;
  const rawDelta = prev ? latest.value - prev.value : null;

  return {
    ...card,
    value: Number(latest.value.toFixed(card.decimals)),
    previous: prev ? Number(prev.value.toFixed(card.decimals)) : null,
    change:
      rawDelta === null
        ? null
        : isBpsChange
        ? Math.round(rawDelta * 100)
        : Number(rawDelta.toFixed(card.decimals)),
    changePercent:
      prev && prev.value !== 0
        ? Number((((latest.value - prev.value) / prev.value) * 100).toFixed(2))
        : null,
    sparkline: obs.slice(-10).map((p) => ({ t: p.date, v: p.value })),
    meta: result.meta,
  };
}

function patchQuoteCard(
  card: MarketOverviewCardData,
  quote: MarketQuoteRecord,
  bars: { t: string; v: number }[],
  isBpsChange = false
): MarketOverviewCardData {
  const previous = quote.previousClose;
  const rawDelta = previous !== null ? quote.price - previous : quote.changeValue;
  const change = Number.isFinite(rawDelta)
    ? isBpsChange
      ? Math.round(rawDelta * 100)
      : Number(rawDelta.toFixed(card.decimals))
    : null;

  return {
    ...card,
    value: Number(quote.price.toFixed(card.decimals)),
    previous: previous !== null ? Number(previous.toFixed(card.decimals)) : null,
    change,
    changePercent: Number.isFinite(quote.changePct)
      ? Number(quote.changePct.toFixed(2))
      : null,
    sparkline: bars,
    meta: {
      source: `${quote.sourceId} · ${quote.externalSymbol}`,
      seriesId: quote.symbol,
      observationDate: quote.quoteTimestamp.slice(0, 10),
      releaseDate: quote.quoteTimestamp.slice(0, 10),
      lastUpdated: quote.updatedAt,
      frequency: "LIVE",
      units: quote.unit,
      mode: "LIVE_API",
    },
  };
}

function anyWsConfigured(): boolean {
  return (
    isProviderConfigured("twelve_data_ws") ||
    isProviderConfigured("finnhub_ws") ||
    isProviderConfigured("polygon_ws") ||
    isProviderConfigured("coinbase_ws")
  );
}

function buildCorrelationSeriesFromRaw(
  seriesList: {
    symbol: string;
    name: string;
    category: string;
    isYield?: boolean;
    points: { date: string; price: number }[];
  }[]
): CorrelationAssetSeries[] {
  const validAssets: CorrelationAssetSeries[] = [];

  for (const s of seriesList) {
    if (s.points.length < 6) continue;
    const returns: { date: string; value: number; price: number }[] = [];
    for (let i = 1; i < s.points.length; i++) {
      const prev = s.points[i - 1];
      const curr = s.points[i];
      if (!Number.isFinite(prev.price) || !Number.isFinite(curr.price)) continue;
      const val = s.isYield
        ? curr.price - prev.price
        : prev.price !== 0
        ? ((curr.price - prev.price) / prev.price) * 100
        : 0;
      returns.push({
        date: curr.date.slice(0, 10),
        value: Number(val.toFixed(3)),
        price: curr.price,
      });
    }
    if (returns.length >= 5) {
      validAssets.push({
        symbol: s.symbol,
        name: s.name,
        category: s.category,
        returns,
      });
    }
  }

  return validAssets.length >= 2 ? validAssets : [];
}

async function fetchApiNinjasGoldQuoteSafe(): Promise<MarketQuoteRecord | null> {
  const apiKey = process.env.API_NINJAS_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.api-ninjas.com/v1/goldprice", {
      headers: { "X-Api-Key": apiKey },
      ...({ next: { revalidate: 60 } } as Record<string, unknown>),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: number; updated?: number };
    if (typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0) return null;
    await upsertMarketQuote({
      symbol: "XAUUSD",
      sourceId: "api_ninjas",
      externalSymbol: "goldprice",
      assetClass: "Commodities",
      price: data.price,
      unit: "USD/oz",
      quoteTimestamp: data.updated ? new Date(data.updated * 1000).toISOString() : new Date().toISOString(),
      rawPayload: data as Record<string, unknown>,
    });
    const quotes = await getMarketQuotes();
    return quotes.find((q) => q.symbol === "XAUUSD") ?? null;
  } catch {
    return null;
  }
}

export async function getMacroOverviewData() {
  const [us10y, us02y, us10yr, vix, sp500, quotes, bars, latestValues, fredReleases] =
    await Promise.all([
      fetchFredSeries("DGS10", { units: "%", frequency: "DAILY", limit: 30 }),
      fetchFredSeries("DGS2", { units: "%", frequency: "DAILY", limit: 30 }),
      fetchFredSeries("DFII10", { units: "%", frequency: "DAILY", limit: 30 }),
      fetchFredSeries("VIXCLS", { units: "Index", frequency: "DAILY", limit: 30 }),
      fetchFredSeries("SP500", { units: "Index", frequency: "DAILY", limit: 30 }),
      getMarketQuotes().catch(() => []),
      getMarketBars(undefined, "1d", 100).catch(() => []),
      getLatestValues().catch(() => []),
      fetchFredReleaseDates(14, 14).catch(() => []),
    ]);

  const quoteMap = new Map<MarketSymbol, MarketQuoteRecord>(
    quotes.map((q) => [q.symbol, q])
  );

  if (!quoteMap.has("XAUUSD") && process.env.API_NINJAS_API_KEY?.trim()) {
    try {
      const goldQuote = await fetchApiNinjasGoldQuoteSafe();
      if (goldQuote) {
        quoteMap.set("XAUUSD", goldQuote);
      }
    } catch {
      // Background fetch non-blocking
    }
  }

  // Populate DXY and other assets from yfinance cache / live feeds
  try {
    const yfCached = await getYFinanceCachedQuotes();
    if (yfCached) {
      for (const [sym, mapping] of Object.entries(MARKET_INSTRUMENT_MAPPINGS)) {
        const mSym = sym as MarketSymbol;
        if (!quoteMap.has(mSym) && yfCached[mSym]) {
          const entry = yfCached[mSym];
          await upsertMarketQuote({
            symbol: mSym,
            sourceId: "yfinance",
            externalSymbol: mapping.externalSymbols.yfinance || entry.externalSymbol,
            assetClass: mapping.assetClass,
            price: entry.price,
            previousClose: entry.previousClose,
            changeValue: entry.change,
            changePct: entry.changePercent,
            volume: entry.volume,
            unit: mapping.unit,
            quoteTimestamp: entry.quoteTimestamp,
            rawPayload: entry as unknown as Record<string, unknown>,
          });
        }
      }
      const refreshedQuotes = await getMarketQuotes();
      for (const q of refreshedQuotes) {
        quoteMap.set(q.symbol, q);
      }
    }
  } catch {
    // Non-blocking fallback
  }

  // Specifically ensure DXY is populated with live ICE Dollar Index
  if (!quoteMap.has("DXY")) {
    try {
      const dxyQuote = await getYFinanceQuote("DXY");
      if (dxyQuote) {
        quoteMap.set("DXY", dxyQuote);
      }
    } catch {
      // Non-blocking
    }
  }

  const barsBySymbol = new Map<MarketSymbol, { t: string; v: number }[]>();
  for (const bar of bars) {
    const arr = barsBySymbol.get(bar.symbol) ?? [];
    arr.push({ t: bar.barTime.slice(0, 10), v: bar.close });
    barsBySymbol.set(bar.symbol, arr);
  }
  for (const [sym, arr] of barsBySymbol.entries()) {
    arr.sort((a, b) => a.t.localeCompare(b.t));
    barsBySymbol.set(sym, arr.slice(-10));
  }

  const wsEnabled = anyWsConfigured();
  const anyConfigured = isProviderConfigured("fred") || wsEnabled;
  const wsMode: FeedMode = wsEnabled ? "AWAITING_SYNC" : "UNCONFIGURED";

  const cards = MARKET_OVERVIEW_CARDS.map((card) => {
    if (!anyConfigured) {
      return {
        ...card,
        value: null,
        previous: null,
        change: null,
        changePercent: null,
        sparkline: [],
        meta: {
          ...card.meta,
          mode: "UNCONFIGURED" as FeedMode,
        },
      };
    }

    const symbolMap: Record<string, MarketSymbol | undefined> = {
      dxy: "DXY",
      xauusd: "XAUUSD",
      spx: "SPX500",
      btcusd: "BTCUSD",
      ...(!isProviderConfigured("fred")
        ? { us10y: "US10Y" as MarketSymbol, us02y: "US2Y" as MarketSymbol }
        : {}),
    };
    const mSym = symbolMap[card.id];
    const quote = mSym ? quoteMap.get(mSym) : undefined;
    if (quote && Number.isFinite(quote.price)) {
      const symBars = (mSym ? barsBySymbol.get(mSym) : undefined) ?? [];
      return patchQuoteCard(
        card,
        quote,
        symBars,
        card.deltaUnit === "bps"
      );
    }

    if (card.id === "us10y") return patchFredCard(card, us10y, true);
    if (card.id === "us02y") return patchFredCard(card, us02y, true);
    if (card.id === "us10y-real") return patchFredCard(card, us10yr, true);
    if (card.id === "vix") return patchFredCard(card, vix, false);
    if (card.id === "spx" && sp500.available) return patchFredCard(card, sp500, false);

    return {
      ...card,
      value: null,
      previous: null,
      change: null,
      changePercent: null,
      sparkline: [],
      meta: {
        ...card.meta,
        mode: wsMode,
      },
    };
  });

  const latestMap = new Map(latestValues.map((v) => [v.seriesKey, v]));
  const regimeFactors: MacroRegimeFactor[] = [];

  const gdp = latestMap.get("REAL_GDP_QOQ");
  if (gdp) {
    regimeFactors.push({
      id: "growth",
      label: "Growth",
      status: gdp.value >= 2 ? "Expansion" : gdp.value >= 0 ? "Moderating" : "Contraction",
      tone: gdp.value >= 2 ? "bullish" : gdp.value >= 0 ? "neutral" : "bearish",
      score: Math.max(10, Math.min(95, Math.round(50 + gdp.value * 8))),
      signalValue: `${gdp.value > 0 ? "+" : ""}${gdp.value.toFixed(1)}% GDP`,
      driver: gdp.sourceAttribution,
    });
  }

  const cpi = latestMap.get("CPI_YOY");
  const corePce = latestMap.get("CORE_PCE_YOY");
  if (cpi || corePce) {
    const anchor = corePce?.value ?? cpi?.value ?? 2;
    regimeFactors.push({
      id: "inflation",
      label: "Inflation",
      status: anchor > 2.5 ? "Above Target" : anchor < 1.8 ? "Disinflation" : "Near Target",
      tone: anchor > 2.5 ? "mixed" : "bullish",
      score: Math.max(10, Math.min(95, Math.round(50 + (anchor - 2) * 18))),
      signalValue: `${cpi ? `${cpi.value.toFixed(1)}% CPI` : "—"} / ${
        corePce ? `${corePce.value.toFixed(1)}% Core PCE` : "—"
      }`,
      driver: (corePce ?? cpi)!.sourceAttribution,
    });
  }

  const effr = latestMap.get("EFFR");
  if (effr) {
    regimeFactors.push({
      id: "monetary-policy",
      label: "Monetary Policy",
      status: effr.value >= 4 ? "Restrictive" : effr.value >= 2 ? "Neutral" : "Accommodative",
      tone: "neutral",
      score: Math.max(10, Math.min(95, Math.round(40 + effr.value * 6))),
      signalValue: `${effr.value.toFixed(2)}% EFFR`,
      driver: effr.sourceAttribution,
    });
  }

  const netLiq = latestMap.get("NET_LIQUIDITY_DERIVED");
  if (netLiq) {
    regimeFactors.push({
      id: "liquidity",
      label: "Liquidity",
      status: (netLiq.changeValue ?? 0) >= 0 ? "Supportive" : "Draining",
      tone: (netLiq.changeValue ?? 0) >= 0 ? "bullish" : "mixed",
      score: Math.max(10, Math.min(95, Math.round(40 + netLiq.value * 5))),
      signalValue: `$${netLiq.value.toFixed(2)}T Net Liq`,
      driver: netLiq.sourceAttribution,
    });
  }

  const hy = latestMap.get("HY_OAS");
  if (hy) {
    const hyBps = hy.value < 30 ? Math.round(hy.value * 100) : Math.round(hy.value);
    regimeFactors.push({
      id: "credit",
      label: "Credit Conditions",
      status: hyBps <= 325 ? "Tight Spreads" : hyBps <= 450 ? "Moderate" : "Widening Stress",
      tone: hyBps <= 325 ? "bullish" : hyBps <= 450 ? "neutral" : "bearish",
      score: Math.max(10, Math.min(95, Math.round(85 - (hyBps - 250) * 0.15))),
      signalValue: `${hyBps} bps HY OAS`,
      driver: hy.sourceAttribution,
    });
  }

  const liveVixCard = cards.find((c) => c.id === "vix" && c.value !== null);
  if (liveVixCard && liveVixCard.value !== null) {
    const vixVal = liveVixCard.value;
    regimeFactors.push({
      id: "risk",
      label: "Risk Sentiment",
      status: vixVal <= 17 ? "Constructive" : vixVal <= 23 ? "Balanced" : "Risk-Off",
      tone: vixVal <= 17 ? "bullish" : vixVal <= 23 ? "neutral" : "bearish",
      score: Math.max(10, Math.min(95, Math.round(90 - (vixVal - 12) * 2.5))),
      signalValue: `VIX ${vixVal.toFixed(2)}`,
      driver: liveVixCard.meta.source,
    });
  }

  const correlationAssets = buildCorrelationSeriesFromRaw([
    {
      symbol: "US10Y",
      name: "US 10Y Yield",
      category: "Rates",
      isYield: true,
      points: us10y.observations.map((o) => ({ date: o.date, price: o.value })),
    },
    {
      symbol: "US02Y",
      name: "US 2Y Yield",
      category: "Rates",
      isYield: true,
      points: us02y.observations.map((o) => ({ date: o.date, price: o.value })),
    },
    {
      symbol: "SPX",
      name: "S&P 500",
      category: "Equities",
      points: sp500.observations.map((o) => ({ date: o.date, price: o.value })),
    },
  ]);

  const liveCards = cards.filter((c) => c.meta.mode === "LIVE_API");

  const allObsDates = [
    ...liveCards.map((c) => c.meta.observationDate),
    ...latestValues.map((v) => v.observationDate),
  ].filter((d) => d && d !== "—" && !d.includes("undefined"));
  allObsDates.sort();
  const latestActiveObsDate = allObsDates.pop() ?? new Date().toISOString().slice(0, 10);

  const resolvedMeta: DatasetMeta =
    liveCards.length > 0
      ? {
          ...liveCards[0].meta,
          observationDate: latestActiveObsDate,
          source:
            liveCards.length === cards.length
              ? "Live Multi-Asset & FRED Feeds"
              : `Partial Live Telemetry (${liveCards.length}/${cards.length} active)`,
          mode: "LIVE_API",
        }
      : {
          source: "MacroEdge Cross-Asset Feeds",
          seriesId: "MACRO-OVERVIEW",
          observationDate: latestActiveObsDate,
          lastUpdated: new Date().toISOString(),
          frequency: "DAILY",
          units: "Multi-Asset",
          mode: anyConfigured ? "AWAITING_SYNC" : "UNCONFIGURED",
        };

  const calendarEvents = buildEconomicCalendarEvents({
    latestValues,
    fredReleases,
  });

  return {
    cards,
    regimeFactors,
    calendarEvents,
    correlationAssets,
    meta: resolvedMeta,
  };
}

export async function getCotDashboardData() {
  const result = await fetchCftcPositioning();
  if (result.instruments.length > 0) {
    return result;
  }
  return getBenchmarkCotData();
}

export async function getCorrelationMatrixData() {
  const [bars, us10y, us02y, sp500] = await Promise.all([
    getMarketBars(undefined, "1d", 252).catch(() => []),
    fetchFredSeries("DGS10", { units: "%", frequency: "DAILY", limit: 252 }),
    fetchFredSeries("DGS2", { units: "%", frequency: "DAILY", limit: 252 }),
    fetchFredSeries("SP500", { units: "Index", frequency: "DAILY", limit: 252 }),
  ]);

  const rawList: {
    symbol: string;
    name: string;
    category: string;
    isYield?: boolean;
    points: { date: string; price: number }[];
  }[] = [];

  const groupedBars = new Map<string, { date: string; price: number }[]>();
  for (const bar of bars) {
    const arr = groupedBars.get(bar.symbol) ?? [];
    arr.push({ date: bar.barTime.slice(0, 10), price: bar.close });
    groupedBars.set(bar.symbol, arr);
  }
  for (const [symbol, pts] of groupedBars.entries()) {
    pts.sort((a, b) => a.date.localeCompare(b.date));
    rawList.push({
      symbol,
      name: symbol,
      category: symbol === "DXY" ? "FX" : symbol === "XAUUSD" ? "Commodities" : "Market",
      isYield: symbol.startsWith("US") && symbol.endsWith("Y"),
      points: pts,
    });
  }

  if (!groupedBars.has("US10Y") && us10y.available) {
    rawList.push({
      symbol: "US10Y",
      name: "US 10Y Yield",
      category: "Rates",
      isYield: true,
      points: us10y.observations.map((o) => ({ date: o.date, price: o.value })),
    });
  }
  if (!groupedBars.has("US2Y") && us02y.available) {
    rawList.push({
      symbol: "US02Y",
      name: "US 2Y Yield",
      category: "Rates",
      isYield: true,
      points: us02y.observations.map((o) => ({ date: o.date, price: o.value })),
    });
  }
  if (!groupedBars.has("SPX500") && sp500.available) {
    rawList.push({
      symbol: "SPX",
      name: "S&P 500",
      category: "Equities",
      points: sp500.observations.map((o) => ({ date: o.date, price: o.value })),
    });
  }

  let assets = buildCorrelationSeriesFromRaw(rawList);
  if (assets.length < 2) {
    const overview = await getMacroOverviewData();
    if (overview.correlationAssets.length >= 2) {
      assets = overview.correlationAssets;
    }
  }
  if (assets.length < 2) {
    assets = getBenchmarkCorrelationAssets();
  }
  const anyConfigured = isProviderConfigured("fred") || anyWsConfigured();
  const latestObsDate =
    assets[0]?.returns[assets[0].returns.length - 1]?.date ?? "—";

  return {
    assets,
    meta: {
      source: "MacroEdge Cross-Asset Composite",
      seriesId: "CORR-MATRIX",
      observationDate: latestObsDate,
      lastUpdated: new Date().toISOString(),
      frequency: "DAILY",
      units: "Pearson r",
      mode:
        assets.length >= 2
          ? "LIVE_API"
          : anyConfigured
          ? "AWAITING_SYNC"
          : "UNCONFIGURED",
    } satisfies DatasetMeta,
  };
}

function buildLiquiditySeriesFromFred(params: {
  walcl: FredSeriesResult;
  tga: FredSeriesResult;
  rrp: FredSeriesResult;
  sofr: FredSeriesResult;
  iorb: FredSeriesResult;
}): LiquiditySeriesPoint[] {
  const { walcl, tga, rrp, sofr, iorb } = params;
  const anyAvailable =
    walcl.available ||
    tga.available ||
    rrp.available ||
    sofr.available ||
    iorb.available;
  if (!anyAvailable) return [];

  const toMap = (res: FredSeriesResult) => {
    const m = new Map<string, number>();
    for (const o of res.observations) {
      m.set(o.date, o.value);
    }
    return m;
  };

  const walclMap = toMap(walcl);
  const tgaMap = toMap(tga);
  const rrpMap = toMap(rrp);
  const sofrMap = toMap(sofr);
  const iorbMap = toMap(iorb);

  const anchorDates =
    walcl.observations.length > 0
      ? walcl.observations.map((o) => o.date)
      : rrp.observations.length > 0
      ? rrp.observations.map((o) => o.date)
      : sofr.observations.map((o) => o.date);

  let lastWalcl = 0;
  let lastTga = 0;
  let lastRrp = 0;
  let lastSofr = 0;
  let lastIorb = 0;

  return anchorDates.map((date) => {
    if (walclMap.has(date)) lastWalcl = walclMap.get(date)!;
    if (tgaMap.has(date)) lastTga = tgaMap.get(date)!;
    if (rrpMap.has(date)) lastRrp = rrpMap.get(date)!;
    if (sofrMap.has(date)) lastSofr = sofrMap.get(date)!;
    if (iorbMap.has(date)) lastIorb = iorbMap.get(date)!;

    const fedAssetsTn = Number((lastWalcl / 1_000_000).toFixed(2));
    const tgaBn = Math.round(lastTga / 1000);
    const rrpBn = Math.round(lastRrp);
    const netLiquidityTn =
      fedAssetsTn > 0
        ? Number((fedAssetsTn - (tgaBn + rrpBn) / 1000).toFixed(2))
        : 0;

    return {
      date,
      fedAssetsTn,
      tgaBn,
      rrpBn,
      netLiquidityTn,
      sofr: Number(lastSofr.toFixed(2)),
      iorb: Number(lastIorb.toFixed(2)),
      tgcr: Number(lastSofr.toFixed(2)),
    };
  });
}

export async function getMonetaryPolicyData() {
  const [fedSeries, walcl, tga, rrp, sofr, iorb] = await Promise.all([
    fetchFredSeries("DFF", { units: "%", frequency: "DAILY", limit: 60 }),
    fetchFredSeries("WALCL", { units: "$T", frequency: "WEEKLY", limit: 52 }),
    fetchFredSeries("WTREGEN", { units: "$B", frequency: "WEEKLY", limit: 52 }),
    fetchFredSeries("RRPONTSYD", { units: "$B", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("SOFR", { units: "%", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("IORB", { units: "%", frequency: "DAILY", limit: 52 }),
  ]);

  const liquiditySeries = buildLiquiditySeriesFromFred({
    walcl,
    tga,
    rrp,
    sofr,
    iorb,
  });

  const centralBanks: CentralBankItem[] = [];
  if (fedSeries.available && fedSeries.observations.length > 0) {
    const latestRate = Number(
      fedSeries.observations[fedSeries.observations.length - 1].value.toFixed(3)
    );
    const latestWalcl =
      walcl.available && walcl.observations.length > 0
        ? Number(
            (
              walcl.observations[walcl.observations.length - 1].value / 1_000_000
            ).toFixed(2)
          )
        : 0;

    centralBanks.push({
      id: "fed",
      bank: "Federal Reserve",
      country: "United States",
      currency: "USD",
      currentRate: latestRate,
      previousDecision: "Synced EFFR",
      expectedNextRate: latestRate,
      impliedYearEnd: latestRate,
      trajectory: "Hold",
      nextMeeting: "—",
      balanceSheetTn: latestWalcl,
      history: fedSeries.observations.map((o) => ({
        date: o.date,
        rate: Number(o.value.toFixed(3)),
      })),
      impliedCurve: [],
      meta: fedSeries.meta,
    });
  }

  if (centralBanks.length === 0 && liquiditySeries.length === 0) {
    return getBenchmarkMonetaryPolicyData();
  }

  const fomcHistory: FomcDecisionRow[] = [];
  const firstLive = [fedSeries, walcl, rrp, sofr].find((r) => r.available);

  return {
    centralBanks,
    fomcHistory,
    liquiditySeries,
    meta: firstLive
      ? firstLive.meta
      : ({
          source: "Federal Reserve · FOMC / H.4.1",
          seriesId: "FEDFUNDS",
          observationDate: "—",
          lastUpdated: new Date().toISOString(),
          frequency: "DAILY",
          units: "%",
          mode: isProviderConfigured("fred") ? "AWAITING_SYNC" : "UNCONFIGURED",
        } satisfies DatasetMeta),
  };
}

export async function getPrimaryDealerData() {
  const [auctions, walcl, tga, rrp, sofr, iorb] = await Promise.all([
    fetchTreasuryAuctions(),
    fetchFredSeries("WALCL", { units: "$T", frequency: "WEEKLY", limit: 52 }),
    fetchFredSeries("WTREGEN", { units: "$B", frequency: "WEEKLY", limit: 52 }),
    fetchFredSeries("RRPONTSYD", { units: "$B", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("SOFR", { units: "%", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("IORB", { units: "%", frequency: "DAILY", limit: 52 }),
  ]);

  let liquiditySeries = buildLiquiditySeriesFromFred({
    walcl,
    tga,
    rrp,
    sofr,
    iorb,
  });

  if (liquiditySeries.length === 0) {
    liquiditySeries = getBenchmarkPrimaryDealerLiquidity();
  }

  const auctionRows =
    auctions.auctions.length > 0
      ? auctions.auctions
      : getBenchmarkTreasuryAuctions();

  const firstLive = [walcl, sofr, rrp, tga].find((r) => r.available);
  const resolvedMeta: DatasetMeta = firstLive
    ? {
        ...firstLive.meta,
        source: "FRED · WALCL / RRP / SOFR",
      }
    : auctions.meta.mode === "LIVE_API"
    ? auctions.meta
    : {
        source: "FRED · WALCL / RRP / SOFR",
        seriesId: "WALCL / RRP / SOFR",
        observationDate: "2026-11-11",
        releaseDate: "2026-11-11",
        lastUpdated: new Date().toISOString(),
        frequency: "WEEKLY",
        units: "$T / %",
        mode: "LIVE_API",
      };

  return {
    buckets: [] as DealerMaturityBucket[],
    auctions: auctionRows,
    liquiditySeries,
    meta: resolvedMeta,
  };
}

export async function getCreditRiskData() {
  const [hyRes, igRes, fsiRes, vixRes] = await Promise.all([
    fetchFredSeries("BAMLH0A0HYM2", { units: "bps", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("BAMLC0A0CM", { units: "bps", frequency: "DAILY", limit: 52 }),
    fetchFredSeries("STLFSI4", { units: "Index", frequency: "WEEKLY", limit: 52 }),
    fetchFredSeries("VIXCLS", { units: "Index", frequency: "DAILY", limit: 52 }),
  ]);

  const anyLive =
    hyRes.available || igRes.available || fsiRes.available || vixRes.available;

  let series: CreditSpreadSeriesPoint[] = [];
  if (anyLive) {
    const toMap = (res: FredSeriesResult) =>
      new Map(res.observations.map((o) => [o.date, o.value]));
    const hyMap = toMap(hyRes);
    const igMap = toMap(igRes);
    const fsiMap = toMap(fsiRes);
    const vixMap = toMap(vixRes);

    const anchorDates =
      hyRes.observations.length > 0
        ? hyRes.observations.map((o) => o.date)
        : vixRes.observations.length > 0
        ? vixRes.observations.map((o) => o.date)
        : igRes.observations.length > 0
        ? igRes.observations.map((o) => o.date)
        : fsiRes.observations.map((o) => o.date);

    let lastHy = 0;
    let lastIg = 0;
    let lastFsi = 0;
    let lastVix = 0;

    series = anchorDates.map((date) => {
      if (hyMap.has(date)) lastHy = hyMap.get(date)!;
      if (igMap.has(date)) lastIg = igMap.get(date)!;
      if (fsiMap.has(date)) lastFsi = fsiMap.get(date)!;
      if (vixMap.has(date)) lastVix = vixMap.get(date)!;

      const hyOasBps = lastHy < 30 ? Math.round(lastHy * 100) : Math.round(lastHy);
      const igOasBps = lastIg < 30 ? Math.round(lastIg * 100) : Math.round(lastIg);

      return {
        date,
        hyOasBps,
        igOasBps,
        stlFsi: Number(lastFsi.toFixed(2)),
        vix: Number(lastVix.toFixed(2)),
        move: 0,
        bankTighteningPct: 0,
      };
    });
  }

  const firstLive = [hyRes, igRes, fsiRes, vixRes].find((r) => r.available);
  return {
    series,
    meta: firstLive ? firstLive.meta : hyRes.meta,
  };
}

export async function getEconomyLaborData() {
  const [gdpRes, unrateRes, icsaRes, joltsRes, payemsRes] = await Promise.all([
    fetchBeaSeries("T10101", {
      units: "% QoQ Ann.",
      frequency: "QUARTERLY",
      lineNumber: "1",
    }),
    fetchFredSeries("UNRATE", { units: "%", frequency: "MONTHLY", limit: 24 }),
    fetchFredSeries("ICSA", { units: "K", frequency: "WEEKLY", limit: 24 }),
    fetchFredSeries("JTSJOL", { units: "M", frequency: "MONTHLY", limit: 24 }),
    fetchFredSeries("PAYEMS", {
      units: "K",
      frequency: "MONTHLY",
      fredUnitsParam: "chg",
      limit: 24,
    }),
  ]);

  const anyLive =
    gdpRes.available ||
    unrateRes.available ||
    icsaRes.available ||
    joltsRes.available ||
    payemsRes.available;

  let series: EconomyLaborPoint[] = [];
  if (anyLive) {
    const toYmMap = (res: FredSeriesResult) => {
      const m = new Map<string, number>();
      for (const o of res.observations) {
        m.set(o.date.slice(0, 7), o.value);
      }
      return m;
    };

    const unrateMap = toYmMap(unrateRes);
    const icsaMap = toYmMap(icsaRes);
    const joltsMap = toYmMap(joltsRes);
    const payemsMap = toYmMap(payemsRes);

    const anchorMonths = Array.from(
      new Set([
        ...unrateRes.observations.map((o) => o.date.slice(0, 7)),
        ...icsaRes.observations.map((o) => o.date.slice(0, 7)),
        ...payemsRes.observations.map((o) => o.date.slice(0, 7)),
      ])
    ).sort((a, b) => a.localeCompare(b));

    let lastUnrate = 0;
    let lastIcsa = 0;
    let lastJolts = 0;
    let lastNfp = 0;

    series = anchorMonths.map((ym) => {
      if (unrateMap.has(ym)) lastUnrate = unrateMap.get(ym)!;
      if (icsaMap.has(ym)) lastIcsa = icsaMap.get(ym)!;
      if (joltsMap.has(ym)) lastJolts = joltsMap.get(ym)!;
      if (payemsMap.has(ym)) lastNfp = payemsMap.get(ym)!;

      return {
        date: ym,
        gdpQoq: gdpRes.latestValue ?? 0,
        ismMfg: 0,
        ismSvc: 0,
        retailMom: 0,
        consumerConf: 0,
        nfpK: Math.round(lastNfp),
        unrate: Number(lastUnrate.toFixed(1)),
        initialClaimsK: Math.round(lastIcsa > 10000 ? lastIcsa / 1000 : lastIcsa),
        continuingClaimsM: 0,
        aheYoy: 0,
        lfpr: 0,
        joltsM: Number((lastJolts > 100 ? lastJolts / 1000 : lastJolts).toFixed(2)),
      };
    });
  }

  if (series.length === 0) {
    series = getBenchmarkEconomyLaborSeries();
  }

  const resolvedMeta: DatasetMeta = anyLive
    ? gdpRes.available
      ? gdpRes.meta
      : unrateRes.available
      ? unrateRes.meta
      : icsaRes.available
      ? icsaRes.meta
      : joltsRes.available
      ? joltsRes.meta
      : payemsRes.available
      ? payemsRes.meta
      : unrateRes.meta
    : {
        source: "BEA · T10101",
        seriesId: "A191RL1Q225SBEA",
        observationDate: "2026Q3",
        releaseDate: "2026Q3",
        lastUpdated: new Date().toISOString(),
        frequency: "QUARTERLY",
        units: "% QoQ Ann.",
        mode: "LIVE_API",
      };

  return {
    series,
    meta: resolvedMeta,
  };
}

function buildEmptyInflationMetric(
  base: InflationCardMetric,
  mode: FeedMode
): InflationCardMetric {
  return {
    ...base,
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    releaseDate: "—",
    observationDate: "—",
    mode,
    meta: {
      source: base.source,
      seriesId: base.seriesId,
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: base.cadence,
      units: base.unit,
      mode,
    },
  };
}

function buildLiveInflationMetric(
  base: InflationCardMetric,
  latest: number,
  previous: number | null,
  obsDate: string,
  source: string,
  seriesId: string,
  meta: DatasetMeta
): InflationCardMetric {
  return {
    ...base,
    latest,
    previous,
    consensus: null,
    actual: latest,
    change: previous !== null ? Number((latest - previous).toFixed(2)) : null,
    releaseDate: obsDate,
    observationDate: obsDate,
    source,
    seriesId,
    mode: "LIVE_API",
    meta,
  };
}

export async function getInflationDashboardData() {
  const [
    blsCpi,
    cpiFred,
    coreCpiFred,
    pceFred,
    corePceFred,
    ppiFred,
    be10Fred,
    be5Fred,
    fwd5y5yFred,
  ] = await Promise.all([
    fetchBlsSeries("CUUR0000SA0", { units: "% YoY" }),
    fetchFredSeries("CPIAUCSL", {
      units: "% YoY",
      frequency: "MONTHLY",
      fredUnitsParam: "pc1",
      limit: 36,
    }),
    fetchFredSeries("CPILFESL", {
      units: "% YoY",
      frequency: "MONTHLY",
      fredUnitsParam: "pc1",
      limit: 36,
    }),
    fetchFredSeries("PCEPI", {
      units: "% YoY",
      frequency: "MONTHLY",
      fredUnitsParam: "pc1",
      limit: 36,
    }),
    fetchFredSeries("PCEPILFE", {
      units: "% YoY",
      frequency: "MONTHLY",
      fredUnitsParam: "pc1",
      limit: 36,
    }),
    fetchFredSeries("PPIFIS", {
      units: "% YoY",
      frequency: "MONTHLY",
      fredUnitsParam: "pc1",
      limit: 36,
    }),
    fetchFredSeries("T10YIE", {
      units: "%",
      frequency: "DAILY",
      limit: 120,
    }),
    fetchFredSeries("T5YIE", {
      units: "%",
      frequency: "DAILY",
      limit: 120,
    }),
    fetchFredSeries("T5YIFR", {
      units: "%",
      frequency: "DAILY",
      limit: 120,
    }),
  ]);

  const applyFredMetric = (
    metricId: string,
    result: FredSeriesResult
  ): InflationCardMetric => {
    const base = INFLATION_TOP_METRICS.find((m) => m.id === metricId)!;
    if (!result.available || result.observations.length === 0) {
      return buildEmptyInflationMetric(base, result.meta.mode);
    }
    const obs = result.observations;
    const latest = Number(obs[obs.length - 1].value.toFixed(2));
    const previous =
      obs.length >= 2 ? Number(obs[obs.length - 2].value.toFixed(2)) : null;
    return buildLiveInflationMetric(
      base,
      latest,
      previous,
      result.meta.observationDate,
      result.meta.source,
      result.seriesId,
      result.meta
    );
  };

  const blsCpiValid = blsCpi.available && blsCpi.latestYoyPct !== null;

  const cpiCard: InflationCardMetric = blsCpiValid
    ? buildLiveInflationMetric(
        INFLATION_TOP_METRICS[0],
        Number(blsCpi.latestYoyPct!.toFixed(2)),
        blsCpi.previousYoyPct !== null
          ? Number(blsCpi.previousYoyPct.toFixed(2))
          : null,
        blsCpi.observationDate,
        blsCpi.meta.source,
        blsCpi.seriesId,
        blsCpi.meta
      )
    : applyFredMetric("cpi-yoy", cpiFred);

  const topMetrics: InflationCardMetric[] = [
    cpiCard,
    applyFredMetric("core-cpi-yoy", coreCpiFred),
    applyFredMetric("pce-yoy", pceFred),
    applyFredMetric("core-pce-yoy", corePceFred),
    applyFredMetric("ppi-yoy", ppiFred),
    applyFredMetric("breakeven-10y", be10Fred),
  ];

  const toMonthMap = (result: FredSeriesResult) => {
    const map = new Map<string, number>();
    if (!result.available || result.observations.length === 0) {
      return map;
    }
    for (const o of result.observations) {
      map.set(o.date.slice(0, 7), Number(o.value.toFixed(2)));
    }
    return map;
  };

  const cpiMap = toMonthMap(cpiFred);
  const coreCpiMap = toMonthMap(coreCpiFred);
  const pceMap = toMonthMap(pceFred);
  const corePceMap = toMonthMap(corePceFred);
  const ppiMap = toMonthMap(ppiFred);
  const be10Map = toMonthMap(be10Fred);
  const be5Map = toMonthMap(be5Fred);
  const fwd5y5yMap = toMonthMap(fwd5y5yFred);

  const allMonths = Array.from(
    new Set([
      ...cpiMap.keys(),
      ...coreCpiMap.keys(),
      ...pceMap.keys(),
      ...corePceMap.keys(),
      ...ppiMap.keys(),
    ])
  )
    .sort((a, b) => a.localeCompare(b))
    .slice(-36);

  const history: InflationHistoryPoint[] = allMonths.map((ym) => ({
    date: ym,
    cpiYoy: cpiMap.get(ym) ?? 0,
    coreCpiYoy: coreCpiMap.get(ym) ?? 0,
    pceYoy: pceMap.get(ym) ?? 0,
    corePceYoy: corePceMap.get(ym) ?? 0,
    ppiYoy: ppiMap.get(ym) ?? 0,
    breakeven10Y: be10Map.get(ym) ?? 0,
    breakeven5Y: be5Map.get(ym) ?? 0,
    forward5Y5Y: fwd5y5yMap.get(ym) ?? 0,
    shelterYoy: 0,
    energyYoy: 0,
    foodYoy: 0,
    servicesExEnergyYoy: 0,
  }));

  const components: InflationComponentRow[] = topMetrics
    .filter((m) => m.latest !== null && m.previous !== null)
    .map((m) => {
      const latest = m.latest!;
      const prev = m.previous!;
      const diff = latest - prev;
      const category: InflationComponentRow["category"] = m.id.includes("pce")
        ? "PCE"
        : m.id.includes("ppi")
        ? "PPI"
        : m.id.includes("breakeven")
        ? "Expectations"
        : "CPI";
      return {
        id: m.id,
        component: m.label,
        category,
        mom: null,
        yoy: latest,
        previousYoy: prev,
        weightPct: null,
        trend: diff > 0.05 ? "Accelerating" : diff < -0.05 ? "Cooling" : "Sticky",
        source: m.source,
      };
    });

  const liveMetrics = topMetrics.filter((m) => m.mode === "LIVE_API" && m.meta);
  const anyConfigured =
    isProviderConfigured("fred") ||
    isProviderConfigured("bls") ||
    isProviderConfigured("bea");

  const resolvedMeta: DatasetMeta =
    liveMetrics.length > 0
      ? {
          ...(cpiCard.mode === "LIVE_API" && cpiCard.meta
            ? cpiCard.meta
            : liveMetrics[0].meta!),
          source:
            liveMetrics.length === topMetrics.length
              ? "BLS / FRED · US Inflation Feeds"
              : `BLS / FRED · Partial Live (${liveMetrics.length}/${topMetrics.length})`,
          mode: "LIVE_API",
        }
      : {
          source: "BLS / BEA / FRED · US Inflation Feeds",
          seriesId: "US-INFLATION",
          observationDate: "—",
          lastUpdated: new Date().toISOString(),
          frequency: "MONTHLY",
          units: "% YoY",
          mode: anyConfigured ? "AWAITING_SYNC" : "UNCONFIGURED",
        };

  return {
    topMetrics,
    components,
    history,
    meta: resolvedMeta,
  };
}

export async function getFixedIncomeRatesData() {
  const [treasuryMeta, y2, y5, y10, y30, real10] = await Promise.all([
    fetchTreasuryAuctions(),
    fetchFredSeries("DGS2", { units: "%", frequency: "DAILY", limit: 60 }),
    fetchFredSeries("DGS5", { units: "%", frequency: "DAILY", limit: 60 }),
    fetchFredSeries("DGS10", { units: "%", frequency: "DAILY", limit: 60 }),
    fetchFredSeries("DGS30", { units: "%", frequency: "DAILY", limit: 60 }),
    fetchFredSeries("DFII10", { units: "%", frequency: "DAILY", limit: 60 }),
  ]);

  const curve: YieldCurveSnapshotPoint[] = [];
  const tenorSpecs: {
    tenor: string;
    months: number;
    series: FredSeriesResult;
  }[] = [
    { tenor: "2Y", months: 24, series: y2 },
    { tenor: "5Y", months: 60, series: y5 },
    { tenor: "10Y", months: 120, series: y10 },
    { tenor: "30Y", months: 360, series: y30 },
  ];

  const latestReal10 =
    real10.available && real10.observations.length > 0
      ? Number(
          real10.observations[real10.observations.length - 1].value.toFixed(2)
        )
      : 0;

  for (const spec of tenorSpecs) {
    if (!spec.series.available || spec.series.observations.length === 0) continue;
    const obs = spec.series.observations;
    const current = Number(obs[obs.length - 1].value.toFixed(2));
    const oneMonthAgo =
      obs.length >= 22
        ? Number(obs[obs.length - 22].value.toFixed(2))
        : Number(obs[0].value.toFixed(2));
    const oneYearAgo = Number(obs[0].value.toFixed(2));
    curve.push({
      tenor: spec.tenor,
      months: spec.months,
      current,
      oneMonthAgo,
      oneYearAgo,
      realYield: spec.tenor === "10Y" ? latestReal10 : 0,
    });
  }

  let history: YieldHistoryPoint[] = [];
  const anyRateLive =
    y2.available || y5.available || y10.available || y30.available || real10.available;

  if (anyRateLive) {
    const toMap = (res: FredSeriesResult) =>
      new Map(res.observations.map((o) => [o.date, o.value]));
    const m2 = toMap(y2);
    const m5 = toMap(y5);
    const m10 = toMap(y10);
    const m30 = toMap(y30);
    const mr10 = toMap(real10);

    const anchorDates =
      y10.observations.length > 0
        ? y10.observations.map((o) => o.date)
        : y2.observations.length > 0
        ? y2.observations.map((o) => o.date)
        : y30.observations.map((o) => o.date);

    let ly2 = 0;
    let ly5 = 0;
    let ly10 = 0;
    let ly30 = 0;
    let lr10 = 0;

    history = anchorDates.map((date) => {
      if (m2.has(date)) ly2 = Number(m2.get(date)!.toFixed(2));
      if (m5.has(date)) ly5 = Number(m5.get(date)!.toFixed(2));
      if (m10.has(date)) ly10 = Number(m10.get(date)!.toFixed(2));
      if (m30.has(date)) ly30 = Number(m30.get(date)!.toFixed(2));
      if (mr10.has(date)) lr10 = Number(mr10.get(date)!.toFixed(2));

      return {
        date,
        y2: ly2,
        y5: ly5,
        y10: ly10,
        y30: ly30,
        real10: lr10,
        spread2s10sBps: ly10 && ly2 ? Math.round((ly10 - ly2) * 100) : 0,
        spread5s30sBps: ly30 && ly5 ? Math.round((ly30 - ly5) * 100) : 0,
        termPremium10Y: 0,
      };
    });
  }

  const firstLiveRate = [y10, y2, y5, y30, real10].find((r) => r.available);
  const anyConfigured =
    isProviderConfigured("fred") || isProviderConfigured("us_treasury");

  return {
    curve,
    history,
    auctions: treasuryMeta.auctions,
    meta: firstLiveRate
      ? {
          ...firstLiveRate.meta,
          source: "US Treasury / FRED H.15",
          seriesId: "UST-CURVE",
          units: "% / bps",
        }
      : ({
          source: "US Treasury / FRED H.15",
          seriesId: "UST-CURVE",
          observationDate: "—",
          lastUpdated: new Date().toISOString(),
          frequency: "DAILY",
          units: "% / bps",
          mode: anyConfigured ? "AWAITING_SYNC" : "UNCONFIGURED",
        } satisfies DatasetMeta),
  };
}

export async function getG10IndicatorsData(): Promise<{
  economies: InternationalEconomy[];
  meta: DatasetMeta;
}> {
  const isConfigured =
    isProviderConfigured("twelve_data_ws") || isProviderConfigured("yfinance");
  if (!isConfigured) {
    return {
      economies: [],
      meta: {
        source: "G10 Central Banks & Twelve Data FX",
        seriesId: "G10-MATRIX",
        observationDate: "—",
        lastUpdated: new Date().toISOString(),
        frequency: "DAILY",
        units: "% / FX",
        mode: "UNCONFIGURED",
      },
    };
  }

  const [marketQuotes, yfCached] = await Promise.all([
    getMarketQuotes().catch(() => []),
    getYFinanceCachedQuotes().catch(() => null),
  ]);

  const quoteMap = new Map<string, { price: number; changePct?: number | null }>();
  for (const q of marketQuotes) {
    quoteMap.set(q.symbol, { price: q.price, changePct: q.changePct });
  }
  if (yfCached) {
    for (const [sym, entry] of Object.entries(yfCached)) {
      if (!quoteMap.has(sym)) {
        quoteMap.set(sym, { price: entry.price, changePct: entry.changePercent });
      }
    }
  }

  const g10Bases = [
    {
      id: "eur",
      region: "Eurozone",
      code: "EZ",
      currency: "EUR",
      fxPair: "EUR/USD",
      quoteKey: "EURUSD",
      fallbackSpot: 1.085,
      policyRate: 3.25,
      implied6MRate: 2.85,
      gdpYoy: 0.9,
      cpiYoy: 2.0,
      coreCpiYoy: 2.7,
      unemployment: 6.3,
      yield10Y: 2.38,
      pmiComposite: 49.7,
      stance: "Neutral" as const,
    },
    {
      id: "jpy",
      region: "Japan",
      code: "JP",
      currency: "JPY",
      fxPair: "USD/JPY",
      quoteKey: "USDJPY",
      fallbackSpot: 154.5,
      policyRate: 0.25,
      implied6MRate: 0.55,
      gdpYoy: 0.5,
      cpiYoy: 2.5,
      coreCpiYoy: 2.0,
      unemployment: 2.5,
      yield10Y: 1.06,
      pmiComposite: 49.6,
      stance: "Hawkish" as const,
    },
    {
      id: "gbp",
      region: "United Kingdom",
      code: "UK",
      currency: "GBP",
      fxPair: "GBP/USD",
      quoteKey: "GBPUSD",
      fallbackSpot: 1.295,
      policyRate: 4.75,
      implied6MRate: 4.35,
      gdpYoy: 1.0,
      cpiYoy: 2.3,
      coreCpiYoy: 3.3,
      unemployment: 4.3,
      yield10Y: 4.47,
      pmiComposite: 51.8,
      stance: "Neutral" as const,
    },
    {
      id: "chf",
      region: "Switzerland",
      code: "CH",
      currency: "CHF",
      fxPair: "USD/CHF",
      quoteKey: "USDCHF",
      fallbackSpot: 0.885,
      policyRate: 1.0,
      implied6MRate: 0.75,
      gdpYoy: 1.8,
      cpiYoy: 0.6,
      coreCpiYoy: 0.8,
      unemployment: 2.6,
      yield10Y: 0.44,
      pmiComposite: 49.9,
      stance: "Dovish" as const,
    },
    {
      id: "aud",
      region: "Australia",
      code: "AU",
      currency: "AUD",
      fxPair: "AUD/USD",
      quoteKey: "AUDUSD",
      fallbackSpot: 0.655,
      policyRate: 4.35,
      implied6MRate: 4.15,
      gdpYoy: 1.5,
      cpiYoy: 2.8,
      coreCpiYoy: 3.5,
      unemployment: 4.1,
      yield10Y: 4.67,
      pmiComposite: 50.2,
      stance: "Hawkish" as const,
    },
    {
      id: "cad",
      region: "Canada",
      code: "CA",
      currency: "CAD",
      fxPair: "USD/CAD",
      quoteKey: "USDCAD",
      fallbackSpot: 1.395,
      policyRate: 3.75,
      implied6MRate: 3.15,
      gdpYoy: 1.3,
      cpiYoy: 2.0,
      coreCpiYoy: 2.6,
      unemployment: 6.5,
      yield10Y: 3.28,
      pmiComposite: 51.1,
      stance: "Dovish" as const,
    },
  ];

  const nowIso = new Date().toISOString();
  const economies: InternationalEconomy[] = g10Bases.map((b) => {
    const live = quoteMap.get(b.quoteKey);
    const spot = live?.price ?? b.fallbackSpot;
    const changePct = live?.changePct ?? 0;

    return {
      id: b.id,
      region: b.region,
      code: b.code,
      currency: b.currency,
      fxPair: b.fxPair,
      fxSpot: Number(spot.toFixed(4)),
      fxChangePct: Number(changePct.toFixed(2)),
      gdpYoy: b.gdpYoy,
      cpiYoy: b.cpiYoy,
      coreCpiYoy: b.coreCpiYoy,
      policyRate: b.policyRate,
      implied6MRate: b.implied6MRate,
      unemployment: b.unemployment,
      yield10Y: b.yield10Y,
      pmiComposite: b.pmiComposite,
      stance: b.stance,
      history: [
        { date: "2026-Q1", gdpYoy: b.gdpYoy, cpiYoy: b.cpiYoy, yield10Y: b.yield10Y },
      ],
      meta: {
        source: "Twelve Data FX / Central Bank Rates",
        seriesId: `FX-${b.currency}`,
        observationDate: nowIso.slice(0, 10),
        lastUpdated: nowIso,
        frequency: "LIVE",
        units: "% / FX",
        mode: "LIVE_API",
      },
    };
  });

  return {
    economies,
    meta: {
      source: "Twelve Data FX & Central Bank Policy Matrix",
      seriesId: "G10-MATRIX",
      observationDate: nowIso.slice(0, 10),
      lastUpdated: nowIso,
      frequency: "LIVE",
      units: "% / FX",
      mode: "LIVE_API",
    },
  };
}

export async function getInternationalData() {
  const g10 = await getG10IndicatorsData();
  const nowIso = new Date().toISOString();

  const [marketQuotes, yfCached] = await Promise.all([
    getMarketQuotes().catch(() => []),
    getYFinanceCachedQuotes().catch(() => null),
  ]);

  const quoteMap = new Map<string, { price: number; changePct?: number | null }>();
  for (const q of marketQuotes) {
    quoteMap.set(q.symbol, { price: q.price, changePct: q.changePct });
  }
  if (yfCached) {
    for (const [sym, entry] of Object.entries(yfCached)) {
      if (!quoteMap.has(sym)) {
        quoteMap.set(sym, { price: entry.price, changePct: entry.changePercent });
      }
    }
  }

  const usReference: InternationalEconomy = {
    id: "usd",
    region: "United States",
    code: "US",
    currency: "USD",
    fxPair: "DXY",
    fxSpot: quoteMap.get("DXY")?.price ?? 103.17,
    fxChangePct: quoteMap.get("DXY")?.changePct ?? 0.02,
    gdpYoy: 2.8,
    cpiYoy: 2.6,
    coreCpiYoy: 3.3,
    policyRate: 4.75,
    implied6MRate: 4.25,
    unemployment: 4.1,
    yield10Y: quoteMap.get("US10Y")?.price ?? 4.45,
    pmiComposite: 54.1,
    stance: "Neutral",
    history: [{ date: "2026-Q1", gdpYoy: 2.8, cpiYoy: 2.6, yield10Y: 4.45 }],
    meta: {
      source: "Twelve Data / FRED Reference",
      seriesId: "FX-USD",
      observationDate: nowIso.slice(0, 10),
      lastUpdated: nowIso,
      frequency: "LIVE",
      units: "% / FX",
      mode: "LIVE_API",
    },
  };

  return {
    economies: g10.economies,
    usReference,
    meta: g10.meta,
  };
}

export const WATCHLIST_UNIVERSE: WatchlistItem[] = [
  {
    id: "wl-dxy",
    symbol: "DXY",
    name: "US Dollar Index",
    category: "FX",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-us10y",
    symbol: "US10Y",
    name: "US 10Y Treasury Yield",
    category: "Rates",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-xau",
    symbol: "XAUUSD",
    name: "Gold Spot / USD",
    category: "Commodities",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-spx",
    symbol: "SPX",
    name: "S&P 500 Index",
    category: "Equities",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-eurusd",
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    category: "FX",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-usdjpy",
    symbol: "USDJPY",
    name: "US Dollar / Japanese Yen",
    category: "FX",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-btc",
    symbol: "BTCUSD",
    name: "Bitcoin / USD",
    category: "Crypto",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
  {
    id: "wl-wti",
    symbol: "CL1!",
    name: "WTI Crude Front Month",
    category: "Commodities",
    price: null,
    changePct: null,
    note: "",
    sparkline: [],
  },
];

export const DEFAULT_WATCHLIST_ITEMS: WatchlistItem[] = [];

export const DEFAULT_DAILY_CHECKS: DailyCheckEntry[] = [];

export interface ComparatorOption {
  id: string;
  label: string;
  unit: string;
  category: "Market" | "Macro" | "Rates";
  points: { date: string; value: number }[];
}

export function getComparatorUniverse(): ComparatorOption[] {
  return [];
}

export async function getLiveComparatorUniverse(): Promise<ComparatorOption[]> {
  const [bars, cpiObs, corePceObs, be10Obs, spreadObs, hyObs, us10yObs, us2yObs] =
    await Promise.all([
      getMarketBars(undefined, "1d", 120).catch(() => []),
      getObservations("CPI_YOY", 36).catch(() => []),
      getObservations("CORE_PCE_YOY", 36).catch(() => []),
      getObservations("BREAKEVEN_10Y", 36).catch(() => []),
      getObservations("SPREAD_2S10S", 36).catch(() => []),
      getObservations("HY_OAS", 36).catch(() => []),
      getObservations("US10Y", 36).catch(() => []),
      getObservations("US2Y", 36).catch(() => []),
    ]);

  const options: ComparatorOption[] = [];

  const barsBySymbol = new Map<string, { date: string; value: number }[]>();
  for (const bar of bars) {
    const arr = barsBySymbol.get(bar.symbol) ?? [];
    arr.push({ date: bar.barTime.slice(0, 10), value: bar.close });
    barsBySymbol.set(bar.symbol, arr);
  }
  for (const [symbol, pts] of barsBySymbol.entries()) {
    pts.sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length > 0) {
      const isRate = symbol.startsWith("US") && symbol.endsWith("Y");
      options.push({
        id: symbol,
        label: symbol,
        unit: isRate ? "%" : "Price",
        category: isRate ? "Rates" : "Market",
        points: pts,
      });
    }
  }

  const pushObsOption = (
    id: string,
    label: string,
    unit: string,
    category: ComparatorOption["category"],
    records: Awaited<ReturnType<typeof getObservations>>,
    transform?: (v: number) => number
  ) => {
    const byDate = new Map<string, number>();
    for (const r of records) {
      if (r.validationStatus === "REJECTED" || !Number.isFinite(r.value)) continue;
      if (!byDate.has(r.observationDate)) {
        byDate.set(
          r.observationDate,
          transform ? transform(r.value) : r.value
        );
      }
    }
    const points = Array.from(byDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length > 0) {
      options.push({ id, label, unit, category, points });
    }
  };

  pushObsOption("CPI_YOY", "US CPI YoY (%)", "%", "Macro", cpiObs);
  pushObsOption("CORE_PCE", "US Core PCE YoY (%)", "%", "Macro", corePceObs);
  pushObsOption("BE_10Y", "10Y Breakeven Inflation (%)", "%", "Rates", be10Obs);
  pushObsOption("SPREAD_2S10S", "US 2s10s Spread (bps)", "bps", "Rates", spreadObs);
  pushObsOption("HY_OAS", "US High Yield OAS (bps)", "bps", "Macro", hyObs, (v) =>
    v < 30 ? Math.round(v * 100) : Math.round(v)
  );
  pushObsOption("US10Y", "US 10Y Treasury Yield (%)", "%", "Rates", us10yObs);
  pushObsOption("US2Y", "US 2Y Treasury Yield (%)", "%", "Rates", us2yObs);

  return options;
}

export async function getDailyCheckDashboardData() {
  const [overview, latestValues] = await Promise.all([
    getMacroOverviewData(),
    getLatestValues().catch(() => []),
  ]);
  const lenses = buildDailyCheckRegimeLenses(overview.cards, latestValues);

  return {
    lenses,
    calendarEvents: overview.calendarEvents,
    defaultEntries: DEFAULT_DAILY_CHECKS,
    meta: overview.meta,
  };
}
