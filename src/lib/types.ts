export type FeedMode = "LIVE_API" | "AWAITING_SYNC" | "UNCONFIGURED";

export type DataCadence = "LIVE" | "DELAYED" | "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY";

export interface DatasetMeta {
  source: string;
  seriesId?: string;
  observationDate: string;
  releaseDate?: string;
  lastUpdated: string;
  frequency: DataCadence;
  units: string;
  mode: FeedMode;
}

export type RegimeTone = "bullish" | "bearish" | "neutral" | "mixed";

export interface MarketOverviewCardData {
  id: string;
  symbol: string;
  name: string;
  category: "FX" | "Rates" | "Volatility" | "Commodities" | "Equities" | "Crypto";
  value: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  unit: string;
  decimals: number;
  deltaUnit: "%" | "bps";
  sparkline: { t: string; v: number }[];
  meta: DatasetMeta;
}

export interface MacroRegimeFactor {
  id: string;
  label: string;
  status: string;
  tone: RegimeTone;
  score: number; // 0-100 for radar & summary
  signalValue: string;
  driver: string;
}

export interface EconomicCalendarEvent {
  id: string;
  event: string;
  country: "US" | "EZ" | "UK" | "JP" | "CN" | "CA" | "AU" | "CH" | string;
  currency?: string;
  bucket: "today" | "this-week" | "next-week";
  releaseTime: string;
  previous: string;
  consensus: string;
  actual: string | null;
  importance: "HIGH" | "MEDIUM" | "LOW" | "NON_ECONOMIC";
  unit: string;
  betterThanExpected?: boolean | null;
  rawDate?: string;
}

export type CotSignal = "Extreme Long" | "Neutral" | "Extreme Short";

export interface CotHistoryPoint {
  date: string;
  net: number;
  long: number;
  short: number;
  openInterest: number;
  oscillator: number;
  commercialNet: number;
}

export interface CotInstrument {
  id: string;
  instrument: string;
  symbol: string;
  assetClass: "FX" | "Rates" | "Metals" | "Energy" | "Equities" | "Crypto";
  netContracts: number;
  weeklyChange: number;
  longPositions: number;
  shortPositions: number;
  openInterest: number;
  percentile: number;
  signal: CotSignal;
  reportDate: string;
  releaseDate: string;
  history: CotHistoryPoint[];
}

export interface CorrelationAssetSeries {
  symbol: string;
  name: string;
  category: string;
  returns: { date: string; value: number; price: number }[];
}

export interface CentralBankItem {
  id: string;
  bank: string;
  country: string;
  currency: string;
  currentRate: number;
  previousDecision: string;
  expectedNextRate: number;
  impliedYearEnd: number;
  trajectory: "Hiking" | "Hold" | "Cutting" | "Dovish Hold";
  nextMeeting: string;
  balanceSheetTn: number;
  history: { date: string; rate: number }[];
  impliedCurve: { meeting: string; impliedRate: number; marketCutsBps: number }[];
  meta: DatasetMeta;
}

export interface FomcDecisionRow {
  date: string;
  decision: string;
  targetRange: string;
  effr: number;
  dissents: number;
  stance: "Hawkish" | "Neutral" | "Dovish";
}

export interface DealerMaturityBucket {
  bucket: string;
  netPositionBn: number;
  weeklyChangeBn: number;
  purchasesBn: number;
  salesBn: number;
}

export interface TreasuryAuctionRow {
  date: string;
  tenor: string;
  sizeBn: number;
  highYield: number;
  tailBps: number;
  bidToCover: number;
  indirectPct: number;
}

export interface LiquiditySeriesPoint {
  date: string;
  fedAssetsTn: number;
  tgaBn: number;
  rrpBn: number;
  netLiquidityTn: number;
  sofr: number;
  iorb: number;
  tgcr: number;
}

export interface CreditSpreadSeriesPoint {
  date: string;
  hyOasBps: number;
  igOasBps: number;
  stlFsi: number;
  vix: number;
  move: number;
  bankTighteningPct: number;
}

export interface EconomyLaborPoint {
  date: string;
  gdpQoq: number;
  ismMfg: number;
  ismSvc: number;
  retailMom: number;
  consumerConf: number;
  nfpK: number;
  unrate: number;
  initialClaimsK: number;
  continuingClaimsM: number;
  aheYoy: number;
  lfpr: number;
  joltsM: number;
}

