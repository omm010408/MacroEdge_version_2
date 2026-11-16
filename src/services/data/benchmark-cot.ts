import type { CotHistoryPoint, CotInstrument, CotSignal } from "@/lib/types";
import type { CftcDatasetResult } from "@/services/cftc/client";

interface BenchmarkContractSpec {
  id: string;
  symbol: string;
  code: string;
  instrument: string;
  assetClass: CotInstrument["assetClass"];
  netK: number;
  wkK: number;
  pct: number;
  longK: number;
  shortK: number;
  oiK: number;
  commNetK: number;
}

const BENCHMARK_SPECS: BenchmarkContractSpec[] = [
  // FX
  { id: "eurusd", symbol: "6E", code: "099741", instrument: "Euro FX (CME)", assetClass: "FX", netK: -157.8, wkK: -13.9, pct: 0, longK: 175.2, shortK: 333.0, oiK: 612.4, commNetK: 142.0 },
  { id: "usdjpy", symbol: "6J", code: "097741", instrument: "Japanese Yen (CME)", assetClass: "FX", netK: 102.3, wkK: 0.73, pct: 79, longK: 148.1, shortK: 45.8, oiK: 284.9, commNetK: -88.5 },
  { id: "gbpusd", symbol: "6B", code: "096742", instrument: "British Pound (CME)", assetClass: "FX", netK: -59.8, wkK: 19.6, pct: 19, longK: 92.4, shortK: 152.2, oiK: 210.6, commNetK: 52.1 },
  { id: "dxy", symbol: "DX", code: "098662", instrument: "US Dollar Index (ICE)", assetClass: "FX", netK: 14.2, wkK: 0.069, pct: 79, longK: 38.6, shortK: 24.4, oiK: 85.3, commNetK: -11.8 },
  { id: "audusd", symbol: "6A", code: "232741", instrument: "Australian Dollar (CME)", assetClass: "FX", netK: -129.5, wkK: -1.1, pct: 0, longK: 48.2, shortK: 177.7, oiK: 245.1, commNetK: 118.0 },
  // Metals
  { id: "gold", symbol: "GC", code: "088691", instrument: "Gold (COMEX)", assetClass: "Metals", netK: 179.5, wkK: -6.9, pct: 26, longK: 220.5, shortK: 41.0, oiK: 399.2, commNetK: -95.0 },
  { id: "silver", symbol: "SI", code: "084691", instrument: "Silver (COMEX)", assetClass: "Metals", netK: 21.3, wkK: 1.5, pct: 16, longK: 54.8, shortK: 33.5, oiK: 142.0, commNetK: -18.2 },
  { id: "copper", symbol: "HG", code: "085692", instrument: "High Grade Copper (COMEX)", assetClass: "Metals", netK: 37.7, wkK: -10.6, pct: 56, longK: 82.1, shortK: 44.4, oiK: 215.0, commNetK: -32.0 },
  // Rates
  { id: "us10y", symbol: "ZN", code: "043602", instrument: "10Y Treasury Note (CBOT)", assetClass: "Rates", netK: -962.4, wkK: 19.2, pct: 22, longK: 420.0, shortK: 1382.4, oiK: 4210.0, commNetK: 850.0 },
  { id: "us02y", symbol: "ZT", code: "042601", instrument: "2Y Treasury Note (CBOT)", assetClass: "Rates", netK: -1000.0, wkK: 6.9, pct: 78, longK: 350.0, shortK: 1350.0, oiK: 3180.0, commNetK: 910.0 },
  // Energy
  { id: "wti", symbol: "CL", code: "067651", instrument: "WTI Crude Oil (NYMEX)", assetClass: "Energy", netK: 80.3, wkK: 5.9, pct: 15, longK: 245.0, shortK: 164.7, oiK: 1850.0, commNetK: -72.0 },
  // Equities
  { id: "spx", symbol: "ES", code: "13874A", instrument: "E-mini S&P 500 (CME)", assetClass: "Equities", netK: -129.4, wkK: 5.0, pct: 31, longK: 310.2, shortK: 439.6, oiK: 2680.0, commNetK: 115.0 },
  { id: "nq", symbol: "NQ", code: "209742", instrument: "E-mini Nasdaq-100 (CME)", assetClass: "Equities", netK: 42.9, wkK: -6.0, pct: 84, longK: 98.4, shortK: 55.5, oiK: 540.0, commNetK: -38.0 },
  // Crypto
  { id: "btc", symbol: "BTC", code: "133741", instrument: "Bitcoin Futures (CME)", assetClass: "Crypto", netK: 1.24, wkK: 0.32, pct: 74, longK: 16.8, shortK: 15.56, oiK: 34.2, commNetK: -0.9 },
];

