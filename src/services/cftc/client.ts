import type {
  CotHistoryPoint,
  CotInstrument,
  CotSignal,
  DatasetMeta,
  FeedMode,
} from "@/lib/types";
import { getObservations } from "@/services/sync/store";
import { fetchCftcLegacyContractRows } from "@/services/sync/workers/rest-adapters";

export interface CftcDatasetResult {
  instruments: CotInstrument[];
  reportDate: string;
  releaseDate: string;
  meta: DatasetMeta;
}

interface CotContractSpec {
  id: string;
  symbol: string;
  code: string;
  instrument: string;
  assetClass: CotInstrument["assetClass"];
}

const CFTC_CONTRACTS: CotContractSpec[] = [
  { id: "gold", symbol: "GC", code: "088691", instrument: "Gold (COMEX)", assetClass: "Metals" },
  { id: "eurusd", symbol: "6E", code: "099741", instrument: "Euro FX (CME)", assetClass: "FX" },
  { id: "usdjpy", symbol: "6J", code: "097741", instrument: "Japanese Yen (CME)", assetClass: "FX" },
  { id: "gbpusd", symbol: "6B", code: "096742", instrument: "British Pound (CME)", assetClass: "FX" },
  { id: "dxy", symbol: "DX", code: "098662", instrument: "US Dollar Index (ICE)", assetClass: "FX" },
  { id: "audusd", symbol: "6A", code: "232741", instrument: "Australian Dollar (CME)", assetClass: "FX" },
  { id: "us10y", symbol: "ZN", code: "043602", instrument: "10Y Treasury Note (CBOT)", assetClass: "Rates" },
  { id: "us02y", symbol: "ZT", code: "042601", instrument: "2Y Treasury Note (CBOT)", assetClass: "Rates" },
  { id: "spx", symbol: "ES", code: "13874A", instrument: "E-mini S&P 500 (CME)", assetClass: "Equities" },
  { id: "nq", symbol: "NQ", code: "209742", instrument: "E-mini Nasdaq-100 (CME)", assetClass: "Equities" },
  { id: "wti", symbol: "CL", code: "067651", instrument: "WTI Crude Oil (NYMEX)", assetClass: "Energy" },
  { id: "silver", symbol: "SI", code: "084691", instrument: "Silver (COMEX)", assetClass: "Metals" },
  { id: "copper", symbol: "HG", code: "085692", instrument: "High Grade Copper (COMEX)", assetClass: "Metals" },
  { id: "btc", symbol: "BTC", code: "133741", instrument: "Bitcoin Futures (CME)", assetClass: "Crypto" },
];

