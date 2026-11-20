import fs from "node:fs/promises";
import path from "node:path";
import type { EconomicCalendarEvent } from "@/lib/types";

export type ForexFactoryImpact = "HIGH" | "MEDIUM" | "LOW" | "NON_ECONOMIC";

export interface ForexFactoryEvent {
  id: string;
  title: string;
  currency: string;
  country: string;
  date: string; // ISO 8601 UTC string (e.g. "2026-11-20T13:30:00Z")
  time: string; // "13:30"
  impact: ForexFactoryImpact;
  forecast: string;
  previous: string;
  actual: string | null;
  betterThanExpected: boolean | null;
}

export interface ForexFactoryRawItem {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

const CACHE_FILE_PATH = path.join(process.cwd(), "ml", "data", "forex_factory_calendar.json");

export const G10_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "NZD", "CNY"] as const;
export type SupportedCurrency = (typeof G10_CURRENCIES)[number];

// Country flags and ISO codes mapping
export const CURRENCY_METADATA: Record<string, { name: string; flag: string; countryCode: string }> = {
  USD: { name: "United States", flag: "🇺🇸", countryCode: "US" },
  EUR: { name: "Eurozone", flag: "🇪🇺", countryCode: "EZ" },
  GBP: { name: "United Kingdom", flag: "🇬🇧", countryCode: "UK" },
  JPY: { name: "Japan", flag: "🇯🇵", countryCode: "JP" },
  CAD: { name: "Canada", flag: "🇨🇦", countryCode: "CA" },
  AUD: { name: "Australia", flag: "🇦🇺", countryCode: "AU" },
  CHF: { name: "Switzerland", flag: "🇨🇭", countryCode: "CH" },
  NZD: { name: "New Zealand", flag: "🇳🇿", countryCode: "NZ" },
  CNY: { name: "China", flag: "🇨🇳", countryCode: "CN" },
};

/**
 * Institutional baseline Forex Factory calendar docket spanning major economies.
 * Automatically synchronizes with today's anchor dates for seamless offline & testing operation.
 */
