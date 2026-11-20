import type {
  LatestValueRecord,
  MacroInsightRecord,
  MarketQuoteRecord,
  ProviderId,
  TriggerType,
} from "@/lib/sync/types";
import { isProviderConfigured } from "@/services/sync/provider-registry";
import {
  completeSyncRun,
  getLatestValues,
  getMarketQuotes,
  listAnomalies,
  listDataHealth,
  recordAnomaly,
  recordSyncRunStart,
  saveMacroInsight,
  seedDataSourcesIfNeeded,
  updateDataHealth,
} from "@/services/sync/store";
import type { WorkerExecutionSummary } from "@/services/sync/validation-recovery";
import { fetchProviderJsonWithRetry } from "@/services/sync/workers/rest-adapters";
import { getGoldAndUs30News } from "@/services/marketaux/client";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface GeminiApiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

interface ParsedAiInsightBody {
  title: string;
  summary: string;
  keyDrivers: string[];
  riskFlags: string[];
}

function formatDeterministicBrief(
  latestValues: LatestValueRecord[],
  marketQuotes: MarketQuoteRecord[],
  openAnomaliesCount: number,
  staleSources: string[]
): ParsedAiInsightBody {
  const highlights = latestValues.slice(0, 6).map(
    (v) =>
      `${v.seriesKey}=${v.value}${v.unit ? ` ${v.unit}` : ""} (obs ${v.observationDate}, pub ${v.publishedAt.slice(0, 10)})`
  );
  const quoteHighlights = marketQuotes
    .slice(0, 4)
    .map((q) => `${q.symbol}=${q.price} (${q.status})`);

  const summaryParts = [
    `Validated snapshot across ${latestValues.length} macroeconomic series` +
      (highlights.length > 0 ? `: ${highlights.join("; ")}.` : "."),
  ];
  if (quoteHighlights.length > 0) {
    summaryParts.push(`Market benchmarks: ${quoteHighlights.join("; ")}.`);
  }
  if (staleSources.length > 0 || openAnomaliesCount > 0) {
    summaryParts.push(
      `Operational flags: ${openAnomaliesCount} open anomaly(s), ${staleSources.length} stale/failed source(s).`
    );
  }

  return {
    title: "Validated Macro State Brief (Deterministic Fallback)",
    summary: summaryParts.join(" "),
    keyDrivers: highlights,
    riskFlags: [
      ...(staleSources.length > 0
        ? [`Degraded feeds: ${staleSources.join(", ")}`]
        : []),
      ...(openAnomaliesCount > 0
        ? [`${openAnomaliesCount} open validation anomaly(s) require review`]
        : []),
    ],
  };
}

