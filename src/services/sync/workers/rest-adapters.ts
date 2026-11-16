import type { ProviderId } from "@/lib/sync/types";
import { fetchJsonWithTimeout } from "@/services/http";
import { getProviderConfig } from "@/services/sync/provider-registry";

export interface NormalizedFeedObservation {
  observationDate: string;
  publishedAt: string;
  value: number;
  previousValue: number | null;
  rawPayload: Record<string, unknown>;
}

export interface AdapterFetchResult {
  ok: boolean;
  configured: boolean;
  statusCode: number;
  reason?: string;
  items: NormalizedFeedObservation[];
  attempts: number;
  retryDelaysMs: number[];
}

export interface ProviderRetryResponse<T> {
  ok: boolean;
  statusCode: number;
  data?: T;
  reason?: string;
  attempts: number;
  retryDelaysMs: number[];
}

const FRED_ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BEA_API_URL = "https://apps.bea.gov/api/data";
const NYFED_BASE_URL = "https://markets.newyorkfed.org/api";
const TREASURY_AVG_RATES_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates";
const CFTC_SOCRATA_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared provider-aware HTTP JSON fetcher with exponential backoff + jitter
 * governed by PROVIDER_REGISTRY retryableStatusCodes, maxRetries, and timeoutMs.
 */
export async function fetchProviderJsonWithRetry<T>(
  providerId: ProviderId,
  url: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<ProviderRetryResponse<T>> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      statusCode: 0,
      reason: "server-only",
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const cfg = getProviderConfig(providerId);
  const maxRetries = Math.max(0, options.maxRetries ?? cfg.maxRetries);
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  const envBaseOverride = Number(process.env.MACROEDGE_RETRY_BASE_MS);
  const backoffBaseMs =
    options.backoffBaseMs ??
    (Number.isFinite(envBaseOverride) && envBaseOverride > 0
      ? envBaseOverride
      : cfg.rateLimit.backoffBaseMs);
  const backoffMaxMs = options.backoffMaxMs ?? cfg.rateLimit.backoffMaxMs;
  const sleepFn = options.sleepFn ?? defaultSleep;

  const retryDelaysMs: number[] = [];
  let lastStatus = 0;
  let lastReason = "unknown_error";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchJsonWithTimeout<T>(url, init, timeoutMs);
    if (res.ok) {
      return {
        ok: true,
        statusCode: res.status,
        data: res.data,
        attempts: attempt + 1,
        retryDelaysMs,
      };
    }

    lastStatus = res.status;
    lastReason = res.reason;

    const retryable =
      res.status === 0 || cfg.retryableStatusCodes.includes(res.status);
    if (!retryable || attempt >= maxRetries) {
      return {
        ok: false,
        statusCode: lastStatus,
        reason: lastReason,
        attempts: attempt + 1,
        retryDelaysMs,
      };
    }

    const expDelay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt);
    const delayMs = Math.max(5, Math.round(expDelay * (0.5 + Math.random() * 0.5)));
    retryDelaysMs.push(delayMs);
    await sleepFn(delayMs);
  }

  return {
    ok: false,
    statusCode: lastStatus,
    reason: lastReason,
    attempts: maxRetries + 1,
    retryDelaysMs,
  };
}

export function normalizePeriodToIsoDate(period: string): string | null {
  const trimmed = period.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return `${trimmed}-01`;
  }
  const qMatch = /^(\d{4})-?Q([1-4])$/i.exec(trimmed);
  if (qMatch) {
    const month = String((Number(qMatch[2]) - 1) * 3 + 1).padStart(2, "0");
    return `${qMatch[1]}-${month}-01`;
  }
  const beaM = /^(\d{4})M(0[1-9]|1[0-2])$/i.exec(trimmed);
  if (beaM) {
    return `${beaM[1]}-${beaM[2]}-01`;
  }
  return null;
}

