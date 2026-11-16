import type {
  EconomyLaborPoint,
  InflationCardMetric,
  InflationComponentRow,
  InflationHistoryPoint,
  InternationalEconomy,
  YieldCurveSnapshotPoint,
  YieldHistoryPoint,
} from "@/lib/types";

export const INFLATION_TOP_METRICS: InflationCardMetric[] = [
  {
    id: "cpi-yoy",
    label: "CPI YoY",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "BLS · CUUR0000SA0",
    seriesId: "CPIAUCSL",
    cadence: "MONTHLY",
    mode: "UNCONFIGURED",
  },
  {
    id: "core-cpi-yoy",
    label: "Core CPI YoY",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "BLS · CUUR0000SA0L1E",
    seriesId: "CPILFESL",
    cadence: "MONTHLY",
    mode: "UNCONFIGURED",
  },
  {
    id: "pce-yoy",
    label: "PCE YoY",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "BEA · PCEPI",
    seriesId: "PCEPI",
    cadence: "MONTHLY",
    mode: "UNCONFIGURED",
  },
  {
    id: "core-pce-yoy",
    label: "Core PCE YoY",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "BEA · PCEPILFE",
    seriesId: "PCEPILFE",
    cadence: "MONTHLY",
    mode: "UNCONFIGURED",
  },
  {
    id: "ppi-yoy",
    label: "PPI YoY",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "BLS · PPIFIS",
    seriesId: "PPIFIS",
    cadence: "MONTHLY",
    mode: "UNCONFIGURED",
  },
  {
    id: "breakeven-10y",
    label: "10Y Breakeven Inflation",
    latest: null,
    previous: null,
    consensus: null,
    actual: null,
    change: null,
    unit: "%",
    releaseDate: "—",
    observationDate: "—",
    source: "FRED · T10YIE",
    seriesId: "T10YIE",
    cadence: "DAILY",
    mode: "UNCONFIGURED",
  },
];

export const INFLATION_COMPONENTS: InflationComponentRow[] = [];

export const INFLATION_HISTORY: InflationHistoryPoint[] = [];

export const ECONOMY_LABOR_SERIES: EconomyLaborPoint[] = [];

export const YIELD_CURVE_SNAPSHOT: YieldCurveSnapshotPoint[] = [];

export const YIELD_HISTORY: YieldHistoryPoint[] = [];

export const INTERNATIONAL_ECONOMIES: InternationalEconomy[] = [];

export const G10_EXTRA_ECONOMIES: InternationalEconomy[] = [];
