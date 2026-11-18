import type { SyncStatusType, TriggerType } from "@/lib/sync/types";
import {
  completeSyncRun,
  getCheckpoint,
  getLatestValues,
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
import { fetchCftcLegacyContractRows } from "@/services/sync/workers/rest-adapters";

interface CotContractSpec {
  id: string;
  symbol: string;
  code: string;
  name: string;
  assetClass: string;
}

const CFTC_CONTRACTS: CotContractSpec[] = [
  { id: "gold", symbol: "GC", code: "088691", name: "Gold (COMEX)", assetClass: "Metals" },
  { id: "eurusd", symbol: "6E", code: "099741", name: "Euro FX (CME)", assetClass: "FX" },
  { id: "usdjpy", symbol: "6J", code: "097741", name: "Japanese Yen (CME)", assetClass: "FX" },
  { id: "gbpusd", symbol: "6B", code: "096742", name: "British Pound (CME)", assetClass: "FX" },
  { id: "dxy", symbol: "DX", code: "098662", name: "US Dollar Index (ICE)", assetClass: "FX" },
  { id: "audusd", symbol: "6A", code: "232741", name: "Australian Dollar (CME)", assetClass: "FX" },
  { id: "us10y", symbol: "ZN", code: "043602", name: "10Y Treasury Note (CBOT)", assetClass: "Rates" },
  { id: "us02y", symbol: "ZT", code: "042601", name: "2Y Treasury Note (CBOT)", assetClass: "Rates" },
  { id: "spx", symbol: "ES", code: "13874A", name: "E-mini S&P 500 (CME)", assetClass: "Equities" },
  { id: "nq", symbol: "NQ", code: "209742", name: "E-mini Nasdaq-100 (CME)", assetClass: "Equities" },
  { id: "wti", symbol: "CL", code: "067651", name: "WTI Crude Oil (NYMEX)", assetClass: "Energy" },
  { id: "silver", symbol: "SI", code: "084691", name: "Silver (COMEX)", assetClass: "Metals" },
  { id: "copper", symbol: "HG", code: "085692", name: "High Grade Copper (COMEX)", assetClass: "Metals" },
  { id: "btc", symbol: "BTC", code: "133741", name: "Bitcoin Futures (CME)", assetClass: "Crypto" },
];

function computeCftcFridayReleaseUtc(tuesdayReportDate: string): string {
  const dt = new Date(`${tuesdayReportDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) {
    return `${tuesdayReportDate.slice(0, 10)}T20:30:00Z`;
  }
  const friday = new Date(dt.getTime() + 3 * 86400000);
  return `${friday.toISOString().slice(0, 10)}T20:30:00Z`;
}

function classifyWeeklyFreshness(reportDate: string): SyncStatusType {
  const ageDays = (Date.now() - Date.parse(`${reportDate}T20:30:00Z`)) / 86400000;
  if (!Number.isFinite(ageDays)) return "DELAYED";
  if (ageDays > 12) return "STALE";
  if (ageDays > 8) return "DELAYED";
  return "CURRENT";
}

/**
 * Worker 4: CFTC Institutional Positioning Engine.
 * Syncs weekly Tuesday-close COT reports released Fridays 15:30 ET with retry/backoff,
 * validateAndNormalizeObservation, and Non-Commercial/Commercial/Non-Reportable breakdown.
 */
export async function runPositioningEngineSync(options?: {
  trigger?: TriggerType;
}): Promise<WorkerExecutionSummary> {
  const startedAtMs = Date.now();
  await seedDataSourcesIfNeeded();

  const run = await recordSyncRunStart({
    workerId: "positioning-engine",
    sourceId: "cftc",
    jobName: "cftc-cot-weekly-sync",
    triggerType: options?.trigger ?? "scheduled",
    maxAttempts: 4,
  });

  const nowIso = new Date().toISOString();
  const cftcEnabled =
    typeof window === "undefined" && process.env.ENABLE_PUBLIC_CFTC_LIVE?.trim() === "true";

  if (!cftcEnabled) {
    const latencyMs = Date.now() - startedAtMs;
    await updateDataHealth({
      id: "source:cftc",
      entityType: "source",
      sourceId: "cftc",
      workerId: "positioning-engine",
      status: "DISCONNECTED",
      lastAttemptAt: nowIso,
      latencyMs,
      lastError: "ENABLE_PUBLIC_CFTC_LIVE is not enabled; reference snapshot only",
      details: { disabledByFlag: true, configured: false },
    });
    await updateDataHealth({
      id: "worker:positioning-engine",
      entityType: "worker",
      workerId: "positioning-engine",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      latencyMs,
      lastError: null,
      details: {
        cftcLiveConfigured: false,
        referenceSnapshotActive: true,
      },
    });
    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: 0,
      recordsValidated: 0,
      recordsUpserted: 0,
      recordsRejected: CFTC_CONTRACTS.length,
      rawPayload: { mode: "DISCONNECTED", reason: "ENABLE_PUBLIC_CFTC_LIVE_disabled" },
    });

    return {
      runId: run.id,
      workerId: "positioning-engine",
      providerId: "cftc",
      status: "SUCCEEDED",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: CFTC_CONTRACTS.length,
      anomaliesDetected: 0,
      latencyMs,
    };
  }

  const [latestList, existingHealth] = await Promise.all([
    getLatestValues(),
    listDataHealth(),
  ]);
  const latestMap = new Map(latestList.map((v) => [v.seriesKey, v]));
  const healthMap = new Map(existingHealth.map((h) => [h.id, h]));

  let recordsFetched = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  let anomaliesDetected = 0;
  let failedContracts = 0;
  let totalAttempts = 0;
  const allRetryDelaysMs: number[] = [];
  let latestObservedStatus: SyncStatusType = "CURRENT";

  for (const contract of CFTC_CONTRACTS) {
    const res = await fetchCftcLegacyContractRows(contract.code, 156);
    totalAttempts += res.attempts;
    allRetryDelaysMs.push(...res.retryDelaysMs);

    if (!res.ok || res.rows.length === 0) {
      failedContracts += 1;
      anomaliesDetected += 1;
      await recordAnomaly({
        seriesKey: `COT_NET_${contract.symbol}`,
        sourceId: "cftc",
        workerId: "positioning-engine",
        severity: "WARN",
        anomalyType: "TRANSPORT_FAILURE",
        message: `CFTC fetch failed for ${contract.name} (${contract.code}) after ${res.attempts} attempt(s): ${res.reason ?? "empty_rows"}`,
      });
      continue;
    }

    const parsed = res.rows
      .map((row) => {
        const dateStr = row.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? "";
        const ncLong = Number(row.noncomm_positions_long_all);
        const ncShort = Number(row.noncomm_positions_short_all);
        const cLong = Number(row.comm_positions_long_all);
        const cShort = Number(row.comm_positions_short_all);
        const nrLong = Number(row.nonrept_positions_long_all ?? "0");
        const nrShort = Number(row.nonrept_positions_short_all ?? "0");
        const oi = Number(row.open_interest_all);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
          !Number.isFinite(ncLong) ||
          !Number.isFinite(ncShort) ||
          !Number.isFinite(cLong) ||
          !Number.isFinite(cShort) ||
          !Number.isFinite(oi)
        ) {
          return null;
        }
        return {
          reportDate: dateStr,
          publishedAt: computeCftcFridayReleaseUtc(dateStr),
          nonCommercialLong: ncLong,
          nonCommercialShort: ncShort,
          nonCommercialNet: ncLong - ncShort,
          commercialLong: cLong,
          commercialShort: cShort,
          commercialNet: cLong - cShort,
          nonReportableLong: Number.isFinite(nrLong) ? nrLong : 0,
          nonReportableShort: Number.isFinite(nrShort) ? nrShort : 0,
          nonReportableNet:
            (Number.isFinite(nrLong) ? nrLong : 0) - (Number.isFinite(nrShort) ? nrShort : 0),
          openInterest: oi,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate));

    if (parsed.length === 0) {
      recordsSkipped += 1;
      continue;
    }

    recordsFetched += parsed.length;
    const nets = parsed.map((p) => p.nonCommercialNet);
    const minNet = Math.min(...nets);
    const maxNet = Math.max(...nets);
    const span = Math.max(1, maxNet - minNet);

    const latest = parsed[parsed.length - 1];
    const prior = parsed.length >= 2 ? parsed[parsed.length - 2] : null;
    const percentile = Math.round(((latest.nonCommercialNet - minNet) / span) * 100);
    const signal =
      percentile >= 80 ? "Extreme Long" : percentile <= 20 ? "Extreme Short" : "Neutral";
    const status = classifyWeeklyFreshness(latest.reportDate);
    latestObservedStatus = status;

    const seriesKey = `COT_NET_${contract.symbol}`;
    const checkpointKey = `positioning-engine:cftc:${contract.symbol}`;
    const [prevCheckpoint, history] = await Promise.all([
      getCheckpoint(checkpointKey),
      getObservations(seriesKey, 120),
    ]);

    const validation = await validateAndNormalizeObservation(
      {
        seriesKey,
        sourceId: "cftc",
        externalSeriesId: contract.code,
        observationDate: latest.reportDate,
        publishedAt: latest.publishedAt,
        value: latest.nonCommercialNet,
        previousValue: prior ? prior.nonCommercialNet : null,
        unit: "Contracts",
        expectedUnit: "Contracts",
        cadence: "WEEKLY",
        sourceAttribution: "CFTC · Legacy Futures Commitments of Traders",
        workerId: "positioning-engine",
        status,
        rawPayload: {
          contractName: contract.name,
          assetClass: contract.assetClass,
          nonCommercialLong: latest.nonCommercialLong,
          nonCommercialShort: latest.nonCommercialShort,
          nonCommercialNet: latest.nonCommercialNet,
          commercialLong: latest.commercialLong,
          commercialShort: latest.commercialShort,
          commercialNet: latest.commercialNet,
          nonReportableNet: latest.nonReportableNet,
          openInterest: latest.openInterest,
          weeklyDelta: prior ? latest.nonCommercialNet - prior.nonCommercialNet : 0,
          percentile3Y: percentile,
          signal,
          releaseSchedule: "Friday 15:30 ET",
        },
      },
      {
        historicalObservations: history,
        latestValue: latestMap.get(seriesKey) ?? null,
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

    await upsertCheckpoint({
      checkpointKey,
      workerId: "positioning-engine",
      sourceId: "cftc",
      cursorValue: latest.reportDate,
      lastObservationDate: latest.reportDate,
      lastPublishedAt: latest.publishedAt,
      retryCount: 0,
      nextRetryAt: null,
      metadata: {
        previousCursor: prevCheckpoint?.cursorValue ?? null,
        percentile,
        signal,
      },
    });
  }

  const latencyMs = Date.now() - startedAtMs;
  const allFailed = failedContracts === CFTC_CONTRACTS.length;
  const deadLetter = allFailed && allRetryDelaysMs.length > 0;
  const finalStatus = deadLetter
    ? "DEAD_LETTER"
    : allFailed
    ? "FAILED"
    : failedContracts > 0
    ? "PARTIAL"
    : "SUCCEEDED";

  const prevCftc = healthMap.get("source:cftc");

  await updateDataHealth({
    id: "source:cftc",
    entityType: "source",
    sourceId: "cftc",
    workerId: "positioning-engine",
    status: allFailed ? "FAILED" : latestObservedStatus,
    lastSuccessAt: allFailed ? undefined : nowIso,
    lastAttemptAt: nowIso,
    consecutiveFailures: allFailed ? (prevCftc?.consecutiveFailures ?? 0) + 1 : 0,
    latencyMs,
    lastError: allFailed ? "All CFTC contract queries failed" : null,
    details: { configured: true },
  });
  await updateDataHealth({
    id: "worker:positioning-engine",
    entityType: "worker",
    workerId: "positioning-engine",
    status: "CURRENT",
    lastSuccessAt: nowIso,
    lastAttemptAt: nowIso,
    consecutiveFailures: 0,
    latencyMs,
    lastError: allFailed ? "All live CFTC contract queries failed; serving institutional COT reference snapshot" : null,
    details: {
      cftcLiveConfigured: true,
      referenceSnapshotActive: allFailed,
    },
  });

  await completeSyncRun(run.id, {
    status: finalStatus,
    deadLettered: deadLetter,
    recordsFetched,
    recordsValidated: recordsInserted + recordsUpdated,
    recordsUpserted: recordsInserted + recordsUpdated,
    recordsRejected: recordsSkipped,
    errorCode: allFailed ? "CFTC_SYNC_FAILED" : null,
    errorMessage: allFailed ? "CFTC Socrata positioning fetch failed after retries" : null,
    rawPayload: {
      totalAttempts,
      retryCount: allRetryDelaysMs.length,
      retryDelaysMs: allRetryDelaysMs,
    },
  });

  return {
    runId: run.id,
    workerId: "positioning-engine",
    providerId: "cftc",
    status: finalStatus,
    recordsInserted,
    recordsUpdated,
    recordsSkipped,
    anomaliesDetected,
    latencyMs,
    ...(deadLetter ? { deadLetter: true } : {}),
  };
}
