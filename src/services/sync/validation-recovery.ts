import crypto from "node:crypto";
import type { DataCadence } from "@/lib/types";
import type {
  DataAnomalyRecord,
  DataHealthRecord,
  LatestValueRecord,
  MarketSymbol,
  ObservationRecord,
  ProviderId,
  SyncRunRecord,
  SyncRunStatus,
  SyncStatusType,
  TriggerType,
  UpsertMarketQuoteInput,
  UpsertObservationInput,
  UpsertObservationResult,
  ValidationStatus,
  WorkerId,
} from "@/lib/sync/types";
import {
  getMarketInstrumentMapping,
  getProviderConfig,
  getSeriesMapping,
  isProviderConfigured,
  listProviders,
  MACRO_SERIES_MAPPINGS,
  MARKET_INSTRUMENT_MAPPINGS,
  PROVIDER_REGISTRY,
} from "@/services/sync/provider-registry";
import {
  completeSyncRun,
  getLatestValues,
  getObservations,
  listAnomalies,
  listDataHealth,
  listSyncRuns,
  recordAnomaly,
  recordSyncRunStart,
  resolveAnomaly,
  updateDataHealth,
  upsertMacroObservation,
} from "@/services/sync/store";

export interface WorkerExecutionSummary {
  runId: string;
  workerId: WorkerId;
  providerId: ProviderId;
  status: SyncRunStatus;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsRejected?: number;
  anomaliesDetected: number;
  latencyMs: number;
  deadLetter?: boolean;
  error?: string;
}

export interface ObservationValidationInput {
  seriesKey: string;
  sourceId: ProviderId;
  externalSeriesId: string;
  observationDate: string;
  publishedAt?: string | null;
  value: number | string | null | undefined;
  previousValue?: number | null;
  unit: string;
  expectedUnit?: string;
  cadence?: DataCadence;
  sourceAttribution?: string;
  workerId?: WorkerId;
  status?: SyncStatusType;
  rawPayload?: Record<string, unknown>;
}

export interface ObservationValidationOptions {
  historicalObservations?: ObservationRecord[];
  latestValue?: LatestValueRecord | null;
  isBackfill?: boolean;
  persist?: boolean;
  rejectOnSuspect?: boolean;
  zScoreThreshold?: number;
  madThreshold?: number;
  crossSourceTolerancePct?: number;
}

export interface ObservationValidationResult {
  valid: boolean;
  validationStatus: ValidationStatus;
  normalized: UpsertObservationInput | null;
  reasons: string[];
  anomalies: DataAnomalyRecord[];
  isDuplicate: boolean;
  isRevision: boolean;
  isStale: boolean;
  gapDetected: boolean;
  monotonicRejected: boolean;
  canUpdateLatest: boolean;
  zScore: number | null;
  madScore: number | null;
  upsertResult?: UpsertObservationResult;
}

export interface MarketTickValidationInput {
  symbol: MarketSymbol | string;
  providerId: ProviderId;
  externalSymbol?: string;
  price: number | string | null | undefined;
  bid?: number | string | null;
  ask?: number | string | null;
  previousClose?: number | string | null;
  volume?: number | string | null;
  tickSeq?: number;
  quoteTimestamp: string | number;
  receivedAt?: string | number;
  rawPayload?: Record<string, unknown>;
}

export interface MarketTickValidationOptions {
  previousPrice?: number | null;
  maxStaleMs?: number;
  recordAnomalies?: boolean;
  workerId?: WorkerId;
}

export interface MarketTickValidationResult {
  valid: boolean;
  reason?: string;
  normalized: UpsertMarketQuoteInput | null;
  dedupKey: string;
  latencyMs: number;
  isStale: boolean;
  normalizedTimestamp: string | null;
  anomalies: DataAnomalyRecord[];
}

export interface RetryExecutionContext {
  runId: string;
  attempt: number;
  maxAttempts: number;
  signal: AbortSignal;
}

export interface RetryExecutionResult {
  status?: Exclude<SyncRunStatus, "RUNNING">;
  recordsFetched?: number;
  recordsValidated?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsSkipped?: number;
  recordsRejected?: number;
  anomaliesDetected?: number;
  errorMessage?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ExecuteWithRetryOptions {
  workerId: WorkerId;
  providerId: ProviderId;
  jobName: string;
  triggerType?: TriggerType;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  timeoutMs?: number;
  idempotencyKey?: string;
  idempotencyTtlMs?: number;
  force?: boolean;
  skipSourceHealthUpdate?: boolean;
  workerStatusOnSuccess?: SyncStatusType;
  rawPayload?: Record<string, unknown>;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface BackfillJobOptions {
  workerId?: WorkerId;
  providerId?: ProviderId;
  seriesKeys?: string[];
  symbols?: MarketSymbol[];
  startDate?: string;
  endDate?: string;
  trigger?: TriggerType;
}

export interface OrchestratorDispatchPayload {
  workerId?: WorkerId;
  providerId?: ProviderId;
  trigger?: TriggerType;
  force?: boolean;
  backfill?: boolean;
  seriesKeys?: string[];
  symbols?: MarketSymbol[];
}

export interface OrchestratorDispatchSummary {
  ok: boolean;
  trigger: TriggerType;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summaries: WorkerExecutionSummary[];
  errors: Array<{ workerId: WorkerId; providerId?: ProviderId; message: string }>;
}

type OrchestratorDispatcher = (
  options?: OrchestratorDispatchPayload
) => Promise<OrchestratorDispatchSummary>;

interface ProviderRateLimitWindow {
  lastRequestAtMs: number;
  requestTimestampsMs: number[];
  cooldownUntilMs: number;
}

interface IdempotencyEntry {
  expiresAtMs: number;
  promise?: Promise<WorkerExecutionSummary>;
  summary?: WorkerExecutionSummary;
}

declare global {
  var __macroedgeRateLimitWindows: Map<ProviderId, ProviderRateLimitWindow> | undefined;
  var __macroedgeIdempotencyCache: Map<string, IdempotencyEntry> | undefined;
  var __macroedgeOrchestratorDispatch: OrchestratorDispatcher | undefined;
}

function getRateLimitWindows(): Map<ProviderId, ProviderRateLimitWindow> {
  if (!globalThis.__macroedgeRateLimitWindows) {
    globalThis.__macroedgeRateLimitWindows = new Map();
  }
  return globalThis.__macroedgeRateLimitWindows;
}

function getIdempotencyCache(): Map<string, IdempotencyEntry> {
  if (!globalThis.__macroedgeIdempotencyCache) {
    globalThis.__macroedgeIdempotencyCache = new Map();
  }
  return globalThis.__macroedgeIdempotencyCache;
}

export function registerOrchestratorDispatcher(fn: OrchestratorDispatcher): void {
  globalThis.__macroedgeOrchestratorDispatch = fn;
}

async function resolveOrchestratorDispatch(): Promise<OrchestratorDispatcher> {
  if (globalThis.__macroedgeOrchestratorDispatch) {
    return globalThis.__macroedgeOrchestratorDispatch;
  }
  const mod = await import("@/services/sync/orchestrator");
  return mod.dispatchSyncJob;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ProviderRequestError extends Error {
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
  code: string;

  constructor(
    message: string,
    opts: {
      statusCode?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      code?: string;
    } = {}
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? true;
    this.retryAfterMs = opts.retryAfterMs;
    this.code = opts.code ?? (opts.statusCode ? `HTTP_${opts.statusCode}` : "TRANSPORT_ERROR");
  }
}

export function normalizeObservationDateUtc(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    if (year < 1900 || year > new Date().getUTCFullYear() + 2) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() + 1 !== month ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }
    return trimmed;
  }

  const ymMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ymMatch) {
    const year = Number(ymMatch[1]);
    const month = Number(ymMatch[2]);
    if (year < 1900 || year > new Date().getUTCFullYear() + 2 || month < 1 || month > 12) {
      return null;
    }
    return `${ymMatch[1]}-${ymMatch[2]}-01`;
  }

  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) return null;
  const dt = new Date(parsedMs);
  const year = dt.getUTCFullYear();
  if (year < 1900 || year > new Date().getUTCFullYear() + 2) return null;
  return dt.toISOString().slice(0, 10);
}

