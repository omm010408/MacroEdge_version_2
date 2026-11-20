# Market Data Architecture & Provider Adapter Design (Phase 1 — Read-Only)

**System:** MacroEdge Market Data Pipeline  
**Auditor Role:** Senior Quantitative Trading Software Engineer & Full-Stack Architect  

---

## 1. Provider Adapter Interface Definition

To ensure quantitative strategy logic remains entirely decoupled from specific market data vendors, all data acquisition must implement the following TypeScript / Python adapter interfaces:

```typescript
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface MarketBar {
  symbol: string;
  timeframe: Timeframe;
  barTimeUtc: string; // ISO 8601 UTC timestamp of bar open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount?: number;
  isClosed: boolean;
  provider: string; // e.g. "twelve_data", "cboe", "synthetic"
  fetchedAtUtc: string;
  isSimulated: boolean; // Flagged true for Monte Carlo or synthetic bars
}

export interface LatestQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  quoteTimestampUtc: string;
  receivedAtUtc: string;
  status: "LIVE" | "DELAYED" | "STALE" | "CLOSED";
  provider: string;
}

export interface TradingSession {
  name: "ASIA" | "LONDON" | "NEW_YORK" | "CLOSED";
  startUtc: string; // e.g. "07:00:00"
  endUtc: string;   // e.g. "16:00:00"
  isPrimaryLiquidity: boolean;
  tradingPermitted: boolean;
}

export interface SessionCalendar {
  instrument: string;
  currentSession: TradingSession;
  upcomingSessions: TradingSession[];
  isMarketOpen: boolean;
  nextOpenUtc: string | null;
  nextCloseUtc: string | null;
  newsBlackoutWindows: Array<{
    event: string;
    startUtc: string;
    endUtc: string;
  }>;
}

export interface InstrumentSpec {
  symbol: string;
  version: string; // e.g. "v1_raw_spread"
  assetClass: "COMMODITY" | "INDEX" | "CRYPTO" | "FX";
  baseCurrency: string;
  quoteCurrency: string;
  contractSize: number;       // e.g. 100 oz for XAUUSD
  tickSize: number;           // e.g. 0.01 for XAUUSD
  tickValue: number;          // e.g. $1.00 per standard lot for 0.01 move
  minLotSize: number;         // e.g. 0.01 lots
  maxLotSize: number;         // e.g. 50.0 lots
  lotStep: number;            // e.g. 0.01
  standardPip: number;        // e.g. 0.10 for XAUUSD ($10/lot)
  typicalSpreadPips: number;  // e.g. 1.8 pips ($0.18)
  marginRequirementPct: number; // e.g. 1.0% (1:100 leverage)
  effectiveFromUtc: string;
}

export interface MarketDataProviderAdapter {
  readonly providerId: string;
  bars(instrument: string, timeframe: Timeframe, startUtc: string, endUtc: string): Promise<MarketBar[]>;
  latestQuote(instrument: string, asOfUtc?: string): Promise<LatestQuote>;
  sessionCalendar(instrument: string): Promise<SessionCalendar>;
  instrumentSpec(instrument: string, version?: string): InstrumentSpec;
}
```

---

## 2. Multi-Timeframe Provider Mapping & Feasibility Evaluation

