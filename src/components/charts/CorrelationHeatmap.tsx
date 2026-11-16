"use client";

import type { CorrelationAssetSeries } from "@/lib/types";
import { cn, pearsonCorrelation } from "@/lib/utils";

interface CorrelationHeatmapProps {
  assets: CorrelationAssetSeries[];
  lookbackDays?: number;
  selectedPair?: [string, string] | null;
  onSelectPair?: (a: string, b: string) => void;
}

function getCellStyle(r: number, isDiagonal: boolean): string {
  if (isDiagonal) return "bg-[#12161B] text-[#555D68]";
  if (r >= 0.65) return "bg-[#00C985]/25 text-[#00C985] border-[#00C985]/30";
  if (r >= 0.3) return "bg-[#00C985]/12 text-[#00C985]";
  if (r <= -0.65) return "bg-[#F05454]/25 text-[#F05454] border-[#F05454]/30";
  if (r <= -0.3) return "bg-[#F05454]/12 text-[#F05454]";
  return "bg-[#0E1115] text-[#9299A3]";
}

export function CorrelationHeatmap({
  assets,
  lookbackDays = 90,
  selectedPair,
  onSelectPair,
}: CorrelationHeatmapProps) {
  const sliced = assets.map((asset) => ({
    symbol: asset.symbol,
    values: asset.returns.slice(-lookbackDays).map((r) => r.value),
  }));

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-20 px-2 py-1 text-left font-mono-num text-[10px] font-medium text-[#7A8390]">
              {lookbackDays}D r
            </th>
            {sliced.map((col) => (
              <th
                key={col.symbol}
                className="px-2 py-1 text-center font-mono-num text-[11px] font-semibold text-[#9299A3]"
              >
                {col.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sliced.map((row, ri) => (
            <tr key={row.symbol}>
              <td className="px-2 py-1.5 font-mono-num text-[11px] font-semibold text-[#9299A3]">
                {row.symbol}
              </td>
              {sliced.map((col, ci) => {
                const isDiag = ri === ci;
                const r = isDiag ? 1 : pearsonCorrelation(row.values, col.values);
                const isPairActive =
                  selectedPair &&
                  ((selectedPair[0] === row.symbol && selectedPair[1] === col.symbol) ||
                    (selectedPair[1] === row.symbol && selectedPair[0] === col.symbol));

                return (
                  <td key={col.symbol} className="p-0">
                    <button
                      type="button"
                      disabled={isDiag || !onSelectPair}
                      onClick={() => onSelectPair?.(row.symbol, col.symbol)}
                      aria-label={`${row.symbol} vs ${col.symbol} correlation ${isDiag ? "1.00" : r.toFixed(2)}`}
                      title={isDiag ? row.symbol : `Inspect ${row.symbol} vs ${col.symbol} (${r.toFixed(2)})`}
                      className={cn(
                        "flex h-9 w-full min-w-[54px] items-center justify-center rounded border border-white/[0.07] font-mono-num text-[11.5px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#FFFFFF]",
                        getCellStyle(r, isDiag),
                        onSelectPair && !isDiag && "cursor-pointer hover:border-[#FFFFFF]/60",
                        isPairActive && "ring-1 ring-[#FFFFFF]"
                      )}
                    >
                      {isDiag ? "1.00" : r.toFixed(2)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