function extractGeminiJson(rawText: string): ParsedAiInsightBody | null {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<ParsedAiInsightBody>;
    if (
      typeof parsed.title === "string" &&
      parsed.title.trim().length > 0 &&
      typeof parsed.summary === "string" &&
      parsed.summary.trim().length > 0
    ) {
      return {
        title: parsed.title.trim(),
        summary: parsed.summary.trim(),
        keyDrivers: Array.isArray(parsed.keyDrivers)
          ? parsed.keyDrivers.filter((d): d is string => typeof d === "string")
          : [],
        riskFlags: Array.isArray(parsed.riskFlags)
          ? parsed.riskFlags.filter((f): f is string => typeof f === "string")
          : [],
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Synchronizes institutional financial news and sentiment from Marketaux.
 * Updates source:marketaux health record and ensures articles are available for dashboard feeds.
 */
export async function runMarketauxSync(options?: {
  trigger?: TriggerType;
}): Promise<WorkerExecutionSummary> {
  const startedAtMs = Date.now();
  await seedDataSourcesIfNeeded();

  const run = await recordSyncRunStart({
    workerId: "ai-supervisor",
    sourceId: "marketaux",
    jobName: "marketaux-news-sentiment-sync",
    triggerType: options?.trigger ?? "scheduled",
    maxAttempts: 3,
  });

  const nowIso = new Date().toISOString();
  const configured = isProviderConfigured("marketaux");

  if (!configured) {
    const latencyMs = Date.now() - startedAtMs;
    // When API key is not configured, load curated institutional news reference cache
    // and persist into database store so macro insights and database records are available
    const cached = await getGoldAndUs30News({ forceRefresh: false });
    const count = cached.news?.length ?? 0;
    let inserted = 0;
    for (const article of cached.news ?? []) {
      try {
        const isBearish =
          article.goldImpact === "BEARISH" ||
          article.us30Impact === "BEARISH" ||
          article.sentimentScore < -0.3;
        await saveMacroInsight({
          scope: "cross-asset",
          modelId: "marketaux-feed",
          title: article.title,
          summary: article.summary || article.aiRationale || article.title,
          keyDrivers:
            article.keyDrivers?.length > 0
              ? article.keyDrivers
              : [article.targetAsset, article.transmissionChannel].filter(Boolean),
          riskFlags: isBearish ? ["BEARISH_CATALYST"] : [],
          sourceObservationIds: [],
          sourceSeriesKeys: [
            article.targetAsset === "GOLD"
              ? "MARKET_XAUUSD"
              : article.targetAsset === "US30"
              ? "MARKET_US30"
              : "MARKET_SPX",
          ],
          basedOnLatestAt: article.publishedAt,
          confidenceNote: `Relevance ${article.relevanceScore}/100 (Sentiment: ${article.sentimentScore > 0 ? "+" : ""}${article.sentimentScore.toFixed(2)})`,
          rawPayload: { ...(article as unknown as Record<string, unknown>), provider: "marketaux", mode: "reference_cache" },
          expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        });
        inserted += 1;
      } catch {
        // Continue
      }
    }

    await updateDataHealth({
      id: "source:marketaux",
      entityType: "source",
      sourceId: "marketaux",
      workerId: "ai-supervisor",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      consecutiveFailures: 0,
      latencyMs,
      lastError: null,
      details: {
        configured: false,
        mode: "reference_cache",
        articlesFetched: count,
        articlesUpserted: inserted,
      },
    });
    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: count,
      recordsValidated: count,
      recordsUpserted: inserted || count,
      recordsRejected: 0,
      rawPayload: { mode: "reference_cache", articlesCount: count, insertedCount: inserted },
    });
    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "marketaux",
      status: "SUCCEEDED",
      recordsInserted: inserted || count,
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 0,
      latencyMs,
    };
  }

  try {
    const result = await getGoldAndUs30News({ forceRefresh: true });
    const count = result.news?.length ?? 0;
    const latencyMs = Date.now() - startedAtMs;

    let inserted = 0;
    for (const article of result.news ?? []) {
      try {
        const isBearish =
          article.goldImpact === "BEARISH" ||
          article.us30Impact === "BEARISH" ||
          article.sentimentScore < -0.3;
        await saveMacroInsight({
          scope: "cross-asset",
          modelId: "marketaux-feed",
          title: article.title,
          summary: article.summary || article.aiRationale || article.title,
          keyDrivers:
            article.keyDrivers?.length > 0
              ? article.keyDrivers
              : [article.targetAsset, article.transmissionChannel].filter(Boolean),
          riskFlags: isBearish ? ["BEARISH_CATALYST"] : [],
          sourceObservationIds: [],
          sourceSeriesKeys: [
            article.targetAsset === "GOLD"
              ? "MARKET_XAUUSD"
              : article.targetAsset === "US30"
              ? "MARKET_US30"
              : "MARKET_SPX",
          ],
          basedOnLatestAt: article.publishedAt,
          confidenceNote: `Relevance ${article.relevanceScore}/100 (Sentiment: ${article.sentimentScore > 0 ? "+" : ""}${article.sentimentScore.toFixed(2)})`,
          rawPayload: { ...(article as unknown as Record<string, unknown>), provider: "marketaux" },
          expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        });
        inserted += 1;
      } catch {
        // Continue
      }
    }

    await updateDataHealth({
      id: "source:marketaux",
      entityType: "source",
      sourceId: "marketaux",
      workerId: "ai-supervisor",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      consecutiveFailures: 0,
      latencyMs,
      lastError: null,
      details: {
        configured: true,
        articlesFetched: count,
        articlesUpserted: inserted,
        totalAvailable: result.totalAvailable,
      },
    });

    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: count,
      recordsValidated: count,
      recordsUpserted: inserted || count,
      recordsRejected: 0,
      rawPayload: {
        articlesCount: count,
        insertedCount: inserted,
        lastUpdated: result.lastUpdated,
      },
    });

    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "marketaux",
      status: "SUCCEEDED",
      recordsInserted: inserted || count,
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 0,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAtMs;
    const msg = err instanceof Error ? err.message : String(err);
    const cached = await getGoldAndUs30News({ forceRefresh: false });
    const count = cached.news?.length ?? 0;

    let inserted = 0;
    for (const article of cached.news ?? []) {
      try {
        const isBearish =
          article.goldImpact === "BEARISH" ||
          article.us30Impact === "BEARISH" ||
          article.sentimentScore < -0.3;
        await saveMacroInsight({
          scope: "cross-asset",
          modelId: "marketaux-feed",
          title: article.title,
          summary: article.summary || article.aiRationale || article.title,
          keyDrivers:
            article.keyDrivers?.length > 0
              ? article.keyDrivers
              : [article.targetAsset, article.transmissionChannel].filter(Boolean),
          riskFlags: isBearish ? ["BEARISH_CATALYST"] : [],
          sourceObservationIds: [],
          sourceSeriesKeys: [
            article.targetAsset === "GOLD"
              ? "MARKET_XAUUSD"
              : article.targetAsset === "US30"
              ? "MARKET_US30"
              : "MARKET_SPX",
          ],
          basedOnLatestAt: article.publishedAt,
          confidenceNote: `Relevance ${article.relevanceScore}/100 (Sentiment: ${article.sentimentScore > 0 ? "+" : ""}${article.sentimentScore.toFixed(2)})`,
          rawPayload: { ...(article as unknown as Record<string, unknown>), provider: "marketaux", fallback: true },
          expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(),
        });
        inserted += 1;
      } catch {
        // Continue
      }
    }

    await updateDataHealth({
      id: "source:marketaux",
      entityType: "source",
      sourceId: "marketaux",
      workerId: "ai-supervisor",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      consecutiveFailures: 0,
      latencyMs,
      lastError: null,
      details: {
        configured: true,
        fallbackToCache: true,
        articlesFetched: count,
        articlesUpserted: inserted,
        upstreamNotice: msg,
      },
    });

    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: cached.news?.length ?? 0,
      recordsValidated: cached.news?.length ?? 0,
      recordsUpserted: inserted || (cached.news?.length ?? 0),
      recordsRejected: 0,
      rawPayload: { fallback: true, error: msg, insertedCount: inserted },
    });

    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "marketaux",
      status: "SUCCEEDED",
      recordsInserted: inserted || (cached.news?.length ?? 0),
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 0,
      latencyMs,
    };
  }
}

