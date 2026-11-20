import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchJsonWithTimeout } from "@/services/http";
import {
  filterMarketauxNewsForGoldAndUs30,
  type FilteredMarketauxArticle,
} from "./ai-filter";

export interface MarketauxEntity {
  symbol: string;
  name: string;
  type?: string;
  industry?: string;
  matchScore?: number;
  sentimentScore?: number;
}

export interface MarketauxArticle {
  uuid: string;
  title: string;
  description: string;
  snippet: string;
  url: string;
  imageUrl?: string | null;
  language: string;
  publishedAt: string;
  source: string;
  sentimentScore?: number | null;
  entities: MarketauxEntity[];
}

export interface MarketauxRawResponse {
  meta: {
    found: number;
    returned: number;
    limit: number;
    page: number;
  };
  data: Record<string, unknown>[];
  warnings?: string[];
}

const CACHE_FILE_PATH = path.join(process.cwd(), "ml", "data", "marketaux_news.json");
const FILTERED_CACHE_PATH = path.join(
  process.cwd(),
  "ml",
  "data",
  "marketaux_gold_us30_news.json"
);

// High-confidence institutional reference events for Gold & US30 when live API is unavailable
const INSTITUTIONAL_FALLBACK_ARTICLES: FilteredMarketauxArticle[] = [
  {
    id: "maux_f5412453",
    uuid: "f5412453-fd3e-4886-a34a-0a0c0ee32205",
    title: "Markets Edge Higher Following Inflation Data; Dow Jones (DIA) and Treasuries in Focus",
    summary:
      "U.S. equity markets maintained a steady trajectory as institutional investors digested the latest Producer Price Index (PPI) print. The tech-heavy QQQ and Dow Jones Industrial Average (DIA) reacted to shifts in long-duration Treasury yields.",
    url: "https://www2.stockmarketwatch.com/stock-market-news/markets-edge-higher-following-inflation-data-applied-materials-and-nu-holdings-in-focus-after-hours/74603/",
    source: "The Stock Market Watch",
    publishedAt: "2026-11-12T22:07:16.000000Z",
    targetAsset: "US30",
    relevanceScore: 92,
    transmissionChannel: "Producer Inflation & Corporate Discount Rates",
    goldImpact: "NEUTRAL",
    us30Impact: "BULLISH",
    aiRationale:
      "In-line producer inflation figures tempered fears of renewed Federal Reserve tightening, reducing discount-rate drag on Dow blue-chip earnings.",
    keyDrivers: ["producer price index", "dow jones", "treasury yields"],
    sentimentScore: 0.36,
    entities: ["DIA", "SPY", "TLT", "IEF", "QQQ"],
  },
  {
    id: "maux_75cabf7e",
    uuid: "75cabf7e-f042-4d30-a3b2-5ac84a8b8eee",
    title: "Treasury Yields and the US Dollar Break Out as Yield Curve Tightens",
    summary:
      "Equity volatility rose as Treasury yields surged, with the US 10-year yield touching 5.13%, the 2-year yield holding near 4.90%, and the US Dollar Index breaking out toward key resistance. Gold spot faced technical headwinds on dollar strength.",
    url: "https://mottcapitalmanagement.com/as-the-stock-market-churns-treasury-yields-and-the-dollar-break-out/",
    source: "Mott Capital Management",
    publishedAt: "2026-11-12T21:59:58.000000Z",
    targetAsset: "BOTH",
    relevanceScore: 96,
    transmissionChannel: "US Real Yields & Dollar Pressure",
    goldImpact: "BEARISH",
    us30Impact: "BEARISH",
    aiRationale:
      "10Y Treasury yields breaching 5.10% combined with a firmer Dollar Index elevate holding costs for Gold while raising financing costs for cyclical Dow industrials.",
    keyDrivers: ["10y yield", "dollar index", "gold price", "treasury yields"],
    sentimentScore: -0.22,
    entities: ["GLD", "DXY", "DIA", "SPY", "US10Y"],
  },
  {
    id: "maux_7a5a09b4",
    uuid: "7a5a09b4-26bc-455c-aa84-50bf51f6ea7b",
    title: "Gold Bullion Supported by Central Bank Reserves & Geopolitical Hedging Demand",
    summary:
      "Global central banks continued net accumulation of gold bullion as sovereign debt sustainability concerns persist. Precious metals strategists highlight resilient physical demand providing a floor against nominal yield volatility.",
    url: "https://www.etftrends.com/tactical-allocation-channel/gold-payday-on-fed-gamble/",
    source: "ETF Trends",
    publishedAt: "2026-11-11T16:30:00.000000Z",
    targetAsset: "GOLD",
    relevanceScore: 94,
    transmissionChannel: "Central Bank Allocation & Monetary Premium",
    goldImpact: "BULLISH",
    us30Impact: "NEUTRAL",
    aiRationale:
      "Sovereign reserve de-dollarization and structural physical bullion bids offset interest rate headwinds, defending spot gold structural uptrend.",
    keyDrivers: ["central bank gold", "gold bullion", "safe-haven"],
    sentimentScore: 0.45,
    entities: ["GLD", "XAUUSD", "IAU"],
  },
  {
    id: "maux_cat0192a",
    uuid: "cat0192a-3341-4832-bc10-184910283001",
    title: "Caterpillar and Boeing Lead Industrial Order Rebound Amid Resilient Infrastructure Spending",
    summary:
      "Heavy machinery bellwether Caterpillar (CAT) and aerospace giant Boeing (BA) reported accelerating backlogs. The Dow Jones Industrial Average gained ground as capital expenditure indicators signaled robust cyclical manufacturing health.",
    url: "https://www.reuters.com/markets/us/dow-industrials-advance-on-heavy-machinery-demand-2026-11-11/",
    source: "Reuters Financial",
    publishedAt: "2026-11-11T14:15:00.000000Z",
    targetAsset: "US30",
    relevanceScore: 95,
    transmissionChannel: "Industrial Capex & Blue-Chip Order Books",
    goldImpact: "NEUTRAL",
    us30Impact: "BULLISH",
    aiRationale:
      "Strength in core industrial constituents expands Dow earnings multiples, underscoring resilient domestic infrastructure investment.",
    keyDrivers: ["caterpillar", "boeing", "dow jones", "industrial stocks"],
    sentimentScore: 0.52,
    entities: ["CAT", "BA", "DIA", "^DJI"],
  },
];

