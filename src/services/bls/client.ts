import type { DatasetMeta, FeedMode } from "@/lib/types";
import { fetchJsonWithTimeout } from "@/services/http";
import { getObservations } from "@/services/sync/store";

export interface BlsSeriesResponse {
  seriesId: string;
  available: boolean;
  latestValue: number | null;
  previousValue: number | null;
  latestYoyPct: number | null;
  previousYoyPct: number | null;
  observationDate: string;
  meta: DatasetMeta;
}

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

const BLS_SERIES_KEY_MAP: Record<string, string> = {
  CUUR0000SA0: "CPI_YOY",
  CUUR0000SA0L1E: "CORE_CPI_YOY",
};

interface BlsApiPayload {
  status?: string;
  Results?: {
    series?: {
      data?: { year?: string; period?: string; value?: string }[];
    }[];
  };
}

function buildEmptyResponse(
  seriesId: string,
  mode: FeedMode,
  units: string
): BlsSeriesResponse {
  return {
    seriesId,
    available: false,
    latestValue: null,
    previousValue: null,
    latestYoyPct: null,
    previousYoyPct: null,
    observationDate: "—",
    meta: {
      source: `BLS · ${seriesId}`,
      seriesId,
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: "MONTHLY",
      units,
      mode,
    },
  };
}

async function loadPersistedBlsObservations(
  seriesId: string,
  seriesKey: string | undefined,
  units: string
): Promise<BlsSeriesResponse | null> {
  try {
    const resolvedKey = seriesKey ?? BLS_SERIES_KEY_MAP[seriesId];
    const records = resolvedKey
      ? await getObservations(resolvedKey, 120)
      : (await getObservations(undefined, 500)).filter(
          (o) => o.externalSeriesId === seriesId
        );

    const byDate = new Map<
      string,
      { date: string; value: number; fetchedAt: string }
    >();
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

    const descending = Array.from(byDate.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    if (descending.length === 0) return null;

    const latest = descending[0];
    const prev = descending.length >= 2 ? descending[1] : null;
    const obsDate = latest.date.slice(0, 7);

    return {
      seriesId,
      available: true,
      latestValue: latest.value,
      previousValue: prev ? prev.value : null,
      latestYoyPct: latest.value,
      previousYoyPct: prev ? prev.value : null,
      observationDate: obsDate,
      meta: {
        source: `BLS · ${seriesId}`,
        seriesId,
        observationDate: obsDate,
        releaseDate: latest.date,
        lastUpdated: latest.fetchedAt || new Date().toISOString(),
        frequency: "MONTHLY",
        units,
        mode: "LIVE_API",
      },
    };
  } catch {
    return null;
  }
}

export async function fetchBlsSeries(
  seriesId: string,
  options: {
    seriesKey?: string;
    units?: string;
  } = {}
): Promise<BlsSeriesResponse> {
  const units = options.units ?? "% YoY";

  if (typeof window !== "undefined") {
    return buildEmptyResponse(seriesId, "UNCONFIGURED", units);
  }

  const apiKey = process.env.BLS_API_KEY?.trim();

  if (apiKey) {
    const currentYear = new Date().getUTCFullYear();
    const response = await fetchJsonWithTimeout<BlsApiPayload>(BLS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: [seriesId],
        startyear: String(currentYear - 2),
        endyear: String(currentYear),
        registrationkey: apiKey,
      }),
      next: { revalidate: 3600 },
    });

    if (response.ok && response.data.status === "REQUEST_SUCCEEDED") {
      const rawRows = response.data.Results?.series?.[0]?.data ?? [];
      const monthly = rawRows
        .filter(
          (r): r is { year: string; period: string; value: string } =>
            typeof r.year === "string" &&
            typeof r.period === "string" &&
            /^M(0[1-9]|1[0-2])$/.test(r.period) &&
            typeof r.value === "string" &&
            r.value.trim() !== "" &&
            Number.isFinite(Number(r.value))
        )
        .map((r) => ({
          key: `${r.year}-${r.period.slice(1)}`,
          value: Number(r.value),
        }))
        .sort((a, b) => b.key.localeCompare(a.key));

      if (monthly.length >= 2) {
        const latest = monthly[0];
        const prev = monthly[1];
        const yearAgo = monthly.find(
          (m) =>
            m.key === `${Number(latest.key.slice(0, 4)) - 1}-${latest.key.slice(5)}`
        );
        const prevYearAgo = monthly.find(
          (m) =>
            m.key === `${Number(prev.key.slice(0, 4)) - 1}-${prev.key.slice(5)}`
        );

        const latestYoyPct =
          yearAgo && yearAgo.value > 0
            ? Number((((latest.value / yearAgo.value) - 1) * 100).toFixed(2))
            : null;
        const previousYoyPct =
          prevYearAgo && prevYearAgo.value > 0
            ? Number((((prev.value / prevYearAgo.value) - 1) * 100).toFixed(2))
            : null;

        return {
          seriesId,
          available: true,
          latestValue: latest.value,
          previousValue: prev.value,
          latestYoyPct,
          previousYoyPct,
          observationDate: latest.key,
          meta: {
            source: `BLS · ${seriesId}`,
            seriesId,
            observationDate: latest.key,
            releaseDate: latest.key,
            lastUpdated: new Date().toISOString(),
            frequency: "MONTHLY",
            units,
            mode: "LIVE_API",
          },
        };
      }
    }
  }

  const persisted = await loadPersistedBlsObservations(
    seriesId,
    options.seriesKey,
    units
  );
  if (persisted) {
    return persisted;
  }

  return buildEmptyResponse(
    seriesId,
    apiKey ? "AWAITING_SYNC" : "UNCONFIGURED",
    units
  );
}