function defaultStaleSecondsForCadence(cadence: DataCadence): number {
  switch (cadence) {
    case "LIVE":
      return 300;
    case "DAILY":
      return 604_800; // 7 days (weekend + T+2/3 settlement lag for Treasury/FRED daily feeds)
    case "WEEKLY":
      return 1_296_000; // 15 days (weekly Fed H.4.1 / DOL / CFTC reporting lag)
    case "MONTHLY":
      return 6_480_000; // 75 days (month-start observationDate + next-month publication schedule)
    case "QUARTERLY":
      return 12_096_000; // 140 days (quarter-start observationDate + advance/final GDP release schedule)
    default:
      return 6_480_000;
  }
}

function resolveCadenceStaleThresholdSec(
  seriesKey: string,
  cadence: DataCadence,
  providerStaleAfterSec: number
): number {
  const seriesCfg = getSeriesMapping(seriesKey);
  return Math.max(
    seriesCfg?.staleAfterSeconds ?? providerStaleAfterSec,
    defaultStaleSecondsForCadence(cadence)
  );
}

export function normalizeTimestampUtc(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    // Heuristic: seconds vs milliseconds epoch
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const dt = new Date(ms);
    if (!Number.isFinite(dt.getTime()) || dt.getUTCFullYear() < 1970) return null;
    return dt.toISOString();
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const validDate = normalizeObservationDateUtc(trimmed);
    return validDate ? `${validDate}T00:00:00.000Z` : null;
  }

  // Handle pure numeric epoch strings
  if (/^\d{10}(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    return Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
  }
  if (/^\d{13}$/.test(trimmed)) {
    const ms = Number(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  // Normalize naive SQL timestamps like "2026-11-11 14:30:00" to UTC
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const candidate =
    !hasZone && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed;

  const parsedMs = Date.parse(candidate);
  if (!Number.isFinite(parsedMs)) return null;
  const dt = new Date(parsedMs);
  if (dt.getUTCFullYear() < 1900 || dt.getUTCFullYear() > new Date().getUTCFullYear() + 2) {
    return null;
  }
  return dt.toISOString();
}

function canonicalizeUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return "";
  if (["%", "pct", "percent", "percentage"].includes(normalized)) return "%";
  if (["% yoy", "pct yoy", "percent yoy", "% yo/y", "yoy %"].includes(normalized)) {
    return "% YoY";
  }
  if (["% qoq ann.", "pct qoq ann.", "% qoq annualized"].includes(normalized)) {
    return "% QoQ Ann.";
  }
  if (["bps", "basis points", "bp"].includes(normalized)) return "bps";
  if (["$m", "millions", "usd millions", "millions of dollars"].includes(normalized)) {
    return "$M";
  }
  if (["$b", "billions", "usd billions", "billions of dollars"].includes(normalized)) {
    return "$B";
  }
  if (["index", "idx", "pts", "points"].includes(normalized)) return "Index";
  if (["claims", "persons", "number"].includes(normalized)) return "Claims";
  if (["contracts"].includes(normalized)) return "Contracts";
  if (["usd", "dollars"].includes(normalized)) return "USD";
  if (["usd/oz", "usd / oz"].includes(normalized)) return "USD/oz";
  return unit.trim();
}

function normalizeUnitAndValue(
  rawValue: number,
  rawUnit: string,
  expectedUnit?: string
): { ok: boolean; value: number; unit: string; reason?: string } {
  const canonicalInput = canonicalizeUnit(rawUnit);
  const canonicalExpected = expectedUnit ? canonicalizeUnit(expectedUnit) : "";

  if (!canonicalExpected || canonicalInput === canonicalExpected) {
    return {
      ok: true,
      value: rawValue,
      unit: canonicalExpected || canonicalInput || rawUnit.trim(),
    };
  }

  // Deterministic, unambiguous conversions
  if (canonicalInput === "bps" && canonicalExpected === "%") {
    return { ok: true, value: Number((rawValue / 100).toFixed(6)), unit: "%" };
  }
  if (canonicalInput === "$B" && canonicalExpected === "$M") {
    return { ok: true, value: Number((rawValue * 1000).toFixed(4)), unit: "$M" };
  }
  if (canonicalInput === "%" && (canonicalExpected === "% YoY" || canonicalExpected === "% QoQ Ann.")) {
    return { ok: true, value: rawValue, unit: canonicalExpected };
  }
  if (
    canonicalExpected === "Claims" &&
    ["thousands", "k", "thousands of claims"].includes(rawUnit.trim().toLowerCase())
  ) {
    return { ok: true, value: Math.round(rawValue * 1000), unit: "Claims" };
  }

  return {
    ok: false,
    value: rawValue,
    unit: canonicalInput || rawUnit.trim(),
    reason: `Unexpected unit "${rawUnit}" (expected "${expectedUnit}")`,
  };
}

function median(sortedValues: number[]): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedValues[mid];
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

function computeOutlierStats(
  value: number,
  baseline: number[]
): { zScore: number | null; madScore: number | null } {
  if (baseline.length < 5) {
    return { zScore: null, madScore: null };
  }

  const mean = baseline.reduce((acc, v) => acc + v, 0) / baseline.length;
  const variance =
    baseline.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (baseline.length - 1);
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 1e-9 ? (value - mean) / stdDev : null;

  const sorted = [...baseline].sort((a, b) => a - b);
  const med = median(sorted);
  const absDevs = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(absDevs);
  const madScore = mad > 1e-9 ? (0.6745 * (value - med)) / mad : null;

  return { zScore, madScore };
}

function maxExpectedGapDays(cadence: DataCadence): number {
  switch (cadence) {
    case "LIVE":
    case "DELAYED":
    case "DAILY":
      return 7; // weekend + holiday buffer
    case "WEEKLY":
      return 16;
    case "MONTHLY":
      return 48;
    case "QUARTERLY":
      return 125;
  }
}

function parseNumericField(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "." || trimmed.toLowerCase() === "nan") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  // Redact any potential query-string secret keys if accidentally echoed
  return raw.replace(/(api_key|apikey|token|key|secret)=([^&\s]+)/gi, "$1=[REDACTED]").slice(0, 400);
}

/**
 * Validates and normalizes an incoming macroeconomic/liquidity/positioning observation.
 * Performs missing/NaN checks, UTC normalization, unit verification, duplicate/revision
 * checks, cross-source consistency checks, MAD/Z-score outlier detection, gap/staleness
 * checks, anomaly logging, and monotonic latest enforcement.
 */
