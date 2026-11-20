import type { InstrumentSpec } from "./types";

export const US30_SPEC: InstrumentSpec = {
  symbol: "US30",
  version: "v1.0_standard_cfd",
  assetClass: "INDEX",
  baseCurrency: "USD",
  quoteCurrency: "USD",
  contractSize: 1.0,           // 1 lot = 1 index point = $1.00 USD
  tickSize: 1.0,               // 1 index point
  tickValue: 1.0,              // $1.00 per point on 1 lot
  minLotSize: 0.1,             // 0.10 lot = $0.10 per point
  maxLotSize: 100.0,
  lotStep: 0.1,
  standardPip: 1.0,            // 1 point
  typicalSpreadPips: 2.5,      // 2.5 points typical spread
  marginRequirementPct: 5.0,   // 5% margin (1:20 leverage)
  effectiveFromUtc: "2026-01-01T00:00:00Z",
};

export const XAUUSD_SPEC: InstrumentSpec = {
  symbol: "XAUUSD",
  version: "v1.0_standard_cfd",
  assetClass: "COMMODITY",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  contractSize: 100.0,         // 100 troy oz
  tickSize: 0.01,              // $0.01 per oz
  tickValue: 1.0,              // $1.00 on 100 oz for 0.01 move
  minLotSize: 0.01,
  maxLotSize: 50.0,
  lotStep: 0.01,
  standardPip: 0.10,           // 10 cents = 1 pip ($10 per standard lot)
  typicalSpreadPips: 1.8,      // 1.8 pips ($0.18)
  marginRequirementPct: 1.0,   // 1% margin (1:100 leverage)
  effectiveFromUtc: "2026-01-01T00:00:00Z",
};

export const SPX500_SPEC: InstrumentSpec = {
  symbol: "SPX500",
  version: "v1.0_standard_cfd",
  assetClass: "INDEX",
  baseCurrency: "USD",
  quoteCurrency: "USD",
  contractSize: 1.0,
  tickSize: 0.1,
  tickValue: 0.1,
  minLotSize: 0.1,
  maxLotSize: 100.0,
  lotStep: 0.1,
  standardPip: 1.0,
  typicalSpreadPips: 0.4,
  marginRequirementPct: 5.0,
  effectiveFromUtc: "2026-01-01T00:00:00Z",
};

export const BTCUSD_SPEC: InstrumentSpec = {
  symbol: "BTCUSD",
  version: "v1.0_standard_cfd",
  assetClass: "CRYPTO",
  baseCurrency: "BTC",
  quoteCurrency: "USD",
  contractSize: 1.0,           // 1 BTC
  tickSize: 0.01,
  tickValue: 0.01,
  minLotSize: 0.01,
  maxLotSize: 10.0,
  lotStep: 0.01,
  standardPip: 1.0,
  typicalSpreadPips: 15.0,
  marginRequirementPct: 20.0,  // 1:5 leverage
  effectiveFromUtc: "2026-01-01T00:00:00Z",
};

const SPEC_REGISTRY: Record<string, InstrumentSpec> = {
  US30: US30_SPEC,
  DJI: US30_SPEC,
  XAUUSD: XAUUSD_SPEC,
  GOLD: XAUUSD_SPEC,
  SPX500: SPX500_SPEC,
  SPX: SPX500_SPEC,
  BTCUSD: BTCUSD_SPEC,
  BTC: BTCUSD_SPEC,
};

export function getInstrumentSpec(symbol: string): InstrumentSpec {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const spec = SPEC_REGISTRY[normalized];
  if (!spec) {
    throw new Error(`Unsupported instrument symbol: ${symbol}. Available: ${Object.keys(SPEC_REGISTRY).join(", ")}`);
  }
  return spec;
}

export function listSupportedInstruments(): InstrumentSpec[] {
  return [US30_SPEC, XAUUSD_SPEC, SPX500_SPEC, BTCUSD_SPEC];
}
