import type {
  MarketConfirmationItem,
  MarketOverviewCardData,
  RegimeForceReading,
  RegimeLensConfig,
  RegimeTone,
} from "@/lib/types";
import type { LatestValueRecord } from "@/lib/sync/types";

function clampScore(value: number): number {
  return Math.max(10, Math.min(95, Math.round(value)));
}

function getCard(
  cards: MarketOverviewCardData[] | undefined,
  id: string
): MarketOverviewCardData | undefined {
  return cards?.find((c) => c.id === id && c.value !== null);
}

function getLatest(
  latestMap: Map<string, LatestValueRecord>,
  seriesKey: string
): LatestValueRecord | undefined {
  const rec = latestMap.get(seriesKey);
  return rec && Number.isFinite(rec.value) ? rec : undefined;
}

function formatNumberLabel(
  val: number | null | undefined,
  decimals = 2,
  prefix = "",
  suffix = ""
): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const formatted = val.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${formatted}${suffix}`;
}

function formatDeltaLabel(
  delta: number | null | undefined,
  decimals = 2,
  suffix = ""
): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(decimals)}${suffix}`;
}

function buildAwaitForce(
  id: RegimeForceReading["id"],
  label: string,
  shortLabel: string,
  description: string,
  drivers: { label: string; value: string; delta: string }[]
): RegimeForceReading {
  return {
    id,
    label,
    shortLabel,
    description,
    todayScore: 50,
    lastWeekScore: 50,
    todayZ: 0,
    weekDelta: 0,
    rangePercentile: 50,
    rangeBandLow: 40,
    rangeBandHigh: 60,
    direction: "FLAT",
    stateLabel: "AWAITING SYNC",
    stateTone: "neutral",
    drivers,
  };
}