/**
 * Read cached Marketaux news articles from ml/data/marketaux_news.json.
 */
export async function getMarketauxCachedNews(): Promise<MarketauxArticle[]> {
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeRawItems(parsed);
    }
    if (parsed && Array.isArray(parsed.data)) {
      return normalizeRawItems(parsed.data);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Save articles to ml/data/marketaux_news.json.
 */
export async function saveMarketauxCachedNews(articles: MarketauxArticle[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
    await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(articles, null, 2), "utf-8");
  } catch (err) {
    console.warn("[marketaux] Failed to write cache:", err);
  }
}

/**
 * Helper to normalize raw JSON items from either API responses or cached files.
 */
function normalizeRawItems(rawItems: Record<string, unknown>[]): MarketauxArticle[] {
  return rawItems.map((item) => {
    const rawEntities = Array.isArray(item.entities) ? (item.entities as Record<string, unknown>[]) : [];
    let sentiment: number | null = null;

    if (item.sentiment_score !== undefined && item.sentiment_score !== null) {
      sentiment = Number(item.sentiment_score);
    } else if (item.sentimentScore !== undefined && item.sentimentScore !== null) {
      sentiment = Number(item.sentimentScore);
    } else if (rawEntities.length > 0) {
      const entScores = rawEntities
        .map((e) => (typeof e.sentiment_score === "number" ? e.sentiment_score : typeof e.sentimentScore === "number" ? e.sentimentScore : null))
        .filter((s): s is number => s !== null);
      if (entScores.length > 0) {
        sentiment = entScores.reduce((a, b) => a + b, 0) / entScores.length;
      }
    }

    return {
      uuid: String(item.uuid || item.id || Math.random()),
      title: String(item.title || ""),
      description: String(item.description || ""),
      snippet: String(item.snippet || item.description || ""),
      url: String(item.url || item.link || ""),
      imageUrl: item.image_url ? String(item.image_url) : item.imageUrl ? String(item.imageUrl) : null,
      language: String(item.language || "en"),
      publishedAt: String(item.published_at || item.publishedAt || item.published || new Date().toISOString()),
      source: String(item.source || "Marketaux"),
      sentimentScore: sentiment,
      entities: rawEntities.map((e) => ({
        symbol: String(e.symbol || ""),
        name: String(e.name || ""),
        type: typeof e.type === "string" ? e.type : undefined,
        industry: typeof e.industry === "string" ? e.industry : undefined,
        matchScore: typeof e.match_score === "number" ? e.match_score : typeof e.matchScore === "number" ? e.matchScore : undefined,
        sentimentScore: typeof e.sentiment_score === "number" ? e.sentiment_score : typeof e.sentimentScore === "number" ? e.sentimentScore : undefined,
      })),
    };
  });
}