export async function fetchFredObservationsForSync(params: {
  seriesId: string;
  unitsParam?: "lin" | "pc1" | "chg" | "pch";
  limit?: number;
  timeoutMs?: number;
}): Promise<AdapterFetchResult> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "missing_api_key",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const url = new URL(FRED_ENDPOINT);
  url.searchParams.set("series_id", params.seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(params.limit ?? 24));
  if (params.unitsParam) {
    url.searchParams.set("units", params.unitsParam);
  }

  interface FredPayload {
    error_code?: number;
    error_message?: string;
    observations?: {
      date?: string;
      value?: string;
      realtime_start?: string;
      realtime_end?: string;
    }[];
  }

  const res = await fetchProviderJsonWithRetry<FredPayload>(
    "fred",
    url.toString(),
    { cache: "no-store" },
    { timeoutMs: params.timeoutMs }
  );

  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }
  if (res.data.error_code !== undefined) {
    return {
      ok: false,
      configured: true,
      statusCode: 400,
      reason: res.data.error_message ?? "fred_error",
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const ascending = (res.data.observations ?? [])
    .filter(
      (r): r is { date: string; value: string; realtime_start?: string; realtime_end?: string } =>
        typeof r.date === "string" &&
        typeof r.value === "string" &&
        r.value.trim() !== "" &&
        r.value !== "." &&
        Number.isFinite(Number(r.value))
    )
    .map((r) => ({
      observationDate: normalizePeriodToIsoDate(r.date) ?? r.date,
      publishedAt: `${r.realtime_start || r.date}T13:30:00Z`,
      value: Number(r.value),
      rawPayload: {
        date: r.date,
        realtime_start: r.realtime_start ?? null,
        realtime_end: r.realtime_end ?? null,
      },
    }))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));

  const items: NormalizedFeedObservation[] = ascending.map((pt, idx) => ({
    ...pt,
    previousValue: idx > 0 ? ascending[idx - 1].value : null,
  }));

  return {
    ok: items.length > 0,
    configured: true,
    statusCode: res.statusCode,
    items,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}