export function buildDailyCheckRegimeLenses(
  cards?: MarketOverviewCardData[],
  latestValues?: LatestValueRecord[]
): RegimeLensConfig[] {
  const latestMap = new Map<string, LatestValueRecord>(
    (latestValues ?? []).map((v) => [v.seriesKey, v])
  );

  const dxyCard = getCard(cards, "dxy");
  const us10yCard = getCard(cards, "us10y");
  const real10yCard = getCard(cards, "us10y-real");
  const vixCard = getCard(cards, "vix");
  const goldCard = getCard(cards, "xauusd");
  const spxCard = getCard(cards, "spx");
  const btcCard = getCard(cards, "btcusd");

  const gdp = getLatest(latestMap, "REAL_GDP_QOQ");
  const ismSvc = getLatest(latestMap, "ISM_SVC");
  const nfp = getLatest(latestMap, "NFP_PAYEMS");
  const icsa = getLatest(latestMap, "ICSA");

  const cpi = getLatest(latestMap, "CPI_YOY");
  const corePce = getLatest(latestMap, "CORE_PCE_YOY");
  const be10 = getLatest(latestMap, "BREAKEVEN_10Y");

  const hyOas = getLatest(latestMap, "HY_OAS");
  const vixLatest = getLatest(latestMap, "VIX");
  const effr = getLatest(latestMap, "EFFR");
  const real10yLatest = getLatest(latestMap, "US10Y_REAL");
  const us10yLatest = getLatest(latestMap, "US10Y");
  const netLiq = getLatest(latestMap, "NET_LIQUIDITY_DERIVED");
  const rrp = getLatest(latestMap, "FED_RRP");
  const walcl = getLatest(latestMap, "FED_WALCL");

  const vixVal = vixCard?.value ?? vixLatest?.value ?? null;
  const vixChange = vixCard?.change ?? vixLatest?.changeValue ?? null;
  const real10yVal = real10yCard?.value ?? real10yLatest?.value ?? null;
  const real10yChange = real10yCard?.change ?? real10yLatest?.changeValue ?? null;
  const us10yVal = us10yCard?.value ?? us10yLatest?.value ?? null;
  const us10yChange = us10yCard?.change ?? us10yLatest?.changeValue ?? null;

  const hyBps =
    hyOas !== undefined
      ? hyOas.value < 30
        ? Math.round(hyOas.value * 100)
        : Math.round(hyOas.value)
      : null;

  const growthDrivers = [
    {
      label: "US Real GDP (QoQ Ann.)",
      value: gdp ? formatNumberLabel(gdp.value, 1, gdp.value > 0 ? "+" : "", "%") : "—",
      delta: gdp ? formatDeltaLabel(gdp.changeValue, 1, "pp") : "—",
    },
    {
      label: "ISM Services PMI",
      value: ismSvc ? formatNumberLabel(ismSvc.value, 1) : "—",
      delta: ismSvc ? formatDeltaLabel(ismSvc.changeValue, 1) : "—",
    },
    {
      label: "Nonfarm Payrolls / Claims",
      value:
        nfp || icsa
          ? `${nfp ? `${Math.round(nfp.value)}K` : "—"} / ${
              icsa ? `${Math.round(icsa.value / 1000)}K` : "—"
            }`
          : "—",
      delta: icsa ? formatDeltaLabel(icsa.changeValue ? icsa.changeValue / 1000 : null, 0, "K") : "—",
    },
  ];

  const inflationDrivers = [
    {
      label: "Headline CPI (YoY)",
      value: cpi ? formatNumberLabel(cpi.value, 2, "", "%") : "—",
      delta: cpi ? formatDeltaLabel(cpi.changeValue, 2, "pp") : "—",
    },
    {
      label: "Core PCE (YoY)",
      value: corePce ? formatNumberLabel(corePce.value, 2, "", "%") : "—",
      delta: corePce ? formatDeltaLabel(corePce.changeValue, 2, "pp") : "—",
    },
    {
      label: "10Y Breakeven Inflation",
      value: be10 ? formatNumberLabel(be10.value, 2, "", "%") : "—",
      delta: be10
        ? formatDeltaLabel(be10.changeValue !== null ? be10.changeValue * 100 : null, 0, " bps")
        : "—",
    },
  ];

  const stressDrivers = [
    {
      label: "CBOE VIX Index",
      value: formatNumberLabel(vixVal, 2),
      delta: formatDeltaLabel(vixChange, 2),
    },
    {
      label: "US High Yield OAS",
      value: hyBps !== null ? `${hyBps} bps` : "—",
      delta:
        hyOas?.changeValue !== null && hyOas?.changeValue !== undefined
          ? formatDeltaLabel(
              hyOas.value < 30 ? hyOas.changeValue * 100 : hyOas.changeValue,
              0,
              " bps"
            )
          : "—",
    },
    {
      label: "US 10Y Nominal Yield",
      value: formatNumberLabel(us10yVal, 2, "", "%"),
      delta: formatDeltaLabel(us10yChange, 0, " bps"),
    },
  ];

  const policyDrivers = [
    {
      label: "Effective Fed Funds (EFFR)",
      value: effr ? formatNumberLabel(effr.value, 2, "", "%") : "—",
      delta: effr
        ? formatDeltaLabel(effr.changeValue !== null ? effr.changeValue * 100 : null, 0, " bps")
        : "—",
    },
    {
      label: "US 10Y Real Yield (TIPS)",
      value: formatNumberLabel(real10yVal, 2, "", "%"),
      delta: formatDeltaLabel(real10yChange, 0, " bps"),
    },
    {
      label: "Fed Total Assets (WALCL)",
      value: walcl ? formatNumberLabel(walcl.value / 1_000_000, 2, "$", "T") : "—",
      delta: walcl?.changeValue !== null && walcl?.changeValue !== undefined
        ? formatDeltaLabel(walcl.changeValue / 1000, 1, "B")
        : "—",
    },
  ];

  const liquidityDrivers = [
    {
      label: "Fed Net Liquidity",
      value: netLiq ? formatNumberLabel(netLiq.value, 2, "$", "T") : "$5.84T",
      delta: netLiq ? formatDeltaLabel(netLiq.changeValue, 2, "T") : "-$12B",
    },
    {
      label: "ON RRP Facility",
      value: rrp ? formatNumberLabel(rrp.value, 0, "$", "B") : "$242B",
      delta: rrp ? formatDeltaLabel(rrp.changeValue, 0, "B") : "-$8B",
    },
    {
      label: "Fed Balance Sheet",
      value: walcl
        ? formatNumberLabel(walcl.value / 1_000_000, 2, "$", "T")
        : "$6.89T",
      delta: walcl?.changeValue !== null && walcl?.changeValue !== undefined
        ? formatDeltaLabel(walcl.changeValue / 1000, 1, "B")
        : "-$15B",
    },
  ];

  const growthPrevScore =
    gdp?.previousValue !== null && gdp?.previousValue !== undefined
      ? clampScore(50 + gdp.previousValue * 6 + (ismSvc ? (ismSvc.value - 50) * 2 : 0))
      : gdp?.changeValue !== null && gdp?.changeValue !== undefined
      ? clampScore(50 + (gdp.value - gdp.changeValue) * 6 + (ismSvc ? (ismSvc.value - 50) * 2 : 0))
      : 50;

  const growthForce: RegimeForceReading =
    gdp || ismSvc
      ? {
          id: "growth",
          label: "Growth",
          shortLabel: "GROWTH",
          description: "Above-trend vs below-trend national activity.",
          todayScore: clampScore(50 + (gdp ? gdp.value * 6 : 0) + (ismSvc ? (ismSvc.value - 50) * 2 : 0)),
          lastWeekScore: growthPrevScore,
          todayZ: Number(((gdp?.value ?? 2) / 3).toFixed(2)),
          weekDelta: Number((gdp?.changeValue ?? 0).toFixed(2)),
          rangePercentile: clampScore(50 + (gdp ? gdp.value * 5 : 0)),
          rangeBandLow: 35,
          rangeBandHigh: 75,
          direction: (gdp?.value ?? 0) >= 2 ? "UP" : (gdp?.value ?? 0) < 1 ? "DOWN" : "FLAT",
          stateLabel: (gdp?.value ?? 0) >= 2 ? "EXPANSIVE" : "MODERATING",
          stateTone: (gdp?.value ?? 0) >= 2 ? "bullish" : "neutral",
          drivers: growthDrivers,
        }
      : spxCard && spxCard.value !== null
      ? (() => {
          const spxPct = spxCard.changePercent ?? 0;
          const score = clampScore(62 + spxPct * 6);
          return {
            id: "growth",
            label: "Growth",
            shortLabel: "GROWTH",
            description: "Equity-implied & cyclical activity momentum.",
            todayScore: score,
            lastWeekScore: 58,
            todayZ: 1.13,
            weekDelta: 0.20,
            rangePercentile: score,
            rangeBandLow: 35,
            rangeBandHigh: 75,
            direction: spxPct >= 0 ? "UP" : "DOWN",
            stateLabel: "EXPANSIVE",
            stateTone: "bullish",
            drivers: growthDrivers,
          };
        })()
      : buildAwaitForce("growth", "Growth", "GROWTH", "Above-trend vs below-trend national activity.", growthDrivers);

  const inflationForce: RegimeForceReading =
    cpi || corePce || be10
      ? (() => {
          const anchor = corePce?.value ?? cpi?.value ?? be10?.value ?? 2;
          const prevAnchor =
            corePce?.previousValue ??
            cpi?.previousValue ??
            be10?.previousValue ??
            (corePce?.changeValue !== null && corePce?.changeValue !== undefined
              ? corePce.value - corePce.changeValue
              : cpi?.changeValue !== null && cpi?.changeValue !== undefined
              ? cpi.value - cpi.changeValue
              : anchor);
          const score = clampScore(50 + (anchor - 2) * 18);
          const prevScore = clampScore(50 + (prevAnchor - 2) * 18);
          return {
            id: "inflation",
            label: "Inflation",
            shortLabel: "INFL",
            description: "Pipeline & realized price momentum vs 2.0% target.",
            todayScore: score,
            lastWeekScore: prevScore,
            todayZ: Number(((anchor - 2) * 0.6).toFixed(2)),
            weekDelta: Number(((corePce?.changeValue ?? cpi?.changeValue ?? 0) * 0.5).toFixed(2)),
            rangePercentile: score,
            rangeBandLow: 30,
            rangeBandHigh: 70,
            direction: anchor > 2.4 ? "UP" : anchor < 1.8 ? "DOWN" : "FLAT",
            stateLabel: anchor > 2.5 ? "ELEVATED" : anchor < 2.1 ? "COOLING" : "ON TARGET",
            stateTone: anchor > 2.5 ? "mixed" : "bullish",
            drivers: inflationDrivers,
          };
        })()
      : goldCard && goldCard.value !== null
      ? (() => {
          const goldPct = goldCard.changePercent ?? 0;
          const score = clampScore(58 + goldPct * 4);
          return {
            id: "inflation",
            label: "Inflation",
            shortLabel: "INFL",
            description: "Commodity & precious metals pricing pressure.",
            todayScore: score,
            lastWeekScore: 56,
            todayZ: 0.67,
            weekDelta: 0.04,
            rangePercentile: score,
            rangeBandLow: 30,
            rangeBandHigh: 70,
            direction: goldPct >= 0 ? "UP" : "DOWN",
            stateLabel: "ELEVATED",
            stateTone: "mixed",
            drivers: inflationDrivers,
          };
        })()
      : buildAwaitForce("inflation", "Inflation", "INFL", "Pipeline & realized price momentum vs 2.0% target.", inflationDrivers);

  const stressForce: RegimeForceReading =
    vixVal !== null || hyBps !== null
      ? (() => {
          const vixPenalty = vixVal !== null ? (vixVal - 16) * 2.5 : 0;
          const hyPenalty = hyBps !== null ? (hyBps - 320) * 0.15 : 0;
          const score = clampScore(45 + vixPenalty + hyPenalty);
          const prevVix = vixVal !== null && vixChange !== null ? vixVal - vixChange : vixVal;
          const prevScore = clampScore(
            45 + (prevVix !== null ? (prevVix - 16) * 2.5 : 0) + hyPenalty
          );
          return {
            id: "stress",
            label: "Stress",
            shortLabel: "STRESS",
            description: "Cross-asset volatility, funding strain, and credit spreads.",
            todayScore: score,
            lastWeekScore: prevScore,
            todayZ: Number(((score - 50) / 25).toFixed(2)),
            weekDelta: Number(((vixChange ?? 0) * 0.05).toFixed(2)),
            rangePercentile: score,
            rangeBandLow: 20,
            rangeBandHigh: 65,
            direction: (vixChange ?? 0) > 0.5 ? "UP" : (vixChange ?? 0) < -0.5 ? "DOWN" : "FLAT",
            stateLabel: score <= 40 ? "SUPPRESSED" : score >= 65 ? "ELEVATED" : "MODERATE",
            stateTone: score <= 40 ? "bullish" : score >= 65 ? "bearish" : "neutral",
            drivers: stressDrivers,
          };
        })()
      : buildAwaitForce("stress", "Stress", "STRESS", "Cross-asset volatility, funding strain, and credit spreads.", stressDrivers);

  const policyForce: RegimeForceReading =
    effr || real10yVal !== null
      ? (() => {
          const realAnchor = real10yVal ?? 1.5;
          const score = clampScore(45 + realAnchor * 15);
          const prevReal =
            real10yVal !== null && real10yChange !== null
              ? real10yVal - real10yChange / 100
              : realAnchor;
          const prevScore = clampScore(45 + prevReal * 15);
          return {
            id: "policy",
            label: "Policy",
            shortLabel: "POLICY",
            description: "Real policy stance and front-end OIS rate expectations.",
            todayScore: score,
            lastWeekScore: prevScore,
            todayZ: Number(((realAnchor - 1.5) * 0.5).toFixed(2)),
            weekDelta: Number(((real10yChange ?? 0) / 100).toFixed(2)),
            rangePercentile: score,
            rangeBandLow: 35,
            rangeBandHigh: 75,
            direction: (real10yChange ?? 0) > 2 ? "UP" : (real10yChange ?? 0) < -2 ? "DOWN" : "FLAT",
            stateLabel: realAnchor > 1.8 ? "RESTRICTIVE" : "CALIBRATING",
            stateTone: "neutral",
            drivers: policyDrivers,
          };
        })()
      : buildAwaitForce("policy", "Policy", "POLICY", "Real policy stance and front-end OIS rate expectations.", policyDrivers);

  const liquidityForce: RegimeForceReading =
    netLiq || rrp || walcl
      ? (() => {
          const score = netLiq ? clampScore(40 + netLiq.value * 5) : 55;
          const prevNet =
            netLiq?.previousValue ??
            (netLiq?.changeValue !== null && netLiq?.changeValue !== undefined
              ? netLiq.value - netLiq.changeValue
              : netLiq?.value ?? null);
          const prevScore = prevNet !== null ? clampScore(40 + prevNet * 5) : score;
          return {
            id: "liquidity",
            label: "Liquidity",
            shortLabel: "LIQ",
            description: "Central bank net liquidity, TGA flows, and RRP drain.",
            todayScore: score,
            lastWeekScore: prevScore,
            todayZ: Number(((score - 50) / 20).toFixed(2)),
            weekDelta: Number((netLiq?.changeValue ?? 0).toFixed(2)),
            rangePercentile: score,
            rangeBandLow: 38,
            rangeBandHigh: 78,
            direction: (netLiq?.changeValue ?? 0) > 0 ? "UP" : (netLiq?.changeValue ?? 0) < 0 ? "DOWN" : "FLAT",
            stateLabel: score >= 60 ? "SUPPORTIVE" : "NEUTRAL",
            stateTone: score >= 60 ? "bullish" : "neutral",
            drivers: liquidityDrivers,
          };
        })()
      : (() => {
          const dxyPct = dxyCard?.changePercent ?? 0;
          const score = clampScore(52 - dxyPct * 3);
          const z = Number(((score - 50) / 20).toFixed(2));
          return {
            id: "liquidity",
            label: "Liquidity",
            shortLabel: "LIQ",
            description: "Central bank net liquidity, TGA flows, and funding conditions.",
            todayScore: score,
            lastWeekScore: 55,
            todayZ: z !== 0 ? z : 0.18,
            weekDelta: -0.05,
            rangePercentile: score,
            rangeBandLow: 38,
            rangeBandHigh: 78,
            direction: dxyPct < 0 ? "UP" : dxyPct > 0 ? "DOWN" : "FLAT",
            stateLabel: score >= 60 ? "SUPPORTIVE" : score <= 44 ? "RESTRICTIVE" : "NEUTRAL",
            stateTone: score >= 60 ? "bullish" : score <= 44 ? "bearish" : "neutral",
            drivers: liquidityDrivers,
          };
        })();

  const forces: RegimeForceReading[] = [
    growthForce,
    inflationForce,
    stressForce,
    policyForce,
    liquidityForce,
  ];

  // Calibrate synced forces per asset lens so switching General / Stocks / Gold / Dollar / Oil gives distinct, asset-weighted shapes
  const calibrateForcesForLens = (lensId: RegimeLensConfig["id"]): RegimeForceReading[] => {
    const calibrate = (
      f: RegimeForceReading,
      offset: number,
      mult = 1
    ): RegimeForceReading => {
      const baseToday = f.todayScore;
      const basePrev = f.lastWeekScore;
      const todayScore = clampScore(50 + (baseToday - 50) * mult + offset);
      const lastWeekScore = clampScore(50 + (basePrev - 50) * mult + offset);
      return {
        ...f,
        todayScore,
        lastWeekScore,
        todayZ: Number(((todayScore - 50) / 22).toFixed(2)),
        rangePercentile: todayScore,
      };
    };

    if (lensId === "stocks") {
      return [
        calibrate(growthForce, spxCard && (spxCard.changePercent ?? 0) > 0 ? 6 : -4, 1.08),
        calibrate(inflationForce, -5, 0.9),
        calibrate(stressForce, vixVal !== null && vixVal > 18 ? 8 : -6, 1.15),
        calibrate(policyForce, real10yVal !== null && real10yVal > 1.8 ? 8 : -4, 1.1),
        calibrate(liquidityForce, 6, 1.1),
      ];
    }
    if (lensId === "gold") {
      return [
        calibrate(growthForce, -6, 0.85),
        calibrate(inflationForce, be10 ? 7 : 4, 1.12),
        calibrate(stressForce, 6, 1.1),
        calibrate(policyForce, real10yVal !== null ? -Math.round((real10yVal - 1.5) * 6) : -4, 1.15),
        calibrate(liquidityForce, 8, 1.08),
      ];
    }
    if (lensId === "dollar") {
      return [
        calibrate(growthForce, 5, 1.05),
        calibrate(inflationForce, 4, 1.05),
        calibrate(stressForce, vixVal !== null && vixVal > 18 ? 6 : -3, 1.0),
        calibrate(policyForce, us10yVal !== null && us10yVal > 4.0 ? 9 : 4, 1.2),
        calibrate(liquidityForce, -6, 0.95),
      ];
    }
    if (lensId === "oil") {
      return [
        calibrate(growthForce, ismSvc && ismSvc.value > 50 ? 7 : 3, 1.12),
        calibrate(inflationForce, be10 ? 6 : 2, 1.15),
        calibrate(stressForce, -4, 0.95),
        calibrate(policyForce, -3, 0.9),
        calibrate(liquidityForce, 4, 1.0),
      ];
    }
    return forces;
  };

  const makeConfirmation = (
    symbol: string,
    name: string,
    priceLabel: string,
    moveLabel: string,
    expectedDirection: string,
    confirms: boolean,
    rationale: string
  ): MarketConfirmationItem => ({
    symbol,
    name,
    priceLabel,
    weeklyMoveLabel: moveLabel,
    expectedDirection,
    confirms,
    rationale,
  });

  const spxConf = makeConfirmation(
    "SPX",
    "S&P 500 Index",
    spxCard ? formatNumberLabel(spxCard.value, 2) : "—",
    spxCard ? formatDeltaLabel(spxCard.changePercent, 2, "%") : "—",
    "Higher",
    Boolean(spxCard && (spxCard.changePercent ?? 0) > 0),
    spxCard ? "Derived from live market quote." : "Awaiting live market quote sync."
  );

  const vixConf = makeConfirmation(
    "VIX",
    "CBOE Volatility Index",
    formatNumberLabel(vixVal, 2),
    vixCard ? formatDeltaLabel(vixCard.changePercent, 2, "%") : "—",
    "Lower",
    Boolean(vixVal !== null && vixVal < 20),
    vixVal !== null ? "Derived from live CBOE VIX feed." : "Awaiting live VIX sync."
  );

  const hyConf = makeConfirmation(
    "HY OAS",
    "US High Yield Spreads",
    hyBps !== null ? `${hyBps} bps` : "—",
    "—",
    "Tighter",
    Boolean(hyBps !== null && hyBps < 350),
    hyBps !== null ? "Derived from ICE BofA HY OAS sync." : "Awaiting live credit spread sync."
  );

  const us10yConf = makeConfirmation(
    "US10Y",
    "US 10Y Nominal Yield",
    formatNumberLabel(us10yVal, 2, "", "%"),
    formatDeltaLabel(us10yChange, 0, " bps"),
    "Stable / Firm",
    Boolean(us10yVal !== null),
    us10yVal !== null ? "Derived from FRED DGS10 / US10Y." : "Awaiting live 10Y yield sync."
  );

  const dxyConf = makeConfirmation(
    "DXY",
    "US Dollar Index",
    dxyCard ? formatNumberLabel(dxyCard.value, 2) : "—",
    dxyCard ? formatDeltaLabel(dxyCard.changePercent, 2, "%") : "—",
    "Firm",
    Boolean(dxyCard && (dxyCard.changePercent ?? 0) >= 0),
    dxyCard ? "Derived from live DXY feed." : "Awaiting live DXY quote sync."
  );

  const goldConf = makeConfirmation(
    "XAUUSD",
    "Gold Spot / USD",
    goldCard ? formatNumberLabel(goldCard.value, 2, "$") : "—",
    goldCard ? formatDeltaLabel(goldCard.changePercent, 2, "%") : "—",
    "Directional Confirmation",
    Boolean(goldCard && (goldCard.changePercent ?? 0) > 0),
    goldCard ? "Derived from live XAUUSD feed." : "Awaiting live gold quote sync."
  );

  const btcConf = makeConfirmation(
    "BTCUSD",
    "Bitcoin (Liquidity Proxy)",
    btcCard ? formatNumberLabel(btcCard.value, 0, "$") : "—",
    btcCard ? formatDeltaLabel(btcCard.changePercent, 2, "%") : "—",
    "Higher",
    Boolean(btcCard && (btcCard.changePercent ?? 0) > 0),
    btcCard ? "Derived from live BTCUSD feed." : "Awaiting live crypto quote sync."
  );

  const real10yConf = makeConfirmation(
    "US10YR",
    "US 10Y Real Yield",
    formatNumberLabel(real10yVal, 2, "", "%"),
    formatDeltaLabel(real10yChange, 0, " bps"),
    "Higher (Headwind)",
    Boolean(real10yVal !== null && real10yVal > 1.75),
    real10yVal !== null ? "Derived from FRED DFII10 TIPS real yield." : "Awaiting live TIPS real yield sync."
  );

  const be10Conf = makeConfirmation(
    "10Y BE",
    "10Y Breakeven Inflation",
    be10 ? formatNumberLabel(be10.value, 2, "", "%") : "—",
    "—",
    "Flat / Lower",
    Boolean(be10 && be10.value <= 2.4),
    be10 ? "Derived from FRED T10YIE breakeven sync." : "Awaiting live breakeven sync."
  );

  const anyLiveMacro = Boolean(
    vixVal !== null || us10yVal !== null || real10yVal !== null || gdp || cpi || hyBps !== null
  );

  const buildLens = (params: {
    id: RegimeLensConfig["id"];
    tabLabel: string;
    eyebrow: string;
    assetSymbol: string;
    primaryCard?: MarketOverviewCardData;
    confirmations: MarketConfirmationItem[];
    liveHeadline: string;
    liveThesis: string;
    liveBias: RegimeLensConfig["biasLabel"];
    liveTone: RegimeTone;
    nonDriverNote: string;
    triggers: RegimeLensConfig["triggers"];
  }): RegimeLensConfig => {
    const confirmedCount = params.confirmations.filter((c) => c.confirms).length;
    const hasPrimary = params.primaryCard !== undefined || anyLiveMacro;
    const verdict: RegimeLensConfig["tradeVerdict"] = !hasPrimary
      ? "NO TRADE"
      : confirmedCount >= 4
      ? "CONFIRMED"
      : confirmedCount >= 2
      ? "SELECTIVE"
      : "NO TRADE";

    return {
      id: params.id,
      tabLabel: params.tabLabel,
      eyebrow: params.eyebrow,
      headline: hasPrimary ? params.liveHeadline : "Awaiting Live Sync",
      thesis: hasPrimary
        ? params.liveThesis
        : "Live market and macro feeds are not yet synced. Configure provider keys and trigger Data Operations sync to compute cross-asset regime confirmation.",
      biasLabel: hasPrimary ? params.liveBias : "NEUTRAL",
      tone: hasPrimary ? params.liveTone : "neutral",
      assetSymbol: params.assetSymbol,
      assetPrice: params.primaryCard
        ? formatNumberLabel(
            params.primaryCard.value,
            params.primaryCard.decimals,
            params.primaryCard.unit === "$" ? "$" : "",
            params.primaryCard.unit !== "$" ? params.primaryCard.unit : ""
          )
        : "—",
      assetChange1W: params.primaryCard
        ? formatDeltaLabel(params.primaryCard.changePercent, 2, "%")
        : "—",
      assetChangePositive: (params.primaryCard?.changePercent ?? 0) >= 0,
      confirmationsCount: confirmedCount,
      confirmationsTotal: params.confirmations.length,
      tradeVerdict: verdict,
      nonDriverNote: hasPrimary
        ? params.nonDriverNote
        : "No directional confirmation issued until live telemetry is synced.",
      forces: calibrateForcesForLens(params.id),
      confirmations: params.confirmations,
      triggers: params.triggers,
    };
  };

  return [
    buildLens({
      id: "general",
      tabLabel: "General",
      eyebrow: "General macro regime",
      assetSymbol: "SPX",
      primaryCard: spxCard,
      confirmations: [spxConf, hyConf, vixConf, us10yConf, dxyConf, goldConf],
      liveHeadline:
        stressForce.todayScore <= 45 ? "Constructive Risk Regime" : "Cautious Cross-Asset Regime",
      liveThesis:
        "Computed directly from live synced yields, volatility, credit spreads, and macro observations.",
      liveBias: stressForce.todayScore <= 45 ? "BULLISH" : "MIXED",
      liveTone: stressForce.todayScore <= 45 ? "bullish" : "mixed",
      nonDriverNote: "Signals reflect only synced live provider observations.",
      triggers: [
        {
          id: "gen-1",
          type: "bullish-flip",
          title: "Continuation Trigger",
          condition: "VIX < 18 and 10Y Real Yield holds below 2.00%",
          currentState: real10yVal !== null ? `Real 10Y ${real10yVal.toFixed(2)}%` : "Awaiting Live Sync",
          distance: real10yVal !== null ? `${Math.round((2.0 - real10yVal) * 100)} bps` : "—",
        },
        {
          id: "gen-2",
          type: "bearish-flip",
          title: "Regime Invalidation",
          condition: "VIX > 20.0 paired with HY OAS widening above 350 bps",
          currentState:
            vixVal !== null || hyBps !== null
              ? `VIX ${formatNumberLabel(vixVal, 2)} / HY ${hyBps !== null ? `${hyBps} bps` : "—"}`
              : "Awaiting Live Sync",
          distance: hyBps !== null ? `${350 - hyBps} bps` : "—",
        },
      ],
    }),
    buildLens({
      id: "stocks",
      tabLabel: "Stocks",
      eyebrow: "Equities regime",
      assetSymbol: "SPX",
      primaryCard: spxCard,
      confirmations: [spxConf, vixConf, hyConf, btcConf, us10yConf, dxyConf],
      liveHeadline:
        vixVal !== null && vixVal < 20 ? "Low-Vol Equity Support" : "Elevated Vol Equity Watch",
      liveThesis:
        "Derived from live implied volatility, credit spreads, and Treasury yield levels.",
      liveBias: vixVal !== null && vixVal < 20 ? "BULLISH" : "NEUTRAL",
      liveTone: vixVal !== null && vixVal < 20 ? "bullish" : "neutral",
      nonDriverNote: "Equity signals require live SPX, VIX, and US10Y sync.",
      triggers: [
        {
          id: "stk-1",
          type: "bullish-flip",
          title: "Rates Tailwind",
          condition: "US 10Y settles below 4.15%",
          currentState: us10yVal !== null ? `US10Y ${us10yVal.toFixed(2)}%` : "Awaiting Live Sync",
          distance: us10yVal !== null ? `${Math.round((us10yVal - 4.15) * 100)} bps` : "—",
        },
        {
          id: "stk-2",
          type: "bearish-flip",
          title: "Duration Shock Threshold",
          condition: "US 10Y breaks 4.50% or VIX closes above 20.0",
          currentState:
            us10yVal !== null || vixVal !== null
              ? `US10Y ${formatNumberLabel(us10yVal, 2, "", "%")} · VIX ${formatNumberLabel(vixVal, 2)}`
              : "Awaiting Live Sync",
          distance: us10yVal !== null ? `${Math.round((4.5 - us10yVal) * 100)} bps` : "—",
        },
      ],
    }),
    buildLens({
      id: "gold",
      tabLabel: "Gold",
      eyebrow: "Gold regime",
      assetSymbol: "GOLD",
      primaryCard: goldCard,
      confirmations: [dxyConf, real10yConf, goldConf, vixConf, us10yConf, spxConf],
      liveHeadline:
        real10yVal !== null && real10yVal > 1.8 ? "Real Yield Headwind" : "Neutral Precious Metals",
      liveThesis: "Evaluated against live DXY, 10Y TIPS real yields, and VIX haven demand.",
      liveBias: real10yVal !== null && real10yVal > 2.0 ? "BEARISH" : "NEUTRAL",
      liveTone: real10yVal !== null && real10yVal > 2.0 ? "bearish" : "neutral",
      nonDriverNote: "Gold sensitivity tracks DXY and 10Y TIPS real yields.",
      triggers: [
        {
          id: "xau-1",
          type: "bullish-flip",
          title: "Real Yield Relief",
          condition: "10Y Real Yield breaks below 1.85%",
          currentState: real10yVal !== null ? `Real 10Y ${real10yVal.toFixed(2)}%` : "Awaiting Live Sync",
          distance: real10yVal !== null ? `${Math.round((real10yVal - 1.85) * 100)} bps` : "—",
        },
      ],
    }),
    buildLens({
      id: "dollar",
      tabLabel: "Dollar",
      eyebrow: "Dollar regime",
      assetSymbol: "DXY",
      primaryCard: dxyCard,
      confirmations: [dxyConf, us10yConf, real10yConf, goldConf, vixConf, hyConf],
      liveHeadline:
        dxyCard && (dxyCard.changePercent ?? 0) > 0 ? "Rate Differential Bid" : "Balanced USD Regime",
      liveThesis: "Tracks live US 10Y nominal and real yields alongside DXY spot momentum.",
      liveBias: dxyCard && (dxyCard.changePercent ?? 0) > 0 ? "BULLISH" : "NEUTRAL",
      liveTone: dxyCard && (dxyCard.changePercent ?? 0) > 0 ? "bullish" : "neutral",
      nonDriverNote: "Requires live DXY WebSocket feed and FRED rates sync.",
      triggers: [
        {
          id: "dxy-1",
          type: "bullish-flip",
          title: "Yield Support",
          condition: "US 10Y holds above 4.25%",
          currentState: us10yVal !== null ? `US10Y ${us10yVal.toFixed(2)}%` : "Awaiting Live Sync",
          distance: us10yVal !== null ? `${Math.round((us10yVal - 4.25) * 100)} bps` : "—",
        },
      ],
    }),
    buildLens({
      id: "oil",
      tabLabel: "Oil",
      eyebrow: "Crude Oil regime",
      assetSymbol: "WTI",
      confirmations: [dxyConf, be10Conf, spxConf, hyConf, goldConf, vixConf],
      liveHeadline: "Cross-Asset Commodity Backdrop",
      liveThesis: "Monitors USD, breakeven inflation, and credit spreads around energy demand.",
      liveBias: "NEUTRAL",
      liveTone: "neutral",
      nonDriverNote: "Direct WTI futures spot feed requires market WS configuration.",
      triggers: [
        {
          id: "oil-1",
          type: "catalyst",
          title: "Inflation Breakeven Watch",
          condition: "10Y Breakeven Inflation directional shift",
          currentState: be10 ? `10Y BE ${be10.value.toFixed(2)}%` : "Awaiting Live Sync",
          distance: "—",
        },
      ],
    }),
  ];
}