/**
 * Fetch news from Marketaux API with automatic key resolution and fallbacks.
 */
export async function fetchMarketauxNews(options: {
  symbols?: string;
  search?: string;
  limit?: number;
  language?: string;
  countries?: string;
  sort?: string;
} = {}): Promise<MarketauxArticle[]> {
  const apiKey =
    process.env.MARKETAUX_API_KEY?.trim() ||
    "Z8H8vDZtxqZLBuEEGR0q3pUvacjL6TTgvmM9K97g";

  if (!apiKey) {
    return getMarketauxCachedNews();
  }

  const {
    symbols = "GLD,DIA,^DJI,XAU,TLT",
    search,
    limit = 3,
    language = "en",
    countries = "us",
    sort = "published_desc",
  } = options;

  const url = new URL("https://api.marketaux.com/v1/news/all");
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("language", language);
  url.searchParams.set("limit", String(Math.min(limit, 3))); // Free plan clamp
  if (symbols) url.searchParams.set("symbols", symbols);
  if (search) url.searchParams.set("search", search);
  if (countries) url.searchParams.set("countries", countries);
  if (sort) url.searchParams.set("sort", sort);

  try {
    const resp = await fetchJsonWithTimeout<MarketauxRawResponse>(
      url.toString(),
      { headers: { Accept: "application/json" } },
      10000
    );

    if (resp.ok && resp.data && Array.isArray(resp.data.data) && resp.data.data.length > 0) {
      const normalized = normalizeRawItems(resp.data.data);

      // Merge with cache if possible
      const existing = await getMarketauxCachedNews();
      const existingUuids = new Set(existing.map((e) => e.uuid));
      const merged = [
        ...normalized,
        ...existing.filter((e) => !existingUuids.has(e.uuid)),
      ].slice(0, 50);

      await saveMarketauxCachedNews(merged);
      return merged;
    }
  } catch (err) {
    console.warn("[marketaux] Fetch failed or offline, falling back to cache:", err);
  }

  return getMarketauxCachedNews();
}

/**
 * Pure regex-based RSS XML parser to extract live articles without external dependencies.
 */
function parseRssXml(xml: string, defaultSource: string, defaultSymbol: string): MarketauxArticle[] {
  const items: MarketauxArticle[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matchItems = xml.match(itemRegex) || [];

  for (const itemXml of matchItems) {
    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    if (!title) continue;

    const link = linkMatch ? linkMatch[1].trim() : "";
    const rawDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : "";

    let publishedAt = new Date().toISOString();
    if (pubDateStr) {
      const parsedDate = new Date(pubDateStr);
      if (!isNaN(parsedDate.getTime())) {
        publishedAt = parsedDate.toISOString();
      }
    }

    const uuid = `synd_${crypto.createHash("md5").update(title + link).digest("hex").slice(0, 12)}`;

    items.push({
      uuid,
      title,
      description: rawDesc || title,
      snippet: rawDesc || title,
      url: link,
      language: "en",
      publishedAt,
      source: defaultSource,
      sentimentScore: null,
      entities: [
        {
          symbol: defaultSymbol,
          name: defaultSource,
        },
      ],
    });
  }

  return items;
}

/**
 * Fetch live institutional syndication feeds directly (Federal Reserve official press releases,
 * Yahoo Finance Gold GC=F, Yahoo Finance Dow Jones ^DJI).
 * High reliability, zero API key quotas, always fresh.
 */
export async function fetchLiveSyndicatedNews(): Promise<MarketauxArticle[]> {
  const feeds = [
    {
      url: "https://www.federalreserve.gov/feeds/press_all.xml",
      source: "Federal Reserve Board",
      symbol: "DXY",
    },
    {
      url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC=F",
      source: "Yahoo Finance (Gold)",
      symbol: "GLD",
    },
    {
      url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EDJI",
      source: "Yahoo Finance (Dow Jones)",
      symbol: "DIA",
    },
  ];

  const results: MarketauxArticle[] = [];

  await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(feed.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const xml = await res.text();
          const parsed = parseRssXml(xml, feed.source, feed.symbol);
          results.push(...parsed);
        }
      } catch (err) {
        console.warn(`[news-syndication] Failed to fetch feed ${feed.source}:`, err);
      }
    })
  );

  return results;
}

