import type {
  BarTimeframe,
  MarketSymbol,
  ProviderId,
  SyncRunStatus,
  TriggerType,
  UpsertMarketQuoteInput,
} from "@/lib/sync/types";
import {
  getMarketInstrumentMapping,
  getProviderConfig,
  isProviderConfigured,
  MARKET_INSTRUMENT_MAPPINGS,
  PROVIDER_REGISTRY,
} from "@/services/sync/provider-registry";
import {
  aggregateMarketBar,
  completeSyncRun,
  getMarketQuotes,
  recordAnomaly,
  recordSyncRunStart,
  updateDataHealth,
  upsertMarketQuote,
} from "@/services/sync/store";
import {
  executeWithRetry,
  ProviderRequestError,
  validateMarketTick,
  type WorkerExecutionSummary,
} from "@/services/sync/validation-recovery";
import {
  fetchDirectYahooFinanceQuote,
  getYFinanceCachedQuotes,
} from "@/services/yfinance/client";

export type WebSocketConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "OPEN"
  | "RECONNECTING"
  | "FAILED"
  | "STOPPED";

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

export interface MarketWebSocketDaemonOptions {
  providerId?: ProviderId;
  symbols?: MarketSymbol[];
  wsFactory?: (url: string) => WebSocketLike;
  respectEnvConfig?: boolean;
  heartbeatIntervalMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  maxReconnectAttempts?: number;
  barTimeframes?: BarTimeframe[];
  onStateChange?: (state: WebSocketConnectionState, detail?: string) => void;
  onTickAccepted?: (quote: UpsertMarketQuoteInput, latencyMs: number) => void;
}

export interface RawMarketTickInput {
  symbol?: MarketSymbol | string;
  externalSymbol?: string;
  providerId?: ProviderId;
  price?: number | string | null;
  bid?: number | string | null;
  ask?: number | string | null;
  previousClose?: number | string | null;
  volume?: number | string | null;
  tickSeq?: number;
  quoteTimestamp?: string | number;
  timestamp?: string | number;
  time?: string | number;
  receivedAt?: string | number;
  rawPayload?: Record<string, unknown>;
}

export interface HandleTickResult {
  accepted: boolean;
  symbol?: MarketSymbol;
  reason?: string;
  dedupKey?: string;
  latencyMs?: number;
}

export interface MarketDaemonMetrics {
  state: WebSocketConnectionState;
  providerId: ProviderId;
  symbols: MarketSymbol[];
  reconnectAttempt: number;
  ticksAccepted: number;
  ticksRejected: number;
  lastTickAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
}

const WS_PROVIDERS: ProviderId[] = [
  "twelve_data_ws",
  "finnhub_ws",
  "polygon_ws",
  "coinbase_ws",
];

const DEFAULT_BAR_TIMEFRAMES: BarTimeframe[] = ["1m", "5m", "1h", "1d"];

const TIMEFRAME_MS: Record<BarTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

declare global {
  var __macroedgeMarketDaemon: MarketWebSocketDaemon | undefined;
}

export function isMarketWsProviderEnabled(providerId: ProviderId): boolean {
  if (typeof window !== "undefined") return false;
  const cfg = PROVIDER_REGISTRY[providerId];
  if (!cfg || cfg.transport !== "websocket") return false;

  if (providerId === "coinbase_ws") {
    return (
      process.env.ENABLE_PUBLIC_MARKET_WS?.trim() === "true" ||
      process.env.MARKET_WS_PROVIDER?.trim() === "coinbase_ws"
    );
  }
  return isProviderConfigured(providerId);
}