export async function validateAndNormalizeObservation(
  input: ObservationValidationInput,
  options: ObservationValidationOptions = {}
): Promise<ObservationValidationResult> {
  const workerId = input.workerId ?? "validation-recovery";
  const mapping = getSeriesMapping(input.seriesKey);
  const cadence = input.cadence ?? mapping?.cadence ?? "DAILY";
  const expectedUnit = input.expectedUnit ?? mapping?.unit;
  const reasons: string[] = [];
  const anomalies: DataAnomalyRecord[] = [];

  const fail = (
    validationStatus: ValidationStatus = "REJECTED",
    extra: Partial<ObservationValidationResult> = {}
  ): ObservationValidationResult => ({
    valid: false,
    validationStatus,
    normalized: null,
    reasons,
    anomalies,
    isDuplicate: false,
    isRevision: false,
    isStale: false,
    gapDetected: false,
    monotonicRejected: false,
    canUpdateLatest: false,
    zScore: null,
    madScore: null,
    ...extra,
  });

  // 1. Missing / NaN value check
  const parsedValue = parseNumericField(input.value);
  if (parsedValue === null) {
    const msg = `Missing or non-finite numeric value for ${input.seriesKey}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "WARN",
        anomalyType: "MISSING_FIELD",
        message: msg,
        observedValue: input.value === undefined ? "undefined" : String(input.value),
        expectedRange: mapping ? `[${mapping.minValidValue}, ${mapping.maxValidValue}]` : null,
        rawPayload: input.rawPayload,
      })
    );
    return fail("REJECTED");
  }

  // 2. Timestamp & UTC normalization
  const normalizedObsDate = normalizeObservationDateUtc(input.observationDate);
  if (!normalizedObsDate) {
    const msg = `Invalid observationDate "${input.observationDate}" for ${input.seriesKey}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "ERROR",
        anomalyType: "SCHEMA_MISMATCH",
        message: msg,
        observedValue: String(input.observationDate),
        expectedRange: "YYYY-MM-DD (UTC)",
        rawPayload: input.rawPayload,
      })
    );
    return fail("REJECTED");
  }

  const normalizedPublishedAt = normalizeTimestampUtc(input.publishedAt);
  if (!normalizedPublishedAt) {
    const msg = `Missing or invalid publishedAt timestamp for ${input.seriesKey} @ ${normalizedObsDate}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "WARN",
        anomalyType: "MISSING_FIELD",
        message: msg,
        observedValue: String(input.publishedAt ?? "null"),
        expectedRange: "ISO-8601 UTC timestamp",
        rawPayload: input.rawPayload,
      })
    );
    return fail("REJECTED");
  }

  // 3. Unit normalization & mismatch detection
  const unitCheck = normalizeUnitAndValue(parsedValue, input.unit, expectedUnit);
  if (!unitCheck.ok) {
    const msg = `${unitCheck.reason} for ${input.seriesKey}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "ERROR",
        anomalyType: "SCHEMA_MISMATCH",
        message: msg,
        observedValue: `${parsedValue} ${input.unit}`,
        expectedRange: expectedUnit ?? null,
        rawPayload: input.rawPayload,
      })
    );
    return fail("REJECTED");
  }

  const numericValue = unitCheck.value;
  const normalizedUnit = unitCheck.unit;

  // 4. Hard range bounds check
  if (
    mapping &&
    (numericValue < mapping.minValidValue || numericValue > mapping.maxValidValue)
  ) {
    const msg = `Value ${numericValue} out of hard bounds [${mapping.minValidValue}, ${mapping.maxValidValue}] for ${input.seriesKey}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "ERROR",
        anomalyType: "OUTLIER_SPIKE",
        message: msg,
        observedValue: String(numericValue),
        expectedRange: `[${mapping.minValidValue}, ${mapping.maxValidValue}]`,
        rawPayload: input.rawPayload,
      })
    );
    return fail("REJECTED");
  }

  // 5. Load historical series & latest value from store
  const history =
    options.historicalObservations ?? (await getObservations(input.seriesKey, 120));
  const seriesHistory = history.filter((o) => o.seriesKey === input.seriesKey);
  const existingLatest =
    options.latestValue !== undefined
      ? options.latestValue
      : (await getLatestValues()).find((v) => v.seriesKey === input.seriesKey) ?? null;

  // 6. Monotonic vintage & duplicate/revision check
  const existingVintage = seriesHistory.find(
    (o) =>
      o.sourceId === input.sourceId &&
      o.observationDate === normalizedObsDate &&
      o.isLatest
  );

  let isDuplicate = false;
  let isRevision = false;

  if (existingVintage) {
    if (normalizedPublishedAt < existingVintage.publishedAt) {
      const msg = `Rejected older vintage (${normalizedPublishedAt} < ${existingVintage.publishedAt}) for ${input.seriesKey} @ ${normalizedObsDate}`;
      reasons.push(msg);
      anomalies.push(
        await recordAnomaly({
          seriesKey: input.seriesKey,
          sourceId: input.sourceId,
          workerId,
          severity: "WARN",
          anomalyType: "NON_MONOTONIC_REJECTED",
          message: msg,
          observedValue: String(numericValue),
          expectedRange: `publishedAt >= ${existingVintage.publishedAt}`,
          rawPayload: {
            incomingPublishedAt: normalizedPublishedAt,
            existingPublishedAt: existingVintage.publishedAt,
          },
        })
      );
      return fail("REJECTED", { monotonicRejected: true, canUpdateLatest: false });
    }

    if (
      Math.abs(numericValue - existingVintage.value) < 1e-12 &&
      normalizedUnit === existingVintage.unit
    ) {
      isDuplicate = true;
    } else {
      isRevision = true;
    }
  }

  // Monotonic latest guard against existing latest_values
  let canUpdateLatest = true;
  if (existingLatest) {
    if (normalizedObsDate < existingLatest.observationDate) {
      canUpdateLatest = false;
    } else if (
      normalizedObsDate === existingLatest.observationDate &&
      normalizedPublishedAt < existingLatest.publishedAt
    ) {
      const msg = `Monotonic latest guard rejected older publishedAt (${normalizedPublishedAt} < ${existingLatest.publishedAt}) for ${input.seriesKey} @ ${normalizedObsDate}`;
      reasons.push(msg);
      anomalies.push(
        await recordAnomaly({
          seriesKey: input.seriesKey,
          sourceId: input.sourceId,
          workerId,
          severity: "WARN",
          anomalyType: "NON_MONOTONIC_REJECTED",
          message: msg,
          observedValue: String(numericValue),
          expectedRange: `publishedAt >= ${existingLatest.publishedAt}`,
          rawPayload: {
            observationDate: normalizedObsDate,
            incomingPublishedAt: normalizedPublishedAt,
            latestPublishedAt: existingLatest.publishedAt,
          },
        })
      );
      return fail("REJECTED", { monotonicRejected: true, canUpdateLatest: false });
    }
  }

  // 7. Cross-source consistency check
  const otherSourceSameDate = seriesHistory.find(
    (o) =>
      o.observationDate === normalizedObsDate &&
      o.sourceId !== input.sourceId &&
      o.isLatest &&
      o.unit === normalizedUnit
  );
  if (otherSourceSameDate) {
    const diff = Math.abs(numericValue - otherSourceSameDate.value);
    const relDiff = diff / Math.max(Math.abs(otherSourceSameDate.value), 1);
    const tolerance = options.crossSourceTolerancePct ?? 0.05;
    if (relDiff > tolerance && diff > 0.25) {
      const msg = `Cross-source divergence for ${input.seriesKey} @ ${normalizedObsDate}: ${input.sourceId}=${numericValue} vs ${otherSourceSameDate.sourceId}=${otherSourceSameDate.value}`;
      reasons.push(msg);
      anomalies.push(
        await recordAnomaly({
          seriesKey: input.seriesKey,
          sourceId: input.sourceId,
          workerId,
          severity: "WARN",
          anomalyType: "SCHEMA_MISMATCH",
          message: msg,
          observedValue: String(numericValue),
          expectedRange: `~${otherSourceSameDate.value} (${otherSourceSameDate.sourceId})`,
          rawPayload: {
            otherSourceId: otherSourceSameDate.sourceId,
            otherValue: otherSourceSameDate.value,
          },
        })
      );
    }
  }

  // 8. MAD / Z-score outlier & step check
  const baselinePoints = seriesHistory
    .filter(
      (o) =>
        o.validationStatus === "VALIDATED" &&
        o.isLatest &&
        o.observationDate !== normalizedObsDate
    )
    .sort((a, b) => b.observationDate.localeCompare(a.observationDate));

  const baselineValues = baselinePoints.map((o) => o.value);
  const { zScore, madScore } = computeOutlierStats(numericValue, baselineValues);

  const priorPoint = baselinePoints.find((o) => o.observationDate < normalizedObsDate);
  const stepAbs = priorPoint ? Math.abs(numericValue - priorPoint.value) : null;

  const zThresh = options.zScoreThreshold ?? 4.5;
  const madThresh = options.madThreshold ?? 4.5;

  const isSevereStatisticalOutlier =
    (madScore !== null && Math.abs(madScore) > madThresh * 1.6) ||
    (zScore !== null && Math.abs(zScore) > zThresh * 1.6) ||
    (mapping?.maxStepAbs !== undefined &&
      stepAbs !== null &&
      stepAbs > mapping.maxStepAbs * 2);

  const isModerateOutlier =
    !isSevereStatisticalOutlier &&
    ((madScore !== null && Math.abs(madScore) > madThresh) ||
      (zScore !== null && Math.abs(zScore) > zThresh) ||
      (mapping?.maxStepAbs !== undefined &&
        stepAbs !== null &&
        stepAbs > mapping.maxStepAbs));

  let validationStatus: ValidationStatus = "VALIDATED";

  if (isSevereStatisticalOutlier) {
    validationStatus = "REJECTED";
    const msg = `Severe statistical outlier rejected for ${input.seriesKey} @ ${normalizedObsDate}: val=${numericValue}, z=${zScore?.toFixed(2) ?? "n/a"}, mad=${madScore?.toFixed(2) ?? "n/a"}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "ERROR",
        anomalyType: "OUTLIER_SPIKE",
        message: msg,
        observedValue: String(numericValue),
        expectedRange: priorPoint ? `prior=${priorPoint.value}` : null,
        rawPayload: { zScore, madScore, stepAbs },
      })
    );
    return fail("REJECTED", {
      zScore,
      madScore,
      isRevision,
      isDuplicate,
      canUpdateLatest: false,
    });
  }

  if (isModerateOutlier) {
    validationStatus = "SUSPECT";
    canUpdateLatest = false; // Never promote unverified suspect spikes into latest_values
    const msg = `Suspect outlier flagged for ${input.seriesKey} @ ${normalizedObsDate}: val=${numericValue}, z=${zScore?.toFixed(2) ?? "n/a"}, mad=${madScore?.toFixed(2) ?? "n/a"}`;
    reasons.push(msg);
    anomalies.push(
      await recordAnomaly({
        seriesKey: input.seriesKey,
        sourceId: input.sourceId,
        workerId,
        severity: "WARN",
        anomalyType: "OUTLIER_SPIKE",
        message: msg,
        observedValue: String(numericValue),
        expectedRange: priorPoint ? `prior=${priorPoint.value}` : null,
        rawPayload: { zScore, madScore, stepAbs },
      })
    );

    if (options.rejectOnSuspect) {
      return fail("SUSPECT", {
        zScore,
        madScore,
        isRevision,
        isDuplicate,
        canUpdateLatest: false,
      });
    }
  }

  // 9. Gap detection & stale check
  let gapDetected = false;
  if (priorPoint) {
    const gapMs =
      Date.parse(`${normalizedObsDate}T00:00:00Z`) -
      Date.parse(`${priorPoint.observationDate}T00:00:00Z`);
    const gapDays = gapMs / 86_400_000;
    const allowedGapDays = maxExpectedGapDays(cadence);
    if (gapDays > allowedGapDays) {
      gapDetected = true;
      const msg = `Observation gap of ${Math.round(gapDays)}d detected for ${input.seriesKey} (${priorPoint.observationDate} -> ${normalizedObsDate})`;
      reasons.push(msg);
      if (!options.isBackfill) {
        anomalies.push(
          await recordAnomaly({
            seriesKey: input.seriesKey,
            sourceId: input.sourceId,
            workerId,
            severity: "INFO",
            anomalyType: "STALE_DATA",
            message: msg,
            observedValue: normalizedObsDate,
            expectedRange: `<= ${allowedGapDays}d since ${priorPoint.observationDate}`,
            rawPayload: { gapDays, priorDate: priorPoint.observationDate },
          })
        );
      }
    }
  }

  const providerCfg = getProviderConfig(input.sourceId);
  const staleThresholdSec = resolveCadenceStaleThresholdSec(
    input.seriesKey,
    cadence,
    providerCfg.staleAfterSeconds
  );
  const ageSeconds = Math.max(
    0,
    (Date.now() - Date.parse(normalizedPublishedAt)) / 1000
  );
  const isStale = !options.isBackfill && ageSeconds > staleThresholdSec;

  // Periodic economic data is NEVER marked LIVE
  let resolvedStatus: SyncStatusType = input.status ?? "CURRENT";
  if (providerCfg.transport !== "websocket" && resolvedStatus === "LIVE") {
    resolvedStatus = "CURRENT";
  }
  if (isStale && resolvedStatus === "CURRENT") {
    resolvedStatus = "STALE";
  }

  const resolvedPreviousValue =
    input.previousValue !== undefined
      ? input.previousValue
      : priorPoint
      ? priorPoint.value
      : null;

  const normalized: UpsertObservationInput = {
    seriesKey: input.seriesKey,
    sourceId: input.sourceId,
    externalSeriesId: input.externalSeriesId,
    observationDate: normalizedObsDate,
    publishedAt: normalizedPublishedAt,
    value: numericValue,
    previousValue: resolvedPreviousValue,
    unit: normalizedUnit,
    cadence,
    sourceAttribution:
      input.sourceAttribution ?? mapping?.sourceAttribution ?? providerCfg.attribution,
    status: resolvedStatus,
    validationStatus,
    rawPayload: {
      ...(input.rawPayload ?? {}),
      validatedAt: new Date().toISOString(),
      zScore,
      madScore,
      isRevision,
      gapDetected,
    },
    workerId,
  };

  let upsertResult: UpsertObservationResult | undefined;
  if (options.persist && validationStatus === "VALIDATED") {
    upsertResult = await upsertMacroObservation(normalized);
    if (!upsertResult.accepted && upsertResult.status === "REJECTED_OLDER_VINTAGE") {
      return {
        valid: false,
        validationStatus: "REJECTED",
        normalized,
        reasons: [...reasons, "Rejected older vintage by store"],
        anomalies,
        isDuplicate,
        isRevision,
        isStale,
        gapDetected,
        monotonicRejected: true,
        canUpdateLatest: false,
        zScore,
        madScore,
        upsertResult,
      };
    }
  }

  return {
    valid: true,
    validationStatus,
    normalized,
    reasons,
    anomalies,
    isDuplicate,
    isRevision,
    isStale,
    gapDetected,
    monotonicRejected: false,
    canUpdateLatest,
    zScore,
    madScore,
    upsertResult,
  };
}

