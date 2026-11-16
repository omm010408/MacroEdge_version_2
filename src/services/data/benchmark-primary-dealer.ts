import type { LiquiditySeriesPoint, TreasuryAuctionRow } from "@/lib/types";

export function getBenchmarkPrimaryDealerLiquidity(): LiquiditySeriesPoint[] {
  const WK = 78;
  const END = new Date(2026, 10, 11);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const seed = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  };

  const rnd = (s: number) => () =>
    ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

  function wave(
    start: number,
    end: number,
    amp: number,
    key: string,
    back4?: number
  ): number[] {
    const r = rnd(seed(key));
    const p = [r() * 6.28, r() * 6.28];
    const out: number[] = [];
    for (let i = 0; i < WK; i++) {
      const t = i / (WK - 1);
      const w = Math.sin(t * 11 + p[0]) * 0.6 + Math.sin(t * 29 + p[1]) * 0.4;
      out.push(start + (end - start) * t + w * amp * (1 - 0.5 * t));
    }
    if (back4 !== undefined) out[WK - 5] = back4;
    out[WK - 1] = end;
    return out;
  }

  const rrp = Array(WK).fill(0);
  rrp[67] = 4.2;
  rrp[69] = 12.1;
  rrp[70] = 3.9;

  const iorb = Array.from({ length: WK }, (_, i) => (i < 69 ? 3.65 : 3.9));
  const sofrNoise = wave(0, 0, 0.02, "sofr");
  const sofr = iorb.map(
    (v, i) => v + (i < 69 ? -0.02 : 0.04) + sofrNoise[i] * 0.4
  );
  sofr[WK - 1] = 3.94;

  const nl = wave(5760, 5850, 110, "nl", 5880);
  const ta = wave(6480, 6760, 55, "ta", 6760);

  const dates = Array.from({ length: WK }, (_, i) =>
    iso(new Date(END.getTime() - (WK - 1 - i) * 7 * 864e5))
  );

  return dates.map((date, i) => {
    const fedAssetsTn = Number((ta[i] / 1000).toFixed(2));
    const netLiquidityTn = Number((nl[i] / 1000).toFixed(2));
    const rrpBn = Number(rrp[i].toFixed(1));
    const tgaBn = Math.max(0, Math.round(ta[i] - nl[i] - rrpBn));

    return {
      date,
      fedAssetsTn,
      tgaBn,
      rrpBn,
      netLiquidityTn,
      sofr: Number(sofr[i].toFixed(2)),
      iorb: Number(iorb[i].toFixed(2)),
      tgcr: Number(sofr[i].toFixed(2)),
    };
  });
}

export function getBenchmarkTreasuryAuctions(): TreasuryAuctionRow[] {
  return [
    {
      date: "2026-10-15",
      tenor: "3-Year Note",
      sizeBn: 59.4,
      highYield: 4.932,
      tailBps: 0.0,
      bidToCover: 2.62,
      indirectPct: 55.3,
    },
    {
      date: "2026-10-15",
      tenor: "9-Year 10-Month Note",
      sizeBn: 39.9,
      highYield: 5.3,
      tailBps: 0.0,
      bidToCover: 2.77,
      indirectPct: 77.8,
    },
    {
      date: "2026-10-15",
      tenor: "29-Year 10-Month Bond",
      sizeBn: 22.5,
      highYield: 5.618,
      tailBps: 0.0,
      bidToCover: 2.54,
      indirectPct: 70.4,
    },
    {
      date: "2026-09-30",
      tenor: "9-Year 10-Month Note",
      sizeBn: 21.9,
      highYield: 2.653,
      tailBps: 0.0,
      bidToCover: 2.24,
      indirectPct: 51.1,
    },
    {
      date: "2026-09-30",
      tenor: "7-Year Note",
      sizeBn: 50.6,
      highYield: 5.085,
      tailBps: 0.0,
      bidToCover: 2.42,
      indirectPct: 49.1,
    },
    {
      date: "2026-09-30",
      tenor: "5-Year Note",
      sizeBn: 80.5,
      highYield: 5.033,
      tailBps: 0.0,
      bidToCover: 2.21,
      indirectPct: 47.0,
    },
    {
      date: "2026-09-30",
      tenor: "2-Year Note",
      sizeBn: 79.4,
      highYield: 4.787,
      tailBps: 0.0,
      bidToCover: 2.63,
      indirectPct: 49.3,
    },
    {
      date: "2026-09-18",
      tenor: "19-Year 11-Month Bond",
      sizeBn: 13.0,
      highYield: 5.42,
      tailBps: 0.0,
      bidToCover: 2.57,
      indirectPct: 52.1,
    },
    {
      date: "2026-09-15",
      tenor: "3-Year Note",
      sizeBn: 58.0,
      highYield: 4.474,
      tailBps: 0.0,
      bidToCover: 2.72,
      indirectPct: 61.7,
    },
  ];
}