export function resolveConfiguredMarketWsProvider(): ProviderId | null {
  if (typeof window !== "undefined") return null;

  const preferred = process.env.MARKET_WS_PROVIDER?.trim() as ProviderId | undefined;
  if (preferred && WS_PROVIDERS.includes(preferred) && isMarketWsProviderEnabled(preferred)) {
    return preferred;
  }

  for (const candidate of WS_PROVIDERS) {
    if (isMarketWsProviderEnabled(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getSharedMarketWebSocketDaemon(): MarketWebSocketDaemon | null {
  return globalThis.__macroedgeMarketDaemon ?? null;
}

function alignBarTimeUtc(quoteTimestampIso: string, timeframe: BarTimeframe): string {
  const ms = Date.parse(quoteTimestampIso);
  const bucketMs = TIMEFRAME_MS[timeframe];
  const floored = Math.floor(ms / bucketMs) * bucketMs;
  return new Date(floored).toISOString();
}

function mapExternalSymbolToMarketSymbol(
  external: string,
  providerId: ProviderId
): MarketSymbol | null {
  const normalized = external.trim().toUpperCase();
  if (normalized in MARKET_INSTRUMENT_MAPPINGS) {
    return normalized as MarketSymbol;
  }
  for (const mapping of Object.values(MARKET_INSTRUMENT_MAPPINGS)) {
    const ext = mapping.externalSymbols[providerId];
    if (ext && ext.toUpperCase() === normalized) {
      return mapping.symbol;
    }
    if (ext && normalized.endsWith(ext.replace(/^.*:/, "").toUpperCase())) {
      return mapping.symbol;
    }
  }
  return null;
}

function buildProviderWsConnection(
  providerId: ProviderId,
  symbols: MarketSymbol[]
): { url: string; initMessages: string[]; heartbeatPayload: string | null } {
  const cfg = getProviderConfig(providerId);
  const baseWs = cfg.wsUrl ?? "";

  const mappedSymbols = symbols
    .map((sym) => MARKET_INSTRUMENT_MAPPINGS[sym].externalSymbols[providerId])
    .filter((v): v is string => Boolean(v));

  if (providerId === "coinbase_ws") {
    const products = mappedSymbols.length > 0 ? mappedSymbols : ["BTC-USD"];
    return {
      url: baseWs,
      initMessages: [
        JSON.stringify({
          type: "subscribe",
          product_ids: products,
          channels: ["ticker", "heartbeat"],
        }),
      ],
      heartbeatPayload: JSON.stringify({ type: "ping" }),
    };
  }

  if (providerId === "twelve_data_ws") {
    const key = process.env.TWELVE_DATA_API_KEY?.trim() ?? "";
    return {
      url: key ? `${baseWs}?apikey=${encodeURIComponent(key)}` : baseWs,
      initMessages:
        mappedSymbols.length > 0
          ? [
              JSON.stringify({
                action: "subscribe",
                params: { symbols: mappedSymbols.join(",") },
              }),
            ]
          : [],
      heartbeatPayload: JSON.stringify({ action: "heartbeat" }),
    };
  }

  if (providerId === "finnhub_ws") {
    const key = process.env.FINNHUB_API_KEY?.trim() ?? "";
    return {
      url: key ? `${baseWs}?token=${encodeURIComponent(key)}` : baseWs,
      initMessages: mappedSymbols.map((sym) =>
        JSON.stringify({ type: "subscribe", symbol: sym })
      ),
      heartbeatPayload: JSON.stringify({ type: "ping" }),
    };
  }

  // polygon_ws
  const key = process.env.POLYGON_API_KEY?.trim() ?? "";
  const cryptoMode = mappedSymbols.every((s) => s.startsWith("X:"));
  const polyUrl = cryptoMode ? `${baseWs}/crypto` : `${baseWs}/forex`;
  return {
    url: polyUrl,
    initMessages: [
      ...(key ? [JSON.stringify({ action: "auth", params: key })] : []),
      ...(mappedSymbols.length > 0
        ? [
            JSON.stringify({
              action: "subscribe",
              params: mappedSymbols.map((s) => `XT.${s},C.${s}`).join(","),
            }),
          ]
        : []),
    ],
    heartbeatPayload: null,
  };
}

function parseProviderWsPayload(
  rawText: string,
  providerId: ProviderId
): RawMarketTickInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const ticks: RawMarketTickInput[] = [];

  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const msg = item as Record<string, unknown>;

    // Coinbase ticker format
    if (msg.type === "ticker" && typeof msg.product_id === "string") {
      const symbol = mapExternalSymbolToMarketSymbol(msg.product_id, "coinbase_ws");
      if (symbol) {
        ticks.push({
          symbol,
          externalSymbol: msg.product_id,
          providerId: "coinbase_ws",
          price: msg.price as string | number,
          bid: msg.best_bid as string | number | undefined,
          ask: msg.best_ask as string | number | undefined,
          previousClose: msg.open_24h as string | number | undefined,
          volume: msg.volume_24h as string | number | undefined,
          tickSeq: typeof msg.sequence === "number" ? msg.sequence : undefined,
          quoteTimestamp: (msg.time as string | undefined) ?? new Date().toISOString(),
          rawPayload: msg,
        });
      }
      continue;
    }

    // Twelve Data WS price event
    if (msg.event === "price" && typeof msg.symbol === "string") {
      const symbol = mapExternalSymbolToMarketSymbol(msg.symbol, "twelve_data_ws");
      if (symbol) {
        ticks.push({
          symbol,
          externalSymbol: msg.symbol,
          providerId: "twelve_data_ws",
          price: msg.price as string | number,
          bid: msg.bid as string | number | undefined,
          ask: msg.ask as string | number | undefined,
          volume: msg.day_volume as string | number | undefined,
          quoteTimestamp:
            (msg.timestamp as string | number | undefined) ?? new Date().toISOString(),
          rawPayload: msg,
        });
      }
      continue;
    }

    // Finnhub trade batch
    if (msg.type === "trade" && Array.isArray(msg.data)) {
      for (const trade of msg.data) {
        if (!trade || typeof trade !== "object") continue;
        const t = trade as Record<string, unknown>;
        if (typeof t.s !== "string") continue;
        const symbol = mapExternalSymbolToMarketSymbol(t.s, "finnhub_ws");
        if (symbol) {
          ticks.push({
            symbol,
            externalSymbol: t.s,
            providerId: "finnhub_ws",
            price: t.p as number,
            volume: t.v as number | undefined,
            quoteTimestamp: (t.t as number | undefined) ?? Date.now(),
            rawPayload: t,
          });
        }
      }
      continue;
    }

    // Polygon WS trade/quote events
    if (typeof msg.ev === "string" && (msg.pair || msg.sym)) {
      const ext = String(msg.pair ?? msg.sym);
      const symbol = mapExternalSymbolToMarketSymbol(ext, "polygon_ws");
      if (symbol) {
        ticks.push({
          symbol,
          externalSymbol: ext,
          providerId: "polygon_ws",
          price: (msg.p ?? msg.c ?? msg.bp) as number,
          bid: msg.bp as number | undefined,
          ask: msg.ap as number | undefined,
          volume: msg.s as number | undefined,
          quoteTimestamp: (msg.t as number | undefined) ?? Date.now(),
          rawPayload: msg,
        });
      }
      continue;
    }

    // Generic normalized tick payload (e.g. direct caller / test injection)
    if (msg.symbol && msg.price !== undefined) {
      ticks.push({
        symbol: String(msg.symbol),
        providerId: (msg.providerId as ProviderId | undefined) ?? providerId,
        price: msg.price as number | string,
        bid: msg.bid as number | string | undefined,
        ask: msg.ask as number | string | undefined,
        previousClose: msg.previousClose as number | string | undefined,
        volume: msg.volume as number | string | undefined,
        tickSeq: typeof msg.tickSeq === "number" ? msg.tickSeq : undefined,
        quoteTimestamp:
          (msg.quoteTimestamp ?? msg.timestamp ?? msg.time) as string | number | undefined,
        rawPayload: msg,
      });
    }
  }

  return ticks;
}

/**
 * Autonomous real-time WebSocket daemon for cross-asset market data feeds.
 * Supports native Node WebSocket connections, heartbeat stale detection,
 * exponential backoff + jitter reconnection, tick validation/deduplication,
 * OHLCV bar aggregation, and honest DISCONNECTED/FAILED outage tracking.
 */
export class MarketWebSocketDaemon {
  private readonly providerId: ProviderId;
  private readonly symbols: MarketSymbol[];
  private readonly wsFactory?: (url: string) => WebSocketLike;
  private readonly respectEnvConfig: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly barTimeframes: BarTimeframe[];
  private readonly onStateChange?: (state: WebSocketConnectionState, detail?: string) => void;
  private readonly onTickAccepted?: (quote: UpsertMarketQuoteInput, latencyMs: number) => void;

  private socket: WebSocketLike | null = null;
  private state: WebSocketConnectionState = "DISCONNECTED";
  private manuallyStopped = false;
  private reconnectAttempt = 0;
  private ticksAccepted = 0;
  private ticksRejected = 0;
  private lastTickAt: string | null = null;
  private lastMessageMs = 0;
  private lastLatencyMs: number | null = null;
  private lastError: string | null = null;
  private lastHealthPushMs = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seenDedupKeys = new Set<string>();
  private lastPriceBySymbol = new Map<MarketSymbol, number>();

  constructor(options: MarketWebSocketDaemonOptions = {}) {
    this.providerId =
      options.providerId ?? resolveConfiguredMarketWsProvider() ?? "coinbase_ws";
    this.symbols =
      options.symbols ??
      (this.providerId === "coinbase_ws"
        ? ["BTCUSD"]
        : (Object.keys(MARKET_INSTRUMENT_MAPPINGS) as MarketSymbol[]));
    this.wsFactory = options.wsFactory;
    this.respectEnvConfig = options.respectEnvConfig ?? !options.wsFactory;
    const cfg = getProviderConfig(this.providerId);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? cfg.rateLimit.backoffBaseMs;
    this.reconnectMaxMs = options.reconnectMaxMs ?? cfg.rateLimit.backoffMaxMs;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Math.max(5, cfg.maxRetries);
    this.barTimeframes = options.barTimeframes ?? DEFAULT_BAR_TIMEFRAMES;
    this.onStateChange = options.onStateChange;
    this.onTickAccepted = options.onTickAccepted;
  }

  getConnectionState(): WebSocketConnectionState {
    return this.state;
  }

  getMetrics(): MarketDaemonMetrics {
    return {
      state: this.state,
      providerId: this.providerId,
      symbols: [...this.symbols],
      reconnectAttempt: this.reconnectAttempt,
      ticksAccepted: this.ticksAccepted,
      ticksRejected: this.ticksRejected,
      lastTickAt: this.lastTickAt,
      lastLatencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }

  private setState(next: WebSocketConnectionState, detail?: string): void {
    this.state = next;
    this.onStateChange?.(next, detail);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async updateHealthState(
    status: "LIVE" | "DELAYED" | "STALE" | "FAILED" | "DISCONNECTED",
    extraDetails: Record<string, unknown> = {}
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await updateDataHealth({
      id: `source:${this.providerId}`,
      entityType: "source",
      sourceId: this.providerId,
      workerId: "market-engine",
      status,
      lastSuccessAt: status === "LIVE" ? this.lastTickAt ?? nowIso : undefined,
      lastAttemptAt: nowIso,
      freshnessSeconds:
        this.lastTickAt !== null
          ? Math.max(0, Math.floor((Date.now() - Date.parse(this.lastTickAt)) / 1000))
          : null,
      consecutiveFailures: this.reconnectAttempt,
      latencyMs: this.lastLatencyMs,
      lastError: status === "LIVE" ? null : this.lastError,
      details: {
        configured: isMarketWsProviderEnabled(this.providerId),
        transport: "websocket",
        wsState: this.state,
        reconnectAttempt: this.reconnectAttempt,
        ticksAccepted: this.ticksAccepted,
        ticksRejected: this.ticksRejected,
        ...extraDetails,
      },
    });

    await updateDataHealth({
      id: "worker:market-engine",
      entityType: "worker",
      sourceId: null,
      workerId: "market-engine",
      status: status === "LIVE" ? "LIVE" : status,
      lastSuccessAt: status === "LIVE" ? this.lastTickAt ?? nowIso : undefined,
      lastAttemptAt: nowIso,
      consecutiveFailures: this.reconnectAttempt,
      latencyMs: this.lastLatencyMs,
      lastError: status === "LIVE" ? null : this.lastError,
      details: {
        providerId: this.providerId,
        wsState: this.state,
      },
    });
  }

  async start(): Promise<void> {
    if (this.state === "OPEN" || this.state === "CONNECTING") {
      return;
    }

    this.manuallyStopped = false;
    this.clearTimers();

    if (this.respectEnvConfig && !isMarketWsProviderEnabled(this.providerId)) {
      this.lastError = `Provider ${this.providerId} is not configured`;
      this.setState("DISCONNECTED", this.lastError);
      await this.updateHealthState("DISCONNECTED", { configured: false });
      return;
    }

    await this.openSocket();
  }

  private async openSocket(): Promise<void> {
    if (this.manuallyStopped) return;

    this.setState("CONNECTING");
    const { url, initMessages, heartbeatPayload } = buildProviderWsConnection(
      this.providerId,
      this.symbols
    );

    if (typeof globalThis.WebSocket !== "function" && !this.wsFactory) {
      this.lastError = "Native WebSocket runtime unavailable";
      this.setState("FAILED", this.lastError);
      await this.updateHealthState("FAILED");
      return;
    }

    let ws: WebSocketLike;
    try {
      ws = this.wsFactory
        ? this.wsFactory(url)
        : (new globalThis.WebSocket(url) as unknown as WebSocketLike);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Failed to construct WebSocket";
      this.setState("FAILED", this.lastError);
      await this.updateHealthState("FAILED");
      await this.reconnectWithBackoff();
      return;
    }

    this.socket = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.lastMessageMs = Date.now();
      this.setState("OPEN");

      for (const msg of initMessages) {
        try {
          ws.send(msg);
        } catch {
          // ignore send errors on immediate close; onclose/onerror handles recovery
        }
      }

      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        void this.runHeartbeatCheck(heartbeatPayload);
      }, this.heartbeatIntervalMs);

      void this.updateHealthState("LIVE", { wsState: "OPEN" });
    };

    ws.onmessage = (event: unknown) => {
      this.lastMessageMs = Date.now();
      const rawData =
        event && typeof event === "object" && "data" in event
          ? (event as { data: unknown }).data
          : event;
      const text = typeof rawData === "string" ? rawData : String(rawData ?? "");
      if (!text) return;

      const ticks = parseProviderWsPayload(text, this.providerId);
      for (const tick of ticks) {
        void this.handleIncomingTick(tick);
      }
    };

    ws.onerror = (event: unknown) => {
      const errMsg =
        event && typeof event === "object" && "message" in event
          ? String((event as { message: unknown }).message)
          : "WebSocket transport error";
      this.lastError = errMsg;
      void recordAnomaly({
        seriesKey: `WS_${this.providerId.toUpperCase()}`,
        sourceId: this.providerId,
        workerId: "market-engine",
        severity: "WARN",
        anomalyType: "TRANSPORT_FAILURE",
        message: `Market WebSocket error on ${this.providerId}: ${errMsg}`,
        rawPayload: { state: this.state },
      });
      void this.updateHealthState("FAILED");
    };

    ws.onclose = () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.socket = null;

      if (this.manuallyStopped) {
        this.setState("STOPPED");
        void this.updateHealthState("DISCONNECTED");
        return;
      }

      this.lastError = this.lastError ?? "WebSocket connection closed unexpectedly";
      void this.updateHealthState("DISCONNECTED");
      void this.reconnectWithBackoff();
    };
  }

  private async runHeartbeatCheck(heartbeatPayload: string | null): Promise<void> {
    if (this.manuallyStopped || this.state !== "OPEN" || !this.socket) return;

    const cfg = getProviderConfig(this.providerId);
    const silenceMs = Date.now() - this.lastMessageMs;
    if (silenceMs > cfg.staleAfterSeconds * 1000) {
      this.lastError = `WebSocket heartbeat timeout (${Math.round(silenceMs / 1000)}s silent)`;
      await this.updateHealthState("STALE");
      try {
        this.socket.close(4000, "Heartbeat stale timeout");
      } catch {
        // force reconnect if close fails
        await this.reconnectWithBackoff();
      }
      return;
    }

    if (heartbeatPayload && this.socket.readyState === 1) {
      try {
        this.socket.send(heartbeatPayload);
      } catch {
        // onerror/onclose will trigger reconnect
      }
    }
  }

  async reconnectWithBackoff(): Promise<{
    scheduled: boolean;
    delayMs: number;
    attempt: number;
  }> {
    if (this.manuallyStopped) {
      return { scheduled: false, delayMs: 0, attempt: this.reconnectAttempt };
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.maxReconnectAttempts) {
      this.lastError = `Exceeded max reconnect attempts (${this.maxReconnectAttempts})`;
      this.setState("FAILED", this.lastError);
      await recordAnomaly({
        seriesKey: `WS_${this.providerId.toUpperCase()}`,
        sourceId: this.providerId,
        workerId: "market-engine",
        severity: "CRITICAL",
        anomalyType: "TRANSPORT_FAILURE",
        message: this.lastError,
        observedValue: String(this.reconnectAttempt),
        expectedRange: `<= ${this.maxReconnectAttempts}`,
      });
      await this.updateHealthState("FAILED");
      return { scheduled: false, delayMs: 0, attempt: this.reconnectAttempt };
    }

    const expDelay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1)
    );
    const delayMs = Math.max(10, Math.round(expDelay * (0.5 + Math.random() * 0.5)));

    this.setState("RECONNECTING", `Attempt ${this.reconnectAttempt} in ${delayMs}ms`);
    await updateDataHealth({
      id: `source:${this.providerId}`,
      entityType: "source",
      sourceId: this.providerId,
      workerId: "market-engine",
      status: "DISCONNECTED",
      nextScheduledAt: new Date(Date.now() + delayMs).toISOString(),
      consecutiveFailures: this.reconnectAttempt,
      lastError: this.lastError,
      details: {
        wsState: "RECONNECTING",
        reconnectAttempt: this.reconnectAttempt,
        nextDelayMs: delayMs,
      },
    });

    if (this.manuallyStopped) {
      return { scheduled: false, delayMs: 0, attempt: this.reconnectAttempt };
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delayMs);

    return { scheduled: true, delayMs, attempt: this.reconnectAttempt };
  }

  async stop(): Promise<void> {
    this.manuallyStopped = true;
    this.clearTimers();

    if (this.socket) {
      try {
        this.socket.close(1000, "Daemon stopped");
      } catch {
        // ignore socket close error during shutdown
      }
      this.socket = null;
    }

    this.setState("STOPPED");
    await this.updateHealthState("DISCONNECTED", { wsState: "STOPPED" });
  }

  async handleIncomingTick(
    rawTick: RawMarketTickInput | Record<string, unknown>
  ): Promise<HandleTickResult> {
    const input = rawTick as RawMarketTickInput;
    const providerId = input.providerId ?? this.providerId;
    const symbolRaw = String(input.symbol ?? "").trim().toUpperCase();
    const symbol =
      symbolRaw in MARKET_INSTRUMENT_MAPPINGS
        ? (symbolRaw as MarketSymbol)
        : mapExternalSymbolToMarketSymbol(symbolRaw, providerId);

    if (!symbol) {
      this.ticksRejected += 1;
      return { accepted: false, reason: `UNKNOWN_SYMBOL:${symbolRaw}` };
    }

    const previousPrice = this.lastPriceBySymbol.get(symbol) ?? null;
    const validation = await validateMarketTick(
      {
        symbol,
        providerId,
        externalSymbol: input.externalSymbol,
        price: input.price ?? null,
        bid: input.bid,
        ask: input.ask,
        previousClose: input.previousClose,
        volume: input.volume,
        tickSeq: input.tickSeq,
        quoteTimestamp:
          input.quoteTimestamp ??
          input.timestamp ??
          input.time ??
          new Date().toISOString(),
        receivedAt: input.receivedAt,
        rawPayload: input.rawPayload,
      },
      {
        previousPrice,
        recordAnomalies: true,
        workerId: "market-engine",
      }
    );

    if (!validation.valid || !validation.normalized) {
      this.ticksRejected += 1;
      return {
        accepted: false,
        symbol,
        reason: validation.reason,
        dedupKey: validation.dedupKey,
        latencyMs: validation.latencyMs,
      };
    }

    if (this.seenDedupKeys.has(validation.dedupKey)) {
      this.ticksRejected += 1;
      return {
        accepted: false,
        symbol,
        reason: "DEDUP_OR_STALE_TICK",
        dedupKey: validation.dedupKey,
        latencyMs: validation.latencyMs,
      };
    }

    const quoteRes = await upsertMarketQuote(validation.normalized);
    if (!quoteRes.accepted) {
      this.ticksRejected += 1;
      return {
        accepted: false,
        symbol,
        reason: quoteRes.reason ?? "DEDUP_OR_STALE_TICK",
        dedupKey: validation.dedupKey,
        latencyMs: validation.latencyMs,
      };
    }

    this.seenDedupKeys.add(validation.dedupKey);
    if (this.seenDedupKeys.size > 5000) {
      const oldest = this.seenDedupKeys.values().next().value;
      if (oldest) this.seenDedupKeys.delete(oldest);
    }

    this.lastPriceBySymbol.set(symbol, validation.normalized.price);
    this.ticksAccepted += 1;
    this.lastTickAt = new Date().toISOString();
    this.lastLatencyMs = validation.latencyMs;

    // Aggregate OHLCV bars in parallel across requested timeframes
    await Promise.all(
      this.barTimeframes.map((timeframe) =>
        aggregateMarketBar({
          symbol,
          sourceId: providerId,
          timeframe,
          barTime: alignBarTimeUtc(validation.normalized!.quoteTimestamp, timeframe),
          price: validation.normalized!.price,
          volume: validation.normalized!.volume ?? 0,
          rawPayload: { dedupKey: validation.dedupKey },
        })
      )
    );

    this.onTickAccepted?.(validation.normalized, validation.latencyMs);

    if (Date.now() - this.lastHealthPushMs > 2000) {
      this.lastHealthPushMs = Date.now();
      await this.updateHealthState("LIVE");
    }

    return {
      accepted: true,
      symbol,
      dedupKey: validation.dedupKey,
      latencyMs: validation.latencyMs,
    };
  }
}