/**
 * Validates and normalizes a real-time or delayed market tick.
 * Computes latency and deterministic dedup key `provider:symbol:timestamp:price`.
 */
export async function validateMarketTick(
  input: MarketTickValidationInput,
  options: MarketTickValidationOptions = {}
): Promise<MarketTickValidationResult> {
  const workerId = options.workerId ?? "market-engine";
  const anomalies: DataAnomalyRecord[] = [];
  const symbolStr = String(input.symbol).trim().toUpperCase();

  if (!(symbolStr in MARKET_INSTRUMENT_MAPPINGS)) {
    return {
      valid: false,
      reason: `Unsupported market symbol "${input.symbol}"`,
      normalized: null,
      dedupKey: `${input.providerId}:${symbolStr}:invalid:0`,
      latencyMs: 0,
      isStale: false,
      normalizedTimestamp: null,
      anomalies,
    };
  }

  const symbol = symbolStr as MarketSymbol;
  const mapping = getMarketInstrumentMapping(symbol);
  const providerCfg = getProviderConfig(input.providerId);

  const normalizedTimestamp = normalizeTimestampUtc(input.quoteTimestamp);
  if (!normalizedTimestamp) {
    const reason = `Invalid UTC quoteTimestamp for ${symbol}`;
    if (options.recordAnomalies) {
      anomalies.push(
        await recordAnomaly({
          seriesKey: `MARKET_${symbol}`,
          sourceId: input.providerId,
          workerId,
          severity: "WARN",
          anomalyType: "SCHEMA_MISMATCH",
          message: reason,
          observedValue: String(input.quoteTimestamp),
          expectedRange: "ISO-8601 UTC",
          rawPayload: input.rawPayload,
        })
      );
    }
    return {
      valid: false,
      reason,
      normalized: null,
      dedupKey: `${input.providerId}:${symbol}:invalid:0`,
      latencyMs: 0,
      isStale: false,
      normalizedTimestamp: null,
      anomalies,
    };
  }

  const price = parseNumericField(input.price);
  if (price === null || price <= 0) {
    const reason = `Non-finite or non-positive price for ${symbol}`;
    if (options.recordAnomalies) {
      anomalies.push(
        await recordAnomaly({
          seriesKey: `MARKET_${symbol}`,
          sourceId: input.providerId,
          workerId,
          severity: "WARN",
          anomalyType: "MISSING_FIELD",
          message: reason,
          observedValue: String(input.price ?? "null"),
          expectedRange: `> 0`,
          rawPayload: input.rawPayload,
        })
      );
    }
    return {
      valid: false,
      reason,
      normalized: null,
      dedupKey: `${input.providerId}:${symbol}:${normalizedTimestamp}:${String(input.price ?? "NaN")}`,
      latencyMs: 0,
      isStale: false,
      normalizedTimestamp,
      anomalies,
    };
  }

  const dedupKey = `${input.providerId}:${symbol}:${normalizedTimestamp}:${price}`;

  const receivedIso =
    options && input.receivedAt !== undefined
      ? normalizeTimestampUtc(input.receivedAt)
      : new Date().toISOString();
  const receivedMs = receivedIso ? Date.parse(receivedIso) : Date.now();
  const quoteMs = Date.parse(normalizedTimestamp);
  const latencyMs = Math.max(0, receivedMs - quoteMs);

  // Guard against future clock-skew ticks (> 2 minutes ahead)
  if (quoteMs - receivedMs > 120_000) {
    return {
      valid: false,
      reason: `Future quoteTimestamp (${normalizedTimestamp}) exceeds clock skew tolerance`,
      normalized: null,
      dedupKey,
      latencyMs: 0,
      isStale: false,
      normalizedTimestamp,
      anomalies,
    };
  }

  const maxStaleMs = options.maxStaleMs ?? providerCfg.staleAfterSeconds * 1000;
  const isStale = receivedMs - quoteMs > maxStaleMs;
  if (isStale) {
    return {
      valid: false,
      reason: `Stale market tick (${Math.round((receivedMs - quoteMs) / 1000)}s old > ${Math.round(maxStaleMs / 1000)}s)`,
      normalized: null,
      dedupKey,
      latencyMs,
      isStale: true,
      normalizedTimestamp,
      anomalies,
    };
  }

  if (price < mapping.minValidValue || price > mapping.maxValidValue) {
    const reason = `Price ${price} out of valid range [${mapping.minValidValue}, ${mapping.maxValidValue}] for ${symbol}`;
    if (options.recordAnomalies) {
      anomalies.push(
        await recordAnomaly({
          seriesKey: `MARKET_${symbol}`,
          sourceId: input.providerId,
          workerId,
          severity: "ERROR",
          anomalyType: "OUTLIER_SPIKE",
          message: reason,
          observedValue: String(price),
          expectedRange: `[${mapping.minValidValue}, ${mapping.maxValidValue}]`,
          rawPayload: input.rawPayload,
        })
      );
    }
    return {
      valid: false,
      reason,
      normalized: null,
      dedupKey,
      latencyMs,
      isStale: false,
      normalizedTimestamp,
      anomalies,
    };
  }

  if (
    options.previousPrice !== undefined &&
    options.previousPrice !== null &&
    options.previousPrice > 0
  ) {
    const stepPct =
      (Math.abs(price - options.previousPrice) / options.previousPrice) * 100;
    if (stepPct > mapping.maxStepPct) {
      const reason = `Tick spike ${stepPct.toFixed(2)}% exceeds maxStepPct ${mapping.maxStepPct}% for ${symbol}`;
      if (options.recordAnomalies) {
        anomalies.push(
          await recordAnomaly({
            seriesKey: `MARKET_${symbol}`,
            sourceId: input.providerId,
            workerId,
            severity: "WARN",
            anomalyType: "OUTLIER_SPIKE",
            message: reason,
            observedValue: String(price),
            expectedRange: `${options.previousPrice} +/- ${mapping.maxStepPct}%`,
            rawPayload: { previousPrice: options.previousPrice, stepPct },
          })
        );
      }
      return {
        valid: false,
        reason,
        normalized: null,
        dedupKey,
        latencyMs,
        isStale: false,
        normalizedTimestamp,
        anomalies,
      };
    }
  }

  const bid = input.bid !== undefined && input.bid !== null ? parseNumericField(input.bid) : null;
  const ask = input.ask !== undefined && input.ask !== null ? parseNumericField(input.ask) : null;
  if (bid !== null && ask !== null && (bid <= 0 || ask <= 0 || ask < bid)) {
    return {
      valid: false,
      reason: `Invalid bid/ask spread (${bid}/${ask}) for ${symbol}`,
      normalized: null,
      dedupKey,
      latencyMs,
      isStale: false,
      normalizedTimestamp,
      anomalies,
    };
  }

  const previousClose =
    input.previousClose !== undefined && input.previousClose !== null
      ? parseNumericField(input.previousClose)
      : null;
  const volume =
    input.volume !== undefined && input.volume !== null
      ? parseNumericField(input.volume)
      : null;

  const changeValue =
    previousClose !== null ? Number((price - previousClose).toFixed(6)) : 0;
  const changePct =
    previousClose !== null && previousClose !== 0
      ? Number((((price - previousClose) / previousClose) * 100).toFixed(4))
      : 0;

  const normalized: UpsertMarketQuoteInput = {
    symbol,
    sourceId: input.providerId,
    externalSymbol:
      input.externalSymbol ?? mapping.externalSymbols[input.providerId] ?? symbol,
    assetClass: mapping.assetClass,
    price,
    bid,
    ask,
    previousClose,
    changeValue,
    changePct,
    volume: volume !== null && volume >= 0 ? volume : null,
    unit: mapping.unit,
    tickSeq: input.tickSeq ?? 0,
    quoteTimestamp: normalizedTimestamp,
    status: providerCfg.transport === "websocket" ? "LIVE" : "CURRENT",
    rawPayload: {
      ...(input.rawPayload ?? {}),
      dedupKey,
      latencyMs,
    },
  };

  return {
    valid: true,
    normalized,
    dedupKey,
    latencyMs,
    isStale: false,
    normalizedTimestamp,
    anomalies,
  };
}