export interface InflationCardMetric {
  id: string;
  label: string;
  latest: number | null;
  previous: number | null;
  consensus: number | null;
  actual: number | null;
  change: number | null;
  unit: "%";
  releaseDate: string;
  source: string;
  seriesId: string;
  cadence: DataCadence;
  observationDate?: string;
  mode?: FeedMode;
  meta?: DatasetMeta;
}

export interface InflationComponentRow {
  id: string;
  component: string;
  category: "CPI" | "PCE" | "PPI" | "Expectations";
  mom: number | null;
  yoy: number;
  previousYoy: number;
  weightPct: number | null;
  trend: "Accelerating" | "Sticky" | "Cooling";
  source: string;
}

export interface InflationHistoryPoint {
  date: string;
  cpiYoy: number;
  coreCpiYoy: number;
  pceYoy: number;
  corePceYoy: number;
  ppiYoy: number;
  breakeven10Y: number;
  breakeven5Y: number;
  forward5Y5Y: number;
  shelterYoy: number;
  energyYoy: number;
  foodYoy: number;
  servicesExEnergyYoy: number;
}

export interface YieldCurveSnapshotPoint {
  tenor: string;
  months: number;
  current: number;
  oneMonthAgo: number;
  oneYearAgo: number;
  realYield: number;
}

export interface YieldHistoryPoint {
  date: string;
  y2: number;
  y5: number;
  y10: number;
  y30: number;
  real10: number;
  spread2s10sBps: number;
  spread5s30sBps: number;
  termPremium10Y: number;
}

export interface InternationalEconomy {
  id: string;
  region: string;
  code: string;
  currency: string;
  fxPair: string;
  fxSpot: number;
  fxChangePct: number;
  gdpYoy: number;
  cpiYoy: number;
  coreCpiYoy: number;
  policyRate: number;
  implied6MRate: number;
  unemployment: number;
  yield10Y: number;
  pmiComposite: number;
  stance: "Hawkish" | "Neutral" | "Dovish";
  history: { date: string; gdpYoy: number; cpiYoy: number; yield10Y: number }[];
  meta: DatasetMeta;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string;
  category: "FX" | "Rates" | "Commodities" | "Equities" | "Crypto";
  price: number | null;
  changePct: number | null;
  note: string;
  sparkline: number[];
}

export type PillarBias = "Bullish" | "Neutral" | "Bearish";

export interface DailyCheckPillar {
  id: string;
  name: string;
  metricLabel: string;
  metricValue: string;
  bias: PillarBias;
  note: string;
}

export interface DailyCheckEntry {
  id: string;
  date: string;
  regime: string;
  netScore: number;
  pillars: DailyCheckPillar[];
  summaryNote: string;
}

export type RegimeLensId = "general" | "stocks" | "gold" | "dollar" | "oil";

export type ForceId = "growth" | "inflation" | "stress" | "policy" | "liquidity";

export type ForceDirection = "UP" | "DOWN" | "FLAT";

export interface RegimeForceDriver {
  label: string;
  value: string;
  delta: string;
}

export interface RegimeForceReading {
  id: ForceId;
  label: string;
  shortLabel: string;
  description: string;
  todayScore: number; // 0..100 pentagon radius
  lastWeekScore: number; // 0..100 dashed last-week radius
  todayZ: number;
  weekDelta: number;
  rangePercentile: number; // 0..100 position in 1Y range
  rangeBandLow: number; // 0..100 shaded range start
  rangeBandHigh: number; // 0..100 shaded range end
  direction: ForceDirection;
  stateLabel: string;
  stateTone: RegimeTone;
  drivers: RegimeForceDriver[];
}

export interface MarketConfirmationItem {
  symbol: string;
  name: string;
  priceLabel: string;
  weeklyMoveLabel: string;
  expectedDirection: string;
  confirms: boolean;
  rationale: string;
}

export interface RegimeTriggerItem {
  id: string;
  type: "bullish-flip" | "bearish-flip" | "catalyst";
  title: string;
  condition: string;
  currentState: string;
  distance: string;
}

export interface RegimeLensConfig {
  id: RegimeLensId;
  tabLabel: string;
  eyebrow: string;
  headline: string;
  thesis: string;
  biasLabel: "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL";
  tone: RegimeTone;
  assetSymbol: string;
  assetPrice: string;
  assetChange1W: string;
  assetChangePositive: boolean;
  confirmationsCount: number;
  confirmationsTotal: number;
  tradeVerdict: "CONFIRMED" | "SELECTIVE" | "NO TRADE";
  nonDriverNote: string;
  forces: RegimeForceReading[]; // Clockwise: growth, inflation, stress, policy, liquidity
  confirmations: MarketConfirmationItem[];
  triggers: RegimeTriggerItem[];
}
