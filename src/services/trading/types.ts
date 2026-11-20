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
  provider: string;
  fetchedAtUtc: string;
  isSimulated?: boolean;
}

export interface LatestQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  quoteTimestampUtc: string;
  receivedAtUtc: string;
  status: "LIVE" | "CURRENT" | "DELAYED" | "STALE" | "CLOSED";
  provider: string;
}

export interface InstrumentSpec {
  symbol: string;
  version: string;
  assetClass: "COMMODITY" | "INDEX" | "CRYPTO" | "FX" | "EQUITY";
  baseCurrency: string;
  quoteCurrency: string;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  minLotSize: number;
  maxLotSize: number;
  lotStep: number;
  standardPip: number;
  typicalSpreadPips: number;
  marginRequirementPct: number;
  effectiveFromUtc: string;
}

export type Direction = "BUY" | "SELL";

export type SetupStage = "HTF_BIAS" | "15M_KEY_ZONE" | "LIQUIDITY_SWEEP" | "LTF_CONFIRMATION";

export type SetupStatus = "MONITORING" | "PENDING_CONFIRMATION" | "TRIGGERED" | "EXPIRED" | "INVALIDATED";

export interface SetupComponent {
  stage: SetupStage;
  timeframe: Timeframe;
  eventTimeUtc: string;
  status: "PASSED" | "FAILED" | "PENDING";
  referenceLevel?: number;
  zoneTop?: number;
  zoneBottom?: number;
  sweepWickExtreme?: number;
  chochBreakLevel?: number;
  fvgTop?: number;
  fvgBottom?: number;
  rationale: string;
}

export interface StrategySetup {
  id: string;
  instrument: string;
  strategyName: string;
  direction: Direction;
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  status: SetupStatus;
  detectedAtUtc: string;
  expiresAtUtc: string;
  qualityGrade: "A+" | "A" | "B" | "REJECTED";
  components: SetupComponent[];
  plannedEntry: number;
  plannedStopLoss: number;
  plannedTakeProfit1: number;
  plannedTakeProfit2?: number;
  rewardToRiskRatio: number;
  metadata?: Record<string, unknown>;
}

export interface PositionSizingInput {
  accountEquity: number;
  riskPct: number; // e.g. 1.0 for 1%
  entryPrice: number;
  stopLossPrice: number;
  instrumentSpec: InstrumentSpec;
}

export interface PositionSizingResult {
  lotSize: number;
  dollarRisk: number;
  stopDistancePoints: number;
  stopDistancePips: number;
  notionalValue: number;
  marginRequired: number;
  isCapped: boolean;
  capReason?: string;
}

export interface RiskProfile {
  id: string;
  userId: string;
  profileName: string;
  accountEquity: number;
  accountCurrency: string;
  riskPerTradePct: number;
  maxOpenTrades: number;
  isActive: boolean;
}

export interface PropFirmRules {
  id: string;
  firmName: string;
  challengePhase: string;
  startingBalance: number;
  currentEquityHwm: number;
  maxDailyLossPct: number;
  maxTotalLossPct: number;
  dailyLossResetUtc: string; // e.g. "21:00:00"
  allowWeekendHold: boolean;
  newsBlackoutMinutes: number;
  isBreached: boolean;
  breachReason?: string;
}

export interface RiskGateInput {
  instrument: string;
  direction: Direction;
  plannedLotSize: number;
  dollarRisk: number;
  rewardToRiskRatio: number;
  riskProfile: RiskProfile;
  propRules?: PropFirmRules | null;
  currentDailyPnl: number;
  openPositionsCount: number;
  isNewsBlackout: boolean;
  isDataStale: boolean;
}

export interface RiskVerdict {
  verdict: "PASS" | "BLOCK";
  code:
    | "ALL_CONDITIONS_MET"
    | "MAX_DAILY_LOSS_BREACHED"
    | "TRAILING_DRAWDOWN_BREACHED"
    | "NEWS_BLACKOUT_ACTIVE"
    | "STALE_MARKET_FEED"
    | "MAX_OPEN_TRADES_EXCEEDED"
    | "REWARD_TO_RISK_INSUFFICIENT"
    | "EXCESSIVE_RISK_PERCENTAGE";
  message: string;
  timestampUtc: string;
}

export interface TradePlan {
  id: string;
  setupId?: string;
  instrument: string;
  direction: Direction;
  entryType: "LIMIT" | "MARKET";
  plannedEntryPrice: number;
  stopLossPrice: number;
  takeProfit1: number;
  takeProfit2?: number;
  rewardToRiskRatio: number;
  stopDistancePoints: number;
  calculatedLotSize: number;
  dollarRisk: number;
  gatekeeperVerdict: "PASS" | "BLOCK";
  gatekeeperReason: string;
  status: "PLANNED" | "READY" | "EXECUTED_MANUAL" | "CANCELLED" | "EXPIRED";
  createdAtUtc: string;
}