async function waitForRateLimitSlot(
  providerId: ProviderId,
  sleepFn: (ms: number) => Promise<void>
): Promise<void> {
  const cfg = getProviderConfig(providerId);
  const windows = getRateLimitWindows();
  const state = windows.get(providerId) ?? {
    lastRequestAtMs: 0,
    requestTimestampsMs: [],
    cooldownUntilMs: 0,
  };
  windows.set(providerId, state);

  const now = Date.now();
  if (state.cooldownUntilMs > now) {
    const waitMs = Math.min(state.cooldownUntilMs - now, cfg.rateLimit.backoffMaxMs);
    await sleepFn(waitMs);
  }

  const afterCooldown = Date.now();
  const spacingWait =
    state.lastRequestAtMs > 0
      ? state.lastRequestAtMs + cfg.rateLimit.minSpacingMs - afterCooldown
      : 0;
  if (spacingWait > 0) {
    await sleepFn(spacingWait);
  }

  const windowStart = Date.now() - 60_000;
  state.requestTimestampsMs = state.requestTimestampsMs.filter((t) => t > windowStart);
  if (state.requestTimestampsMs.length >= cfg.rateLimit.requestsPerMinute) {
    const oldest = state.requestTimestampsMs[0];
    const rpmWait = Math.max(50, oldest + 60_000 - Date.now());
    await sleepFn(Math.min(rpmWait, cfg.rateLimit.backoffMaxMs));
  }

  const stamp = Date.now();
  state.lastRequestAtMs = stamp;
  state.requestTimestampsMs.push(stamp);
}

