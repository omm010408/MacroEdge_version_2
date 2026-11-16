import type { DataCadence } from "@/lib/types";
import type { ProviderId, SyncStatusType, TriggerType } from "@/lib/sync/types";
import { isProviderConfigured } from "@/services/sync/provider-registry";
import {
  completeSyncRun,
  getLatestValues,
  getMarketQuotes,
  getObservations,
  listDataHealth,
  recordAnomaly,
  recordSyncRunStart,
  seedDataSourcesIfNeeded,
  updateDataHealth,
  upsertCheckpoint,
} from "@/services/sync/store";
import {
  validateAndNormalizeObservation,
  type WorkerExecutionSummary,
} from "@/services/sync/validation-recovery";
import {
  type AdapterFetchResult,
  fetchFredObservationsForSync,
  fetchNyFedReferenceRates,
  fetchTreasuryAvgInterestRates,
} from "@/services/sync/workers/rest-adapters";

interface LiquidityRiskSpec {
  seriesKey: string;
  label: string;
  unit: string;
  cadence: DataCadence;
  staleAfterDays: number;
  minValid: number;
  maxValid: number;
  provider: ProviderId;
  externalId: string;
  attribution: string;
  fetchFn: () => Promise<AdapterFetchResult>;
  fallbackFn?: () => Promise<AdapterFetchResult>;
  fallbackProvider?: ProviderId;
  fallbackExternalId?: string;
}

