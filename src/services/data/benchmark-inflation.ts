import type {
  InflationCardMetric,
  InflationComponentRow,
  InflationHistoryPoint,
} from "@/lib/types";

export interface InflationDispersionItem {
  name: string;
  value: number;
}

export interface InflationDataQualityItem {
  title: string;
  description: string;
}

const N = 36;

const seed = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
};

const rnd = (s: number) => () =>
  ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

function path(
  start: number,
  end: number,
  prior: number,
  amp: number,
  key: string,
  last: number
): (number | null)[] {
  const r = rnd(seed(key));
  const p = [r() * 6.28, r() * 6.28];
  const out: (number | null)[] = [];
  for (let i = 0; i <= last; i++) {
    const t = i / last;
    const w = Math.sin(t * 9 + p[0]) * 0.6 + Math.sin(t * 23 + p[1]) * 0.4;
    out.push(
      Number((start + (end - start) * t + w * amp * (1 - 0.4 * t)).toFixed(2))
    );
  }
  out[last] = end;
  out[last - 1] = prior;
  while (out.length < N) out.push(null);
  return out;
}

export function getBenchmarkInflationHistory(): InflationHistoryPoint[] {
  const cpi = path(3.2, 3.74, 3.4, 0.22, "cpi", 34);
  const core = path(2.3, 2.57, 2.45, 0.1, "core", 34);
  const pce = path(3.0, 3.65, 3.44, 0.18, "pce", 34);
  const cpce = path(2.9, 3.12, 3.03, 0.1, "cpce", 34);
  const ppi = path(5.6, 6.52, 6.29, 0.4, "ppi", 35);
  const be = path(2.2, 2.24, 2.24, 0.07, "be", 35);
  const f55 = path(2.25, 2.22, 2.24, 0.06, "f55", 35);

  const points: InflationHistoryPoint[] = [];

  for (let i = 0; i < N; i++) {
    const d = new Date(2023, 10 + i, 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;

    points.push({
      date: dateStr,
      cpiYoy: cpi[i] ?? 0,
      coreCpiYoy: core[i] ?? 0,
      pceYoy: pce[i] ?? 0,
      corePceYoy: cpce[i] ?? 0,
      ppiYoy: ppi[i] ?? 0,
      breakeven10Y: be[i] ?? 0,
      breakeven5Y: Number(((be[i] ?? 2.24) + 0.22).toFixed(2)),
      forward5Y5Y: f55[i] ?? 0,
      shelterYoy: Number(((core[i] ?? 2.5) * 1.3).toFixed(2)),
      energyYoy: Number(((cpi[i] ?? 3.2) - (core[i] ?? 2.5)).toFixed(2)),
      foodYoy: Number(((cpi[i] ?? 3.2) * 0.9).toFixed(2)),
      servicesExEnergyYoy: Number(((core[i] ?? 2.5) * 1.15).toFixed(2)),
    });
  }

  return points;
}

export function getBenchmarkInflationTopMetrics(): InflationCardMetric[] {
  return [
    {
      id: "cpi-yoy",
      label: "CPI YoY",
      latest: 3.74,
      previous: 3.4,
      consensus: null,
      actual: 3.74,
      change: 0.34,
      unit: "%",
      releaseDate: "2026-10-12",
      observationDate: "2026-09-01",
      source: "BLS · CUUR0000SA0",
      seriesId: "CPIAUCSL",
      cadence: "MONTHLY",
      mode: "LIVE_API",
    },
    {
      id: "core-cpi-yoy",
      label: "Core CPI YoY",
      latest: 2.57,
      previous: 2.45,
      consensus: null,
      actual: 2.57,
      change: 0.12,
      unit: "%",
      releaseDate: "2026-10-12",
      observationDate: "2026-09-01",
      source: "FRED · CPILFESL",
      seriesId: "CPILFESL",
      cadence: "MONTHLY",
      mode: "LIVE_API",
    },
    {
      id: "pce-yoy",
      label: "PCE YoY",
      latest: 3.65,
      previous: 3.44,
      consensus: null,
      actual: 3.65,
      change: 0.2,
      unit: "%",
      releaseDate: "2026-10-31",
      observationDate: "2026-09-01",
      source: "FRED · PCEPI / BEA",
      seriesId: "PCEPI",
      cadence: "MONTHLY",
      mode: "LIVE_API",
    },
    {
      id: "core-pce-yoy",
      label: "Core PCE YoY",
      latest: 3.12,
      previous: 3.03,
      consensus: null,
      actual: 3.12,
      change: 0.09,
      unit: "%",
      releaseDate: "2026-10-31",
      observationDate: "2026-09-01",
      source: "FRED · PCEPILFE / BEA",
      seriesId: "PCEPILFE",
      cadence: "MONTHLY",
      mode: "LIVE_API",
    },
    {
      id: "ppi-yoy",
      label: "PPI YoY",
      latest: 6.52,
      previous: 6.29,
      consensus: null,
      actual: 6.52,
      change: 0.23,
      unit: "%",
      releaseDate: "2026-11-14",
      observationDate: "2026-10-01",
      source: "FRED · PPIFIS / BLS",
      seriesId: "PPIFIS",
      cadence: "MONTHLY",
      mode: "LIVE_API",
    },
    {
      id: "breakeven-10y",
      label: "10Y Breakeven Inflation",
      latest: 2.24,
      previous: 2.24,
      consensus: null,
      actual: 2.24,
      change: 0.0,
      unit: "%",
      releaseDate: "2026-11-13",
      observationDate: "2026-11-13",
      source: "FRED · T10YIE",
      seriesId: "T10YIE",
      cadence: "DAILY",
      mode: "LIVE_API",
    },
  ];
}

export function getBenchmarkInflationComponents(): InflationComponentRow[] {
  return [
    {
      id: "cpi-headline",
      component: "CPI YoY",
      category: "CPI",
      mom: null,
      yoy: 3.72,
      previousYoy: 3.35,
      weightPct: null,
      trend: "Accelerating",
      source: "FRED · CPIAUCSL",
    },
    {
      id: "cpi-core",
      component: "Core CPI YoY",
      category: "CPI",
      mom: null,
      yoy: 2.57,
      previousYoy: 2.45,
      weightPct: null,
      trend: "Accelerating",
      source: "FRED · CPILFESL",
    },
    {
      id: "pce-headline",
      component: "PCE YoY",
      category: "PCE",
      mom: null,
      yoy: 3.65,
      previousYoy: 3.44,
      weightPct: null,
      trend: "Accelerating",
      source: "FRED · PCEPI",
    },
    {
      id: "pce-core",
      component: "Core PCE YoY",
      category: "PCE",
      mom: null,
      yoy: 3.12,
      previousYoy: 3.03,
      weightPct: null,
      trend: "Accelerating",
      source: "FRED · PCEPILFE",
    },
    {
      id: "ppi-headline",
      component: "PPI YoY",
      category: "PPI",
      mom: null,
      yoy: 6.52,
      previousYoy: 6.29,
      weightPct: null,
      trend: "Accelerating",
      source: "FRED · PPIFIS",
    },
  ];
}

export function getBenchmarkInflationDispersion(): InflationDispersionItem[] {
  return [
    { name: "CPI YoY", value: 3.74 },
    { name: "Core CPI YoY", value: 2.57 },
    { name: "PCE YoY", value: 3.65 },
    { name: "Core PCE YoY", value: 3.12 },
    { name: "PPI YoY", value: 6.52 },
    { name: "10Y breakeven", value: 2.24 },
  ];
}

export function getBenchmarkInflationDataQuality(): InflationDataQualityItem[] {
  return [
    {
      title: "Headline CPI vs core card reads 0.00%",
      description:
        "The card shows headline 0.00% and Δ −3.72 pp. Headline minus core from the KPI values is +1.17 pp (3.74% − 2.57%). This page uses the computed gap.",
    },
    {
      title: "Headline PCE vs core card reads 0.00%",
      description:
        "Same issue: the card shows 0.00% with Δ −3.12 pp. Computed gap is +0.53 pp (3.65% − 3.12%).",
    },
    {
      title: "CPI YoY differs between the table and the KPI card",
      description:
        "Component table shows 3.72%; KPI card and dispersion show 3.74%. Both are kept here; check the source timestamp before using either alone.",
    },
    {
      title: "10Y breakeven differs between the panel and the card",
      description:
        "Breakeven panel header reads 2.34%; KPI card, expectations card and dispersion show 2.24%. This page uses 2.24% (T10YIE, obs 2026-11-13).",
    },
    {
      title: "Regime minimums of 0.00% look like gaps",
      description:
        "The 3Y summary shows 0.00 as the low for headline CPI, core CPI, core PCE and breakeven. These are likely missing observations, not real zeros, so treat the ranges as unreliable until history is backfilled.",
    },
    {
      title: "Delayed and missing consensus",
      description:
        "PCE and core PCE are flagged DELAYED, and consensus and surprise are empty for every series, so the surprise read is unavailable.",
    },
  ];
}