/**
 * Executes a sync task with per-provider rate-limit awareness, exponential backoff + jitter,
 * idempotency deduplication, sync_runs lifecycle tracking, and dead-letter persistence.
 */
export async function executeWithRetry(
  options: ExecuteWithRetryOptions,
  fn: (ctx: RetryExecutionContext) => Promise<RetryExecutionResult>
): Promise<WorkerExecutionSummary> {
  const cfg = getProviderConfig(options.providerId);
  const maxAttempts = Math.max(1, options.maxAttempts ?? cfg.maxRetries + 1);
  const backoffBaseMs = options.backoffBaseMs ?? cfg.rateLimit.backoffBaseMs;
  const backoffMaxMs = options.backoffMaxMs ?? cfg.rateLimit.backoffMaxMs;
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  const sleepFn = options.sleepFn ?? defaultSleep;

  const cache = getIdempotencyCache();
  if (options.idempotencyKey && !options.force) {
    const existing = cache.get(options.idempotencyKey);
    if (existing) {
      if (existing.promise) {
        return existing.promise;
      }
      if (existing.summary && existing.expiresAtMs > Date.now()) {
        return {
          ...existing.summary,
          recordsSkipped: existing.summary.recordsSkipped + 1,
        };
      }
    }
  }

  const executePromise = (async (): Promise<WorkerExecutionSummary> => {
    const startedMs = Date.now();
    const run = await recordSyncRunStart({
      workerId: options.workerId,
      sourceId: options.providerId,
      jobName: options.jobName,
      triggerType: options.triggerType ?? "scheduled",
      attempt: 1,
      maxAttempts,
      rawPayload: {
        ...(options.rawPayload ?? {}),
        idempotencyKey: options.idempotencyKey ?? null,
      },
    });

    const retryDelaysMs: number[] = [];
    let lastError: unknown = null;
    let lastErrorCode = "EXECUTION_FAILED";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await waitForRateLimitSlot(options.providerId, sleepFn);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await fn({
          runId: run.id,
          attempt,
          maxAttempts,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const recordsInserted = result.recordsInserted ?? 0;
        const recordsUpdated = result.recordsUpdated ?? 0;
        const recordsSkipped = result.recordsSkipped ?? 0;
        const recordsFetched =
          result.recordsFetched ?? recordsInserted + recordsUpdated + recordsSkipped;
        const recordsValidated =
          result.recordsValidated ?? recordsInserted + recordsUpdated;
        const anomaliesDetected = result.anomaliesDetected ?? 0;
        const latencyMs = Math.max(0, Date.now() - startedMs);
        const finalStatus = result.status ?? "SUCCEEDED";
        const isFailureResult = finalStatus === "FAILED" || finalStatus === "DEAD_LETTER";
        const isPartialResult = finalStatus === "PARTIAL";

        await completeSyncRun(run.id, {
          status: finalStatus,
          recordsFetched,
          recordsValidated,
          recordsUpserted: recordsInserted + recordsUpdated,
          recordsRejected: result.recordsRejected ?? recordsSkipped,
          errorMessage: isFailureResult
            ? result.errorMessage ?? `Worker reported ${finalStatus}`
            : result.errorMessage ?? null,
          deadLettered: finalStatus === "DEAD_LETTER",
          rawPayload: {
            ...(options.rawPayload ?? {}),
            ...(result.rawPayload ?? {}),
            attempts: attempt,
            retryDelaysMs,
          },
        });

        const healthyStatus: SyncStatusType =
          cfg.transport === "websocket" ? "LIVE" : "CURRENT";
        const mappedStatus: SyncStatusType = isFailureResult
          ? "FAILED"
          : isPartialResult
          ? "DELAYED"
          : healthyStatus;
        const workerStatus: SyncStatusType = isFailureResult
          ? "FAILED"
          : isPartialResult
          ? "DELAYED"
          : options.workerStatusOnSuccess ?? (healthyStatus === "LIVE" ? "LIVE" : "CURRENT");

        let nextConsecutiveFailures = 0;
        if (isFailureResult) {
          const healthRows = await listDataHealth();
          const existingSourceHealth = healthRows.find(
            (h) => h.id === `source:${options.providerId}`
          );
          const existingWorkerHealth = healthRows.find(
            (h) => h.id === `worker:${options.workerId}`
          );
          nextConsecutiveFailures =
            Math.max(
              existingSourceHealth?.consecutiveFailures ?? 0,
              existingWorkerHealth?.consecutiveFailures ?? 0
            ) + 1;
        }

        const attemptIso = new Date().toISOString();

        if (!options.skipSourceHealthUpdate) {
          await updateDataHealth({
            id: `source:${options.providerId}`,
            entityType: "source",
            sourceId: options.providerId,
            workerId: options.workerId,
            status: mappedStatus,
            lastSuccessAt: isFailureResult ? undefined : attemptIso,
            lastAttemptAt: attemptIso,
            nextScheduledAt: new Date(
              Date.now() + cfg.expectedIntervalSeconds * 1000
            ).toISOString(),
            freshnessSeconds: isFailureResult ? undefined : 0,
            consecutiveFailures: nextConsecutiveFailures,
            latencyMs,
            lastError: isFailureResult
              ? result.errorMessage ?? `Worker returned ${finalStatus}`
              : null,
            details: {
              configured: isProviderConfigured(options.providerId),
              transport: cfg.transport,
              cadence: cfg.cadence,
            },
          });
        }

        await updateDataHealth({
          id: `worker:${options.workerId}`,
          entityType: "worker",
          sourceId: null,
          workerId: options.workerId,
          status: workerStatus,
          lastSuccessAt: isFailureResult ? undefined : attemptIso,
          lastAttemptAt: attemptIso,
          consecutiveFailures: nextConsecutiveFailures,
          latencyMs,
          lastError: isFailureResult
            ? result.errorMessage ?? `Worker returned ${finalStatus}`
            : null,
          details: { lastRunId: run.id, lastProviderId: options.providerId },
        });

        return {
          runId: run.id,
          workerId: options.workerId,
          providerId: options.providerId,
          status: finalStatus,
          recordsInserted,
          recordsUpdated,
          recordsSkipped,
          anomaliesDetected,
          latencyMs,
          ...(finalStatus === "DEAD_LETTER" ? { deadLetter: true } : {}),
          ...(isFailureResult
            ? { error: result.errorMessage ?? `Worker returned ${finalStatus}` }
            : {}),
        };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;

        const reqErr = err instanceof ProviderRequestError ? err : null;
        lastErrorCode =
          reqErr?.code ??
          (err instanceof Error && err.name === "AbortError"
            ? "TIMEOUT"
            : "TRANSPORT_ERROR");

        if (reqErr?.statusCode === 429) {
          const windows = getRateLimitWindows();
          const state = windows.get(options.providerId);
          if (state) {
            state.cooldownUntilMs =
              Date.now() + (reqErr.retryAfterMs ?? Math.min(backoffMaxMs, backoffBaseMs * 4));
          }
        }

        const isStatusRetryable =
          reqErr?.statusCode !== undefined
            ? cfg.retryableStatusCodes.includes(reqErr.statusCode)
            : true;
        const canRetry =
          attempt < maxAttempts && (reqErr ? reqErr.retryable && isStatusRetryable : true);

        if (!canRetry) {
          break;
        }

        const expDelay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** (attempt - 1));
        const jitteredDelay = Math.max(
          1,
          Math.round(expDelay * (0.5 + Math.random() * 0.5))
        );
        retryDelaysMs.push(jitteredDelay);
        await sleepFn(jitteredDelay);
      }
    }

    const errorMessage = sanitizeErrorMessage(lastError);
    const latencyMs = Math.max(0, Date.now() - startedMs);

    await completeSyncRun(run.id, {
      status: "DEAD_LETTER",
      deadLettered: true,
      errorCode: lastErrorCode,
      errorMessage,
      rawPayload: {
        ...(options.rawPayload ?? {}),
        attempts: maxAttempts,
        retryDelaysMs,
      },
    });

    const isRateLimited = lastErrorCode === "HTTP_429";
    await recordAnomaly({
      seriesKey: `PROVIDER_${options.providerId.toUpperCase()}`,
      sourceId: options.providerId,
      workerId: options.workerId,
      severity: "ERROR",
      anomalyType: isRateLimited ? "RATE_LIMIT" : "TRANSPORT_FAILURE",
      message: `${options.jobName} failed after ${maxAttempts} attempts: ${errorMessage}`,
      observedValue: lastErrorCode,
      expectedRange: "HTTP 200",
      rawPayload: { runId: run.id, retryDelaysMs },
    });

    const healthRecords = await listDataHealth();
    const existingSourceHealth = healthRecords.find(
      (h) => h.id === `source:${options.providerId}`
    );
    const existingWorkerHealth = healthRecords.find(
      (h) => h.id === `worker:${options.workerId}`
    );
    const consecutiveFailures =
      (options.skipSourceHealthUpdate
        ? existingWorkerHealth?.consecutiveFailures ?? 0
        : existingSourceHealth?.consecutiveFailures ?? 0) + 1;

    if (!options.skipSourceHealthUpdate) {
      await updateDataHealth({
        id: `source:${options.providerId}`,
        entityType: "source",
        sourceId: options.providerId,
        workerId: options.workerId,
        status: "FAILED",
        lastAttemptAt: new Date().toISOString(),
        consecutiveFailures,
        latencyMs,
        lastError: errorMessage,
        details: {
          configured: isProviderConfigured(options.providerId),
          transport: cfg.transport,
          lastDeadLetterRunId: run.id,
        },
      });
    }

    await updateDataHealth({
      id: `worker:${options.workerId}`,
      entityType: "worker",
      sourceId: null,
      workerId: options.workerId,
      status: "FAILED",
      lastAttemptAt: new Date().toISOString(),
      consecutiveFailures,
      latencyMs,
      lastError: errorMessage,
      details: { lastDeadLetterRunId: run.id, lastProviderId: options.providerId },
    });

    return {
      runId: run.id,
      workerId: options.workerId,
      providerId: options.providerId,
      status: "DEAD_LETTER",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 1,
      latencyMs,
      deadLetter: true,
      error: errorMessage,
    };
  })();

  if (options.idempotencyKey) {
    const ttlMs = options.idempotencyTtlMs ?? 5000;
    cache.set(options.idempotencyKey, {
      expiresAtMs: Date.now() + ttlMs,
      promise: executePromise,
    });
    executePromise
      .then((summary) => {
        cache.set(options.idempotencyKey!, {
          expiresAtMs: Date.now() + ttlMs,
          summary,
        });
      })
      .catch(() => {
        cache.delete(options.idempotencyKey!);
      });
  }

  return executePromise;
}