const LIQUIDITY_RISK_SPECS: LiquidityRiskSpec[] = [
  {
    seriesKey: "US2Y",
    label: "US 2Y Treasury Yield",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 15,
    provider: "fred",
    externalId: "DGS2",
    attribution: "US Treasury H.15 / FRED · DGS2",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DGS2", limit: 30 }),
  },
  {
    seriesKey: "US5Y",
    label: "US 5Y Treasury Yield",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 15,
    provider: "fred",
    externalId: "DGS5",
    attribution: "US Treasury H.15 / FRED · DGS5",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DGS5", limit: 30 }),
  },
  {
    seriesKey: "US10Y",
    label: "US 10Y Treasury Yield",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 15,
    provider: "fred",
    externalId: "DGS10",
    attribution: "US Treasury H.15 / FRED · DGS10",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DGS10", limit: 30 }),
  },
  {
    seriesKey: "US30Y",
    label: "US 30Y Treasury Yield",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 15,
    provider: "fred",
    externalId: "DGS30",
    attribution: "US Treasury H.15 / FRED · DGS30",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DGS30", limit: 30 }),
  },
  {
    seriesKey: "US10Y_REAL",
    label: "US 10Y TIPS Real Yield",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: -3,
    maxValid: 10,
    provider: "fred",
    externalId: "DFII10",
    attribution: "US Treasury / FRED · DFII10",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DFII10", limit: 30 }),
  },
  {
    seriesKey: "BREAKEVEN_10Y",
    label: "10Y Breakeven Inflation",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 6,
    provider: "fred",
    externalId: "T10YIE",
    attribution: "FRED · T10YIE",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "T10YIE", limit: 30 }),
  },
  {
    seriesKey: "BREAKEVEN_5Y",
    label: "5Y Breakeven Inflation",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 6,
    provider: "fred",
    externalId: "T5YIE",
    attribution: "FRED · T5YIE",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "T5YIE", limit: 30 }),
  },
  {
    seriesKey: "FED_WALCL",
    label: "Federal Reserve Total Assets",
    unit: "$M",
    cadence: "WEEKLY",
    staleAfterDays: 14,
    minValid: 500000,
    maxValid: 20000000,
    provider: "fred",
    externalId: "WALCL",
    attribution: "Federal Reserve H.4.1 · WALCL",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "WALCL", limit: 20 }),
  },
  {
    seriesKey: "FED_TGA",
    label: "Treasury General Account (TGA)",
    unit: "$M",
    cadence: "WEEKLY",
    staleAfterDays: 14,
    minValid: 0,
    maxValid: 5000000,
    provider: "fred",
    externalId: "WTREGEN",
    attribution: "US Treasury / Fed H.4.1 · WTREGEN",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "WTREGEN", limit: 20 }),
  },
  {
    seriesKey: "FED_RRP",
    label: "Overnight Reverse Repo (ON RRP)",
    unit: "$B",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 5000,
    provider: "fred",
    externalId: "RRPONTSYD",
    attribution: "NY Fed / FRED · RRPONTSYD",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "RRPONTSYD", limit: 30 }),
  },
  {
    seriesKey: "SOFR",
    label: "Secured Overnight Financing Rate",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 20,
    provider: "fed_reserve",
    externalId: "SOFR",
    attribution: "NY Fed · SOFR",
    fetchFn: () => fetchNyFedReferenceRates("sofr", 10),
    fallbackFn: () => fetchFredObservationsForSync({ seriesId: "SOFR", limit: 30 }),
    fallbackProvider: "fred",
    fallbackExternalId: "SOFR",
  },
  {
    seriesKey: "EFFR",
    label: "Effective Federal Funds Rate",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 20,
    provider: "fed_reserve",
    externalId: "EFFR",
    attribution: "NY Fed · EFFR",
    fetchFn: () => fetchNyFedReferenceRates("effr", 10),
    fallbackFn: () => fetchFredObservationsForSync({ seriesId: "DFF", limit: 30 }),
    fallbackProvider: "fred",
    fallbackExternalId: "DFF",
  },
  {
    seriesKey: "IORB",
    label: "Interest on Reserve Balances",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0,
    maxValid: 20,
    provider: "fred",
    externalId: "IORB",
    attribution: "Federal Reserve · IORB",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "IORB", limit: 30 }),
  },
  {
    seriesKey: "UST_AVG_NOTE_RATE",
    label: "US Treasury Notes Avg Interest Rate",
    unit: "%",
    cadence: "MONTHLY",
    staleAfterDays: 45,
    minValid: 0,
    maxValid: 15,
    provider: "us_treasury",
    externalId: "AVG_INT_RATES_NOTES",
    attribution: "US Treasury · Fiscal Data",
    fetchFn: () => fetchTreasuryAvgInterestRates(),
  },
  {
    seriesKey: "HY_OAS",
    label: "ICE BofA US High Yield OAS",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0.5,
    maxValid: 25,
    provider: "fred",
    externalId: "BAMLH0A0HYM2",
    attribution: "ICE BofA / FRED · BAMLH0A0HYM2",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "BAMLH0A0HYM2", limit: 30 }),
  },
  {
    seriesKey: "IG_OAS",
    label: "ICE BofA US Corporate IG OAS",
    unit: "%",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 0.1,
    maxValid: 15,
    provider: "fred",
    externalId: "BAMLC0A0CM",
    attribution: "ICE BofA / FRED · BAMLC0A0CM",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "BAMLC0A0CM", limit: 30 }),
  },
  {
    seriesKey: "VIX",
    label: "CBOE Volatility Index (VIX)",
    unit: "Index",
    cadence: "DAILY",
    staleAfterDays: 6,
    minValid: 5,
    maxValid: 120,
    provider: "fred",
    externalId: "VIXCLS",
    attribution: "CBOE / FRED · VIXCLS",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "VIXCLS", limit: 30 }),
  },
  {
    seriesKey: "STLFSI4",
    label: "St. Louis Fed Financial Stress Index",
    unit: "Index",
    cadence: "WEEKLY",
    staleAfterDays: 14,
    minValid: -5,
    maxValid: 15,
    provider: "fred",
    externalId: "STLFSI4",
    attribution: "St. Louis Fed · STLFSI4",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "STLFSI4", limit: 20 }),
  },
  {
    seriesKey: "DXY_BROAD",
    label: "Nominal Broad US Dollar Index",
    unit: "Index",
    cadence: "DAILY",
    staleAfterDays: 10,
    minValid: 70,
    maxValid: 180,
    provider: "fred",
    externalId: "DTWEXBGS",
    attribution: "Federal Reserve H.10 / FRED · DTWEXBGS",
    fetchFn: () => fetchFredObservationsForSync({ seriesId: "DTWEXBGS", limit: 30 }),
  },
];

