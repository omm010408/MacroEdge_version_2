"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { FeedModeBadge } from "@/components/cards/MarketStatusBadge";
import type { DatasetMeta } from "@/lib/types";

export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  meta?: DatasetMeta;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#1C1C1C] pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <Breadcrumbs />
        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
          <h1 className="text-[21px] font-semibold tracking-tight text-[#FFFFFF]">
            {title}
          </h1>
          {meta && (
            <FeedModeBadge
              mode={meta.mode}
              compact
              suffix={meta.observationDate}
              className="text-[10px] font-medium"
            />
          )}
        </div>
        {subtitle && (
          <p className="text-[12.5px] text-[#A3A3A3]">{subtitle}</p>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TimeframeSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-0.5">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded px-2.5 py-1 font-mono-num text-[11px] font-medium transition-all",
              active
                ? "bg-[#141414] text-[#FFFFFF] shadow-[inset_0_0_0_1px_#2E2E2E]"
                : "text-[#6B6B6B] hover:text-[#FFFFFF]"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function AssetSelector({
  options,
  selected,
  onToggle,
  multi = true,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  multi?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(opt.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 font-mono-num text-[11px] font-medium transition-colors",
              active
                ? "border-[#FFFFFF]/45 bg-[#FFFFFF]/12 text-[#FFFFFF]"
                : "border-white/[0.09] bg-[#07090D] text-[#9299A3] hover:border-white/20 hover:text-[#F0F2F5]",
              !multi && active && "shadow-xs"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function DateRangeSelector({
  ranges,
  value,
  onChange,
}: {
  ranges: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center rounded-md border border-white/[0.09] bg-[#07090D] p-0.5">
      {ranges.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={value === r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            "rounded px-2.5 py-1 font-mono-num text-[11px] transition-colors",
            value === r.id
              ? "bg-[#12161B] font-medium text-[#FFFFFF]"
              : "text-[#9299A3] hover:text-[#F0F2F5]"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