function isProviderEffectivelyConfigured(providerId: ProviderId): boolean {
  if (typeof window !== "undefined") return false;
  if (providerId === "coinbase_ws") {
    return (
      process.env.ENABLE_PUBLIC_MARKET_WS?.trim() === "true" ||
      process.env.MARKET_WS_PROVIDER?.trim() === "coinbase_ws"
    );
  }
  if (providerId === "cftc") {
    return process.env.ENABLE_PUBLIC_CFTC_LIVE?.trim() === "true";
  }
  if (providerId === "us_treasury") {
    return process.env.ENABLE_PUBLIC_TREASURY_LIVE?.trim() === "true";
  }
  return isProviderConfigured(providerId);
}

/**
 * Evaluates staleness for every registered data source based on `data_health`,
 * `latest_values`, and `PROVIDER_REGISTRY` cadence thresholds.
 * Periodic economic data (REST/AI) is NEVER promoted to `LIVE`.
 */
export async function evaluateSourceStaleness(
  nowMs: number = Date.now()
): Promise<DataHealthRecord[]> {
  const [healthRows, latestValues, openAnomalies] = await Promise.all([
    listDataHealth(),
    getLatestValues(),
    listAnomalies(false, 200),
  ]);

  const healthById = new Map(healthRows.map((h) => [h.id, h]));
  const openStaleSources = new Set(
    openAnomalies
      .filter((a) => a.anomalyType === "STALE_DATA" && a.sourceId)
      .map((a) => a.sourceId as ProviderId)
  );

  const updatedHealth: DataHealthRecord[] = [];

  for (const cfg of listProviders()) {
    const id = `source:${cfg.id}`;
    const existing = healthById.get(id);
    const configured = isProviderEffectivelyConfigured(cfg.id);

    // Explicitly unconfigured sources stay DISCONNECTED
    if (!configured || existing?.details?.disabledByFlag === true) {
      if (!existing || existing.status !== "DISCONNECTED") {
        const res = await updateDataHealth({
          id,
          entityType: "source",
          sourceId: cfg.id,
          workerId: cfg.ownerWorker,
          status: "DISCONNECTED",
          lastSuccessAt: existing?.lastSuccessAt ?? null,
          lastAttemptAt: existing?.lastAttemptAt ?? null,
          nextScheduledAt: existing?.nextScheduledAt ?? null,
          freshnessSeconds: existing?.freshnessSeconds ?? null,
          consecutiveFailures: existing?.consecutiveFailures ?? 0,
          latencyMs: existing?.latencyMs ?? null,
          lastError: existing?.lastError ?? null,
          details: { ...(existing?.details ?? {}), configured: false },
        });
        updatedHealth.push(res);
      } else {
        updatedHealth.push(existing);
      }
      continue;
    }

    // Websocket provider without an open socket & no recent tick -> DISCONNECTED or FAILED
    if (cfg.transport === "websocket") {
      const wsState = String(existing?.details?.wsState ?? "");
      if (!existing?.lastSuccessAt && wsState !== "OPEN") {
        const nextStatus: SyncStatusType =
          existing?.status === "FAILED" ? "FAILED" : "DISCONNECTED";
        const res = await updateDataHealth({
          id,
          entityType: "source",
          sourceId: cfg.id,
          workerId: cfg.ownerWorker,
          status: nextStatus,
          lastSuccessAt: existing?.lastSuccessAt ?? null,
          lastAttemptAt: existing?.lastAttemptAt ?? null,
          freshnessSeconds: null,
          consecutiveFailures: existing?.consecutiveFailures ?? 0,
          latencyMs: existing?.latencyMs ?? null,
          lastError: existing?.lastError ?? null,
          details: { ...(existing?.details ?? {}), configured },
        });
        updatedHealth.push(res);
        continue;
      }
    }

    if (
      existing?.status === "FAILED" &&
      (existing.consecutiveFailures ?? 0) >= Math.max(1, cfg.maxRetries)
    ) {
      updatedHealth.push(existing);
      continue;
    }

    // Determine freshness age from lastSuccessAt and provider's latest observations
    const lastSuccessMs = existing?.lastSuccessAt
      ? Date.parse(existing.lastSuccessAt)
      : NaN;

    const providerSeries = latestValues.filter((v) => v.sourceId === cfg.id);
    let latestDataMs = NaN;
    let allSeriesFreshByCadence = providerSeries.length > 0;
    let maxSeriesExcessSec = 0;

    for (const lv of providerSeries) {
      const ts = Date.parse(lv.publishedAt || `${lv.observationDate}T00:00:00Z`);
      if (Number.isFinite(ts)) {
        if (!Number.isFinite(latestDataMs) || ts > latestDataMs) {
          latestDataMs = ts;
        }
        const seriesStaleThreshold = resolveCadenceStaleThresholdSec(
          lv.seriesKey,
          lv.cadence,
          cfg.staleAfterSeconds
        );
        const lvAgeSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
        if (lvAgeSec > seriesStaleThreshold) {
          allSeriesFreshByCadence = false;
          maxSeriesExcessSec = Math.max(maxSeriesExcessSec, lvAgeSec);
        }
      }
    }

    if (!Number.isFinite(lastSuccessMs) && !Number.isFinite(latestDataMs)) {
      if (existing) {
        // Never successfully synced yet
        const safeStatus: SyncStatusType =
          cfg.transport === "websocket"
            ? "DISCONNECTED"
            : existing.status === "LIVE"
            ? "CURRENT"
            : existing.status;
        if (safeStatus !== existing.status) {
          updatedHealth.push(
            await updateDataHealth({
              id,
              entityType: "source",
              sourceId: cfg.id,
              workerId: cfg.ownerWorker,
              status: safeStatus,
              details: { ...(existing.details ?? {}), configured },
            })
          );
        } else {
          updatedHealth.push(existing);
        }
      }
      continue;
    }

    const syncAgeSec = Number.isFinite(lastSuccessMs)
      ? Math.max(0, Math.floor((nowMs - lastSuccessMs) / 1000))
      : Math.max(0, Math.floor((nowMs - latestDataMs) / 1000));

    const dataAgeSec = Number.isFinite(latestDataMs)
      ? Math.max(0, Math.floor((nowMs - latestDataMs) / 1000))
      : syncAgeSec;

    let computedStatus: SyncStatusType;
    if (cfg.transport === "websocket") {
      const wsHealthyWindow = Math.max(cfg.expectedIntervalSeconds * 3, 15);
      if (syncAgeSec <= wsHealthyWindow) {
        computedStatus = "LIVE";
      } else if (syncAgeSec <= cfg.staleAfterSeconds) {
        computedStatus = "DELAYED";
      } else {
        computedStatus = "STALE";
      }
    } else {
      // Periodic economic/macro/liquidity/positioning/AI sources NEVER receive LIVE
      const effectiveAgeSec =
        Number.isFinite(lastSuccessMs)
          ? !allSeriesFreshByCadence && maxSeriesExcessSec > syncAgeSec
            ? maxSeriesExcessSec
            : syncAgeSec
          : dataAgeSec;

      if (effectiveAgeSec <= cfg.expectedIntervalSeconds) {
        computedStatus = "CURRENT";
      } else if (effectiveAgeSec <= cfg.staleAfterSeconds) {
        computedStatus = "DELAYED";
      } else {
        computedStatus = "STALE";
      }
    }

    if (computedStatus === "STALE" && !openStaleSources.has(cfg.id)) {
      await recordAnomaly({
        seriesKey: `SOURCE_${cfg.id.toUpperCase()}`,
        sourceId: cfg.id,
        workerId: "validation-recovery",
        severity: "WARN",
        anomalyType: "STALE_DATA",
        message: `${cfg.name} exceeded staleness threshold (${syncAgeSec}s > ${cfg.staleAfterSeconds}s)`,
        observedValue: `${syncAgeSec}s`,
        expectedRange: `<= ${cfg.staleAfterSeconds}s`,
        rawPayload: {
          syncAgeSec,
          dataAgeSec,
          expectedIntervalSeconds: cfg.expectedIntervalSeconds,
          staleAfterSeconds: cfg.staleAfterSeconds,
        },
      });
    } else if (computedStatus !== "STALE") {
      const recoveredAnomalies = openAnomalies.filter(
        (a) =>
          a.anomalyType === "STALE_DATA" &&
          a.sourceId === cfg.id &&
          a.seriesKey === `SOURCE_${cfg.id.toUpperCase()}`
      );
      for (const anom of recoveredAnomalies) {
        await resolveAnomaly(anom.id);
      }
    }

    const updated = await updateDataHealth({
      id,
      entityType: "source",
      sourceId: cfg.id,
      workerId: cfg.ownerWorker,
      status: computedStatus,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastAttemptAt: existing?.lastAttemptAt ?? null,
      nextScheduledAt: existing?.nextScheduledAt ?? null,
      freshnessSeconds: syncAgeSec,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      latencyMs: existing?.latencyMs ?? null,
      lastError: existing?.lastError ?? null,
      details: {
        ...(existing?.details ?? {}),
        configured,
        cadence: cfg.cadence,
        transport: cfg.transport,
        dataAgeSeconds: dataAgeSec,
      },
    });
    updatedHealth.push(updated);
  }

  return updatedHealth;
}