export async function fetchBlsObservationsForSync(params: {
  seriesId: string;
  transform: "yoy" | "mom_diff" | "level";
  yearsBack?: number;
  timeoutMs?: number;
}): Promise<AdapterFetchResult> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const apiKey = process.env.BLS_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "missing_api_key",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const currentYear = new Date().getUTCFullYear();
  const startYear = currentYear - (params.yearsBack ?? 3);

  interface BlsPayload {
    status?: string;
    message?: string[];
    Results?: {
      series?: {
        data?: { year?: string; period?: string; value?: string; latest?: string }[];
      }[];
    };
  }

  const res = await fetchProviderJsonWithRetry<BlsPayload>(
    "bls",
    BLS_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: [params.seriesId],
        startyear: String(startYear),
        endyear: String(currentYear),
        registrationkey: apiKey,
      }),
      cache: "no-store",
    },
    { timeoutMs: params.timeoutMs }
  );

  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }
  if (res.data.status !== "REQUEST_SUCCEEDED") {
    return {
      ok: false,
      configured: true,
      statusCode: 400,
      reason: res.data.message?.[0] ?? "bls_request_failed",
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const monthly = (res.data.Results?.series?.[0]?.data ?? [])
    .filter(
      (r): r is { year: string; period: string; value: string; latest?: string } =>
        typeof r.year === "string" &&
        typeof r.period === "string" &&
        /^M(0[1-9]|1[0-2])$/.test(r.period) &&
        typeof r.value === "string" &&
        r.value.trim() !== "" &&
        Number.isFinite(Number(r.value))
    )
    .map((r) => ({
      ym: `${r.year}-${r.period.slice(1)}`,
      observationDate: `${r.year}-${r.period.slice(1)}-01`,
      rawValue: Number(r.value),
      latestFlag: r.latest === "true",
    }))
    .sort((a, b) => a.ym.localeCompare(b.ym));

  const byYm = new Map(monthly.map((m) => [m.ym, m]));
  const transformed: {
    observationDate: string;
    publishedAt: string;
    value: number;
    rawPayload: Record<string, unknown>;
  }[] = [];

  for (let i = 0; i < monthly.length; i++) {
    const pt = monthly[i];
    const yr = Number(pt.ym.slice(0, 4));
    const mo = Number(pt.ym.slice(5, 7));
    const releaseYear = mo === 12 ? yr + 1 : yr;
    const releaseMonth = String(mo === 12 ? 1 : mo + 1).padStart(2, "0");
    const publishedAt = `${releaseYear}-${releaseMonth}-12T13:30:00Z`;

    if (params.transform === "level") {
      transformed.push({
        observationDate: pt.observationDate,
        publishedAt,
        value: Number(pt.rawValue.toFixed(2)),
        rawPayload: { ym: pt.ym, rawIndex: pt.rawValue, latest: pt.latestFlag },
      });
    } else if (params.transform === "mom_diff") {
      if (i === 0) continue;
      const diff = pt.rawValue - monthly[i - 1].rawValue;
      transformed.push({
        observationDate: pt.observationDate,
        publishedAt,
        value: Math.round(diff),
        rawPayload: { ym: pt.ym, rawLevel: pt.rawValue, prevLevel: monthly[i - 1].rawValue },
      });
    } else {
      const yearAgoYm = `${yr - 1}-${pt.ym.slice(5, 7)}`;
      const yearAgo = byYm.get(yearAgoYm);
      if (!yearAgo || yearAgo.rawValue <= 0) continue;
      const yoy = Number((((pt.rawValue / yearAgo.rawValue) - 1) * 100).toFixed(2));
      transformed.push({
        observationDate: pt.observationDate,
        publishedAt,
        value: yoy,
        rawPayload: { ym: pt.ym, rawIndex: pt.rawValue, yearAgoIndex: yearAgo.rawValue },
      });
    }
  }

  const items: NormalizedFeedObservation[] = transformed.map((pt, idx) => ({
    ...pt,
    previousValue: idx > 0 ? transformed[idx - 1].value : null,
  }));

  return {
    ok: items.length > 0,
    configured: true,
    statusCode: res.statusCode,
    items,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}

export async function fetchBeaObservationsForSync(params: {
  tableName: string;
  frequency: "Q" | "M";
  lineNumber?: string;
  yearsBack?: number;
  timeoutMs?: number;
}): Promise<AdapterFetchResult> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const apiKey = process.env.BEA_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "missing_api_key",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const currentYear = new Date().getUTCFullYear();
  const yearsCount = params.yearsBack ?? 3;
  const years = Array.from({ length: yearsCount }, (_, i) => currentYear - yearsCount + 1 + i).join(",");

  const url = new URL(BEA_API_URL);
  url.searchParams.set("UserID", apiKey);
  url.searchParams.set("method", "GetData");
  url.searchParams.set("DataSetName", "NIPA");
  url.searchParams.set("TableName", params.tableName);
  url.searchParams.set("Frequency", params.frequency);
  url.searchParams.set("Year", years);
  url.searchParams.set("ResultFormat", "JSON");

  interface BeaPayload {
    BEAAPI?: {
      Error?: unknown;
      Results?: {
        Error?: unknown;
        Data?: { LineNumber?: string; DataValue?: string; TimePeriod?: string; LineDescription?: string }[];
      };
    };
  }

  const res = await fetchProviderJsonWithRetry<BeaPayload>(
    "bea",
    url.toString(),
    { cache: "no-store" },
    { timeoutMs: params.timeoutMs }
  );

  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }
  if (res.data.BEAAPI?.Error || res.data.BEAAPI?.Results?.Error) {
    return {
      ok: false,
      configured: true,
      statusCode: 400,
      reason: "bea_api_error",
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const targetLine = params.lineNumber ?? "1";
  const ascending = (res.data.BEAAPI?.Results?.Data ?? [])
    .filter(
      (r): r is { LineNumber: string; DataValue: string; TimePeriod: string; LineDescription?: string } =>
        r.LineNumber === targetLine &&
        typeof r.DataValue === "string" &&
        r.DataValue.trim() !== "" &&
        typeof r.TimePeriod === "string"
    )
    .map((r) => {
      const observationDate = normalizePeriodToIsoDate(r.TimePeriod);
      const value = Number(r.DataValue.replace(/,/g, ""));
      return {
        timePeriod: r.TimePeriod.trim(),
        observationDate,
        value,
        lineDesc: r.LineDescription ?? null,
      };
    })
    .filter(
      (r): r is { timePeriod: string; observationDate: string; value: number; lineDesc: string | null } =>
        r.observationDate !== null && Number.isFinite(r.value)
    )
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));

  const items: NormalizedFeedObservation[] = ascending.map((pt, idx) => ({
    observationDate: pt.observationDate,
    publishedAt: `${pt.observationDate}T13:30:00Z`,
    value: pt.value,
    previousValue: idx > 0 ? ascending[idx - 1].value : null,
    rawPayload: { timePeriod: pt.timePeriod, lineDescription: pt.lineDesc },
  }));

  return {
    ok: items.length > 0,
    configured: true,
    statusCode: res.statusCode,
    items,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}

export async function fetchNyFedReferenceRates(
  rateType: "effr" | "sofr",
  limit = 10,
  timeoutMs?: number
): Promise<AdapterFetchResult> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const endpoint =
    rateType === "effr"
      ? `${NYFED_BASE_URL}/rates/unsecured/effr/last/${limit}.json`
      : `${NYFED_BASE_URL}/rates/secured/sofr/last/${limit}.json`;

  interface NyFedPayload {
    refRates?: {
      effectiveDate?: string;
      type?: string;
      percentRate?: number;
      volumeInBillions?: number;
    }[];
  }

  const res = await fetchProviderJsonWithRetry<NyFedPayload>(
    "fed_reserve",
    endpoint,
    { cache: "no-store" },
    { timeoutMs }
  );
  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const ascending = (res.data.refRates ?? [])
    .filter(
      (r): r is { effectiveDate: string; type?: string; percentRate: number; volumeInBillions?: number } =>
        typeof r.effectiveDate === "string" &&
        typeof r.percentRate === "number" &&
        Number.isFinite(r.percentRate)
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const items: NormalizedFeedObservation[] = ascending.map((pt, idx) => ({
    observationDate: pt.effectiveDate.slice(0, 10),
    publishedAt: `${pt.effectiveDate.slice(0, 10)}T13:00:00Z`,
    value: pt.percentRate,
    previousValue: idx > 0 ? ascending[idx - 1].percentRate : null,
    rawPayload: {
      type: pt.type ?? rateType.toUpperCase(),
      volumeInBillions: pt.volumeInBillions ?? null,
    },
  }));

  return {
    ok: items.length > 0,
    configured: true,
    statusCode: res.statusCode,
    items,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}

export async function fetchTreasuryAvgInterestRates(
  timeoutMs?: number
): Promise<AdapterFetchResult> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  if (process.env.ENABLE_PUBLIC_TREASURY_LIVE?.trim() !== "true") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "public_treasury_disabled",
      items: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  interface TreasuryPayload {
    data?: {
      record_date?: string;
      security_desc?: string;
      avg_interest_rate_amt?: string;
    }[];
  }

  const res = await fetchProviderJsonWithRetry<TreasuryPayload>(
    "us_treasury",
    `${TREASURY_AVG_RATES_URL}?filter=security_desc:eq:Treasury%20Notes&sort=-record_date&page[size]=12`,
    { cache: "no-store" },
    { timeoutMs }
  );

  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      items: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const ascending = (res.data.data ?? [])
    .filter(
      (r): r is { record_date: string; security_desc?: string; avg_interest_rate_amt: string } =>
        typeof r.record_date === "string" &&
        typeof r.avg_interest_rate_amt === "string" &&
        r.avg_interest_rate_amt.trim() !== "" &&
        Number.isFinite(Number(r.avg_interest_rate_amt))
    )
    .map((r) => ({
      observationDate: r.record_date.slice(0, 10),
      publishedAt: `${r.record_date.slice(0, 10)}T16:00:00Z`,
      value: Number(r.avg_interest_rate_amt),
      rawPayload: { securityDesc: r.security_desc ?? "Treasury Notes" },
    }))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));

  const items: NormalizedFeedObservation[] = ascending.map((pt, idx) => ({
    ...pt,
    previousValue: idx > 0 ? ascending[idx - 1].value : null,
  }));

  return {
    ok: items.length > 0,
    configured: true,
    statusCode: res.statusCode,
    items,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}