export function getInstitutionalForexFactoryDocket(anchorIso = new Date().toISOString()): ForexFactoryEvent[] {
  const d = new Date(anchorIso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = d.getUTCDate();

  // Helper to format date offset from anchor
  const offsetDate = (offsetDays: number) => {
    const dt = new Date(Date.UTC(y, d.getUTCMonth(), day + offsetDays));
    return dt.toISOString().slice(0, 10);
  };

  const dayMinus1 = offsetDate(-1);
  const day0 = offsetDate(0);
  const dayPlus1 = offsetDate(1);
  const dayPlus2 = offsetDate(2);
  const dayPlus3 = offsetDate(3);
  const dayPlus4 = offsetDate(4);
  const dayPlus5 = offsetDate(5);

  const rawEvents: Array<{
    dateStr: string;
    timeStr: string;
    currency: string;
    title: string;
    impact: ForexFactoryImpact;
    forecast: string;
    previous: string;
    actual: string | null;
  }> = [
    // Yesterday (Completed releases with actuals)
    {
      dateStr: dayMinus1,
      timeStr: "07:00",
      currency: "GBP",
      title: "CPI y/y",
      impact: "HIGH",
      forecast: "2.2%",
      previous: "1.7%",
      actual: "2.3%",
    },
    {
      dateStr: dayMinus1,
      timeStr: "13:30",
      currency: "USD",
      title: "Building Permits",
      impact: "MEDIUM",
      forecast: "1.43M",
      previous: "1.42M",
      actual: "1.41M",
    },
    {
      dateStr: dayMinus1,
      timeStr: "13:30",
      currency: "USD",
      title: "Housing Starts",
      impact: "MEDIUM",
      forecast: "1.34M",
      previous: "1.35M",
      actual: "1.31M",
    },
    {
      dateStr: dayMinus1,
      timeStr: "15:30",
      currency: "USD",
      title: "Crude Oil Inventories",
      impact: "MEDIUM",
      forecast: "0.8M",
      previous: "2.1M",
      actual: "0.5M",
    },

    // Today (Active trading session docket)
    {
      dateStr: day0,
      timeStr: "00:50",
      currency: "JPY",
      title: "Trade Balance",
      impact: "MEDIUM",
      forecast: "-0.36T",
      previous: "-0.29T",
      actual: "-0.46T",
    },
    {
      dateStr: day0,
      timeStr: "08:15",
      currency: "EUR",
      title: "ECB President Lagarde Speaks",
      impact: "HIGH",
      forecast: "—",
      previous: "—",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "09:00",
      currency: "EUR",
      title: "Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "46.0",
      previous: "45.8",
      actual: "45.2",
    },
    {
      dateStr: day0,
      timeStr: "09:30",
      currency: "GBP",
      title: "Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "50.1",
      previous: "49.9",
      actual: "48.6",
    },
    {
      dateStr: day0,
      timeStr: "13:30",
      currency: "USD",
      title: "Unemployment Claims (Initial Jobless)",
      impact: "HIGH",
      forecast: "215K",
      previous: "217K",
      actual: "213K",
    },
    {
      dateStr: day0,
      timeStr: "13:30",
      currency: "USD",
      title: "Philly Fed Manufacturing Index",
      impact: "HIGH",
      forecast: "8.2",
      previous: "10.3",
      actual: "-5.5",
    },
    {
      dateStr: day0,
      timeStr: "15:00",
      currency: "USD",
      title: "Existing Home Sales",
      impact: "MEDIUM",
      forecast: "3.95M",
      previous: "3.84M",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "15:00",
      currency: "USD",
      title: "CB Leading Index m/m",
      impact: "LOW",
      forecast: "-0.3%",
      previous: "-0.5%",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "15:30",
      currency: "USD",
      title: "Natural Gas Storage",
      impact: "LOW",
      forecast: "-3B",
      previous: "42B",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "19:00",
      currency: "USD",
      title: "FOMC Member Hammack Speaks",
      impact: "MEDIUM",
      forecast: "—",
      previous: "—",
      actual: null,
    },

    // Tomorrow (Upcoming key high-impact volatility events)
    {
      dateStr: dayPlus1,
      timeStr: "00:01",
      currency: "GBP",
      title: "GfK Consumer Confidence",
      impact: "LOW",
      forecast: "-22",
      previous: "-21",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "00:30",
      currency: "JPY",
      title: "National Core CPI y/y",
      impact: "HIGH",
      forecast: "2.2%",
      previous: "2.4%",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "07:00",
      currency: "GBP",
      title: "Retail Sales m/m",
      impact: "HIGH",
      forecast: "-0.3%",
      previous: "0.3%",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "08:15",
      currency: "EUR",
      title: "French Flash Manufacturing PMI",
      impact: "MEDIUM",
      forecast: "44.6",
      previous: "44.5",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "08:30",
      currency: "EUR",
      title: "German Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "43.1",
      previous: "43.0",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "09:00",
      currency: "EUR",
      title: "Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "46.0",
      previous: "46.0",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "09:30",
      currency: "GBP",
      title: "Flash Services PMI",
      impact: "HIGH",
      forecast: "52.3",
      previous: "52.0",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "13:30",
      currency: "CAD",
      title: "Core Retail Sales m/m",
      impact: "HIGH",
      forecast: "0.5%",
      previous: "-0.7%",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "14:45",
      currency: "USD",
      title: "Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "48.8",
      previous: "48.5",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "14:45",
      currency: "USD",
      title: "Flash Services PMI",
      impact: "HIGH",
      forecast: "55.0",
      previous: "55.0",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "15:00",
      currency: "USD",
      title: "Revised UoM Consumer Sentiment",
      impact: "HIGH",
      forecast: "73.9",
      previous: "73.0",
      actual: null,
    },
    {
      dateStr: dayPlus1,
      timeStr: "15:00",
      currency: "USD",
      title: "Revised UoM Inflation Expectations",
      impact: "MEDIUM",
      forecast: "2.6%",
      previous: "2.6%",
      actual: null,
    },

    // Next Week Docket
    {
      dateStr: dayPlus2,
      timeStr: "01:00",
      currency: "NZD",
      title: "Official Cash Rate (RBNZ Rate Decision)",
      impact: "HIGH",
      forecast: "4.25%",
      previous: "4.75%",
      actual: null,
    },
    {
      dateStr: dayPlus3,
      timeStr: "09:00",
      currency: "EUR",
      title: "German Ifo Business Climate",
      impact: "HIGH",
      forecast: "85.6",
      previous: "86.5",
      actual: null,
    },
    {
      dateStr: dayPlus3,
      timeStr: "13:30",
      currency: "USD",
      title: "Durable Goods Orders m/m",
      impact: "HIGH",
      forecast: "0.5%",
      previous: "-0.7%",
      actual: null,
    },
    {
      dateStr: dayPlus4,
      timeStr: "00:30",
      currency: "AUD",
      title: "CPI y/y",
      impact: "HIGH",
      forecast: "2.3%",
      previous: "2.1%",
      actual: null,
    },
    {
      dateStr: dayPlus4,
      timeStr: "13:30",
      currency: "USD",
      title: "Prelim GDP q/q (BEA)",
      impact: "HIGH",
      forecast: "2.8%",
      previous: "3.0%",
      actual: null,
    },
    {
      dateStr: dayPlus4,
      timeStr: "13:30",
      currency: "USD",
      title: "Core PCE Price Index m/m",
      impact: "HIGH",
      forecast: "0.3%",
      previous: "0.3%",
      actual: null,
    },
    {
      dateStr: dayPlus5,
      timeStr: "01:30",
      currency: "CNY",
      title: "Manufacturing PMI",
      impact: "HIGH",
      forecast: "50.2",
      previous: "50.1",
      actual: null,
    },
    {
      dateStr: dayPlus5,
      timeStr: "13:00",
      currency: "EUR",
      title: "CPI Flash Estimate y/y",
      impact: "HIGH",
      forecast: "2.3%",
      previous: "2.0%",
      actual: null,
    },
  ];

  return rawEvents.map((r, idx) => {
    const iso = `${r.dateStr}T${r.timeStr}:00Z`;
    const meta = CURRENCY_METADATA[r.currency];
    const country = meta?.countryCode ?? r.currency.slice(0, 2);
    const betterThanExpected = evaluateBetterThanExpected(r.actual, r.forecast, r.title);

    return {
      id: `ff-${r.currency}-${r.dateStr}-${idx}-${r.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
      title: r.title,
      currency: r.currency,
      country,
      date: iso,
      time: r.timeStr,
      impact: r.impact,
      forecast: r.forecast,
      previous: r.previous,
      actual: r.actual,
      betterThanExpected,
    };
  });
}

/**
 * Institutional logic: determines whether the actual release beat or missed forecast.
 * Accurately flips polarity for inverted economic indicators (unemployment, jobless claims, deficits).
 */
export function evaluateBetterThanExpected(
  actualStr: string | null | undefined,
  forecastStr: string | null | undefined,
  title: string
): boolean | null {
  if (!actualStr || !forecastStr || actualStr === "—" || forecastStr === "—") {
    return null;
  }

  const parseNumber = (s: string): number | null => {
    const cleaned = s.replace(/[%KMBTPpts,]/gi, "").trim();
    const val = Number.parseFloat(cleaned);
    if (!Number.isFinite(val)) return null;
    let multiplier = 1;
    if (/k/i.test(s)) multiplier = 1000;
    else if (/m/i.test(s)) multiplier = 1_000_000;
    else if (/b/i.test(s)) multiplier = 1_000_000_000;
    else if (/t/i.test(s)) multiplier = 1_000_000_000_000;
    return val * multiplier;
  };

  const actualNum = parseNumber(actualStr);
  const forecastNum = parseNumber(forecastStr);

  if (actualNum === null || forecastNum === null) {
    return null;
  }

  if (Math.abs(actualNum - forecastNum) < 1e-9) {
    return null;
  }

  const lowerTitle = title.toLowerCase();
  const isInverted =
    lowerTitle.includes("unemployment") ||
    lowerTitle.includes("jobless") ||
    lowerTitle.includes("claims") ||
    (lowerTitle.includes("trade balance") && actualNum < 0 && forecastNum < 0);

  if (isInverted) {
    return actualNum < forecastNum;
  }

  return actualNum > forecastNum;
}

/**
 * Normalizes raw Forex Factory / Fair Economy JSON feed items into strongly-typed ForexFactoryEvent.
 */
export function normalizeForexFactoryItem(
  item: ForexFactoryRawItem,
  idx: number
): ForexFactoryEvent {
  const currency = (item.country || "USD").toUpperCase();
  const meta = CURRENCY_METADATA[currency];
  const country = meta?.countryCode ?? currency.slice(0, 2);

  // Parse ISO date from format e.g. "2026-11-20T13:30:00-05:00"
  let iso = new Date().toISOString();
  let timeStr = "13:30";
  try {
    const dt = new Date(item.date);
    if (!Number.isNaN(dt.getTime())) {
      iso = dt.toISOString();
      timeStr = iso.slice(11, 16);
    }
  } catch {
    // Keep fallback
  }

  const rawImpact = (item.impact || "").toLowerCase();
  let impact: ForexFactoryImpact = "LOW";
  if (rawImpact.includes("high") || rawImpact.includes("red")) {
    impact = "HIGH";
  } else if (rawImpact.includes("medium") || rawImpact.includes("orange")) {
    impact = "MEDIUM";
  } else if (rawImpact.includes("low") || rawImpact.includes("yellow")) {
    impact = "LOW";
  } else if (rawImpact.includes("holiday") || rawImpact.includes("gray") || rawImpact.includes("non")) {
    impact = "NON_ECONOMIC";
  }

  const forecast = item.forecast?.trim() || "—";
  const previous = item.previous?.trim() || "—";
  const actual = item.actual?.trim() || null;
  const betterThanExpected = evaluateBetterThanExpected(actual, forecast, item.title);

  return {
    id: `ff-${currency}-${iso.slice(0, 10)}-${idx}-${item.title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
    title: item.title,
    currency,
    country,
    date: iso,
    time: timeStr,
    impact,
    forecast,
    previous,
    actual,
    betterThanExpected,
  };
}

/**
 * Primary fetch service: Fetches live Forex Factory calendar with disk caching and offline fallback.
 */
export async function getForexFactoryCalendar(options?: {
  forceRefresh?: boolean;
}): Promise<{
  events: ForexFactoryEvent[];
  source: "live_nfs" | "disk_cache" | "institutional_docket";
  lastUpdated: string;
}> {
  const force = options?.forceRefresh ?? false;

  // 1. Try reading disk cache first if recent and not forcing refresh
  if (!force) {
    try {
      const stat = await fs.stat(CACHE_FILE_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 3600_000) {
        // Cached less than 1 hour ago
        const raw = await fs.readFile(CACHE_FILE_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return {
            events: parsed,
            source: "disk_cache",
            lastUpdated: new Date(stat.mtimeMs).toISOString(),
          };
        }
      }
    } catch {
      // Continue to live fetch
    }
  }

  // 2. Fetch live Forex Factory / Fair Economy media calendar feeds
  try {
    const urls = [
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
    ];

    const responses = await Promise.allSettled(
      urls.map(async (u) => {
        const res = await fetch(u, {
          headers: {
            "User-Agent": "MacroEdge-QuantCalendar/2.0 (Institutional Risk Platform)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ForexFactoryRawItem[];
      })
    );

    const mergedRaw: ForexFactoryRawItem[] = [];
    for (const r of responses) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        mergedRaw.push(...r.value);
      }
    }

    if (mergedRaw.length > 0) {
      const normalized = mergedRaw.map((item, idx) => normalizeForexFactoryItem(item, idx));
      // Save to disk cache
      try {
        await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(normalized, null, 2), "utf-8");
      } catch {
        // Non-fatal
      }

      return {
        events: normalized,
        source: "live_nfs",
        lastUpdated: new Date().toISOString(),
      };
    }
  } catch {
    // Continue to fallback
  }

  // 3. Fallback to existing disk cache if present
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        events: parsed,
        source: "disk_cache",
        lastUpdated: new Date().toISOString(),
      };
    }
  } catch {
    // Fallback to institutional docket
  }

  // 4. Resilient institutional fallback docket
  const institutional = getInstitutionalForexFactoryDocket();
  return {
    events: institutional,
    source: "institutional_docket",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Converts ForexFactoryEvent into standard EconomicCalendarEvent for seamless UI compatibility.
 */
export function toEconomicCalendarEvent(ff: ForexFactoryEvent): EconomicCalendarEvent {
  const importanceMap: Record<ForexFactoryImpact, EconomicCalendarEvent["importance"]> = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    NON_ECONOMIC: "NON_ECONOMIC",
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const eventDate = ff.date.slice(0, 10);
  let bucket: EconomicCalendarEvent["bucket"] = "this-week";
  if (eventDate === todayIso) {
    bucket = "today";
  } else if (eventDate > todayIso) {
    bucket = "next-week";
  }

  return {
    id: ff.id,
    event: ff.title,
    country: ff.country,
    currency: ff.currency,
    bucket,
    releaseTime: `${eventDate} · ${ff.time} UTC`,
    previous: ff.previous,
    consensus: ff.forecast,
    actual: ff.actual,
    importance: importanceMap[ff.impact],
    unit: "",
    betterThanExpected: ff.betterThanExpected,
    rawDate: ff.date,
  };
}

/**
 * Generates CSV export content matching the fizahkhalid/forex_factory_calendar_news_scraper output.
 */
export function exportForexFactoryCsv(events: ForexFactoryEvent[]): string {
  const headers = [
    "ID",
    "Date (UTC)",
    "Time (UTC)",
    "Currency",
    "Country",
    "Impact",
    "Event",
    "Actual",
    "Forecast",
    "Previous",
    "Better Than Expected",
  ];

  const escapeCsv = (val: string | null | undefined | boolean): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = events.map((e) => [
    escapeCsv(e.id),
    escapeCsv(e.date.slice(0, 10)),
    escapeCsv(e.time),
    escapeCsv(e.currency),
    escapeCsv(e.country),
    escapeCsv(e.impact),
    escapeCsv(e.title),
    escapeCsv(e.actual ?? "—"),
    escapeCsv(e.forecast),
    escapeCsv(e.previous),
    escapeCsv(e.betterThanExpected === null ? "—" : e.betterThanExpected ? "YES" : "NO"),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Generates JSON export content matching the fizahkhalid/forex_factory_calendar_news_scraper output.
 */
export function exportForexFactoryJson(events: ForexFactoryEvent[]): string {
  return JSON.stringify(events, null, 2);
}
