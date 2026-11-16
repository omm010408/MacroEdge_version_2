import type { DatasetMeta, FeedMode } from "@/lib/types";
import { fetchJsonWithTimeout } from "@/services/http";
import { getObservations } from "@/services/sync/store";

export interface BeaSeriesResult {
  tableName: string;
  available: boolean;
  latestValue: number | null;
  previousValue: number | null;
  observationDate: string;
  meta: DatasetMeta;
}

const BEA_API_URL = "https://apps.bea.gov/api/data";

const BEA_SERIES_KEY_MAP: Record<string, string> = {
  T10101: "REAL_GDP_QOQ",
  T20804: "CORE_PCE_YOY",
};

interface BeaApiPayload {
  BEAAPI?: {
    Error?: unknown;
    Results?: {
      Error?: unknown;
      Data?: { LineNumber?: string; DataValue?: string; TimePeriod?: string }[];
    };
  };
}

function buildEmptyResult(
  tableName: string,
  mode: FeedMode,
  options: {
    units?: string;
    frequency?: DatasetMeta["frequency"];
  }
): BeaSeriesResult {
  return {
    tableName,
    available: false,
    latestValue: null,
    previousValue: null,
    observationDate: "—",
    meta: {
      source: `BEA · ${tableName}`,
      seriesId: tableName,
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: options.frequency ?? "QUARTERLY",
      units: options.units ?? "% QoQ Ann.",
      mode,
    },
  };
}

async function loadPersistedBeaObservations(
  tableName: string,
  options: {
    seriesKey?: string;
    units?: string;
    frequency?: DatasetMeta["frequency"];
  }
): Promise<BeaSeriesResult | null> {
  try {
    const resolvedKey = options.seriesKey ?? BEA_SERIES_KEY_MAP[tableName];
    const records = resolvedKey
      ? await getObservations(resolvedKey, 60)
      : (await getObservations(undefined, 500)).filter(
          (o) => o.externalSeriesId === tableName
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

    return {
      tableName,
      available: true,
      latestValue: latest.value,
      previousValue: prev ? prev.value : null,
      observationDate: latest.date,
      meta: {
        source: `BEA · ${tableName}`,
        seriesId: tableName,
        observationDate: latest.date,
        releaseDate: latest.date,
        lastUpdated: latest.fetchedAt || new Date().toISOString(),
        frequency: options.frequency ?? "QUARTERLY",
        units: options.units ?? "% QoQ Ann.",
        mode: "LIVE_API",
      },
    };
  } catch {
    return null;
  }
}

export async function fetchBeaSeries(
  tableName: string,
  options: {
    seriesKey?: string;
    units?: string;
    frequency?: DatasetMeta["frequency"];
    lineNumber?: string;
  } = {}
): Promise<BeaSeriesResult> {
  if (typeof window !== "undefined") {
    return buildEmptyResult(tableName, "UNCONFIGURED", options);
  }

  const frequency = options.frequency ?? "QUARTERLY";
  const units = options.units ?? "% QoQ Ann.";
  const apiKey = process.env.BEA_API_KEY?.trim();

  if (apiKey) {
    const targetLine = options.lineNumber ?? "1";
    const currentYear = new Date().getUTCFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear].join(",");

    const url = new URL(BEA_API_URL);
    url.searchParams.set("UserID", apiKey);
    url.searchParams.set("method", "GetData");
    url.searchParams.set("DataSetName", "NIPA");
    url.searchParams.set("TableName", tableName);
    url.searchParams.set("Frequency", frequency === "QUARTERLY" ? "Q" : "M");
    url.searchParams.set("Year", years);
    url.searchParams.set("ResultFormat", "JSON");

    const response = await fetchJsonWithTimeout<BeaApiPayload>(url.toString(), {
      next: { revalidate: 3600 },
    });

    if (
      response.ok &&
      !response.data.BEAAPI?.Error &&
      !response.data.BEAAPI?.Results?.Error
    ) {
      const parsed = (response.data.BEAAPI?.Results?.Data ?? [])
        .filter(
          (r): r is { LineNumber: string; DataValue: string; TimePeriod: string } =>
            r.LineNumber === targetLine &&
            typeof r.DataValue === "string" &&
            r.DataValue.trim() !== "" &&
            typeof r.TimePeriod === "string" &&
            r.TimePeriod.trim() !== ""
        )
        .map((r) => ({
          timePeriod: r.TimePeriod.trim(),
          value: Number(r.DataValue.replace(/,/g, "")),
        }))
        .filter((r) => Number.isFinite(r.value))
        .sort((a, b) => a.timePeriod.localeCompare(b.timePeriod));

      if (parsed.length >= 2) {
        const latestRow = parsed[parsed.length - 1];
        const prevRow = parsed[parsed.length - 2];

        return {
          tableName,
          available: true,
          latestValue: latestRow.value,
          previousValue: prevRow.value,
          observationDate: latestRow.timePeriod,
          meta: {
            source: `BEA · ${tableName}`,
            seriesId: tableName,
            observationDate: latestRow.timePeriod,
            releaseDate: latestRow.timePeriod,
            lastUpdated: new Date().toISOString(),
            frequency,
            units,
            mode: "LIVE_API",
          },
        };
      }
    }
  }

  const persisted = await loadPersistedBeaObservations(tableName, {
    seriesKey: options.seriesKey,
    units,
    frequency,
  });
  if (persisted) {
    return persisted;
  }

  return buildEmptyResult(
    tableName,
    apiKey ? "AWAITING_SYNC" : "UNCONFIGURED",
    options
  );
}