export interface CftcSocrataRow {
  market_and_exchange_names?: string;
  cftc_contract_market_code?: string;
  report_date_as_yyyy_mm_dd?: string;
  noncomm_positions_long_all?: string;
  noncomm_positions_short_all?: string;
  comm_positions_long_all?: string;
  comm_positions_short_all?: string;
  nonrept_positions_long_all?: string;
  nonrept_positions_short_all?: string;
  open_interest_all?: string;
}

export async function fetchCftcLegacyContractRows(
  contractCode: string,
  limit = 156,
  timeoutMs?: number
): Promise<{
  ok: boolean;
  configured: boolean;
  statusCode: number;
  reason?: string;
  rows: CftcSocrataRow[];
  attempts: number;
  retryDelaysMs: number[];
}> {
  if (typeof window !== "undefined") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "server-only",
      rows: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  if (process.env.ENABLE_PUBLIC_CFTC_LIVE?.trim() !== "true") {
    return {
      ok: false,
      configured: false,
      statusCode: 0,
      reason: "public_cftc_disabled",
      rows: [],
      attempts: 0,
      retryDelaysMs: [],
    };
  }

  const url = new URL(CFTC_SOCRATA_URL);
  url.searchParams.set("cftc_contract_market_code", contractCode);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", String(limit));

  const res = await fetchProviderJsonWithRetry<CftcSocrataRow[]>(
    "cftc",
    url.toString(),
    { cache: "no-store" },
    { timeoutMs }
  );
  if (!res.ok || !res.data) {
    return {
      ok: false,
      configured: true,
      statusCode: res.statusCode,
      reason: res.reason,
      rows: [],
      attempts: res.attempts,
      retryDelaysMs: res.retryDelaysMs,
    };
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    ok: rows.length > 0,
    configured: true,
    statusCode: res.statusCode,
    rows,
    attempts: res.attempts,
    retryDelaysMs: res.retryDelaysMs,
  };
}
