import type { DataCadence } from "@/lib/types";

export type SyncStatusType =
  | "LIVE"
  | "CURRENT"
  | "DELAYED"
  | "STALE"
  | "FAILED"
  | "DISCONNECTED";

export type WorkerId =
  | "orchestrator"
  | "market-engine"
  | "macro-engine"
  | "positioning-engine"
  | "liquidity-risk-engine"
  | "validation-recovery"
  | "ai-supervisor";

export type ProviderId =
  | "fred"
  | "bls"
  | "bea"
  | "us_treasury"
  | "fed_reserve"
  | "cftc"
  | "coinbase_ws"
  | "twelve_data_ws"
  | "finnhub_ws"
  | "polygon_ws"
  | "api_ninjas"
  | "yfinance"
  | "marketaux"
  | "gemini";

export type ProviderCategory =
  | "macro"
  | "market"
  | "positioning"
  | "liquidity"
  | "ai";

export type ProviderTransport = "rest" | "websocket" | "ai";

export type MarketSymbol =
  | "XAUUSD"
  | "BTCUSD"
  | "US30"
  | "SPX500"
  | "DXY"
  | "EURUSD"
  | "USDJPY"
  | "GBPUSD"
  | "USDCHF"
  | "AUDUSD"
  | "USDCAD"
  | "US2Y"
  | "US10Y"
  | "US30Y";

export type BarTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type ValidationStatus = "VALIDATED" | "SUSPECT" | "REJECTED";

export type SyncRunStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "DEAD_LETTER";

export type TriggerType = "scheduled" | "manual" | "recovery" | "startup";

export type AnomalySeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export type AnomalyType =
  | "STALE_DATA"
  | "OUTLIER_SPIKE"
  | "MISSING_FIELD"
  | "SCHEMA_MISMATCH"
  | "NON_MONOTONIC_REJECTED"
  | "RATE_LIMIT"
  | "TRANSPORT_FAILURE";

export interface RateLimitPolicy {
  requestsPerMinute: number;
  burstLimit: number;
  minSpacingMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  category: ProviderCategory;
  transport: ProviderTransport;
  ownerWorker: WorkerId;
  cadence: DataCadence;
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
  timeoutMs: number;
  maxRetries: number;
  retryableStatusCodes: number[];
  rateLimit: RateLimitPolicy;
  requiresApiKey: boolean;
  envVarName: string | null;
  baseUrl: string;
  wsUrl?: string;
  attribution: string;
  enabledByDefault: boolean;
}

export interface InstrumentMapping {
  symbol: MarketSymbol;
  name: string;
  assetClass: "Commodities" | "Crypto" | "Equities" | "FX" | "Rates";
  unit: string;
  decimals: number;
  primaryProvider: ProviderId;
  fallbackProviders: ProviderId[];
  externalSymbols: Partial<Record<ProviderId, string>>;
  minValidValue: number;
  maxValidValue: number;
  maxStepPct: number;
}

export interface SeriesMapping {
  seriesKey: string;
  label: string;
  category: "inflation" | "growth" | "labor" | "rates" | "liquidity" | "credit" | "positioning";
  primaryProvider: ProviderId;
  fallbackProvider?: ProviderId;
  externalSeriesId: string;
  fallbackExternalSeriesId?: string;
  unit: string;
  cadence: DataCadence;
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
  minValidValue: number;
  maxValidValue: number;
  maxStepAbs?: number;
  sourceAttribution: string;
}

