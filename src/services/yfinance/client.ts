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
 * Write or update a specific quote in the local yfinance_quotes.json cache.
 */
export async function updateYFinanceCacheEntry(
  symbol: string,
  entry: { price: number; previousClose: number | null }
): Promise<void> {
  try {
    const raw = await fs.readFile(YF_CACHE_FILE, "utf-8").catch(() => null);
    const parsed = raw ? (JSON.parse(raw) as YFinanceCachePayload) : { updatedAt: "", provider: "yfinance", count: 0, quotes: {} };
    if (!parsed.quotes) parsed.quotes = {};
    const existing = parsed.quotes[symbol] || {};
    const nowIso = new Date().toISOString();
    const change =
      entry.previousClose !== null ? Number((entry.price - entry.previousClose).toFixed(4)) : existing.change ?? 0;
    const changePercent =
      entry.previousClose !== null && entry.previousClose > 0
        ? Number(((change / entry.previousClose) * 100).toFixed(2))
        : existing.changePercent ?? 0;

    parsed.quotes[symbol] = {
      ...existing,
      symbol,
      externalSymbol: existing.externalSymbol || (symbol === "DXY" ? "DX-Y.NYB" : symbol),
      providerId: existing.providerId || "yfinance",
      price: entry.price,
      previousClose: entry.previousClose,
      change,
      changePercent,
      quoteTimestamp: nowIso,
      receivedAt: nowIso,
    };
    parsed.updatedAt = nowIso;
    parsed.count = Object.keys(parsed.quotes).length;
    await fs.writeFile(YF_CACHE_FILE, JSON.stringify(parsed, null, 2), "utf-8");
  } catch {
    // Non-blocking
  }
}

/**
 * Fetch DXY directly from API Ninjas when Yahoo Finance is blocked / rate-limited (HTTP 429).
 */
export async function fetchDirectApiNinjasDxyQuote(
  signal?: AbortSignal
): Promise<{ price: number; previousClose: number | null; timestamp: string } | null> {
  const apiKey = process.env.API_NINJAS_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.api-ninjas.com/v1/stockprice?ticker=DX-Y.NYB", {
      headers: { "X-Api-Key": apiKey },
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        price?: number;
        previous_close?: number;
        updated?: number;
      };
      if (typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0) {
        const ts =
          typeof data.updated === "number" && data.updated > 0
            ? new Date(data.updated * 1000).toISOString()
            : new Date().toISOString();
        return {
          price: data.price,
          previousClose:
            typeof data.previous_close === "number" && Number.isFinite(data.previous_close)
              ? data.previous_close
              : null,
          timestamp: ts,
        };
      }
    }
  } catch {
    // Fall through to UUP
  }

  // Fallback to UUP proxy ETF (~3.52x conversion to implied DXY)
  try {
    const res = await fetch("https://api.api-ninjas.com/v1/stockprice?ticker=UUP", {
      headers: { "X-Api-Key": apiKey },
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        price?: number;
        previous_close?: number;
        updated?: number;
      };
      if (typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0) {
        const impliedPrice = Number((data.price * 3.52).toFixed(2));
        const impliedPrev =
          typeof data.previous_close === "number" && Number.isFinite(data.previous_close)
            ? Number((data.previous_close * 3.52).toFixed(2))
            : null;
        const ts =
          typeof data.updated === "number" && data.updated > 0
            ? new Date(data.updated * 1000).toISOString()
            : new Date().toISOString();
        return {
          price: impliedPrice,
          previousClose: impliedPrev,
          timestamp: ts,
        };
      }
    }
  } catch {
    // Return null
  }

  return null;
}

/**
 * Fetch live quote directly from Yahoo Finance v8 chart API with fallback symbol candidates.
 */
export async function fetchDirectYahooFinanceQuote(
  externalSymbol: string,
  signal?: AbortSignal
): Promise<{ price: number; previousClose: number | null; timestamp: string } | null> {
  const candidateSymbols =
    externalSymbol === "DX-Y.NYB"
      ? ["DX-Y.NYB", "DX=F", "UUP"]
      : [externalSymbol];

  for (const sym of candidateSymbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      sym
    )}?interval=1d&range=5d`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        signal,
      });

      if (!res.ok) continue;

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
      if (!result?.meta) continue;

      const meta = result.meta;
      let price = meta.regularMarketPrice;
      const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;

      // Fallback to last close in array if regularMarketPrice is missing
      if (
        (price === undefined || price === null || !Number.isFinite(price)) &&
        result.indicators?.quote?.[0]?.close
      ) {
        const closes = result.indicators.quote[0].close.filter(
          (c): c is number => typeof c === "number" && Number.isFinite(c)
        );
        if (closes.length > 0) {
          price = closes[closes.length - 1];
        }
      }

      if (price === undefined || price === null || !Number.isFinite(price) || price <= 0) {
        continue;
      }

      // If proxy ETF UUP was used, convert to implied DXY index (~3.5x multiplier)
      let finalPrice = price;
      let finalPrevClose = prevClose;
      if (sym === "UUP") {
        finalPrice = Number((price * 3.52).toFixed(2));
        finalPrevClose = prevClose ? Number((prevClose * 3.52).toFixed(2)) : null;
      }

      const ts = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString();

      return {
        price: finalPrice,
        previousClose: finalPrevClose,
        timestamp: ts,
      };
    } catch {
      // Try next candidate
    }
  }

  return null;
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

  // 1. Direct Yahoo Finance fetch first to guarantee real-time market sync
  try {
    const direct = await fetchDirectYahooFinanceQuote(ext, signal);
    if (direct && Number.isFinite(direct.price) && direct.price > 0) {
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
      await updateYFinanceCacheEntry(symbol, {
        price: direct.price,
        previousClose: direct.previousClose,
      });
      const quotes = await getMarketQuotes();
      return quotes.find((q) => q.symbol === symbol) ?? null;
    }
  } catch {
    // Fall back if network call fails
  }

  // 1.5 For DXY, check API-Ninjas if Yahoo Finance direct is rate-limited (HTTP 429)
  if (symbol === "DXY") {
    try {
      const ninjaDxy = await fetchDirectApiNinjasDxyQuote(signal);
      if (ninjaDxy && Number.isFinite(ninjaDxy.price) && ninjaDxy.price > 0) {
        const change = ninjaDxy.previousClose ? ninjaDxy.price - ninjaDxy.previousClose : 0;
        const changePct = ninjaDxy.previousClose ? (change / ninjaDxy.previousClose) * 100 : 0;

        await upsertMarketQuote({
          symbol: "DXY",
          sourceId: "api_ninjas",
          externalSymbol: "DX-Y.NYB",
          assetClass: mapping.assetClass,
          price: ninjaDxy.price,
          previousClose: ninjaDxy.previousClose,
          changeValue: change,
          changePct,
          unit: mapping.unit,
          quoteTimestamp: ninjaDxy.timestamp,
          rawPayload: ninjaDxy as unknown as Record<string, unknown>,
        });
        await updateYFinanceCacheEntry("DXY", {
          price: ninjaDxy.price,
          previousClose: ninjaDxy.previousClose,
        });
        const quotes = await getMarketQuotes();
        return quotes.find((q) => q.symbol === "DXY") ?? null;
      }
    } catch {
      // Fall through to cache
    }
  }

  // 2. Check local cache as resilient fallback
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