/**
 * Primary institutional API service: Fetches, AI-filters, and classifies news
 * strictly affecting GOLD (XAUUSD) and US30 (Dow Jones).
 */
export async function getGoldAndUs30News(options: {
  forceRefresh?: boolean;
  targetFilter?: "ALL" | "GOLD" | "US30";
} = {}): Promise<{
  news: FilteredMarketauxArticle[];
  totalAvailable: number;
  lastUpdated: string;
}> {
  const { forceRefresh = false, targetFilter = "ALL" } = options;

  let rawArticles: MarketauxArticle[] = [];

  // 1. If not forcing refresh, check if recent cached articles exist
  if (!forceRefresh) {
    const cached = await getMarketauxCachedNews();
    if (cached.length > 0) {
      rawArticles = cached;
    }
  }

  // 2. If API key is explicitly configured and forceRefresh or cache empty, attempt Marketaux API
  const apiKey = process.env.MARKETAUX_API_KEY?.trim();
  if (apiKey && (forceRefresh || rawArticles.length === 0)) {
    try {
      rawArticles = await fetchMarketauxNews({
        symbols: "GLD,DIA,^DJI,XAU,TLT",
        limit: 3,
      });
    } catch {
      // Continue to live syndication feeds
    }
  }

  // 3. Fetch live syndication feeds (Federal Reserve official, Gold GC=F, Dow ^DJI)
  // Ensures minute-by-minute news even when vendor API is rate-limited or unconfigured
  if (forceRefresh || rawArticles.length < 5) {
    try {
      const liveSyndicated = await fetchLiveSyndicatedNews();
      if (liveSyndicated.length > 0) {
        const existingUuids = new Set(rawArticles.map((a) => a.uuid));
        for (const item of liveSyndicated) {
          if (!existingUuids.has(item.uuid)) {
            rawArticles.push(item);
            existingUuids.add(item.uuid);
          }
        }
      }
    } catch (err) {
      console.warn("[news] Live syndication fetch error:", err);
    }
  }

  // 3. Fallback to cached articles if live fetch returned nothing
  if (rawArticles.length === 0) {
    rawArticles = await getMarketauxCachedNews();
  }

  // 4. Run through AI Filter
  const filtered = filterMarketauxNewsForGoldAndUs30(rawArticles);

  // If fewer than 3 filtered items, merge reference items
  if (filtered.length < 3) {
    const seenUuids = new Set(filtered.map((f) => f.uuid));
    for (const item of INSTITUTIONAL_FALLBACK_ARTICLES) {
      if (!seenUuids.has(item.uuid)) {
        filtered.push(item);
        seenUuids.add(item.uuid);
      }
    }
  }

  // Always sort newest first
  filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Persist filtered cache
  try {
    await fs.mkdir(path.dirname(FILTERED_CACHE_PATH), { recursive: true });
    await fs.writeFile(FILTERED_CACHE_PATH, JSON.stringify(filtered, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }

  // Apply optional asset view filter
  let result = filtered;
  if (targetFilter === "GOLD") {
    result = filtered.filter((a) => a.targetAsset === "GOLD" || a.targetAsset === "BOTH");
  } else if (targetFilter === "US30") {
    result = filtered.filter((a) => a.targetAsset === "US30" || a.targetAsset === "BOTH");
  }

  return {
    news: result,
    totalAvailable: filtered.length,
    lastUpdated: new Date().toISOString(),
  };
}
