import type { EconomyLaborPoint } from "@/lib/types";

export interface IndicatorStatusRow {
  indicator: string;
  series: string;
  latest: string;
  prior: string;
  source: string;
  obs: string;
  tone: "ok" | "bad";
  label: string;
}

export interface EconomyLaborDataQualityItem {
  title: string;
  description: string;
}

export function getBenchmarkEconomyLaborSeries(): EconomyLaborPoint[] {
  const N = 24;
  const wave = (f: (i: number) => number) =>
    Array.from({ length: N }, (_, i) => f(i));

  const nfp = wave(
    (i) =>
      110 + 120 * Math.sin(i * 0.9 + 0.5) * (0.6 + 0.4 * Math.cos(i * 0.37))
  );
  nfp[N - 1] = 165;
  nfp[N - 2] = 165;

  const unr = wave((i) => 4.3 + 0.22 * Math.sin(i * 0.5 + 1));
  unr[N - 1] = 4.1;
  unr[N - 2] = 4.1;

  const claims = wave((i) => 215 + 14 * Math.sin(i * 0.7));
  claims[N - 1] = 200;
  claims[N - 2] = 205;

  const jolts = wave((i) => 7.2 + 0.35 * Math.sin(i * 0.6 + 0.3));
  jolts[N - 1] = 7.52;
  jolts[N - 2] = 7.52;

  const gdp = wave(() => 3.4);

  return Array.from({ length: N }, (_, i) => {
    const d = new Date(2024, 10 + i, 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;

    return {
      date: dateStr,
      gdpQoq: Number(gdp[i].toFixed(1)),
      ismMfg: 0,
      ismSvc: 0,
      retailMom: 0,
      consumerConf: 0,
      nfpK: Math.round(nfp[i]),
      unrate: Number(unr[i].toFixed(1)),
      initialClaimsK: Math.round(claims[i]),
      continuingClaimsM: 0,
      aheYoy: 0,
      lfpr: 0,
      joltsM: Number(jolts[i].toFixed(2)),
    };
  });
}

export function getBenchmarkIndicatorStatus(): IndicatorStatusRow[] {
  return [
    {
      indicator: "Real GDP growth",
      series: "A191RL1Q225SBEA",
      latest: "3.4%",
      prior: "3.4%",
      source: "BEA",
      obs: "2026Q3",
      tone: "ok",
      label: "Live",
    },
    {
      indicator: "ISM services PMI",
      series: "ISM SVC",
      latest: "0.0",
      prior: "—",
      source: "ISM",
      obs: "2025-11",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "ISM manufacturing PMI",
      series: "ISM MFG",
      latest: "0.0",
      prior: "—",
      source: "ISM",
      obs: "2025-11",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "Advance retail sales MoM",
      series: "RSAFS",
      latest: "+0.00%",
      prior: "+0.00%",
      source: "Census",
      obs: "—",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "Consumer confidence",
      series: "CB / UMICH",
      latest: "0.0",
      prior: "+0.0 m/m",
      source: "Conference Board",
      obs: "—",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "Nonfarm payrolls Δ",
      series: "PAYEMS",
      latest: "+165K",
      prior: "+165K",
      source: "BLS",
      obs: "2026-10",
      tone: "ok",
      label: "Live · prior matches latest",
    },
    {
      indicator: "Labor force participation",
      series: "LFPR",
      latest: "0.0%",
      prior: "—",
      source: "BLS",
      obs: "—",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "Unemployment rate U-3",
      series: "UNRATE",
      latest: "4.1%",
      prior: "—",
      source: "BLS",
      obs: "2026-10",
      tone: "ok",
      label: "Live",
    },
    {
      indicator: "Avg hourly earnings YoY",
      series: "AHE",
      latest: "0.0%",
      prior: "—",
      source: "BLS",
      obs: "—",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "Initial jobless claims",
      series: "ICSA",
      latest: "200K",
      prior: "—",
      source: "DOL",
      obs: "2026-11-07",
      tone: "ok",
      label: "Live",
    },
    {
      indicator: "Continuing claims",
      series: "CCSA",
      latest: "0.00M",
      prior: "—",
      source: "DOL",
      obs: "—",
      tone: "bad",
      label: "Feed zero",
    },
    {
      indicator: "JOLTS job openings",
      series: "JTSJOL",
      latest: "7.52M",
      prior: "+0.00M m/m",
      source: "BLS",
      obs: "2026-09",
      tone: "ok",
      label: "Live · m/m zero",
    },
  ];
}

export function getBenchmarkEconomyLaborDataQuality(): EconomyLaborDataQualityItem[] {
  return [
    {
      title: "ISM services and manufacturing read 0.0",
      description:
        "Both series are zero for every month shown. The page shows an empty state instead of a flat zero line, so the 50 neutral line is not compared against real data.",
    },
    {
      title: "Retail sales and consumer confidence are zero",
      description:
        "Retail sales MoM is +0.00% with prior +0.00%, and confidence reads 0.0 with +0.0 m/m. These look like unpopulated feeds, not real readings.",
    },
    {
      title: "Wage growth and participation read 0.0%",
      description:
        "AHE YoY and LFPR are zero, so the unemployment chart does not plot wages. Both need a feed sync before they can be read against unemployment.",
    },
    {
      title: "Nonfarm payrolls current and prior are both +165K",
      description:
        "A repeated value often means the prior month did not load. Check the previous observation before reading the change.",
    },
    {
      title: "Zero placeholders in claims and JOLTS",
      description:
        "Continuing claims are 0.00M and JOLTS month-over-month is +0.00M. The headline levels are kept, but the changes are not reliable.",
    },
    {
      title: "Jobless claims history has a gap in the reference",
      description:
        "The reference chart is near zero until the last three months, which points to a backfill gap. This page uses the sample series for shape and the printed levels for the headline.",
    },
  ];
}