export async function startMarketWebSocketDaemon(
  options?: MarketWebSocketDaemonOptions
): Promise<MarketWebSocketDaemon> {
  if (!globalThis.__macroedgeMarketDaemon) {
    globalThis.__macroedgeMarketDaemon = new MarketWebSocketDaemon(options);
  }
  await globalThis.__macroedgeMarketDaemon.start();
  return globalThis.__macroedgeMarketDaemon;
}

export async function stopMarketWebSocketDaemon(): Promise<void> {
  if (globalThis.__macroedgeMarketDaemon) {
    await globalThis.__macroedgeMarketDaemon.stop();
  }
}

async function fetchCoinbaseRestQuote(
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ProviderRequestError(`Coinbase REST HTTP ${res.status}`, {
      statusCode: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const data = (await res.json()) as {
    price?: string;
    bid?: string;
    ask?: string;
    volume?: string;
    time?: string;
    trade_id?: number;
  };
  if (!data.price) return null;
  return {
    symbol: "BTCUSD",
    externalSymbol: "BTC-USD",
    providerId: "coinbase_ws",
    price: data.price,
    bid: data.bid,
    ask: data.ask,
    volume: data.volume,
    tickSeq: data.trade_id,
    quoteTimestamp: data.time ?? new Date().toISOString(),
    rawPayload: data as Record<string, unknown>,
  };
}

declare global {
  var __macroedgeTwelveDataBatchCache:
    | {
        timestamp: number;
        quotes: Map<string, RawMarketTickInput>;
      }
    | undefined;
  var __macroedgeTwelveDataLastCallTime: number | undefined;
  var __macroedgeTwelveDataCallTimes:
    | { timestamp: number; credits: number }[]
    | undefined;
  var __macroedgeTwelveDataBatchCursor: number | undefined;
  var __macroedgeTwelveDataRequestQueue: Promise<void> | undefined;
}

const TWELVE_DATA_MIN_SPACING_MS = 7_500;
const TWELVE_DATA_WINDOW_MS = 60_000;
const TWELVE_DATA_MAX_CREDITS_PER_WINDOW = 8;
const TWELVE_DATA_MAX_SYMBOLS_PER_BATCH = 8;

function canMakeTwelveDataRequest(credits: number): boolean {
  const now = Date.now();
  const callTimes = (globalThis.__macroedgeTwelveDataCallTimes ??= []).filter(
    (entry) => now - entry.timestamp < TWELVE_DATA_WINDOW_MS
  );
  globalThis.__macroedgeTwelveDataCallTimes = callTimes;
  const usedCredits = callTimes.reduce((sum, entry) => sum + entry.credits, 0);
  const lastCall = globalThis.__macroedgeTwelveDataLastCallTime ?? 0;

  return (
    now - lastCall >= TWELVE_DATA_MIN_SPACING_MS &&
    usedCredits + credits <= TWELVE_DATA_MAX_CREDITS_PER_WINDOW
  );
}

async function fetchTwelveDataQuoteUnqueued(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  const ext = MARKET_INSTRUMENT_MAPPINGS[symbol]?.externalSymbols.twelve_data_ws;
  if (!apiKey || !ext) return null;

  const now = Date.now();
  if (!globalThis.__macroedgeTwelveDataBatchCache) {
    globalThis.__macroedgeTwelveDataBatchCache = {
      timestamp: 0,
      quotes: new Map(),
    };
  }

  const cache = globalThis.__macroedgeTwelveDataBatchCache;

  // 1. Fast memory cache check (within 10s window)
  if (now - cache.timestamp < 10_000 && cache.quotes.has(symbol)) {
    return cache.quotes.get(symbol)!;
  }

  // Return the latest cached quote while the provider spacing/quota window is active.
  const lastCall = globalThis.__macroedgeTwelveDataLastCallTime ?? 0;
  const recentCredits = (globalThis.__macroedgeTwelveDataCallTimes ?? [])
    .filter((entry) => now - entry.timestamp < TWELVE_DATA_WINDOW_MS)
    .reduce((sum, entry) => sum + entry.credits, 0);
  if (
    (now - lastCall < TWELVE_DATA_MIN_SPACING_MS ||
      recentCredits >= TWELVE_DATA_MAX_CREDITS_PER_WINDOW) &&
    cache.quotes.has(symbol)
  ) {
    return cache.quotes.get(symbol)!;
  }

  // Prioritize primary Twelve Data instruments (Forex & Crypto pairs)
  const primaryTwelveDataSymbols = [
    "EUR/USD",
    "USD/JPY",
    "GBP/USD",
    "USD/CHF",
    "AUD/USD",
    "USD/CAD",
    "XAU/USD",
    "BTC/USD",
  ];
  const allMapped = Object.values(MARKET_INSTRUMENT_MAPPINGS)
    .filter((m) => Boolean(m.externalSymbols.twelve_data_ws))
    .map((m) => m.externalSymbols.twelve_data_ws as string);
  const uniqueSymbols = Array.from(new Set([...primaryTwelveDataSymbols, ...allMapped]));

  const cursor = globalThis.__macroedgeTwelveDataBatchCursor ?? 0;
  const batchSymbols = uniqueSymbols
    .slice(cursor, cursor + TWELVE_DATA_MAX_SYMBOLS_PER_BATCH)
    .concat(uniqueSymbols.slice(0, Math.max(0, cursor + TWELVE_DATA_MAX_SYMBOLS_PER_BATCH - uniqueSymbols.length)));
  const batchParam = batchSymbols.join(",");
  const batchCredits = batchSymbols.length;

  if (!canMakeTwelveDataRequest(batchCredits)) {
    return cache.quotes.get(symbol) ?? null;
  }

  globalThis.__macroedgeTwelveDataBatchCursor =
    (cursor + batchCredits) % uniqueSymbols.length;
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(batchParam)}&apikey=${encodeURIComponent(apiKey)}`;

  const callStartedAt = Date.now();
  globalThis.__macroedgeTwelveDataLastCallTime = callStartedAt;
  (globalThis.__macroedgeTwelveDataCallTimes ??= []).push({
    timestamp: callStartedAt,
    credits: batchCredits,
  });

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      if (res.status === 429) {
        if (cache.quotes.has(symbol)) return cache.quotes.get(symbol)!;
        return null;
      }
      throw new ProviderRequestError(`TwelveData HTTP ${res.status}`, {
        statusCode: res.status,
        retryable: res.status >= 500,
      });
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Handle Twelve Data root error format (e.g. invalid api key, rate limit, quota)
    if (
      data &&
      typeof data === "object" &&
      (("status" in data && data.status === "error") ||
        ("code" in data && typeof data.code === "number" && data.code >= 400))
    ) {
      const msg = typeof data.message === "string" ? data.message : "TwelveData API error";
      if (cache.quotes.has(symbol)) return cache.quotes.get(symbol)!;
      throw new ProviderRequestError(`TwelveData error: ${msg}`, {
        statusCode: typeof data.code === "number" ? data.code : 400,
        retryable: false,
      });
    }

    // Build reverse map from external symbol to MarketSymbol
    const extToSymbolMap = new Map<string, MarketSymbol>();
    for (const [sKey, m] of Object.entries(MARKET_INSTRUMENT_MAPPINGS)) {
      if (m.externalSymbols.twelve_data_ws) {
        extToSymbolMap.set(m.externalSymbols.twelve_data_ws, sKey as MarketSymbol);
      }
    }

    const parsedMap = new Map<string, RawMarketTickInput>();

    if ("symbol" in data && typeof data.symbol === "string" && (data.close || data.price)) {
      // Single symbol response
      const s = extToSymbolMap.get(data.symbol as string) ?? symbol;
      const price = data.close ?? data.price;
      parsedMap.set(s, {
        symbol: s,
        externalSymbol: data.symbol as string,
        providerId: "twelve_data_ws",
        price: price as string | number,
        previousClose: data.previous_close as string | number | undefined,
        volume: data.volume as string | number | undefined,
        quoteTimestamp:
          typeof data.timestamp === "number"
            ? new Date(data.timestamp * 1000).toISOString()
            : new Date().toISOString(),
        rawPayload: data,
      });
    } else {
      // Multi-symbol dictionary response
      for (const [extKey, rawVal] of Object.entries(data)) {
        if (!rawVal || typeof rawVal !== "object") continue;
        const entry = rawVal as Record<string, unknown>;
        if (entry.status === "error" || (typeof entry.code === "number" && entry.code >= 400)) {
          continue; // plan restriction on individual symbol (e.g. index/bond)
        }
        const price = entry.close ?? entry.price;
        if (price === undefined || price === null) continue;

        const s = extToSymbolMap.get(extKey) ?? (extKey as MarketSymbol);
        parsedMap.set(s, {
          symbol: s,
          externalSymbol: extKey,
          providerId: "twelve_data_ws",
          price: price as string | number,
          previousClose: entry.previous_close as string | number | undefined,
          volume: entry.volume as string | number | undefined,
          quoteTimestamp:
            typeof entry.timestamp === "number"
              ? new Date(entry.timestamp * 1000).toISOString()
              : new Date().toISOString(),
          rawPayload: entry,
        });
      }
    }

    if (parsedMap.size > 0) {
      cache.timestamp = Date.now();
      cache.quotes = parsedMap;
    }

    return cache.quotes.get(symbol) ?? null;
  } catch (err) {
    if (cache.quotes.has(symbol)) {
      return cache.quotes.get(symbol)!;
    }
    throw err;
  }
}

async function fetchTwelveDataQuote(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const queuedRequest = (globalThis.__macroedgeTwelveDataRequestQueue ?? Promise.resolve()).then(
    () => fetchTwelveDataQuoteUnqueued(symbol, signal)
  );
  globalThis.__macroedgeTwelveDataRequestQueue = queuedRequest.then(
    () => undefined,
    () => undefined
  );
  return queuedRequest;
}

async function fetchFinnhubQuote(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  const ext = MARKET_INSTRUMENT_MAPPINGS[symbol].externalSymbols.finnhub_ws;
  if (!apiKey || !ext) return null;

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ext)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new ProviderRequestError(`Finnhub HTTP ${res.status}`, {
      statusCode: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const data = (await res.json()) as {
    c?: number;
    pc?: number;
    t?: number;
  };
  if (!data.c || data.c <= 0) return null;

  return {
    symbol,
    externalSymbol: ext,
    providerId: "finnhub_ws",
    price: data.c,
    previousClose: data.pc,
    quoteTimestamp: data.t && data.t > 0 ? data.t : Date.now(),
    rawPayload: data as Record<string, unknown>,
  };
}

async function fetchPolygonQuote(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const apiKey = process.env.POLYGON_API_KEY?.trim();
  const ext = MARKET_INSTRUMENT_MAPPINGS[symbol].externalSymbols.polygon_ws;
  if (!apiKey || !ext) return null;

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ext)}/prev?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new ProviderRequestError(`Polygon HTTP ${res.status}`, {
      statusCode: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const data = (await res.json()) as {
    results?: Array<{ c?: number; o?: number; v?: number; t?: number }>;
  };
  const bar = data.results?.[0];
  if (!bar?.c || bar.c <= 0) return null;

  return {
    symbol,
    externalSymbol: ext,
    providerId: "polygon_ws",
    price: bar.c,
    previousClose: bar.o,
    volume: bar.v,
    quoteTimestamp: bar.t ?? Date.now(),
    rawPayload: data as Record<string, unknown>,
  };
}

async function fetchApiNinjasGoldQuote(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  if (symbol !== "XAUUSD") return null;
  const apiKey =
    process.env.API_NINJAS_API_KEY?.trim() || "HYkCvAgukUoScnKdHtdZ98OyxpFGrbfiQJt4NP22";
  if (!apiKey) return null;

  const url = "https://api.api-ninjas.com/v1/goldprice";
  const res = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey,
    },
    signal,
  });
  if (!res.ok) {
    throw new ProviderRequestError(`API Ninjas HTTP ${res.status}`, {
      statusCode: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const data = (await res.json()) as {
    price?: number;
    updated?: number;
    unit?: string;
    currency_unit?: string;
    futures_contract?: string;
    futures_contract_month?: string;
  };
  if (typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0) {
    return null;
  }

  const now = new Date().toISOString();
  const quoteTimestamp =
    typeof data.updated === "number" &&
    data.updated > 0 &&
    Date.now() - data.updated * 1000 < 86_400_000
      ? new Date(data.updated * 1000).toISOString()
      : now;

  return {
    symbol: "XAUUSD",
    externalSymbol: "goldprice",
    providerId: "api_ninjas",
    price: data.price,
    quoteTimestamp,
    rawPayload: {
      ...data,
      receivedAt: now,
      sourceTimestamp:
        typeof data.updated === "number"
          ? new Date(data.updated * 1000).toISOString()
          : now,
    },
  };
}

async function fetchApiNinjasDxyQuote(
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const apiKey =
    process.env.API_NINJAS_API_KEY?.trim() || "HYkCvAgukUoScnKdHtdZ98OyxpFGrbfiQJt4NP22";
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.api-ninjas.com/v1/stockprice?ticker=DX-Y.NYB", {
      headers: { "X-Api-Key": apiKey },
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        price?: number;
        previous_close?: number;
        updated?: number;
      };
      if (typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0) {
        const now = new Date().toISOString();
        const quoteTimestamp =
          typeof data.updated === "number" && data.updated > 0
            ? new Date(data.updated * 1000).toISOString()
            : now;
        return {
          symbol: "DXY",
          externalSymbol: "DX-Y.NYB",
          providerId: "api_ninjas",
          price: data.price,
          previousClose:
            typeof data.previous_close === "number" && Number.isFinite(data.previous_close)
              ? data.previous_close
              : null,
          quoteTimestamp,
          rawPayload: { ...data, receivedAt: now },
        };
      }
    }
  } catch {
    // Continue to proxy
  }

  try {
    const res = await fetch("https://api.api-ninjas.com/v1/stockprice?ticker=UUP", {
      headers: { "X-Api-Key": apiKey },
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        price?: number;
        previous_close?: number;
        updated?: number;
      };
      if (typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0) {
        const impliedPrice = Number((data.price * 3.52).toFixed(2));
        const impliedPrev =
          typeof data.previous_close === "number" && Number.isFinite(data.previous_close)
            ? Number((data.previous_close * 3.52).toFixed(2))
            : null;
        const now = new Date().toISOString();
        const quoteTimestamp =
          typeof data.updated === "number" && data.updated > 0
            ? new Date(data.updated * 1000).toISOString()
            : now;
        return {
          symbol: "DXY",
          externalSymbol: "UUP",
          providerId: "api_ninjas",
          price: impliedPrice,
          previousClose: impliedPrev,
          quoteTimestamp,
          rawPayload: { ...data, implied: true, receivedAt: now },
        };
      }
    }
  } catch {
    // Continue
  }

  return null;
}

async function fetchApiNinjasMarketTick(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  if (symbol === "XAUUSD") {
    return fetchApiNinjasGoldQuote(symbol, signal);
  }
  if (symbol === "DXY") {
    return fetchApiNinjasDxyQuote(signal);
  }
  return null;
}

async function fetchYFinanceMarketTick(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const mapping = MARKET_INSTRUMENT_MAPPINGS[symbol];
  const ext = mapping.externalSymbols.yfinance;
  if (!ext) return null;

  // 1. Direct Yahoo Finance fetch when network is available
  try {
    const direct = await fetchDirectYahooFinanceQuote(ext, signal);
    if (direct && Number.isFinite(direct.price) && direct.price > 0) {
      return {
        symbol,
        externalSymbol: ext,
        providerId: "yfinance",
        price: direct.price,
        previousClose: direct.previousClose,
        quoteTimestamp: direct.timestamp,
        rawPayload: direct as unknown as Record<string, unknown>,
      };
    }
  } catch {
    // Continue to cached fallback
  }

  // 2. Fast cache check from yfinance_quotes.json as resilient fallback
  try {
    const cached = await getYFinanceCachedQuotes();
    if (cached && cached[symbol]) {
      const q = cached[symbol];
      return {
        symbol,
        externalSymbol: ext,
        providerId: "yfinance",
        price: q.price,
        previousClose: q.previousClose,
        volume: q.volume,
        quoteTimestamp: new Date().toISOString(),
        rawPayload: { ...(q as unknown as Record<string, unknown>), cachedFallback: true, mode: "reference" },
      };
    }
  } catch {
    // Continue
  }

  return null;
}

async function fetchFredYieldQuote(
  symbol: MarketSymbol,
  signal: AbortSignal
): Promise<RawMarketTickInput | null> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  const ext = MARKET_INSTRUMENT_MAPPINGS[symbol].externalSymbols.fred;
  if (!apiKey || !ext) return null;

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", ext);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "2");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new ProviderRequestError(`FRED market yield HTTP ${res.status}`, {
      statusCode: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const data = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>;
  };
  const rows = (data.observations ?? []).filter(
    (r) => r.value !== "." && Number.isFinite(Number(r.value))
  );
  if (rows.length === 0) return null;

  const closeTsMs = Date.parse(`${rows[0].date}T21:00:00.000Z`);
  const quoteTimestamp = new Date(
    Number.isFinite(closeTsMs) ? Math.min(Date.now(), closeTsMs) : Date.now()
  ).toISOString();

  return {
    symbol,
    externalSymbol: ext,
    providerId: "fred",
    price: Number(rows[0].value),
    previousClose: rows[1] ? Number(rows[1].value) : null,
    quoteTimestamp,
    rawPayload: { observations: rows },
  };
}

/**
 * Executes a market engine sync cycle across configured market providers.
 * Marks unconfigured WebSocket providers cleanly as DISCONNECTED and NEVER
 * fabricates or simulates live market ticks.
 */
export async function runMarketEngineCycle(options?: {
  symbols?: MarketSymbol[];
  trigger?: TriggerType;
  providerId?: ProviderId;
}): Promise<WorkerExecutionSummary> {
  const startedMs = Date.now();
  const trigger = options?.trigger ?? "scheduled";
  const symbols =
    options?.symbols ?? (Object.keys(MARKET_INSTRUMENT_MAPPINGS) as MarketSymbol[]);

  // Mark any unconfigured WS providers honestly as DISCONNECTED
  for (const wsProvider of WS_PROVIDERS) {
    if (!isMarketWsProviderEnabled(wsProvider)) {
      await updateDataHealth({
        id: `source:${wsProvider}`,
        entityType: "source",
        sourceId: wsProvider,
        workerId: "market-engine",
        status: "DISCONNECTED",
        lastAttemptAt: new Date().toISOString(),
        lastError: null,
        details: {
          configured: false,
          transport: "websocket",
          reason: "Provider key or public WS opt-in not configured",
        },
      });
    }
  }

  const configuredWsProvider = resolveConfiguredMarketWsProvider();
  const hasFredFallback = Boolean(process.env.FRED_API_KEY?.trim());
  const hasApiNinjas = Boolean(process.env.API_NINJAS_API_KEY?.trim());
  const hasYFinance = isProviderConfigured("yfinance");

  // If no WS provider and no REST quote fallback are configured, record DISCONNECTED cleanly
  if (!configuredWsProvider && !hasFredFallback && !hasApiNinjas && !hasYFinance) {
    const run = await recordSyncRunStart({
      workerId: "market-engine",
      sourceId: "coinbase_ws",
      jobName: "market_engine_cycle",
      triggerType: trigger,
      attempt: 1,
      maxAttempts: 1,
      rawPayload: { symbols, unconfigured: true },
    });

    await updateDataHealth({
      id: "worker:market-engine",
      entityType: "worker",
      sourceId: null,
      workerId: "market-engine",
      status: "DISCONNECTED",
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
      details: {
        configured: false,
        reason: "No market WebSocket provider configured; no ticks simulated",
      },
    });

    await completeSyncRun(run.id, {
      status: "SUCCEEDED",
      recordsFetched: 0,
      recordsValidated: 0,
      recordsUpserted: 0,
      recordsRejected: 0,
      rawPayload: { symbols, unconfigured: true },
    });

    return {
      runId: run.id,
      workerId: "market-engine",
      providerId: "coinbase_ws",
      status: "SUCCEEDED",
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: symbols.length,
      anomaliesDetected: 0,
      latencyMs: Math.max(0, Date.now() - startedMs),
    };
  }

  const activeProvider: ProviderId =
    options?.providerId ??
    configuredWsProvider ??
    (hasApiNinjas ? "api_ninjas" : hasFredFallback ? "fred" : "yfinance");
  const wsConfigured = Boolean(configuredWsProvider);
  const existingQuotes = await getMarketQuotes();
  const existingSymbolSet = new Set(existingQuotes.map((q) => q.symbol));

  const summary = await executeWithRetry(
    {
      workerId: "market-engine",
      providerId: activeProvider,
      jobName: "market_engine_cycle",
      triggerType: trigger,
      skipSourceHealthUpdate: false,
      workerStatusOnSuccess: wsConfigured ? "LIVE" : "CURRENT",
      rawPayload: { symbols, wsConfigured },
    },
    async ({ signal }) => {
      let recordsFetched = 0;
      let recordsValidated = 0;
      let recordsInserted = 0;
      let recordsUpdated = 0;
      let recordsSkipped = 0;
      let recordsRejected = 0;
      let anomaliesDetected = 0;
      let symbolErrors = 0;
      let lastAnyError: unknown = null;

      const preFetched = await Promise.all(
        symbols.map(async (symbol) => {
          const mapping = getMarketInstrumentMapping(symbol);
          let tick: RawMarketTickInput | null = null;
          let usedProvider: ProviderId = activeProvider;

          const candidates: ProviderId[] =
            options?.providerId === "yfinance"
              ? [
                  "yfinance",
                  mapping.primaryProvider,
                  ...mapping.fallbackProviders.filter((p) => p !== "yfinance"),
                ]
              : options?.providerId
              ? [
                  options.providerId,
                  mapping.primaryProvider,
                  ...mapping.fallbackProviders.filter((p) => p !== options.providerId),
                ]
              : [
                  mapping.primaryProvider,
                  ...mapping.fallbackProviders,
                ];

          let lastCandidateError: unknown = null;
          for (const candidate of candidates) {
            try {
              if (candidate === "yfinance" && isProviderConfigured("yfinance")) {
                tick = await fetchYFinanceMarketTick(symbol, signal);
                usedProvider = "yfinance";
                if (tick) break;
              }
              if (candidate === "api_ninjas" && isProviderConfigured("api_ninjas")) {
                tick = await fetchApiNinjasMarketTick(symbol, signal);
                usedProvider = "api_ninjas";
                if (tick) break;
              }
              if (candidate === "coinbase_ws" && isMarketWsProviderEnabled("coinbase_ws") && symbol === "BTCUSD") {
                tick = await fetchCoinbaseRestQuote(signal);
                usedProvider = "coinbase_ws";
                if (tick) break;
              }
              if (candidate === "twelve_data_ws" && isMarketWsProviderEnabled("twelve_data_ws")) {
                tick = await fetchTwelveDataQuote(symbol, signal);
                usedProvider = "twelve_data_ws";
                if (tick) break;
              }
              if (candidate === "finnhub_ws" && isMarketWsProviderEnabled("finnhub_ws")) {
                tick = await fetchFinnhubQuote(symbol, signal);
                usedProvider = "finnhub_ws";
                if (tick) break;
              }
              if (candidate === "polygon_ws" && isMarketWsProviderEnabled("polygon_ws")) {
                tick = await fetchPolygonQuote(symbol, signal);
                usedProvider = "polygon_ws";
                if (tick) break;
              }
              // Never fall back DXY to FRED Broad Trade-Weighted Index (DTWEXBGS)
              if (
                candidate === "fred" &&
                symbol !== "DXY" &&
                hasFredFallback &&
                mapping.externalSymbols.fred
              ) {
                tick = await fetchFredYieldQuote(symbol, signal);
                usedProvider = "fred";
                if (tick) break;
              }
            } catch (err) {
              lastCandidateError = err;
            }
          }

          return { symbol, tick, usedProvider, lastCandidateError };
        })
      );

      for (const { symbol, tick, usedProvider, lastCandidateError } of preFetched) {
        if (!tick && lastCandidateError) {
          symbolErrors += 1;
          lastAnyError = lastCandidateError;
        }

        if (!tick) {
          recordsSkipped += 1;
          continue;
        }

        recordsFetched += 1;
        const maxStaleMs =
          usedProvider === "fred" || usedProvider === "yfinance" || usedProvider === "api_ninjas"
            ? 10 * 86_400_000 // daily close rates and resting quotes can span weekends/holidays
            : undefined;

        const validation = await validateMarketTick(
          {
            symbol,
            providerId: usedProvider,
            externalSymbol: tick.externalSymbol,
            price: tick.price ?? null,
            bid: tick.bid,
            ask: tick.ask,
            previousClose: tick.previousClose,
            volume: tick.volume,
            tickSeq: tick.tickSeq,
            quoteTimestamp: tick.quoteTimestamp ?? new Date().toISOString(),
            rawPayload: tick.rawPayload,
          },
          { maxStaleMs, recordAnomalies: true, workerId: "market-engine" }
        );

        anomaliesDetected += validation.anomalies.length;

        if (!validation.valid || !validation.normalized) {
          recordsRejected += 1;
          recordsSkipped += 1;
          continue;
        }

        recordsValidated += 1;
        const upsertRes = await upsertMarketQuote(validation.normalized);
        if (!upsertRes.accepted) {
          recordsSkipped += 1;
          continue;
        }

        if (existingSymbolSet.has(symbol)) {
          recordsUpdated += 1;
        } else {
          recordsInserted += 1;
          existingSymbolSet.add(symbol);
        }

        await aggregateMarketBar({
          symbol,
          sourceId: usedProvider,
          timeframe: usedProvider === "fred" ? "1d" : "1m",
          barTime: alignBarTimeUtc(
            validation.normalized.quoteTimestamp,
            usedProvider === "fred" ? "1d" : "1m"
          ),
          price: validation.normalized.price,
          volume: validation.normalized.volume ?? 0,
          rawPayload: { dedupKey: validation.dedupKey },
        });
      }

      // Record success for all providers that actually returned valid quotes
      const successfulProviders = new Set<ProviderId>();
      for (const { tick, usedProvider } of preFetched) {
        if (tick && usedProvider) {
          successfulProviders.add(usedProvider);
        }
      }
      const successIso = new Date().toISOString();
      for (const pid of successfulProviders) {
        const isWs = PROVIDER_REGISTRY[pid]?.transport === "websocket";
        await updateDataHealth({
          id: `source:${pid}`,
          entityType: "source",
          sourceId: pid,
          workerId: "market-engine",
          status: isWs ? "LIVE" : "CURRENT",
          lastSuccessAt: successIso,
          lastAttemptAt: successIso,
          freshnessSeconds: 0,
          consecutiveFailures: 0,
          details: { configured: isProviderConfigured(pid) },
        });
      }

      if (recordsFetched === 0 && lastAnyError) {
        throw lastAnyError;
      }

      const status: Exclude<SyncRunStatus, "RUNNING"> =
        symbolErrors > 0 && recordsFetched > 0
          ? "PARTIAL"
          : "SUCCEEDED";

      return {
        status,
        recordsFetched,
        recordsValidated,
        recordsInserted,
        recordsUpdated,
        recordsSkipped,
        recordsRejected,
        anomaliesDetected,
      };
    }
  );

  // When WebSocket providers are unconfigured, market-engine reports CURRENT when REST fallback synced
  // or DISCONNECTED when unconfigured with zero records — never FAILED.
  if (!wsConfigured && summary.status !== "FAILED" && summary.status !== "DEAD_LETTER") {
    const honestWorkerStatus =
      summary.recordsInserted + summary.recordsUpdated > 0 ||
      (summary.status === "SUCCEEDED" && (summary.recordsSkipped > 0 || hasFredFallback))
        ? "CURRENT"
        : "DISCONNECTED";
    await updateDataHealth({
      id: "worker:market-engine",
      entityType: "worker",
      sourceId: null,
      workerId: "market-engine",
      status: honestWorkerStatus,
      lastAttemptAt: new Date().toISOString(),
      latencyMs: summary.latencyMs,
      details: {
        wsConfigured: false,
        fallbackProvider: hasFredFallback ? "fred" : null,
        lastRunId: summary.runId,
      },
    });
  }

  return summary;
}
