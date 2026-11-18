import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MarketQuoteRecord, MarketSymbol } from "@/lib/sync/types";
import { MARKET_INSTRUMENT_MAPPINGS } from "@/services/sync/provider-registry";
import { upsertMarketQuote, getMarketQuotes } from "@/services/sync/store";

const ROOT_DIR = process.cwd();
const YF_CACHE_FILE = path.join(ROOT_DIR, "ml", "data", "yfinance_quotes.json");
const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "bin", "python");

export interface YFinanceQuoteEntry {
  symbol: string;
  externalSymbol: string;
  providerId: string;
  price: number;
  previousClose: number | null;
  change: number;
  changePercent: number;
  dayHigh?: number | null;
  dayLow?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  volume?: number | null;
  currency: string;
  quoteTimestamp: string;
  receivedAt: string;
}

export interface YFinanceCachePayload {
  updatedAt: string;
  provider: string;
  count: number;
  quotes: Record<string, YFinanceQuoteEntry>;
}

/**
 * Read the cached yfinance quotes JSON file if available and fresh.
 */
export async function getYFinanceCachedQuotes(): Promise<Record<string, YFinanceQuoteEntry> | null> {
  try {
    const raw = await fs.readFile(YF_CACHE_FILE, "utf-8");
    const data = JSON.parse(raw) as YFinanceCachePayload;
    return data.quotes || null;
  } catch {
    return null;
  }
}

/**
 * Fetch live quote directly from Yahoo Finance v8 chart API.
 */
export async function fetchDirectYahooFinanceQuote(
  externalSymbol: string,
  signal?: AbortSignal
): Promise<{ price: number; previousClose: number | null; timestamp: string } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    externalSymbol
  )}?interval=1d&range=5d`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
            regularMarketTime?: number;
          };
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = data.chart?.result?.[0];
    if (!result?.meta) return null;

    const meta = result.meta;
    let price = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;

    // Fallback to last close in array if regularMarketPrice is missing
    if ((price === undefined || price === null || !Number.isFinite(price)) && result.indicators?.quote?.[0]?.close) {
      const closes = result.indicators.quote[0].close.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
      if (closes.length > 0) {
        price = closes[closes.length - 1];
      }
    }

    if (price === undefined || price === null || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    const ts = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString();

    return {
      price,
      previousClose: prevClose,
      timestamp: ts,
    };
  } catch {
    return null;
  }
}

/**
 * Spawn the Python yfinance service to pull fresh quotes for specific symbols.
 */
export async function runPythonYFinanceSync(symbols?: string[]): Promise<Record<string, YFinanceQuoteEntry> | null> {
  const pythonBin = await fs
    .access(VENV_PYTHON)
    .then(() => VENV_PYTHON)
    .catch(() => "python3");

  const args = ["-m", "ml.yfinance_service", "--quotes"];
  if (symbols && symbols.length > 0) {
    args.push("--symbols", symbols.join(","));
  }

  return new Promise((resolve) => {
    const child = spawn(pythonBin, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 20_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, YFinanceQuoteEntry>;
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Get or fetch quote for a MarketSymbol using yfinance.
 */
export async function getYFinanceQuote(
  symbol: MarketSymbol,
  signal?: AbortSignal
): Promise<MarketQuoteRecord | null> {
  const mapping = MARKET_INSTRUMENT_MAPPINGS[symbol];
  const ext = mapping.externalSymbols.yfinance;
  if (!ext) return null;

  // 1. Check local cache
  const cachedMap = await getYFinanceCachedQuotes();
  if (cachedMap && cachedMap[symbol]) {
    const entry = cachedMap[symbol];
    await upsertMarketQuote({
      symbol,
      sourceId: "yfinance",
      externalSymbol: ext,
      assetClass: mapping.assetClass,
      price: entry.price,
      previousClose: entry.previousClose,
      changeValue: entry.change,
      changePct: entry.changePercent,
      volume: entry.volume,
      unit: mapping.unit,
      quoteTimestamp: new Date().toISOString(),
      rawPayload: { ...(entry as unknown as Record<string, unknown>), cachedFallback: true, mode: "reference" },
    });
    const quotes = await getMarketQuotes();
    return quotes.find((q) => q.symbol === symbol) ?? null;
  }

  // 2. Direct Yahoo Finance fetch
  const direct = await fetchDirectYahooFinanceQuote(ext, signal);
  if (direct) {
    const change = direct.previousClose ? direct.price - direct.previousClose : 0;
    const changePct = direct.previousClose ? (change / direct.previousClose) * 100 : 0;

    await upsertMarketQuote({
      symbol,
      sourceId: "yfinance",
      externalSymbol: ext,
      assetClass: mapping.assetClass,
      price: direct.price,
      previousClose: direct.previousClose,
      changeValue: change,
      changePct,
      unit: mapping.unit,
      quoteTimestamp: direct.timestamp,
      rawPayload: direct as unknown as Record<string, unknown>,
    });
    const quotes = await getMarketQuotes();
    return quotes.find((q) => q.symbol === symbol) ?? null;
  }

  return null;
}

/**
 * Sync all available yfinance quotes into the MacroEdge store.
 */
export async function syncAllYFinanceQuotes(): Promise<number> {
  const cachedMap = await getYFinanceCachedQuotes();
  if (!cachedMap) {
    // Try running python sync in background
    const fresh = await runPythonYFinanceSync();
    if (!fresh) return 0;
  }

  const updatedCache = (await getYFinanceCachedQuotes()) || {};
  let count = 0;

  for (const [sym, mapping] of Object.entries(MARKET_INSTRUMENT_MAPPINGS)) {
    const symbol = sym as MarketSymbol;
    const ext = mapping.externalSymbols.yfinance;
    if (!ext || !updatedCache[symbol]) continue;

    const entry = updatedCache[symbol];
    await upsertMarketQuote({
      symbol,
      sourceId: "yfinance",
      externalSymbol: ext,
      assetClass: mapping.assetClass,
      price: entry.price,
      previousClose: entry.previousClose,
      changeValue: entry.change,
      changePct: entry.changePercent,
      volume: entry.volume,
      unit: mapping.unit,
      quoteTimestamp: new Date().toISOString(),
      rawPayload: { ...(entry as unknown as Record<string, unknown>), cachedFallback: true, mode: "reference" },
    });
    count++;
  }

  return count;
}
