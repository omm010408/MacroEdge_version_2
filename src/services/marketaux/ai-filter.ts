import type { MarketauxArticle } from "./client";

export type TargetAsset = "GOLD" | "US30" | "BOTH";
export type MarketImpactDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "HIGH_VOLATILITY";

export interface FilteredMarketauxArticle {
  id: string;
  uuid: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  targetAsset: TargetAsset;
  relevanceScore: number; // 0 - 100
  transmissionChannel: string;
  goldImpact?: MarketImpactDirection | null;
  us30Impact?: MarketImpactDirection | null;
  aiRationale: string;
  keyDrivers: string[];
  sentimentScore: number; // -1.0 to +1.0
  entities: string[];
}

// -------------------------------------------------------------
// DOW 30 COMPONENTS & KEYWORDS
// -------------------------------------------------------------
const DOW30_TICKERS = new Set([
  "DIA", "^DJI", "DJI", "US30", "DJIA",
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
  "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT"
]);

const DOW30_COMPANIES = [
  "dow jones", "djia", "dow 30", "industrial average", "blue-chip",
  "caterpillar", "boeing", "goldman sachs", "jpmorgan", "unitedhealth",
  "home depot", "honeywell", "salesforce", "chevron", "amgen", "mcdonald",
  "travelers", "sherwin-williams", "american express", "merck", "cisco",
  "wall street 30", "industrial stocks", "manufacturing pmi", "ism manufacturing"
];

// -------------------------------------------------------------
// GOLD (XAUUSD) TICKERS & KEYWORDS
// -------------------------------------------------------------
const GOLD_TICKERS = new Set([
  "GLD", "GC=F", "XAU", "XAUUSD", "IAU", "NEM", "GOLD", "BAR", "GDX", "UUP", "DXY", "^TNX", "TLT", "IEF"
]);

const GOLD_KEYWORDS = [
  "gold", "xauusd", "spot gold", "gold bullion", "precious metals",
  "gold futures", "gold price", "bullion", "real yields", "tips yield",
  "us 10-year yield", "10y yield", "dollar index", "dxy", "greenback",
  "safe-haven", "central bank gold", "stagflation"
];

// SHARED MACRO DRIVERS (AFFECT BOTH GOLD & US30)
const MACRO_SHARED_DRIVERS = [
  "federal reserve", "fomc", "jerome powell", "interest rate", "rate cut",
  "rate hike", "inflation", "cpi", "producer price index", "ppi", "pce",
  "nonfarm payrolls", "unemployment rate", "treasury yields", "recession",
  "monetary policy", "quantitative tightening", "liquidity crunch"
];

// NOISE TO REJECT
const EXCLUSION_PATTERNS = [
  /\bmemecoin\b/i,
  /\bshiba\s*inu\b/i,
  /\bpepe\b/i,
  /\bdogecoin\b/i,
  /\bnft\s+drop\b/i,
  /\bairdrop\b/i,
  /\bcelebrity\b/i,
  /\bgossip\b/i,
  /\bfilm\s+festival\b/i
];

/**
 * AI-driven filtering & transmission channel classification for Marketaux news.
 * Strictly admits articles that exert material directional pressure on GOLD or US30.
 */