/**
 * Triggers a historical backfill job through the central orchestrator.
 */
export async function runBackfillJob(
  options: BackfillJobOptions = {}
): Promise<OrchestratorDispatchSummary> {
  const dispatchSyncJob = await resolveOrchestratorDispatch();
  const targetSeries =
    options.seriesKeys ??
    (options.providerId
      ? MACRO_SERIES_MAPPINGS.filter(
          (s) =>
            s.primaryProvider === options.providerId ||
            s.fallbackProvider === options.providerId
        ).map((s) => s.seriesKey)
      : undefined);

  return dispatchSyncJob({
    workerId:
      options.workerId ??
      (options.providerId ? PROVIDER_REGISTRY[options.providerId].ownerWorker : "macro-engine"),
    providerId: options.providerId,
    trigger: options.trigger ?? "recovery",
    force: true,
    backfill: true,
    seriesKeys: targetSeries,
    symbols: options.symbols,
  });
}

/**
 * Re-dispatches a failed or dead-lettered sync run by ID through the orchestrator.
 */
export async function retryDeadLetterRun(
  runId: string
): Promise<OrchestratorDispatchSummary> {
  const runs: SyncRunRecord[] = await listSyncRuns(250);
  const target = runs.find((r) => r.id === runId);

  if (!target) {
    const now = new Date().toISOString();
    return {
      ok: false,
      trigger: "recovery",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      summaries: [],
      errors: [
        {
          workerId: "validation-recovery",
          message: `Sync run ${runId} not found`,
        },
      ],
    };
  }

  const dispatchSyncJob = await resolveOrchestratorDispatch();
  const seriesKeys = Array.isArray(target.rawPayload?.seriesKeys)
    ? target.rawPayload.seriesKeys.map(String)
    : undefined;
  const backfill = Boolean(target.rawPayload?.backfill);

  return dispatchSyncJob({
    workerId: target.workerId,
    providerId: target.sourceId ?? undefined,
    trigger: "recovery",
    force: true,
    backfill,
    seriesKeys,
  });
}

export function computeValidationChecksum(
  seriesKey: string,
  sourceId: ProviderId,
  observationDate: string,
  value: number,
  unit: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${seriesKey}|${sourceId}|${observationDate}|${value}|${unit}`)
    .digest("hex");
}