function computeFridayReleaseDate(tuesdayReportDate: string): string {
  const dt = new Date(`${tuesdayReportDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return tuesdayReportDate.slice(0, 10);
  const friday = new Date(dt.getTime() + 3 * 86400000);
  return friday.toISOString().slice(0, 10);
}

function emptyCftcResult(mode: FeedMode): CftcDatasetResult {
  return {
    instruments: [],
    reportDate: "—",
    releaseDate: "—",
    meta: {
      source: "CFTC · Legacy & TFF Futures",
      seriesId: "COT-WEEKLY",
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: "WEEKLY",
      units: "Contracts",
      mode,
    },
  };
}

async function loadPersistedCotInstruments(): Promise<CotInstrument[]> {
  try {
    const instruments: CotInstrument[] = [];

    for (const contract of CFTC_CONTRACTS) {
      const records = await getObservations(`COT_NET_${contract.symbol}`, 156);
      const byDate = new Map<
        string,
        {
          date: string;
          net: number;
          long: number;
          short: number;
          openInterest: number;
          commercialNet: number;
          percentile: number | null;
        }
      >();

      for (const rec of records) {
        if (rec.validationStatus === "REJECTED" || !Number.isFinite(rec.value)) continue;
        if (byDate.has(rec.observationDate)) continue;
        const raw = rec.rawPayload ?? {};
        const long = Number(raw.nonCommercialLong);
        const short = Number(raw.nonCommercialShort);
        const openInterest = Number(raw.openInterest);
        const commercialNet = Number(raw.commercialNet);
        const pctl = Number(raw.percentile3Y);

        byDate.set(rec.observationDate, {
          date: rec.observationDate,
          net: rec.value,
          long: Number.isFinite(long) ? long : 0,
          short: Number.isFinite(short) ? short : 0,
          openInterest: Number.isFinite(openInterest) ? openInterest : 0,
          commercialNet: Number.isFinite(commercialNet) ? commercialNet : 0,
          percentile: Number.isFinite(pctl) ? pctl : null,
        });
      }

      const sorted = Array.from(byDate.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      if (sorted.length === 0) continue;

      const nets = sorted.map((p) => p.net);
      const minNet = Math.min(...nets);
      const maxNet = Math.max(...nets);
      const span = Math.max(1, maxNet - minNet);

      const history: CotHistoryPoint[] = sorted.map((pt) => ({
        date: pt.date,
        net: pt.net,
        long: pt.long,
        short: pt.short,
        openInterest: pt.openInterest,
        oscillator:
          pt.percentile !== null
            ? pt.percentile
            : Math.round(((pt.net - minNet) / span) * 100),
        commercialNet: pt.commercialNet,
      }));

      const latest = history[history.length - 1];
      const prev = history.length >= 2 ? history[history.length - 2] : latest;
      const percentile = latest.oscillator;
      const signal: CotSignal =
        percentile >= 80
          ? "Extreme Long"
          : percentile <= 20
          ? "Extreme Short"
          : "Neutral";

      instruments.push({
        id: contract.id,
        instrument: contract.instrument,
        symbol: contract.symbol,
        assetClass: contract.assetClass,
        netContracts: latest.net,
        weeklyChange: latest.net - prev.net,
        longPositions: latest.long,
        shortPositions: latest.short,
        openInterest: latest.openInterest,
        percentile,
        signal,
        reportDate: latest.date,
        releaseDate: computeFridayReleaseDate(latest.date),
        history,
      });
    }

    return instruments;
  } catch {
    return [];
  }
}

/**
 * Fetches live CFTC Legacy Futures positioning via Socrata when ENABLE_PUBLIC_CFTC_LIVE === "true",
 * falling back only to persisted real CFTC observations in sync store if offline.
 */
export async function fetchCftcPositioning(): Promise<CftcDatasetResult> {
  if (typeof window !== "undefined") {
    return emptyCftcResult("UNCONFIGURED");
  }

  const enabled = process.env.ENABLE_PUBLIC_CFTC_LIVE?.trim() === "true";
  if (!enabled) {
    return emptyCftcResult("UNCONFIGURED");
  }

  const results = await Promise.all(
    CFTC_CONTRACTS.map(async (contract) => {
      const res = await fetchCftcLegacyContractRows(contract.code, 156, 5000);
      if (!res.ok || res.rows.length === 0) return null;

      const parsed = res.rows
        .map((row) => {
          const date = row.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? "";
          const ncLong = Number(row.noncomm_positions_long_all);
          const ncShort = Number(row.noncomm_positions_short_all);
          const cLong = Number(row.comm_positions_long_all);
          const cShort = Number(row.comm_positions_short_all);
          const oi = Number(row.open_interest_all);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(ncLong) ||
            !Number.isFinite(ncShort) ||
            !Number.isFinite(cLong) ||
            !Number.isFinite(cShort) ||
            !Number.isFinite(oi)
          ) {
            return null;
          }
          return {
            date,
            net: ncLong - ncShort,
            long: ncLong,
            short: ncShort,
            openInterest: oi,
            commercialNet: cLong - cShort,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (parsed.length === 0) return null;

      const nets = parsed.map((p) => p.net);
      const minNet = Math.min(...nets);
      const maxNet = Math.max(...nets);
      const span = Math.max(1, maxNet - minNet);

      const history: CotHistoryPoint[] = parsed.map((pt) => ({
        ...pt,
        oscillator: Math.round(((pt.net - minNet) / span) * 100),
      }));

      const latest = history[history.length - 1];
      const prev = history.length >= 2 ? history[history.length - 2] : latest;
      const percentile = latest.oscillator;
      const signal: CotSignal =
        percentile >= 80
          ? "Extreme Long"
          : percentile <= 20
          ? "Extreme Short"
          : "Neutral";

      return {
        id: contract.id,
        instrument: contract.instrument,
        symbol: contract.symbol,
        assetClass: contract.assetClass,
        netContracts: latest.net,
        weeklyChange: latest.net - prev.net,
        longPositions: latest.long,
        shortPositions: latest.short,
        openInterest: latest.openInterest,
        percentile,
        signal,
        reportDate: latest.date,
        releaseDate: computeFridayReleaseDate(latest.date),
        history,
      } satisfies CotInstrument;
    })
  );

  const liveInstruments = results.filter(
    (item): item is CotInstrument => item !== null
  );

  const instruments =
    liveInstruments.length > 0
      ? liveInstruments
      : await loadPersistedCotInstruments();

  if (instruments.length === 0) {
    return emptyCftcResult("AWAITING_SYNC");
  }

  const reportDate = instruments[0].reportDate;
  const releaseDate = instruments[0].releaseDate;

  return {
    instruments,
    reportDate,
    releaseDate,
    meta: {
      source: "CFTC · Legacy & TFF Futures",
      seriesId: "COT-WEEKLY",
      observationDate: reportDate,
      releaseDate,
      lastUpdated: new Date().toISOString(),
      frequency: "WEEKLY",
      units: "Contracts",
      mode: "LIVE_API",
    },
  };
}