function computeZScore(values: number[], target: number): number | null {
  if (values.length < 5) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  const std = Math.sqrt(variance);
  if (std <= 1e-9) return null;
  return Number(((target - mean) / std).toFixed(2));
}

function classifyFreshness(obsDate: string, staleAfterDays: number): SyncStatusType {
  const ageDays = (Date.now() - Date.parse(`${obsDate}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(ageDays)) return "DELAYED";
  if (ageDays > staleAfterDays * 1.5) return "STALE";
  if (ageDays > staleAfterDays) return "DELAYED";
  return "CURRENT";
}

function mergeProviderStatus(
  current: SyncStatusType | undefined,
  next: SyncStatusType
): SyncStatusType {
  if (!current) return next;
  if (current === "CURRENT" || next === "CURRENT") return "CURRENT";
  if (current === "DELAYED" || next === "DELAYED") return "DELAYED";
  if (current === "STALE" || next === "STALE") return "STALE";
  if (current === "FAILED" || next === "FAILED") return "FAILED";
  return next;
}

/**
 * Worker 5: Liquidity, Rates, Credit & Risk Engine.
 * Monitors yields, real yields, breakevens, Fed balance sheet (WALCL/TGA/RRP),
 * NY Fed repo/EFFR rates, US Treasury Fiscal Data rates, credit spreads, VIX,
 * STLFSI4, and DXY_BROAD with retry/backoff, derived spreads/Net Liquidity
 * (DERIVED / isEstimated: true), and z-score outlier checks.
 */
export async function runLiquidityRiskEngineSync(options?: {
  trigger?: TriggerType;
  providerId?: ProviderId;
}): Promise<WorkerExecutionSummary> {
  const startedAtMs = Date.now();
  await seedDataSourcesIfNeeded();

  const run = await recordSyncRunStart({
    workerId: "liquidity-risk-engine",
    sourceId: options?.providerId ?? "fed_reserve",
    jobName: "liquidity-risk-sync",
    triggerType: options?.trigger ?? "scheduled",
    maxAttempts: 4,
  });

  const [initialLatest, quotes, existingHealth] = await Promise.all([
    getLatestValues(),
    getMarketQuotes(),
    listDataHealth(),
  ]);
  const storedMap = new Map(initialLatest.map((v) => [v.seriesKey, v]));
  const healthMap = new Map(existingHealth.map((h) => [h.id, h]));
  const dxyQuote = quotes.find((q) => q.symbol === "DXY");

  let recordsFetched = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  let anomaliesDetected = 0;
  let failedFeeds = 0;
  let configuredFeedsCount = 0;
  let totalAttempts = 0;
  const allRetryDelaysMs: number[] = [];

  const providerLatestStatus = new Map<ProviderId, SyncStatusType>();
  const observedLatest = new Map<
    string,
    { value: number; previousValue: number | null; observationDate: string; publishedAt: string }
  >();

  const activeSpecs = options?.providerId
    ? options.providerId === "us_treasury"
      ? LIQUIDITY_RISK_SPECS.filter((s) => s.provider === "us_treasury")
      : options.providerId === "fed_reserve"
      ? LIQUIDITY_RISK_SPECS.filter((s) => s.provider === "fed_reserve" || s.provider === "fred")
      : LIQUIDITY_RISK_SPECS.filter((s) => s.provider === options.providerId)
    : LIQUIDITY_RISK_SPECS;

  const fetchedSpecs: Array<{
    spec: (typeof LIQUIDITY_RISK_SPECS)[number];
    usedProvider: ProviderId;
    usedExternalId: string;
    res: AdapterFetchResult;
    attempts: number;
    retryDelaysMs: number[];
    primaryFailed: boolean;
  }> = [];

  const BATCH_SIZE = 6;
  for (let i = 0; i < activeSpecs.length; i += BATCH_SIZE) {
    const batch = activeSpecs.slice(i, i + BATCH_SIZE);
    const batchOut = await Promise.all(
      batch.map(async (spec) => {
        let usedProvider: ProviderId = spec.provider;
        let usedExternalId = spec.externalId;
        let res = await spec.fetchFn();
        let attempts = res.attempts;
        const retryDelaysMs = [...res.retryDelaysMs];
        let primaryFailed = false;

        if (!res.ok && spec.fallbackFn && spec.fallbackProvider) {
          if (res.configured) {
            primaryFailed = true;
          }
          const fb = await spec.fallbackFn();
          attempts += fb.attempts;
          retryDelaysMs.push(...fb.retryDelaysMs);
          if (fb.ok) {
            res = fb;
            usedProvider = spec.fallbackProvider;
            usedExternalId = spec.fallbackExternalId ?? spec.externalId;
          }
        }

        return {
          spec,
          usedProvider,
          usedExternalId,
          res,
          attempts,
          retryDelaysMs,
          primaryFailed,
        };
      })
    );
    fetchedSpecs.push(...batchOut);
  }

  for (const {
    spec,
    usedProvider,
    usedExternalId,
    res,
    attempts,
    retryDelaysMs,
    primaryFailed,
  } of fetchedSpecs) {
    totalAttempts += attempts;
    allRetryDelaysMs.push(...retryDelaysMs);
    if (primaryFailed) {
      providerLatestStatus.set(
        spec.provider,
        mergeProviderStatus(providerLatestStatus.get(spec.provider), "FAILED")
      );
    }

    if (!res.ok || res.items.length === 0) {
      if (!res.configured) {
        recordsSkipped += 1;
        providerLatestStatus.set(
          usedProvider,
          mergeProviderStatus(providerLatestStatus.get(usedProvider), "DISCONNECTED")
        );
      } else {
        configuredFeedsCount += 1;
        failedFeeds += 1;
        anomaliesDetected += 1;
        providerLatestStatus.set(
          usedProvider,
          mergeProviderStatus(providerLatestStatus.get(usedProvider), "FAILED")
        );
        await recordAnomaly({
          seriesKey: spec.seriesKey,
          sourceId: usedProvider,
          workerId: "liquidity-risk-engine",
          severity: "WARN",
          anomalyType: "TRANSPORT_FAILURE",
          message: `Failed liquidity/risk feed ${spec.seriesKey} after ${res.attempts} attempt(s): ${res.reason ?? "empty"}`,
        });
      }
      continue;
    }

    configuredFeedsCount += 1;
    recordsFetched += res.items.length;
    const latest = res.items[res.items.length - 1];
    if (
      !Number.isFinite(latest.value) ||
      latest.value < spec.minValid ||
      latest.value > spec.maxValid
    ) {
      recordsSkipped += 1;
      anomaliesDetected += 1;
      await recordAnomaly({
        seriesKey: spec.seriesKey,
        sourceId: usedProvider,
        workerId: "liquidity-risk-engine",
        severity: "ERROR",
        anomalyType: "OUTLIER_SPIKE",
        message: `Out-of-bounds reading ${latest.value} for ${spec.seriesKey}`,
        observedValue: String(latest.value),
        expectedRange: `[${spec.minValid}, ${spec.maxValid}]`,
      });
      continue;
    }

    const historyValues = res.items.slice(0, -1).map((p) => p.value);
    const zScore = computeZScore(historyValues, latest.value);
    if (zScore !== null && Math.abs(zScore) >= 3.0) {
      anomaliesDetected += 1;
      await recordAnomaly({
        seriesKey: spec.seriesKey,
        sourceId: usedProvider,
        workerId: "liquidity-risk-engine",
        severity: "INFO",
        anomalyType: "OUTLIER_SPIKE",
        message: `Abnormal ${zScore}σ move detected in ${spec.label} (${latest.value} ${spec.unit})`,
        observedValue: String(latest.value),
        expectedRange: "|z| < 3.0",
        rawPayload: { zScore },
      });
    }

    const status = classifyFreshness(latest.observationDate, spec.staleAfterDays);
    providerLatestStatus.set(
      usedProvider,
      mergeProviderStatus(providerLatestStatus.get(usedProvider), status)
    );

    const history = await getObservations(spec.seriesKey, 120);
    const validation = await validateAndNormalizeObservation(
      {
        seriesKey: spec.seriesKey,
        sourceId: usedProvider,
        externalSeriesId: usedExternalId,
        observationDate: latest.observationDate,
        publishedAt: latest.publishedAt,
        value: latest.value,
        previousValue: latest.previousValue,
        unit: spec.unit,
        expectedUnit: spec.unit,
        cadence: spec.cadence,
        sourceAttribution: spec.attribution,
        workerId: "liquidity-risk-engine",
        status,
        rawPayload: {
          ...latest.rawPayload,
          isEstimated: false,
          derivation: "OBSERVED",
          zScore,
        },
      },
      {
        historicalObservations: history,
        latestValue: storedMap.get(spec.seriesKey) ?? null,
        persist: true,
      }
    );

    anomaliesDetected += validation.anomalies.length;
    if (!validation.valid || !validation.upsertResult?.accepted) {
      recordsSkipped += 1;
    } else if (validation.upsertResult.status === "UNCHANGED") {
      recordsSkipped += 1;
    } else if (validation.upsertResult.revisionNumber > 1) {
      recordsUpdated += 1;
    } else {
      recordsInserted += 1;
    }

    if (validation.valid) {
      observedLatest.set(spec.seriesKey, {
        value: latest.value,
        previousValue: latest.previousValue,
        observationDate: latest.observationDate,
        publishedAt: latest.publishedAt,
      });
    }

    await upsertCheckpoint({
      checkpointKey: `liquidity-risk-engine:${usedProvider}:${spec.seriesKey}`,
      workerId: "liquidity-risk-engine",
      sourceId: usedProvider,
      cursorValue: latest.observationDate,
      lastObservationDate: latest.observationDate,
      lastPublishedAt: latest.publishedAt,
      retryCount: 0,
      nextRetryAt: null,
      metadata: { zScore },
    });
  }

  const getVal = (key: string) => {
    const fresh = observedLatest.get(key);
    if (fresh) return fresh;
    const stored = storedMap.get(key);
    if (stored) {
      return {
        value: stored.value,
        previousValue: stored.previousValue,
        observationDate: stored.observationDate,
        publishedAt: stored.publishedAt,
      };
    }
    return null;
  };

  const y2 = getVal("US2Y");
  const y5 = getVal("US5Y");
  const y10 = getVal("US10Y");
  const y30 = getVal("US30Y");

  if (y2 && y10) {
    const spreadBps = Math.round((y10.value - y2.value) * 100);
    const prevSpreadBps =
      y2.previousValue !== null && y10.previousValue !== null
        ? Math.round((y10.previousValue - y2.previousValue) * 100)
        : null;
    const obsDate =
      y10.observationDate >= y2.observationDate ? y10.observationDate : y2.observationDate;
    const pubAt = y10.publishedAt >= y2.publishedAt ? y10.publishedAt : y2.publishedAt;
    const valRes = await validateAndNormalizeObservation(
      {
        seriesKey: "SPREAD_2S10S",
        sourceId: "fred",
        externalSeriesId: "DERIVED_DGS10_DGS2",
        observationDate: obsDate,
        publishedAt: pubAt,
        value: spreadBps,
        previousValue: prevSpreadBps,
        unit: "bps",
        expectedUnit: "bps",
        cadence: "DAILY",
        sourceAttribution: "Derived (DGS10 - DGS2)",
        status: "CURRENT",
        workerId: "liquidity-risk-engine",
        rawPayload: {
          isEstimated: true,
          derivation: "DERIVED",
          formula: "(DGS10 - DGS2) * 100",
          legs: { US10Y: y10.value, US2Y: y2.value },
        },
      },
      { persist: true, latestValue: storedMap.get("SPREAD_2S10S") ?? null }
    );
    if (valRes.upsertResult?.accepted && valRes.upsertResult.status !== "UNCHANGED") {
      recordsInserted += 1;
    }
  }

  if (y5 && y30) {
    const spreadBps = Math.round((y30.value - y5.value) * 100);
    const prevSpreadBps =
      y5.previousValue !== null && y30.previousValue !== null
        ? Math.round((y30.previousValue - y5.previousValue) * 100)
        : null;
    const obsDate =
      y30.observationDate >= y5.observationDate ? y30.observationDate : y5.observationDate;
    const pubAt = y30.publishedAt >= y5.publishedAt ? y30.publishedAt : y5.publishedAt;
    const valRes = await validateAndNormalizeObservation(
      {
        seriesKey: "SPREAD_5S30S",
        sourceId: "fred",
        externalSeriesId: "DERIVED_DGS30_DGS5",
        observationDate: obsDate,
        publishedAt: pubAt,
        value: spreadBps,
        previousValue: prevSpreadBps,
        unit: "bps",
        expectedUnit: "bps",
        cadence: "DAILY",
        sourceAttribution: "Derived (DGS30 - DGS5)",
        status: "CURRENT",
        workerId: "liquidity-risk-engine",
        rawPayload: {
          isEstimated: true,
          derivation: "DERIVED",
          formula: "(DGS30 - DGS5) * 100",
          legs: { US30Y: y30.value, US5Y: y5.value },
        },
      },
      { persist: true, latestValue: storedMap.get("SPREAD_5S30S") ?? null }
    );
    if (valRes.upsertResult?.accepted && valRes.upsertResult.status !== "UNCHANGED") {
      recordsInserted += 1;
    }
  }

  const walcl = getVal("FED_WALCL");
  const tga = getVal("FED_TGA");
  const rrp = getVal("FED_RRP");
  if (walcl && tga && rrp) {
    const netLiqTn = Number(((walcl.value - tga.value - rrp.value * 1000) / 1_000_000).toFixed(3));
    const prevNetLiqTn =
      walcl.previousValue !== null && tga.previousValue !== null && rrp.previousValue !== null
        ? Number(
            ((walcl.previousValue - tga.previousValue - rrp.previousValue * 1000) / 1_000_000).toFixed(
              3
            )
          )
        : null;
    const obsDate = [walcl.observationDate, tga.observationDate, rrp.observationDate].sort().pop()!;
    const pubAt = [walcl.publishedAt, tga.publishedAt, rrp.publishedAt].sort().pop()!;
    const netRes = await validateAndNormalizeObservation(
      {
        seriesKey: "NET_LIQUIDITY_DERIVED",
        sourceId: "fred",
        externalSeriesId: "DERIVED_WALCL_TGA_RRP",
        observationDate: obsDate,
        publishedAt: pubAt,
        value: netLiqTn,
        previousValue: prevNetLiqTn,
        unit: "$T",
        expectedUnit: "$T",
        cadence: "WEEKLY",
        sourceAttribution: "Derived Fed Net Liquidity (WALCL - TGA - RRP)",
        status: "CURRENT",
        workerId: "liquidity-risk-engine",
        rawPayload: {
          isEstimated: true,
          derivation: "DERIVED",
          formula: "(WALCL_M - WTREGEN_M - RRPONTSYD_B * 1000) / 1e6",
          components: {
            walclMn: walcl.value,
            tgaMn: tga.value,
            rrpBn: rrp.value,
          },
          dxyLiveQuote: dxyQuote ? dxyQuote.price : null,
        },
      },
      { persist: true, latestValue: storedMap.get("NET_LIQUIDITY_DERIVED") ?? null }
    );
    if (netRes.upsertResult?.accepted && netRes.upsertResult.status !== "UNCHANGED") {
      recordsInserted += 1;
    }
  }

  const nowIso = new Date().toISOString();
  const latencyMs = Date.now() - startedAtMs;

  // Update health for providers owned by liquidity-risk-engine
  const ownedProviders: ProviderId[] = ["us_treasury", "fed_reserve"];
  for (const pid of ownedProviders) {
    if (!providerLatestStatus.has(pid)) continue;
    const status = providerLatestStatus.get(pid)!;
    const prev = healthMap.get(`source:${pid}`);
    await updateDataHealth({
      id: `source:${pid}`,
      entityType: "source",
      sourceId: pid,
      workerId: "liquidity-risk-engine",
      status,
      lastSuccessAt: status === "CURRENT" || status === "DELAYED" ? nowIso : undefined,
      lastAttemptAt: nowIso,
      consecutiveFailures: status === "FAILED" ? (prev?.consecutiveFailures ?? 0) + 1 : 0,
      latencyMs,
      lastError:
        status === "FAILED"
          ? `${pid} fetch failed`
          : status === "DISCONNECTED"
          ? `${pid} disabled by environment flag`
          : null,
      details: { configured: isProviderConfigured(pid) },
    });
  }

  const allConfiguredFailed =
    configuredFeedsCount > 0 && failedFeeds === configuredFeedsCount;
  const deadLetter = allConfiguredFailed && allRetryDelaysMs.length > 0;
  const finalStatus = deadLetter
    ? "DEAD_LETTER"
    : allConfiguredFailed
    ? "FAILED"
    : failedFeeds > 0
    ? "PARTIAL"
    : "SUCCEEDED";

  const prevWorker = healthMap.get("worker:liquidity-risk-engine");
  await updateDataHealth({
    id: "worker:liquidity-risk-engine",
    entityType: "worker",
    workerId: "liquidity-risk-engine",
    status: allConfiguredFailed ? "FAILED" : "CURRENT",
    lastSuccessAt: allConfiguredFailed ? undefined : nowIso,
    lastAttemptAt: nowIso,
    consecutiveFailures: allConfiguredFailed ? (prevWorker?.consecutiveFailures ?? 0) + 1 : 0,
    latencyMs,
    details: {
      derivedSpreadsComputed: Boolean(y2 && y10),
      derivedNetLiq: Boolean(walcl && tga && rrp),
    },
  });

  await completeSyncRun(run.id, {
    status: finalStatus,
    deadLettered: deadLetter,
    recordsFetched,
    recordsValidated: recordsInserted + recordsUpdated,
    recordsUpserted: recordsInserted + recordsUpdated,
    recordsRejected: recordsSkipped,
    errorCode: allConfiguredFailed ? "LIQUIDITY_SYNC_FAILED" : null,
    errorMessage: allConfiguredFailed
      ? "All configured liquidity/risk series failed after retries"
      : null,
    rawPayload: {
      totalAttempts,
      retryCount: allRetryDelaysMs.length,
      retryDelaysMs: allRetryDelaysMs,
    },
  });

  return {
    runId: run.id,
    workerId: "liquidity-risk-engine",
    providerId: "fed_reserve",
    status: finalStatus,
    recordsInserted,
    recordsUpdated,
    recordsSkipped,
    anomaliesDetected,
    latencyMs,
    ...(deadLetter ? { deadLetter: true } : {}),
  };
}
