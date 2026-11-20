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

  const dayMinus7 = offsetDate(-7);
  const dayMinus4 = offsetDate(-4);
  const dayMinus3 = offsetDate(-3);
  const dayMinus2 = offsetDate(-2);
  const dayMinus1 = offsetDate(-1);
  const day0 = offsetDate(0);
  const dayPlus1 = offsetDate(1);
  const dayPlus3 = offsetDate(3);
  const dayPlus4 = offsetDate(4);
  const dayPlus5 = offsetDate(5);
  const dayPlus6 = offsetDate(6);

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
    // --- Prior Week: Friday Nov 13 ---
    {
      dateStr: dayMinus7,
      timeStr: "13:30",
      currency: "USD",
      title: "Core PPI m/m",
      impact: "HIGH",
      forecast: "0.3%",
      previous: "0.8%",
      actual: "0.3%",
    },
    {
      dateStr: dayMinus7,
      timeStr: "13:30",
      currency: "USD",
      title: "PPI m/m",
      impact: "HIGH",
      forecast: "0.4%",
      previous: "1.4%",
      actual: "0.3%",
    },

    // --- Current Week: Monday Nov 16 ---
    {
      dateStr: dayMinus4,
      timeStr: "17:00",
      currency: "USD",
      title: "Fed Chairman Warsh Speaks",
      impact: "HIGH",
      forecast: "—",
      previous: "—",
      actual: null,
    },

    // --- Current Week: Tuesday Nov 17 ---
    {
      dateStr: dayMinus3,
      timeStr: "13:30",
      currency: "USD",
      title: "Core Retail Sales m/m",
      impact: "HIGH",
      forecast: "0.4%",
      previous: "1.1%",
      actual: "0.6%",
    },
    {
      dateStr: dayMinus3,
      timeStr: "13:30",
      currency: "USD",
      title: "Retail Sales m/m",
      impact: "HIGH",
      forecast: "0.1%",
      previous: "0.8%",
      actual: "0.2%",
    },

    // --- Current Week: Thursday Nov 19 (Yesterday) ---
    {
      dateStr: dayMinus2, // Nov 18 19:00 UTC = 12:30am Thu Nov 19 Local
      timeStr: "19:00",
      currency: "USD",
      title: "FOMC Meeting Minutes",
      impact: "HIGH",
      forecast: "—",
      previous: "—",
      actual: null,
    },
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
      title: "Philly Fed Manufacturing Index",
      impact: "HIGH",
      forecast: "20.6",
      previous: "20.9",
      actual: "6.3",
    },
    {
      dateStr: dayMinus1,
      timeStr: "13:30",
      currency: "USD",
      title: "Unemployment Claims",
      impact: "MEDIUM",
      forecast: "198K",
      previous: "202K",
      actual: "203K",
    },

    // --- Current Week: Friday Nov 20 (TODAY) ---
    // In Forex Factory, exactly 2 USD releases on Friday Nov 20 at 8:30pm Local (15:00 UTC)
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
      timeStr: "07:00",
      currency: "GBP",
      title: "Retail Sales m/m",
      impact: "HIGH",
      forecast: "-0.3%",
      previous: "0.3%",
      actual: "-0.7%",
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
      currency: "CAD",
      title: "Core Retail Sales m/m",
      impact: "HIGH",
      forecast: "0.5%",
      previous: "-0.7%",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "15:00", // 8:30pm Local GMT+5:30
      currency: "USD",
      title: "Revised UoM Consumer Sentiment",
      impact: "MEDIUM",
      forecast: "51.7",
      previous: "51.0",
      actual: null,
    },
    {
      dateStr: day0,
      timeStr: "15:00", // 8:30pm Local GMT+5:30
      currency: "USD",
      title: "Revised UoM Inflation Expectations",
      impact: "MEDIUM",
      forecast: "—",
      previous: "4.3%",
      actual: null,
    },

    // --- Weekend: Saturday Nov 21 ---
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

    // --- Next Week: Monday Nov 23 ---
    {
      dateStr: dayPlus3,
      timeStr: "08:30",
      currency: "EUR",
      title: "German Flash Manufacturing PMI",
      impact: "HIGH",
      forecast: "43.1",
      previous: "43.0",
      actual: null,
    },
    {
      dateStr: dayPlus3,
      timeStr: "09:30",
      currency: "GBP",
      title: "Flash Services PMI",
      impact: "HIGH",
      forecast: "52.3",
      previous: "52.0",
      actual: null,
    },
    {
      dateStr: dayPlus3,
      timeStr: "14:45", // 8:15pm Local
      currency: "USD",
      title: "Flash Manufacturing PMI",
      impact: "MEDIUM",
      forecast: "54.6",
      previous: "54.9",
      actual: null,
    },
    {
      dateStr: dayPlus3,
      timeStr: "14:45", // 8:15pm Local
      currency: "USD",
      title: "Flash Services PMI",
      impact: "MEDIUM",
      forecast: "55.8",
      previous: "56.1",
      actual: null,
    },

    // --- Next Week: Tuesday Nov 24 ---
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
      timeStr: "01:00",
      currency: "NZD",
      title: "Official Cash Rate (RBNZ Rate Decision)",
      impact: "HIGH",
      forecast: "4.25%",
      previous: "4.75%",
      actual: null,
    },
    {
      dateStr: dayPlus4,
      timeStr: "09:00",
      currency: "EUR",
      title: "German Ifo Business Climate",
      impact: "HIGH",
      forecast: "85.6",
      previous: "86.5",
      actual: null,
    },
    {
      dateStr: dayPlus4,
      timeStr: "15:00", // 8:30pm Local
      currency: "USD",
      title: "CB Consumer Confidence",
      impact: "MEDIUM",
      forecast: "92.1",
      previous: "91.7",
      actual: null,
    },

    // --- Next Week: Wednesday Nov 25 ---
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
    {
      dateStr: dayPlus5,
      timeStr: "13:30", // 7:00pm Local
      currency: "USD",
      title: "Core PCE Price Index m/m",
      impact: "HIGH",
      forecast: "0.3%",
      previous: "0.3%",
      actual: null,
    },
    {
      dateStr: dayPlus5,
      timeStr: "13:30", // 7:00pm Local
      currency: "USD",
      title: "Prelim GDP q/q",
      impact: "HIGH",
      forecast: "3.5%",
      previous: "3.4%",
      actual: null,
    },
    {
      dateStr: dayPlus5,
      timeStr: "13:30", // 7:00pm Local
      currency: "USD",
      title: "Prelim GDP Price Index q/q",
      impact: "MEDIUM",
      forecast: "2.3%",
      previous: "2.3%",
      actual: null,
    },
    {
      dateStr: dayPlus5,
      timeStr: "13:30", // 7:00pm Local
      currency: "USD",
      title: "Unemployment Claims",
      impact: "MEDIUM",
      forecast: "200K",
      previous: "203K",
      actual: null,
    },

    // --- Next Week: Thursday Nov 26 ---
    {
      dateStr: dayPlus6,
      timeStr: "12:00",
      currency: "USD",
      title: "Bank Holiday",
      impact: "NON_ECONOMIC",
      forecast: "—",
      previous: "—",
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