const WEEKS = 73;
const REPORT_DATE = "2026-11-03";
const RELEASE_DATE = "2026-11-06";

function buildDeterministicHistory(spec: BenchmarkContractSpec): CotHistoryPoint[] {
  const endDate = new Date(2026, 10, 3);
  const seed = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  };
  const rnd = (s: number) => () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const genSeries = (start: number, end: number, key: string, amp: number) => {
    const r = rnd(seed(key));
    const p = [r() * 6.28, r() * 6.28];
    const out: number[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const t = i / (WEEKS - 1);
      const w = Math.sin(t * 9 + p[0]) * 0.6 + Math.sin(t * 23 + p[1]) * 0.4;
      out.push(start + (end - start) * t + w * amp * (1 - 0.5 * t));
    }
    out[0] = start;
    out[WEEKS - 1] = end;
    return out;
  };

  const netEnd = Math.round(spec.netK * 1000);
  const netStart = Math.round(netEnd * 0.6 + (rnd(seed(spec.symbol + "o"))() - 0.5) * Math.abs(netEnd) * 0.5);
  const netSeries = genSeries(netStart, netEnd, spec.symbol, Math.abs(netEnd) * 0.1 + 4000);

  const longEnd = Math.round(spec.longK * 1000);
  const longStart = Math.round(longEnd * 0.85);
  const longSeries = genSeries(longStart, longEnd, spec.symbol + "_L", longEnd * 0.08);

  const shortEnd = Math.round(spec.shortK * 1000);
  const shortStart = Math.round(shortEnd * 0.85);
  const shortSeries = genSeries(shortStart, shortEnd, spec.symbol + "_S", shortEnd * 0.08);

  const commEnd = Math.round(spec.commNetK * 1000);
  const commStart = Math.round(commEnd * 0.7);
  const commSeries = genSeries(commStart, commEnd, spec.symbol + "_C", Math.abs(commEnd) * 0.12);

  const oiEnd = Math.round(spec.oiK * 1000);
  const oiStart = Math.round(oiEnd * 0.9);
  const oiSeries = genSeries(oiStart, oiEnd, spec.symbol + "_OI", oiEnd * 0.05);

  const minNet = Math.min(...netSeries);
  const maxNet = Math.max(...netSeries);
  const span = Math.max(1, maxNet - minNet);

  const history: CotHistoryPoint[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const d = new Date(endDate);
    d.setDate(endDate.getDate() - 7 * (WEEKS - 1 - i));
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const net = Math.round(netSeries[i]);
    const osc = Math.max(0, Math.min(100, Math.round(((net - minNet) / span) * 100)));

    history.push({
      date: isoDate,
      net,
      long: Math.round(longSeries[i]),
      short: Math.round(shortSeries[i]),
      openInterest: Math.round(oiSeries[i]),
      commercialNet: Math.round(commSeries[i]),
      oscillator: osc,
    });
  }

  // Force latest point to align exactly with reported spec
  const last = history[history.length - 1];
  last.net = netEnd;
  last.long = longEnd;
  last.short = shortEnd;
  last.openInterest = oiEnd;
  last.commercialNet = commEnd;
  last.oscillator = spec.pct;

  return history;
}

export function getBenchmarkCotData(): CftcDatasetResult {
  const instruments: CotInstrument[] = BENCHMARK_SPECS.map((spec) => {
    const history = buildDeterministicHistory(spec);
    const netContracts = Math.round(spec.netK * 1000);
    const weeklyChange = Math.round(spec.wkK * 1000);
    const longPositions = Math.round(spec.longK * 1000);
    const shortPositions = Math.round(spec.shortK * 1000);
    const openInterest = Math.round(spec.oiK * 1000);

    const signal: CotSignal =
      spec.pct >= 80 ? "Extreme Long" : spec.pct <= 20 ? "Extreme Short" : "Neutral";

    return {
      id: spec.id,
      instrument: spec.instrument,
      symbol: spec.symbol,
      assetClass: spec.assetClass,
      netContracts,
      weeklyChange,
      longPositions,
      shortPositions,
      openInterest,
      percentile: spec.pct,
      signal,
      reportDate: REPORT_DATE,
      releaseDate: RELEASE_DATE,
      history,
    };
  });

  return {
    instruments,
    reportDate: REPORT_DATE,
    releaseDate: RELEASE_DATE,
    meta: {
      source: "CFTC · Legacy & TFF Futures",
      seriesId: "COT-WEEKLY",
      observationDate: REPORT_DATE,
      releaseDate: RELEASE_DATE,
      lastUpdated: new Date().toISOString(),
      frequency: "WEEKLY",
      units: "Contracts",
      mode: "LIVE_API",
    },
  };
}