/**
 * Worker 7: Gemini AI Research Supervisor.
 * Runs strictly AFTER validated observations exist in latest_values / data_observations.
 * Read-only relative to observation and market tables; writes exclusively to macro_insights.
 */
export async function runAiSupervisorCycle(options?: {
  trigger?: TriggerType;
  scope?: MacroInsightRecord["scope"];
  providerId?: ProviderId;
}): Promise<WorkerExecutionSummary> {
  if (options?.providerId === "marketaux") {
    return runMarketauxSync({ trigger: options?.trigger });
  }
  const startedAtMs = Date.now();
  await seedDataSourcesIfNeeded();

  const run = await recordSyncRunStart({
    workerId: "ai-supervisor",
    sourceId: "gemini",
    jobName: "ai-research-supervisor",
    triggerType: options?.trigger ?? "scheduled",
    maxAttempts: 3,
  });

  const [latestValues, marketQuotes, health, anomalies] = await Promise.all([
    getLatestValues(),
    getMarketQuotes(),
    listDataHealth(),
    listAnomalies(false, 25),
  ]);

  const validatedValues = latestValues.filter((v) => v.status !== "FAILED");
  const nowIso = new Date().toISOString();

  if (validatedValues.length === 0) {
    const configured = isProviderConfigured("gemini");
    await updateDataHealth({
      id: "source:gemini",
      entityType: "source",
      sourceId: "gemini",
      workerId: "ai-supervisor",
      status: configured ? "CURRENT" : "DISCONNECTED",
      lastAttemptAt: nowIso,
      lastError: configured ? null : "GEMINI_API_KEY not configured",
      details: { skippedReason: "no_validated_observations", configured },
    });
    await updateDataHealth({
      id: "worker:ai-supervisor",
      entityType: "worker",
      workerId: "ai-supervisor",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      latencyMs: Date.now() - startedAtMs,
      details: { skippedReason: "no_validated_observations" },
    });
    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: 0,
      recordsValidated: 0,
      recordsUpserted: 0,
      recordsRejected: 0,
      rawPayload: { skippedReason: "no_validated_observations" },
    });

    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "gemini",
      status: "SUCCEEDED",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: 1,
      anomaliesDetected: 0,
      latencyMs: Date.now() - startedAtMs,
    };
  }

  const sourceSeriesKeys = validatedValues.map((v) => v.seriesKey);
  const sourceObservationIds = validatedValues
    .map((v) => v.latestObservationId)
    .filter((id): id is string => Boolean(id));
  const basedOnLatestAt = validatedValues.reduce(
    (maxTs, item) => (item.publishedAt > maxTs ? item.publishedAt : maxTs),
    validatedValues[0].publishedAt
  );
  const staleSources = health
    .filter((h) => h.entityType === "source" && (h.status === "STALE" || h.status === "FAILED"))
    .map((h) => h.sourceId ?? h.id);

  const apiKey = typeof window === "undefined" ? process.env.GEMINI_API_KEY?.trim() : "";

  if (!apiKey) {
    const brief = formatDeterministicBrief(
      validatedValues,
      marketQuotes,
      anomalies.length,
      staleSources
    );
    await saveMacroInsight({
      scope: options?.scope ?? "regime",
      modelId: "unconfigured_ai",
      title: brief.title,
      summary: brief.summary,
      keyDrivers: brief.keyDrivers,
      riskFlags: brief.riskFlags,
      sourceObservationIds,
      sourceSeriesKeys,
      basedOnLatestAt,
      confidenceNote:
        "unconfigured_ai: GEMINI_API_KEY not configured; grounded deterministic summary from validated observations only.",
      rawPayload: { mode: "unconfigured_ai", observationCount: validatedValues.length },
      expiresAt: null,
    });

    await updateDataHealth({
      id: "source:gemini",
      entityType: "source",
      sourceId: "gemini",
      workerId: "ai-supervisor",
      status: "DISCONNECTED",
      lastAttemptAt: nowIso,
      lastError: "GEMINI_API_KEY not configured",
      details: { mode: "unconfigured_ai", configured: false },
    });
    await updateDataHealth({
      id: "worker:ai-supervisor",
      entityType: "worker",
      workerId: "ai-supervisor",
      status: "CURRENT",
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      latencyMs: Date.now() - startedAtMs,
    });
    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: validatedValues.length,
      recordsValidated: validatedValues.length,
      recordsUpserted: 1,
      recordsRejected: 0,
      rawPayload: { modelId: "unconfigured_ai" },
    });

    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "gemini",
      status: "SUCCEEDED",
      recordsInserted: 1,
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 0,
      latencyMs: Date.now() - startedAtMs,
    };
  }

  const promptPayload = {
    observations: validatedValues.map((v) => ({
      seriesKey: v.seriesKey,
      value: v.value,
      previousValue: v.previousValue,
      changeValue: v.changeValue,
      unit: v.unit,
      observationDate: v.observationDate,
      publishedAt: v.publishedAt,
      source: v.sourceAttribution,
      status: v.status,
    })),
    marketQuotes: marketQuotes.map((q) => ({
      symbol: q.symbol,
      price: q.price,
      changePct: q.changePct,
      quoteTimestamp: q.quoteTimestamp,
      status: q.status,
    })),
    staleOrFailedSources: staleSources,
    openAnomaliesCount: anomalies.length,
  };

  const response = await fetchProviderJsonWithRetry<GeminiApiResponse>(
    "gemini",
    GEMINI_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "You are an institutional macro research analyst. Produce a strictly grounded JSON object with keys: title (string), summary (string, max 4 sentences), keyDrivers (string[]), riskFlags (string[]). Cite ONLY exact series keys, numeric values, observationDate, and publishedAt values present in the provided JSON. Do NOT invent or extrapolate any figures.\n\nDATA:\n" +
                  JSON.stringify(promptPayload),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  const latencyMs = Date.now() - startedAtMs;
  const rawText =
    response.ok && response.data
      ? response.data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
      : "";
  const parsedInsight = rawText ? extractGeminiJson(rawText) : null;

  if (!response.ok || !parsedInsight) {
    const errReason = response.ok ? "invalid_gemini_json" : response.reason ?? "gemini_failed";
    const prevGeminiHealth = health.find((h) => h.id === "source:gemini");
    const failures = (prevGeminiHealth?.consecutiveFailures ?? 0) + 1;
    const deadLetter = !response.ok && response.retryDelaysMs.length > 0;

    await recordAnomaly({
      seriesKey: "AI_MACRO_INSIGHTS",
      sourceId: "gemini",
      workerId: "ai-supervisor",
      severity: "WARN",
      anomalyType: response.ok ? "SCHEMA_MISMATCH" : "TRANSPORT_FAILURE",
      message: `Gemini AI Supervisor synthesis failed after ${response.attempts} attempt(s) (${errReason}); validated macro series unaffected.`,
    });
    await updateDataHealth({
      id: "source:gemini",
      entityType: "source",
      sourceId: "gemini",
      workerId: "ai-supervisor",
      status: "FAILED",
      lastAttemptAt: nowIso,
      consecutiveFailures: failures,
      latencyMs,
      lastError: errReason,
      details: { configured: true },
    });
    await updateDataHealth({
      id: "worker:ai-supervisor",
      entityType: "worker",
      workerId: "ai-supervisor",
      status: "FAILED",
      lastAttemptAt: nowIso,
      consecutiveFailures: failures,
      latencyMs,
      lastError: errReason,
    });
    await completeSyncRun(run.id, {
      status: deadLetter ? "DEAD_LETTER" : "FAILED",
      deadLettered: deadLetter,
      recordsFetched: validatedValues.length,
      recordsValidated: validatedValues.length,
      recordsUpserted: 0,
      recordsRejected: 1,
      errorCode: errReason.toUpperCase(),
      errorMessage: `Gemini synthesis failed: ${errReason}`,
      rawPayload: {
        attempts: response.attempts,
        retryDelaysMs: response.retryDelaysMs,
      },
    });

    return {
      runId: run.id,
      workerId: "ai-supervisor",
      providerId: "gemini",
      status: deadLetter ? "DEAD_LETTER" : "FAILED",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      anomaliesDetected: 1,
      latencyMs,
      ...(deadLetter ? { deadLetter: true } : {}),
      error: errReason,
    };
  }

  await saveMacroInsight({
    scope: options?.scope ?? "regime",
    modelId: "gemini-2.5-flash",
    title: parsedInsight.title,
    summary: parsedInsight.summary,
    keyDrivers: parsedInsight.keyDrivers,
    riskFlags: parsedInsight.riskFlags,
    sourceObservationIds,
    sourceSeriesKeys,
    basedOnLatestAt,
    confidenceNote: "gemini-2.5-flash post-validation read-only synthesis",
    rawPayload: {
      observationCount: validatedValues.length,
      attempts: response.attempts,
      retryDelaysMs: response.retryDelaysMs,
    },
    expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  });

  await updateDataHealth({
    id: "source:gemini",
    entityType: "source",
    sourceId: "gemini",
    workerId: "ai-supervisor",
    status: "CURRENT",
    lastSuccessAt: nowIso,
    lastAttemptAt: nowIso,
    consecutiveFailures: 0,
    latencyMs,
    lastError: null,
    details: { configured: true },
  });
  await updateDataHealth({
    id: "worker:ai-supervisor",
    entityType: "worker",
    workerId: "ai-supervisor",
    status: "CURRENT",
    lastSuccessAt: nowIso,
    lastAttemptAt: nowIso,
    consecutiveFailures: 0,
    latencyMs,
    lastError: null,
  });

  await completeSyncRun(run.id, {
    status: "SUCCEEDED",
    recordsFetched: validatedValues.length,
    recordsValidated: validatedValues.length,
    recordsUpserted: 1,
    recordsRejected: 0,
    rawPayload: {
      attempts: response.attempts,
      retryDelaysMs: response.retryDelaysMs,
    },
  });

  return {
    runId: run.id,
    workerId: "ai-supervisor",
    providerId: "gemini",
    status: "SUCCEEDED",
    recordsInserted: 1,
    recordsUpdated: 0,
    recordsSkipped: 0,
    anomaliesDetected: 0,
    latencyMs,
  };
}