| Instrument | Timeframe | Primary Configured Provider | Secondary / Fallback Provider | Historical Depth | Intraday Available for Backtest | Session & Timezone Conventions | Identified Gaps & Caveats |
|---|---|---|---|---|---|---|---|
| **XAUUSD** (Gold / USD) | **1D** | Twelve Data (`XAU/USD`) | Yahoo Finance (`GC=F`) | 15+ years | Yes | 24/5 OTC Gold (Sun 22:00 – Fri 21:00 UTC; 1h daily roll 21:00–22:00 UTC) | Twelve Data rate limit: 8 credits/min on free tier. Bulk history takes time. |
| **XAUUSD** | **4H** | Twelve Data (`XAU/USD`) | Yahoo Finance (`GC=F`) | 5+ years | Yes | Formed from UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 bars | Twelve Data native 4h bar vs custom aggregation must be standardized. |
| **XAUUSD** | **15M** | Twelve Data (`XAU/USD`) | Local cache (`ml/data/`) | 1–2 years (Free tier limit ~5,000 bars per query) | **Partial** | Continuous UTC trading | Backtesting full multi-year 15m requires pagination and caching or paid Twelve Data plan. |
| **XAUUSD** | **5M** | Twelve Data (`XAU/USD`) | None | ~6 months (Free tier) | **Partial** | Continuous UTC trading | Critical Gap: Multi-year 5m backtests exceed Twelve Data free quota. Must cache incrementally. |
| **XAUUSD** | **1M** | Twelve Data (`XAU/USD`) | None | ~1 month (Free tier) | **Limited** | Continuous UTC trading | 1m history for years is not free. Historical tick backtesting requires dedicated data archive. |
| **US30** (Dow Jones) | 1D, 4H, 15M, 5M, 1M | Twelve Data (`DJI` / `US30`) | Yahoo Finance (`^DJI`) | 10+ years (1D); 6 mo (intraday) | Partial | CME Futures / Cash Session (09:30–16:00 ET) | Cash index does not trade 24h; CFD/Futures pricing differs from cash index. |
| **S&P 500** | 1D, 4H, 15M, 5M, 1M | Twelve Data (`SPX`) | Yahoo Finance (`^GSPC`) | 10+ years (1D); 6 mo (intraday) | Partial | CME Futures / Cash Session (09:30–16:00 ET) | Cash index vs ES Futures contract rolls. |
| **BTCUSD** | 1D, 4H, 15M, 5M, 1M | Twelve Data (`BTC/USD`) | Coinbase WebSocket | Full history | Yes | Continuous 24/7/365 UTC | High volatility, weekend spreads. |

### Configured WebSocket Status (`MARKET_WS_PROVIDER`):
- Currently **UNSET** in `.env.local`. When enabled, it provides real-time streaming quotes for live terminal widgets, but **cannot** supply historical bars for backtesting or strategy scanning.

---

## 3. Policy on Unofficial Yahoo Finance Endpoints

> [!WARNING]
> **Strict Policy: Yahoo Finance endpoints (`query1.finance.yahoo.com`) are EXCLUDED from production trading and backtesting.**

**Reasons for Exclusion:**
1. **Terms of Service & Legal Exposure:** Yahoo Finance endpoints are not public developer APIs. They have no commercial SLA and explicitly forbid programmatic commercial scraping.
2. **Silent Rate-Limiting & IP Blocking:** Yahoo routinely injects Cloudflare challenges or 429 rate limits without warning.
3. **Bar Adjustment Mismatches:** Yahoo applies retroactive dividend/split adjustments that alter historical high/low wick extremes, corrupting SMC swing points, liquidity sweeps, and order block boundaries.
4. **Use Case Limit:** Yahoo Finance may only be retained in offline local development tests as a tertiary cross-check if network is offline.

---

## 4. Timestamp & Provenance Governance

1. **Universal UTC Storage:**
   - Every bar, quote, order plan, and simulation record must store timestamps in ISO 8601 UTC with explicit `Z` or `+00:00` suffix (`2026-11-20T13:00:00Z`).
2. **Bar-Close Convention:**
   - A bar timestamp `barTimeUtc` strictly denotes the **Open** of the candle.
   - For a 15M bar opened at `13:00:00Z`, it closes at `13:14:59.999Z`. Strategy logic evaluates the bar strictly at or after `13:15:00Z` (`isClosed = true`).
3. **Mandatory UI Source Attribution:**
   - Every chart, ticker pill, and table cell must display the source provider and data timestamp (e.g., `Twelve Data · 15M · 13:15:00 UTC · LIVE`).
4. **Simulated Data Separation:**
   - Monte Carlo time-machine paths and synthetic replay bars must carry `isSimulated: true`.
   - Simulated prices are strictly barred from being plotted on live market overview charts.

---

## 5. Automated Data-Quality & Integrity Checks

Prior to being written into `public.market_bars` or consumed by strategy engines, every incoming bar sequence undergoes 5 automated validation checks:

1. **Time Gap Detector:** Flags missing candles during active market hours (ignoring scheduled weekend market closures).
2. **Duplicate & Overwrite Guard:** Enforces unique constraint `(symbol, timeframe, bar_time)`. Late-arriving duplicate bars with identical OHLC are deduplicated; divergent bars trigger an audit anomaly.
3. **Chronological Sequence Validator:** Rejects any batch where `bar_time[i] <= bar_time[i-1]`.
4. **Outlier Spike Filter:** Flags bars where `(high - low) > 5 * ATR(14)` or where `high < low` or `close > high` (bad print / corrupt tick).
5. **Stale Feed Circuit Breaker:** If no new bar arrives within `2 * timeframe_interval` during active market hours, the symbol is flagged `FEED_STALE` and the strategy engine is automatically paused.
