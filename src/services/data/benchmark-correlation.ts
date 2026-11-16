import type { CorrelationAssetSeries } from "@/lib/types";

export function getBenchmarkCorrelationAssets(): CorrelationAssetSeries[] {
  const DAYS = 252;
  const END = new Date(2026, 10, 13);

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

  const genPrices = (basePrice: number, vol: number, trend: number, key: string) => {
    const r = rnd(seed(key));
    const prices: number[] = [basePrice];
    for (let i = 1; i < DAYS; i++) {
      const u1 = Math.max(1e-7, r());
      const u2 = r();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const ret = trend + z * vol;
      const prev = prices[i - 1];
      prices.push(Number((prev * (1 + ret)).toFixed(4)));
    }
    return prices;
  };

  const ASSETS = [
    { symbol: "DXY", name: "US Dollar Index", category: "FX", base: 104.2, vol: 0.0035, trend: -0.00004 },
    { symbol: "US10Y", name: "US 10Y Yield", category: "Rates", base: 4.85, vol: 0.008, trend: 0.0001, isYield: true },
    { symbol: "US02Y", name: "US 2Y Yield", category: "Rates", base: 4.60, vol: 0.009, trend: 0.00012, isYield: true },
    { symbol: "SPX", name: "S&P 500 Index", category: "Equities", base: 5600, vol: 0.0075, trend: 0.0007 },
    { symbol: "XAUUSD", name: "Gold Spot", category: "Commodities", base: 2650, vol: 0.0085, trend: 0.0008 },
    { symbol: "BTC", name: "Bitcoin", category: "Crypto", base: 64000, vol: 0.022, trend: 0.0009 },
  ];

  const dates: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(END);
    d.setDate(END.getDate() - (DAYS - 1 - i));
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  return ASSETS.map((asset) => {
    const prices = genPrices(asset.base, asset.vol, asset.trend, asset.symbol);
    const returns: { date: string; value: number; price: number }[] = [];
    for (let i = 1; i < DAYS; i++) {
      const prev = prices[i - 1];
      const curr = prices[i];
      const val = asset.isYield ? curr - prev : ((curr - prev) / prev) * 100;
      returns.push({
        date: dates[i],
        value: Number(val.toFixed(3)),
        price: curr,
      });
    }

    return {
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      returns,
    };
  });
}
