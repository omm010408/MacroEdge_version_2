import type { DatasetMeta, FeedMode } from "@/lib/types";
import { fetchJsonWithTimeout } from "@/services/http";
import { getObservations } from "@/services/sync/store";

export interface FredObservation {
  date: string;
  value: number;
}

export interface FredSeriesResult {
  seriesId: string;
  observations: FredObservation[];
  available: boolean;
  meta: DatasetMeta;
}

const FRED_ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const FRED_RELEASES_ENDPOINT = "https://api.stlouisfed.org/fred/releases/dates";

const FRED_SERIES_KEY_MAP: Record<string, string> = {
  CPIAUCSL: "CPI_YOY",
  CPILFESL: "CORE_CPI_YOY",
  PCEPI: "PCE_YOY",
  PCEPILFE: "CORE_PCE_YOY",
  PPIFIS: "PPI_YOY",
  T10YIE: "BREAKEVEN_10Y",
  T5YIE: "BREAKEVEN_5Y",
  DGS2: "US2Y",
  DGS5: "US5Y",
  DGS10: "US10Y",
  DGS30: "US30Y",
  DFII10: "US10Y_REAL",
  VIXCLS: "VIX",
  DFF: "EFFR",
  SOFR: "SOFR",
  IORB: "IORB",
  WALCL: "FED_WALCL",
  WTREGEN: "FED_TGA",
  RRPONTSYD: "FED_RRP",
  BAMLH0A0HYM2: "HY_OAS",
  BAMLC0A0CM: "IG_OAS",
  STLFSI4: "STLFSI4",
  UNRATE: "UNRATE",
  ICSA: "ICSA",
  PAYEMS: "NFP_PAYEMS",
  A191RL1Q225SBEA: "REAL_GDP_QOQ",
  RSAFS: "RETAIL_SALES_MOM",
  DTWEXBGS: "DXY_BROAD",
};

interface FredApiPayload {
  error_code?: number;
  error_message?: string;
  observations?: { date?: string; value?: string }[];
}

function buildEmptyResult(
  seriesId: string,
  mode: FeedMode,
  options: {
    units?: string;
    frequency?: DatasetMeta["frequency"];
  }
): FredSeriesResult {
  return {
    seriesId,
    observations: [],
    available: false,
    meta: {
      source: `FRED · ${seriesId}`,
      seriesId,
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: options.frequency ?? "MONTHLY",
      units: options.units ?? "%",
      mode,
    },
  };
}

async function loadPersistedFredObservations(
  seriesId: string,
  seriesKey: string | undefined,
  limit: number
): Promise<{ observations: FredObservation[]; lastUpdated: string } | null> {
  try {
    const resolvedKey = seriesKey ?? FRED_SERIES_KEY_MAP[seriesId];
    const records = resolvedKey
      ? await getObservations(resolvedKey, limit)
      : (await getObservations(undefined, 500)).filter(
          (o) => o.externalSeriesId === seriesId
        );

    const byDate = new Map<string, { date: string; value: number; fetchedAt: string }>();
    for (const rec of records) {
      if (rec.validationStatus === "REJECTED" || !Number.isFinite(rec.value)) continue;
      if (!byDate.has(rec.observationDate)) {
        byDate.set(rec.observationDate, {
          date: rec.observationDate,
          value: rec.value,
          fetchedAt: rec.fetchedAt,
        });
      }
    }

    const sorted = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    if (sorted.length === 0) return null;

    const sliced = sorted.slice(-limit);
    return {
      observations: sliced.map((r) => ({ date: r.date, value: r.value })),
      lastUpdated: sliced[sliced.length - 1].fetchedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchFredSeries(
  seriesId: string,
  options: {
    seriesKey?: string;
    units?: string;
    frequency?: DatasetMeta["frequency"];
    fredUnitsParam?: "lin" | "pc1" | "chg" | "pch";
    limit?: number;
  } = {}
): Promise<FredSeriesResult> {
  if (typeof window !== "undefined") {
    return buildEmptyResult(seriesId, "UNCONFIGURED", options);
  }

  const limit = options.limit ?? 120;
  const apiKey = process.env.FRED_API_KEY?.trim();

  if (apiKey) {
    const url = new URL(FRED_ENDPOINT);
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", String(limit));
    if (options.fredUnitsParam) {
      url.searchParams.set("units", options.fredUnitsParam);
    }

    const response = await fetchJsonWithTimeout<FredApiPayload>(url.toString(), {
      next: { revalidate: 3600 },
    });

    if (response.ok && response.data.error_code === undefined) {
      const parsed = (response.data.observations ?? [])
        .filter(
          (row): row is { date: string; value: string } =>
            typeof row.date === "string" &&
            row.date.length >= 4 &&
            typeof row.value === "string" &&
            row.value.trim() !== "" &&
            row.value !== "." &&
            Number.isFinite(Number(row.value))
        )
        .map((row) => ({ date: row.date, value: Number(row.value) }))
        .reverse();

      if (parsed.length > 0) {
        const latestObsDate = parsed[parsed.length - 1].date;
        return {
          seriesId,
          observations: parsed,
          available: true,
          meta: {
            source: `FRED · ${seriesId}`,
            seriesId,
            observationDate: latestObsDate,
            releaseDate: latestObsDate,
            lastUpdated: new Date().toISOString(),
            frequency: options.frequency ?? "MONTHLY",
            units: options.units ?? "%",
            mode: "LIVE_API",
          },
        };
      }
    }
  }

  const persisted = await loadPersistedFredObservations(
    seriesId,
    options.seriesKey,
    limit
  );
  if (persisted && persisted.observations.length > 0) {
    const latestObsDate =
      persisted.observations[persisted.observations.length - 1].date;
    return {
      seriesId,
      observations: persisted.observations,
      available: true,
      meta: {
        source: `FRED · ${seriesId}`,
        seriesId,
        observationDate: latestObsDate,
        releaseDate: latestObsDate,
        lastUpdated: persisted.lastUpdated,
        frequency: options.frequency ?? "MONTHLY",
        units: options.units ?? "%",
        mode: "LIVE_API",
      },
    };
  }

  return buildEmptyResult(
    seriesId,
    apiKey ? "AWAITING_SYNC" : "UNCONFIGURED",
    options
  );
}

interface FredReleaseDatesPayload {
  release_dates?: {
    release_id?: number;
    release_name?: string;
    date?: string;
  }[];
}

export async function fetchFredReleaseDates(
  windowDaysBack = 14,
  windowDaysForward = 14
): Promise<{ releaseId: number; releaseName: string; date: string }[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];

  const now = new Date();
  const start = new Date(now.getTime() - windowDaysBack * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const end = new Date(now.getTime() + windowDaysForward * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const url = `${FRED_RELEASES_ENDPOINT}?api_key=${encodeURIComponent(
    apiKey
  )}&file_type=json&include_release_dates_with_no_data=true&realtime_start=${start}&realtime_end=${end}&limit=120`;

  const res = await fetchJsonWithTimeout<FredReleaseDatesPayload>(url, undefined, 5000);
  if (!res.ok || !Array.isArray(res.data?.release_dates)) {
    return [];
  }

  return res.data.release_dates
    .filter(
      (item): item is { release_id: number; release_name: string; date: string } =>
        typeof item.release_id === "number" &&
        typeof item.release_name === "string" &&
        typeof item.date === "string"
    )
    .map((item) => ({
      releaseId: item.release_id,
      releaseName: item.release_name,
      date: item.date,
    }));
}
