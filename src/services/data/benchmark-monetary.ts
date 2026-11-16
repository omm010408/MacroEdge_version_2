import type { CentralBankItem, DatasetMeta, FomcDecisionRow, LiquiditySeriesPoint } from "@/lib/types";

const WK = 78;
const END_DATE = new Date(2026, 10, 12);

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

function wave(start: number, end: number, amp: number, key: string, back4: number) {
  const r = rnd(seed(key));
  const p = [r() * 6.28, r() * 6.28];
  const out: number[] = [];
  for (let i = 0; i < WK; i++) {
    const t = i / (WK - 1);
    const w = Math.sin(t * 11 + p[0]) * 0.6 + Math.sin(t * 29 + p[1]) * 0.4;
    out.push(start + (end - start) * t + w * amp * (1 - 0.5 * t));
  }
  out[WK - 5] = back4;
  out[WK - 1] = end;
  return out;
}

export function getBenchmarkMonetaryPolicyData(): {
  centralBanks: CentralBankItem[];
  fomcHistory: FomcDecisionRow[];
  liquiditySeries: LiquiditySeriesPoint[];
  meta: DatasetMeta;
} {
  const taVals = wave(6480, 6760, 55, "ta", 6760);
  const nlVals = wave(5760, 5850, 110, "nl", 5880);
  const tgaVals = wave(860, 914, 65, "tga", 883);

  const rrpVals = Array(WK).fill(0);
  rrpVals[67] = 4.2;
  rrpVals[69] = 12.1;
  rrpVals[70] = 3.9;

  const dates: string[] = [];
  for (let i = 0; i < WK; i++) {
    const d = new Date(END_DATE.getTime() - (WK - 1 - i) * 7 * 86400000);
    dates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }

  const liquiditySeries: LiquiditySeriesPoint[] = [];
  for (let i = 0; i < WK; i++) {
    const fedAssetsBn = Math.round(taVals[i]);
    const netLiqBn = Math.round(nlVals[i]);
    const tga = Math.round(tgaVals[i]);
    const rrp = Number(rrpVals[i].toFixed(1));

    liquiditySeries.push({
      date: dates[i],
      fedAssetsTn: Number((fedAssetsBn / 1000).toFixed(3)),
      tgaBn: tga,
      rrpBn: rrp,
      netLiquidityTn: Number((netLiqBn / 1000).toFixed(3)),
      sofr: 3.85,
      iorb: 3.90,
      tgcr: 3.84,
    });
  }

  const rateHistory = Array.from({ length: WK }, (_, i) => ({
    date: dates[i],
    rate: i < 69 ? 3.63 : 3.88,
  }));

  const oisImpliedCurve = [
    { meeting: "2026-12-09", impliedRate: 3.88, marketCutsBps: 0 },
    { meeting: "2027-01-27", impliedRate: 3.88, marketCutsBps: 0 },
    { meeting: "2027-03-17", impliedRate: 3.88, marketCutsBps: 0 },
    { meeting: "2027-05-05", impliedRate: 3.88, marketCutsBps: 0 },
    { meeting: "2027-06-16", impliedRate: 3.88, marketCutsBps: 0 },
  ];

  const meta: DatasetMeta = {
    source: "FRED · DFF / WALCL / WTREGEN / RRPONTSYD",
    seriesId: "FEDFUNDS",
    observationDate: "2026-11-12",
    lastUpdated: new Date().toISOString(),
    frequency: "WEEKLY",
    units: "%",
    mode: "LIVE_API",
  };

  const centralBanks: CentralBankItem[] = [
    {
      id: "fed",
      bank: "Federal Reserve",
      country: "United States",
      currency: "USD",
      currentRate: 3.88,
      previousDecision: "Synced EFFR",
      expectedNextRate: 3.88,
      impliedYearEnd: 3.88,
      trajectory: "Hold",
      nextMeeting: "2026-12-09",
      balanceSheetTn: 6.76,
      history: rateHistory,
      impliedCurve: oisImpliedCurve,
      meta,
    },
    {
      id: "ecb",
      bank: "European Central Bank",
      country: "Eurozone",
      currency: "EUR",
      currentRate: 3.25,
      previousDecision: "Cut -25 bps",
      expectedNextRate: 3.0,
      impliedYearEnd: 3.0,
      trajectory: "Cutting",
      nextMeeting: "2026-12-17",
      balanceSheetTn: 6.82,
      history: Array.from({ length: 24 }, (_, i) => ({
        date: dates[dates.length - 24 + i],
        rate: 3.25,
      })),
      impliedCurve: [
        { meeting: "2026-12-17", impliedRate: 3.0, marketCutsBps: -25 },
        { meeting: "2027-01-21", impliedRate: 2.75, marketCutsBps: -50 },
      ],
      meta,
    },
    {
      id: "boe",
      bank: "Bank of England",
      country: "United Kingdom",
      currency: "GBP",
      currentRate: 4.75,
      previousDecision: "Cut -25 bps",
      expectedNextRate: 4.5,
      impliedYearEnd: 4.5,
      trajectory: "Cutting",
      nextMeeting: "2026-12-18",
      balanceSheetTn: 0.94,
      history: Array.from({ length: 24 }, (_, i) => ({
        date: dates[dates.length - 24 + i],
        rate: 4.75,
      })),
      impliedCurve: [
        { meeting: "2026-12-18", impliedRate: 4.5, marketCutsBps: -25 },
      ],
      meta,
    },
    {
      id: "boj",
      bank: "Bank of Japan",
      country: "Japan",
      currency: "JPY",
      currentRate: 0.25,
      previousDecision: "Hike +15 bps",
      expectedNextRate: 0.5,
      impliedYearEnd: 0.5,
      trajectory: "Hiking",
      nextMeeting: "2026-12-19",
      balanceSheetTn: 4.88,
      history: Array.from({ length: 24 }, (_, i) => ({
        date: dates[dates.length - 24 + i],
        rate: 0.25,
      })),
      impliedCurve: [
        { meeting: "2026-12-19", impliedRate: 0.5, marketCutsBps: 25 },
      ],
      meta,
    },
  ];

  return {
    centralBanks,
    fomcHistory: [],
    liquiditySeries,
    meta,
  };
}
