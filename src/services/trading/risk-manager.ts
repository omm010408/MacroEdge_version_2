import type { RiskGateInput, RiskVerdict } from "./types";

export function evaluateRiskGate(input: RiskGateInput): RiskVerdict {
  const nowUtc = new Date().toISOString();
  const {
    dollarRisk,
    rewardToRiskRatio,
    riskProfile,
    propRules,
    currentDailyPnl,
    openPositionsCount,
    isNewsBlackout,
    isDataStale,
  } = input;

  // 1. Stale Data Feed Check
  if (isDataStale) {
    return {
      verdict: "BLOCK",
      code: "STALE_MARKET_FEED",
      message: "Market price feed is stale or disconnected. Order generation blocked for capital preservation.",
      timestampUtc: nowUtc,
    };
  }

  // 2. High-Impact News Blackout Window Check
  if (isNewsBlackout) {
    return {
      verdict: "BLOCK",
      code: "NEWS_BLACKOUT_ACTIVE",
      message: "High-impact macroeconomic news release window is active (±15 minutes). Execution locked.",
      timestampUtc: nowUtc,
    };
  }

  // 3. Minimum Reward-to-Risk (R:R) Hurdle Check (2.0R requirement)
  if (rewardToRiskRatio < 2.0) {
    return {
      verdict: "BLOCK",
      code: "REWARD_TO_RISK_INSUFFICIENT",
      message: `Setup reward-to-risk ratio (${rewardToRiskRatio.toFixed(2)}R) is below the institutional minimum threshold of 2.0R.`,
      timestampUtc: nowUtc,
    };
  }

  // 4. Max Open Trades Check
  if (openPositionsCount >= riskProfile.maxOpenTrades) {
    return {
      verdict: "BLOCK",
      code: "MAX_OPEN_TRADES_EXCEEDED",
      message: `Maximum concurrent open positions (${riskProfile.maxOpenTrades}) already active. New setup blocked.`,
      timestampUtc: nowUtc,
    };
  }

  // 5. User Profile Risk Per Trade Cap Check
  const maxAllowedRisk = riskProfile.accountEquity * (riskProfile.riskPerTradePct / 100);
  if (dollarRisk > maxAllowedRisk * 1.05) { // 5% tolerance for lot rounding
    return {
      verdict: "BLOCK",
      code: "EXCESSIVE_RISK_PERCENTAGE",
      message: `Proposed dollar risk ($${dollarRisk.toFixed(2)}) exceeds maximum allowed risk ($${maxAllowedRisk.toFixed(2)} at ${riskProfile.riskPerTradePct}%).`,
      timestampUtc: nowUtc,
    };
  }

  // 6. Prop Firm Hard Rules Check (if configured)
  if (propRules && !propRules.isBreached) {
    // Check Daily Loss Limit (e.g. 5% max daily drawdown)
    const maxDailyLossAllowed = propRules.startingBalance * (propRules.maxDailyLossPct / 100);
    const projectedDailyLoss = Math.abs(Math.min(0, currentDailyPnl)) + dollarRisk;

    if (projectedDailyLoss >= maxDailyLossAllowed) {
      return {
        verdict: "BLOCK",
        code: "MAX_DAILY_LOSS_BREACHED",
        message: `Projected loss ($${projectedDailyLoss.toFixed(2)}) breaches maximum daily prop-firm allowance ($${maxDailyLossAllowed.toFixed(2)} at ${propRules.maxDailyLossPct}%).`,
        timestampUtc: nowUtc,
      };
    }

    // Check Trailing Total Drawdown Limit (from High-Water Mark)
    const currentEquity = propRules.startingBalance + currentDailyPnl;
    const distanceToHwm = propRules.currentEquityHwm - (currentEquity - dollarRisk);
    const maxTotalLossAllowed = propRules.startingBalance * (propRules.maxTotalLossPct / 100);

    if (distanceToHwm >= maxTotalLossAllowed) {
      return {
        verdict: "BLOCK",
        code: "TRAILING_DRAWDOWN_BREACHED",
        message: `Projected drawdown ($${distanceToHwm.toFixed(2)}) breaches maximum trailing drawdown limit ($${maxTotalLossAllowed.toFixed(2)} at ${propRules.maxTotalLossPct}%).`,
        timestampUtc: nowUtc,
      };
    }
  }

  return {
    verdict: "PASS",
    code: "ALL_CONDITIONS_MET",
    message: "Pre-trade risk and prop-firm compliance verified. Setup approved for manual execution.",
    timestampUtc: nowUtc,
  };
}