export function filterAndClassifyMarketauxArticle(
  article: MarketauxArticle
): FilteredMarketauxArticle | null {
  const fullText = `${article.title} ${article.description} ${article.snippet}`.toLowerCase();

  // 1. Noise check
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(fullText)) {
      return null;
    }
  }

  // 2. Identify entity overlap
  const articleSymbols = (article.entities || []).map((e) => e.symbol.toUpperCase());
  const hasDowTicker = articleSymbols.some((s) => DOW30_TICKERS.has(s));
  const hasGoldTicker = articleSymbols.some((s) => GOLD_TICKERS.has(s));

  // 3. Keyword scoring
  let goldScore = hasGoldTicker ? 40 : 0;
  let us30Score = hasDowTicker ? 40 : 0;
  const keyDrivers: string[] = [];

  for (const kw of GOLD_KEYWORDS) {
    if (fullText.includes(kw)) {
      goldScore += 25;
      if (!keyDrivers.includes(kw)) keyDrivers.push(kw);
    }
  }

  for (const kw of DOW30_COMPANIES) {
    if (fullText.includes(kw)) {
      us30Score += 25;
      if (!keyDrivers.includes(kw)) keyDrivers.push(kw);
    }
  }

  // Shared macro keywords add to both
  for (const kw of MACRO_SHARED_DRIVERS) {
    if (fullText.includes(kw)) {
      goldScore += 18;
      us30Score += 18;
      if (!keyDrivers.includes(kw)) keyDrivers.push(kw);
    }
  }

  // Cap scores
  goldScore = Math.min(100, goldScore);
  us30Score = Math.min(100, us30Score);

  const qualifiesGold = goldScore >= 35;
  const qualifiesUs30 = us30Score >= 35;

  if (!qualifiesGold && !qualifiesUs30) {
    return null; // Not relevant to Gold or US30; discard noise
  }

  let targetAsset: TargetAsset;
  if (qualifiesGold && qualifiesUs30) {
    targetAsset = "BOTH";
  } else if (qualifiesGold) {
    targetAsset = "GOLD";
  } else {
    targetAsset = "US30";
  }

  const relevanceScore = Math.max(goldScore, us30Score);
  const rawSentiment = article.sentimentScore ?? 0;

  // 4. Transmission channel & directional stance
  let transmissionChannel = "Macro Policy & Yield Transmission";
  let goldImpact: MarketImpactDirection | null = null;
  let us30Impact: MarketImpactDirection | null = null;
  let aiRationale = "";

  const yieldsRising = fullText.includes("yields surge") || fullText.includes("yields rose") || fullText.includes("yields break out") || fullText.includes("higher yields") || fullText.includes("dollar break out") || fullText.includes("stronger dollar");
  const yieldsFalling = fullText.includes("yields drop") || fullText.includes("yields fall") || fullText.includes("lower yields") || fullText.includes("dollar weakens") || fullText.includes("softer dollar");
  const inflationHot = fullText.includes("inflation hotter") || fullText.includes("inflation surges") || fullText.includes("higher ppi") || fullText.includes("higher cpi");
  const rateCutDovish = fullText.includes("rate cut") || fullText.includes("fed pause") || fullText.includes("dovish");
  const rateHikeHawkish = fullText.includes("rate hike") || fullText.includes("hawkish") || fullText.includes("tightening");
  const safeHavenStress = fullText.includes("outage") || fullText.includes("crisis") || fullText.includes("war") || fullText.includes("conflict") || fullText.includes("scandal") || fullText.includes("selloff");

  if (targetAsset === "GOLD" || targetAsset === "BOTH") {
    if (yieldsRising) {
      goldImpact = "BEARISH";
      transmissionChannel = "US Real Yields & Dollar Pressure";
      aiRationale = "Surging US Treasury yields and dollar strength elevate the opportunity cost of holding non-yielding bullion, creating short-term headwind.";
    } else if (yieldsFalling || rateCutDovish) {
      goldImpact = "BULLISH";
      transmissionChannel = "Real Yield Compression & Fed Easing";
      aiRationale = "Compression in US real yields and softer dollar conditions historically trigger institutional gold allocation and momentum bids.";
    } else if (safeHavenStress || inflationHot) {
      goldImpact = "BULLISH";
      transmissionChannel = "Safe-Haven & Inflation Hedge Bid";
      aiRationale = "Macro geopolitical/credit stress or stubborn inflation prints enhance bullion's monetary premium as an unhedged portfolio anchor.";
    } else if (rawSentiment > 0.2) {
      goldImpact = "BULLISH";
      transmissionChannel = "Precious Metals Inflow Sentiment";
      aiRationale = "Positive commodity sentiment and ETF accumulation support spot gold support levels.";
    } else if (rawSentiment < -0.2) {
      goldImpact = "BEARISH";
      transmissionChannel = "Liquidation / Dollar Rebound";
      aiRationale = "Negative cross-asset sentiment prompts profit taking in precious metals.";
    } else {
      goldImpact = "NEUTRAL";
      transmissionChannel = "Consolidation / Rangebound Flows";
      aiRationale = "Balanced cross-currents between rates and risk sentiment leave gold in neutral range.";
    }
  }

  if (targetAsset === "US30" || targetAsset === "BOTH") {
    if (yieldsRising && !fullText.includes("growth")) {
      us30Impact = "BEARISH";
      if (targetAsset === "US30") transmissionChannel = "Discount Rate & Valuation Compression";
      aiRationale = aiRationale || "Rising bond yields tighten corporate credit conditions and weigh on high-dividend blue-chip Dow valuation multiples.";
    } else if (rateCutDovish || (rawSentiment > 0.25 && !yieldsRising)) {
      us30Impact = "BULLISH";
      if (targetAsset === "US30") transmissionChannel = "Credit Easing & Industrial Capex Expansion";
      aiRationale = aiRationale || "Accommodative policy or resilient corporate earnings support Dow industrials and large-cap financials.";
    } else if (inflationHot || rateHikeHawkish) {
      us30Impact = "BEARISH";
      if (targetAsset === "US30") transmissionChannel = "Input Cost Surge & Margin Squeeze";
      aiRationale = aiRationale || "Persistent price pressures threaten corporate operating margins across Dow manufacturing components.";
    } else if (rawSentiment > 0.1) {
      us30Impact = "BULLISH";
      if (targetAsset === "US30") transmissionChannel = "Blue-Chip Earnings & Risk-On Sentiment";
      aiRationale = aiRationale || "Positive industrial demand indicators bolster constituent performance across the Dow Jones basket.";
    } else if (rawSentiment < -0.1) {
      us30Impact = "BEARISH";
      if (targetAsset === "US30") transmissionChannel = "Cyclical Downgrade Risk";
      aiRationale = aiRationale || "Cyclical growth concerns temper revenue forecasts for leading industrial constituents.";
    } else {
      us30Impact = "NEUTRAL";
      if (targetAsset === "US30") transmissionChannel = "Sector-Balanced Rotation";
      aiRationale = aiRationale || "Constituent dispersion keeps the Dow 30 price-weighted index largely rangebound.";
    }
  }

  return {
    id: `maux_${article.uuid.slice(0, 8)}`,
    uuid: article.uuid,
    title: article.title,
    summary: article.description || article.snippet || "",
    url: article.url,
    source: article.source,
    publishedAt: article.publishedAt,
    targetAsset,
    relevanceScore,
    transmissionChannel,
    goldImpact,
    us30Impact,
    aiRationale,
    keyDrivers: keyDrivers.slice(0, 5),
    sentimentScore: rawSentiment,
    entities: articleSymbols.slice(0, 6),
  };
}

/**
 * Filter an array of Marketaux articles, returning only those passing Gold/US30 AI validation,
 * sorted by publication timestamp (newest first).
 */
export function filterMarketauxNewsForGoldAndUs30(
  articles: MarketauxArticle[]
): FilteredMarketauxArticle[] {
  const filtered: FilteredMarketauxArticle[] = [];
  const seenUuids = new Set<string>();

  for (const article of articles) {
    if (!article || seenUuids.has(article.uuid)) continue;
    seenUuids.add(article.uuid);

    const classified = filterAndClassifyMarketauxArticle(article);
    if (classified) {
      filtered.push(classified);
    }
  }

  // Sort by publishedAt descending
  return filtered.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}
