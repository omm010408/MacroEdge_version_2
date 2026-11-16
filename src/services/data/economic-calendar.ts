import type { EconomicCalendarEvent } from "@/lib/types";
import type { LatestValueRecord } from "@/lib/sync/types";

export interface FredReleaseDateItem {
  releaseId: number;
  releaseName: string;
  date: string;
}

interface IndicatorCalendarSpec {
  seriesKey: string;
  event: string;
  importance: EconomicCalendarEvent["importance"];
  unit: string;
  decimals: number;
  releaseTimeUtc: string;
  scale?: number;
  weeklyDayUtc?: number; // 0=Sun..6=Sat for predictable weekly schedules
}

const MACRO_CALENDAR_SPECS: IndicatorCalendarSpec[] = [
  {
    seriesKey: "CPI_YOY",
    event: "US CPI Inflation (YoY)",
    importance: "HIGH",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "CORE_CPI_YOY",
    event: "US Core CPI (YoY)",
    importance: "HIGH",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "PCE_YOY",
    event: "US Headline PCE (YoY)",
    importance: "HIGH",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "CORE_PCE_YOY",
    event: "US Core PCE Price Index (YoY)",
    importance: "HIGH",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "PPI_YOY",
    event: "US Producer Price Index (YoY)",
    importance: "MEDIUM",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "NFP_PAYEMS",
    event: "US Nonfarm Payrolls",
    importance: "HIGH",
    unit: "K",
    decimals: 0,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "UNRATE",
    event: "US Unemployment Rate",
    importance: "HIGH",
    unit: "%",
    decimals: 1,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "AHE_YOY",
    event: "Average Hourly Earnings (YoY)",
    importance: "HIGH",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "REAL_GDP_QOQ",
    event: "US Real GDP Growth (QoQ Ann.)",
    importance: "HIGH",
    unit: "%",
    decimals: 1,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "ISM_MFG",
    event: "ISM Manufacturing PMI",
    importance: "HIGH",
    unit: "pts",
    decimals: 1,
    releaseTimeUtc: "15:00 UTC",
  },
  {
    seriesKey: "ISM_SVC",
    event: "ISM Services PMI",
    importance: "HIGH",
    unit: "pts",
    decimals: 1,
    releaseTimeUtc: "15:00 UTC",
  },
  {
    seriesKey: "RETAIL_SALES_MOM",
    event: "US Retail Sales (MoM)",
    importance: "MEDIUM",
    unit: "%",
    decimals: 2,
    releaseTimeUtc: "13:30 UTC",
  },
  {
    seriesKey: "CONSUMER_CONFIDENCE",
    event: "Conference Board / UMich Sentiment",
    importance: "MEDIUM",
    unit: "pts",
    decimals: 1,
    releaseTimeUtc: "15:00 UTC",
  },
  {
    seriesKey: "ICSA",
    event: "Initial Jobless Claims",
    importance: "MEDIUM",
    unit: "K",
    decimals: 0,
    releaseTimeUtc: "13:30 UTC",
    scale: 0.001,
    weeklyDayUtc: 4, // Thursday
  },
  {
    seriesKey: "FED_WALCL",
    event: "Fed H.4.1 Balance Sheet Assets",
    importance: "MEDIUM",
    unit: "T",
    decimals: 2,
    releaseTimeUtc: "21:30 UTC",
    scale: 0.000001,
    weeklyDayUtc: 4, // Thursday
  },
  {
    seriesKey: "COT_NET_GC",
    event: "CFTC COT Commitments of Traders",
    importance: "MEDIUM",
    unit: "Contracts",
    decimals: 0,
    releaseTimeUtc: "20:30 UTC",
    weeklyDayUtc: 5, // Friday
  },
];

interface FredReleaseMapSpec {
  match: RegExp;
  label: string;
  importance: EconomicCalendarEvent["importance"];
  seriesKey?: string;
  releaseTimeUtc: string;
  unit: string;
  decimals: number;
}