export interface DataSourceRecord {
  id: ProviderId;
  name: string;
  category: ProviderCategory;
  transport: ProviderTransport;
  cadence: DataCadence;
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
  rateLimitRpm: number;
  timeoutMs: number;
  maxRetries: number;
  requiresApiKey: boolean;
  envVarName: string | null;
  baseUrl: string;
  attribution: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ObservationRecord {
  id: string;
  seriesKey: string;
  sourceId: ProviderId;
  externalSeriesId: string;
  observationDate: string;
  publishedAt: string;
  fetchedAt: string;
  value: number;
  previousValue: number | null;
  unit: string;
  cadence: DataCadence;
  revisionNumber: number;
  isLatest: boolean;
  validationStatus: ValidationStatus;
  checksum: string;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface LatestValueRecord {
  seriesKey: string;
  sourceId: ProviderId;
  externalSeriesId: string;
  latestObservationId: string | null;
  observationDate: string;
  publishedAt: string;
  fetchedAt: string;
  value: number;
  previousValue: number | null;
  changeValue: number | null;
  changePct: number | null;
  unit: string;
  cadence: DataCadence;
  status: SyncStatusType;
  revisionNumber: number;
  sourceAttribution: string;
  rawPayload: Record<string, unknown>;
  updatedAt: string;
}

export interface MarketQuoteRecord {
  symbol: MarketSymbol;
  sourceId: ProviderId;
  externalSymbol: string;
  assetClass: InstrumentMapping["assetClass"];
  price: number;
  bid: number | null;
  ask: number | null;
  previousClose: number | null;
  changeValue: number;
  changePct: number;
  volume: number | null;
  unit: string;
  tickSeq: number;
  quoteTimestamp: string;
  receivedAt: string;
  status: SyncStatusType;
  dedupHash: string;
  rawPayload: Record<string, unknown>;
  updatedAt: string;
}

export interface MarketBarRecord {
  id: string;
  symbol: MarketSymbol;
  sourceId: ProviderId;
  timeframe: BarTimeframe;
  barTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  isClosed: boolean;
  rawPayload: Record<string, unknown>;
  updatedAt: string;
}

export interface SyncRunRecord {
  id: string;
  workerId: WorkerId;
  sourceId: ProviderId | null;
  jobName: string;
  triggerType: TriggerType;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsFetched: number;
  recordsValidated: number;
  recordsUpserted: number;
  recordsRejected: number;
  attempt: number;
  maxAttempts: number;
  deadLettered: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  rawPayload: Record<string, unknown>;
}

export interface DataHealthRecord {
  id: string;
  entityType: "source" | "worker";
  sourceId: ProviderId | null;
  workerId: WorkerId | null;
  status: SyncStatusType;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  nextScheduledAt: string | null;
  freshnessSeconds: number | null;
  consecutiveFailures: number;
  latencyMs: number | null;
  lastError: string | null;
  details: Record<string, unknown>;
  updatedAt: string;
}

export interface DataAnomalyRecord {
  id: string;
  seriesKey: string;
  sourceId: ProviderId | null;
  workerId: WorkerId;
  severity: AnomalySeverity;
  anomalyType: AnomalyType;
  message: string;
  observedValue: string | null;
  expectedRange: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  rawPayload: Record<string, unknown>;
  detectedAt: string;
}

export interface SyncCheckpointRecord {
  checkpointKey: string;
  workerId: WorkerId;
  sourceId: ProviderId | null;
  cursorValue: string | null;
  lastObservationDate: string | null;
  lastPublishedAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface MacroInsightRecord {
  id: string;
  scope: "regime" | "inflation" | "rates" | "positioning" | "liquidity" | "cross-asset";
  modelId: string;
  title: string;
  summary: string;
  keyDrivers: string[];
  riskFlags: string[];
  sourceObservationIds: string[];
  sourceSeriesKeys: string[];
  basedOnLatestAt: string;
  confidenceNote: string;
  rawPayload: Record<string, unknown>;
  generatedAt: string;
  expiresAt: string | null;
}

export interface ProviderAuthStatus {
  providerId: ProviderId;
  name: string;
  transport: ProviderTransport;
  ownerWorker: WorkerId;
  requiresApiKey: boolean;
  configured: boolean;
  status: SyncStatusType;
  expectedIntervalSeconds: number;
  staleAfterSeconds: number;
}

export interface SyncSystemSnapshot {
  persistenceMode: "SUPABASE_POSTGRES" | "LOCAL_DURABLE_STORE";
  generatedAt: string;
  overallStatus: SyncStatusType;
  providers: ProviderAuthStatus[];
  dataSources: DataSourceRecord[];
  latestValues: LatestValueRecord[];
  marketQuotes: MarketQuoteRecord[];
  recentBars: MarketBarRecord[];
  recentRuns: SyncRunRecord[];
  health: DataHealthRecord[];
  anomalies: DataAnomalyRecord[];
  checkpoints: SyncCheckpointRecord[];
  insights: MacroInsightRecord[];
  counts: {
    observations: number;
    latestValues: number;
    marketQuotes: number;
    marketBars: number;
    openAnomalies: number;
    deadLetterRuns: number;
  };
}

export interface UpsertObservationInput {
  seriesKey: string;
  sourceId: ProviderId;
  externalSeriesId: string;
  observationDate: string;
  publishedAt: string;
  value: number;
  previousValue: number | null;
  unit: string;
  cadence: DataCadence;
  sourceAttribution: string;
  status?: SyncStatusType;
  validationStatus?: ValidationStatus;
  rawPayload?: Record<string, unknown>;
  workerId?: WorkerId;
}

export interface UpsertObservationResult {
  accepted: boolean;
  status:
    | "UPSERTED"
    | "UNCHANGED"
    | "VINTAGE_ONLY_OLDER_THAN_LATEST"
    | "REJECTED_OLDER_VINTAGE"
    | "REJECTED_INVALID";
  observationId: string | null;
  latestUpdated: boolean;
  revisionNumber: number;
}

export interface UpsertMarketQuoteInput {
  symbol: MarketSymbol;
  sourceId: ProviderId;
  externalSymbol: string;
  assetClass: InstrumentMapping["assetClass"];
  price: number;
  bid?: number | null;
  ask?: number | null;
  previousClose?: number | null;
  changeValue?: number;
  changePct?: number;
  volume?: number | null;
  unit?: string;
  tickSeq?: number;
  quoteTimestamp: string;
  status?: SyncStatusType;
  rawPayload?: Record<string, unknown>;
}

export interface UpsertMarketQuoteResult {
  accepted: boolean;
  symbol: MarketSymbol;
  reason?: "DEDUP_OR_STALE_TICK";
}

export interface AggregateMarketBarInput {
  symbol: MarketSymbol;
  sourceId: ProviderId;
  timeframe: BarTimeframe;
  barTime: string;
  price: number;
  volume?: number;
  isClosed?: boolean;
  rawPayload?: Record<string, unknown>;
}
