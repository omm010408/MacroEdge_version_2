"use client";

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

export function TerminalTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  valueFormatter?: (val: number | string, name?: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-[#1C1C1C] bg-[#0A0A0A] px-3 py-2 shadow-xl backdrop-blur-sm">
      {label !== undefined && (
        <div className="mb-1.5 border-b border-[#1C1C1C] pb-1 font-mono-num text-[10.5px] font-medium text-[#6B6B6B]">
          {String(label)}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const val = entry.value ?? "";
          const formatted = valueFormatter
            ? valueFormatter(val, entry.name)
            : typeof val === "number"
            ? val.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : String(val);

          return (
            <div
              key={`${entry.dataKey ?? entry.name}-${idx}`}
              className="flex items-center justify-between gap-4 font-mono-num text-[11px]"
            >
              <span className="flex items-center gap-1.5 text-[#A3A3A3]">
                <span
                  className="h-2 w-2 rounded-xs"
                  style={{ backgroundColor: entry.color ?? "#FFFFFF" }}
                />
                {entry.name}
              </span>
              <span className="font-semibold text-[#FFFFFF]">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