const FRED_RELEASE_SPECS: FredReleaseMapSpec[] = [
  {
    match: /consumer price index/i,
    label: "US CPI Release (BLS)",
    importance: "HIGH",
    seriesKey: "CPI_YOY",
    releaseTimeUtc: "13:30 UTC",
    unit: "%",
    decimals: 2,
  },
  {
    match: /employment situation/i,
    label: "US Employment Situation (NFP / Unrate)",
    importance: "HIGH",
    seriesKey: "NFP_PAYEMS",
    releaseTimeUtc: "13:30 UTC",
    unit: "K",
    decimals: 0,
  },
  {
    match: /personal income and outlays/i,
    label: "US PCE & Core PCE Inflation (BEA)",
    importance: "HIGH",
    seriesKey: "CORE_PCE_YOY",
    releaseTimeUtc: "13:30 UTC",
    unit: "%",
    decimals: 2,
  },
  {
    match: /gross domestic product/i,
    label: "US Gross Domestic Product (BEA)",
    importance: "HIGH",
    seriesKey: "REAL_GDP_QOQ",
    releaseTimeUtc: "13:30 UTC",
    unit: "%",
    decimals: 1,
  },
  {
    match: /producer price index/i,
    label: "US Producer Price Index (BLS)",
    importance: "MEDIUM",
    seriesKey: "PPI_YOY",
    releaseTimeUtc: "13:30 UTC",
    unit: "%",
    decimals: 2,
  },
  {
    match: /unemployment insurance weekly claims/i,
    label: "Initial Jobless Claims (DOL)",
    importance: "MEDIUM",
    seriesKey: "ICSA",
    releaseTimeUtc: "13:30 UTC",
    unit: "K",
    decimals: 0,
  },
  {
    match: /advance monthly sales for retail/i,
    label: "US Retail Sales (Census)",
    importance: "MEDIUM",
    seriesKey: "RETAIL_SALES_MOM",
    releaseTimeUtc: "13:30 UTC",
    unit: "%",
    decimals: 2,
  },
  {
    match: /h\.4\.1|factors affecting reserve balances/i,
    label: "Fed H.4.1 Reserve Balances & Balance Sheet",
    importance: "MEDIUM",
    seriesKey: "FED_WALCL",
    releaseTimeUtc: "21:30 UTC",
    unit: "T",
    decimals: 2,
  },
  {
    match: /h\.15|selected interest rates/i,
    label: "Fed H.15 Selected Interest Rates",
    importance: "LOW",
    seriesKey: "EFFR",
    releaseTimeUtc: "21:15 UTC",
    unit: "%",
    decimals: 2,
  },
];

