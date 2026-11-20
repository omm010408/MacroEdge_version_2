import type { PositionSizingInput, PositionSizingResult } from "./types";

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { accountEquity, riskPct, entryPrice, stopLossPrice, instrumentSpec } = input;

  if (accountEquity <= 0) {
    throw new Error("Account equity must be strictly positive.");
  }
  if (riskPct <= 0 || riskPct > 10.0) {
    throw new Error(`Risk percentage (${riskPct}%) must be between 0.01% and 10.0%.`);
  }

  const stopDistancePoints = Math.abs(entryPrice - stopLossPrice);
  if (stopDistancePoints <= 0) {
    throw new Error("Entry price and Stop Loss price cannot be identical.");
  }

  const dollarRisk = Math.round(accountEquity * (riskPct / 100) * 100) / 100;

  // Value of 1 point movement per 1.0 standard lot:
  // e.g. For US30: 1 point * ($1.00 tick value / 1.0 tick size) = $1.00 per point per lot.
  // e.g. For XAUUSD: 1 point ($1.00) * ($1.00 tick value / 0.01 tick size) = $100.00 per point per lot.
  const pointValuePerLot = (instrumentSpec.tickValue / instrumentSpec.tickSize) * instrumentSpec.contractSize;

  const rawLotSize = dollarRisk / (stopDistancePoints * pointValuePerLot);

  // Round down to lot step
  const step = instrumentSpec.lotStep;
  const steppedLots = Math.floor(rawLotSize / step) * step;

  let finalLotSize = steppedLots;
  let isCapped = false;
  let capReason: string | undefined;

  if (finalLotSize < instrumentSpec.minLotSize) {
    finalLotSize = instrumentSpec.minLotSize;
    isCapped = true;
    capReason = `Clamped to minimum allowable lot size (${instrumentSpec.minLotSize}).`;
  } else if (finalLotSize > instrumentSpec.maxLotSize) {
    finalLotSize = instrumentSpec.maxLotSize;
    isCapped = true;
    capReason = `Clamped to maximum allowable lot size (${instrumentSpec.maxLotSize}).`;
  }

  // Precision formatting
  const stepDecimals = step.toString().split(".")[1]?.length ?? 0;
  finalLotSize = Number(finalLotSize.toFixed(stepDecimals));

  const actualDollarRisk = Math.round(finalLotSize * stopDistancePoints * pointValuePerLot * 100) / 100;
  const stopDistancePips = Number((stopDistancePoints / instrumentSpec.standardPip).toFixed(1));
  const notionalValue = Math.round(finalLotSize * entryPrice * instrumentSpec.contractSize * 100) / 100;
  const marginRequired = Math.round(notionalValue * (instrumentSpec.marginRequirementPct / 100) * 100) / 100;

  return {
    lotSize: finalLotSize,
    dollarRisk: actualDollarRisk,
    stopDistancePoints: Number(stopDistancePoints.toFixed(2)),
    stopDistancePips,
    notionalValue,
    marginRequired,
    isCapped,
    capReason,
  };
}
