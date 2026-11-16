import React from "react";
import { cn } from "@/lib/utils";

export interface ChartHeaderStat {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "accent" | "neutral";
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: string;
  stats?: ChartHeaderStat[];
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  badge,
  stats,
  controls,
  footer,
  children,
  className,
}: ChartCardProps) {
  return (
    <section
      className={cn(
        "terminal-card flex flex-col rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 lg:p-5 transition-colors hover:border-[#2E2E2E]",
        className
      )}
    >
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold tracking-tight text-[#FFFFFF]">
              {title}
            </h3>
            {badge && (
              <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 font-mono-num text-[10px] text-[#A3A3A3]">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[11.5px] text-[#6B6B6B]">{subtitle}</p>
          )}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="mb-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-md border border-[#1C1C1C] bg-[#0A0A0A] px-3 py-2 font-mono-num text-[11px]">
          {stats.map((st) => (
            <div key={st.label} className="flex items-center gap-1.5">
              <span className="text-[#6B6B6B]">{st.label}</span>
              <span
                className={cn(
                  "font-semibold",
                  st.tone === "positive" && "text-[#22C55E]",
                  st.tone === "negative" && "text-[#EF4444]",
                  st.tone === "accent" && "text-[#FFFFFF]",
                  (!st.tone || st.tone === "neutral") && "text-[#FFFFFF]"
                )}
              >
                {st.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="w-full flex-1">{children}</div>

      {footer && (
        <div className="mt-3 border-t border-[#1C1C1C] pt-2.5 font-mono-num text-[10.5px] text-[#6B6B6B]">
          {footer}
        </div>
      )}
    </section>
  );
}