function classifyBucket(isoDate: string, now = new Date()): EconomicCalendarEvent["bucket"] {
  const todayIso = now.toISOString().slice(0, 10);
  if (isoDate === todayIso) return "today";

  const targetMs = Date.parse(`${isoDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return "this-week";

  const diffDays = Math.round((targetMs - todayMs) / 86_400_000);
  if (diffDays > 6) return "next-week";
  if (diffDays >= -6) return "this-week";
  return "next-week";
}

function nextWeekdayIso(targetDay: number, now = new Date()): string {
  const utcDay = now.getUTCDay();
  const delta = (targetDay - utcDay + 7) % 7;
  const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta));
  return dt.toISOString().slice(0, 10);
}

function formatMetricVal(
  val: number | null | undefined,
  decimals: number,
  unit: string,
  scale = 1
): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const scaled = val * scale;
  const prefix = unit === "T" ? "$" : "";
  const suffix = unit === "Contracts" || unit === "pts" || unit === "T" ? (unit === "T" ? "T" : "") : unit;
  const formatted = scaled.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${formatted}${suffix}`;
}

export function buildEconomicCalendarEvents(options: {
  latestValues?: LatestValueRecord[];
  fredReleases?: FredReleaseDateItem[];
  now?: Date;
}): EconomicCalendarEvent[] {
  const now = options.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const latestMap = new Map<string, LatestValueRecord>();
  for (const lv of options.latestValues ?? []) {
    if (lv && Number.isFinite(lv.value) && lv.status !== "FAILED") {
      latestMap.set(lv.seriesKey, lv);
    }
  }

  const events: EconomicCalendarEvent[] = [];
  const seenKeys = new Set<string>();

  // 1. Official FRED upcoming/recent release schedule dates (when FRED_API_KEY returned release dates)
  for (const item of options.fredReleases ?? []) {
    const matched = FRED_RELEASE_SPECS.find((s) => s.match.test(item.releaseName));
    if (!matched) continue;

    const dedupeKey = `fred-${matched.seriesKey ?? item.releaseId}-${item.date}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const linked = matched.seriesKey ? latestMap.get(matched.seriesKey) : undefined;
    const isFuture = item.date > todayIso;
    const scale = matched.seriesKey === "ICSA" ? 0.001 : matched.seriesKey === "FED_WALCL" ? 0.000001 : 1;
    const rawCons = linked?.rawPayload?.consensus;
    const consensusStr =
      typeof rawCons === "number" && Number.isFinite(rawCons)
        ? formatMetricVal(rawCons, matched.decimals, matched.unit, scale)
        : "—";

    const actualStr =
      !isFuture && linked && linked.publishedAt.slice(0, 10) >= item.date
        ? formatMetricVal(linked.value, matched.decimals, matched.unit, scale)
        : null;

    const prevStr = linked
      ? formatMetricVal(
          isFuture ? linked.value : linked.previousValue,
          matched.decimals,
          matched.unit,
          scale
        )
      : "—";

    events.push({
      id: dedupeKey,
      event: matched.label,
      country: "US",
      bucket: classifyBucket(item.date, now),
      releaseTime: `${item.date} · ${matched.releaseTimeUtc}`,
      previous: prevStr,
      consensus: consensusStr,
      actual: actualStr,
      importance: matched.importance,
      unit: matched.unit,
    });
  }

  // 2. Synced macroeconomic releases & predictable weekly institutional releases from live latestValues
  for (const spec of MACRO_CALENDAR_SPECS) {
    const rec = latestMap.get(spec.seriesKey);
    if (!rec) continue;

    const pubDate = (rec.publishedAt || rec.observationDate || "").slice(0, 10);
    if (pubDate) {
      const hasFredForSeries = Array.from(seenKeys).some(
        (k) => k.startsWith(`fred-${spec.seriesKey}-`) && k.endsWith(`-${pubDate}`)
      );
      if (!hasFredForSeries) {
        const scale = spec.scale ?? 1;
        const rawCons = rec.rawPayload?.consensus;
        const consensusStr =
          typeof rawCons === "number" && Number.isFinite(rawCons)
            ? formatMetricVal(rawCons, spec.decimals, spec.unit, scale)
            : "—";

        const id = `latest-${spec.seriesKey}-${pubDate}`;
        if (!seenKeys.has(id)) {
          seenKeys.add(id);
          events.push({
            id,
            event: spec.event,
            country: "US",
            bucket: classifyBucket(pubDate, now),
            releaseTime: `${pubDate} · ${spec.releaseTimeUtc}`,
            previous: formatMetricVal(rec.previousValue, spec.decimals, spec.unit, scale),
            consensus: consensusStr,
            actual: formatMetricVal(rec.value, spec.decimals, spec.unit, scale),
            importance: spec.importance,
            unit: spec.unit,
          });
        }
      }
    }

    // Add next scheduled weekly release slot only when FRED hasn't already provided one for this series
    if (spec.weeklyDayUtc !== undefined) {
      const nextDate = nextWeekdayIso(spec.weeklyDayUtc, now);
      if (nextDate >= todayIso && nextDate !== pubDate) {
        const alreadyCovered = Array.from(seenKeys).some(
          (k) =>
            k.startsWith(`fred-${spec.seriesKey}-`) ||
            (k.includes(`-${spec.seriesKey}-`) && k.endsWith(`-${nextDate}`))
        );
        if (!alreadyCovered) {
          const scale = spec.scale ?? 1;
          const upId = `upcoming-${spec.seriesKey}-${nextDate}`;
          seenKeys.add(upId);
          events.push({
            id: upId,
            event: `${spec.event} (Next Release)`,
            country: "US",
            bucket: classifyBucket(nextDate, now),
            releaseTime: `${nextDate} · ${spec.releaseTimeUtc}`,
            previous: formatMetricVal(rec.value, spec.decimals, spec.unit, scale),
            consensus: "—",
            actual: null,
            importance: spec.importance,
            unit: spec.unit,
          });
        }
      }
    }
  }

  // Sort chronologically descending by release date/time with pending upcoming releases first
  events.sort((a, b) => {
    const aPending = a.actual === null ? 1 : 0;
    const bPending = b.actual === null ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;
    return b.releaseTime.localeCompare(a.releaseTime);
  });

  return events;
}
