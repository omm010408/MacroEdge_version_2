"use client";

import { useMemo, useState } from "react";
import type { EconomicCalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { DataOpsEmptyState } from "@/components/dashboard/FeedbackStates";

type BucketFilter = "all" | "today" | "this-week" | "next-week";
type ImportanceFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

export interface EconomicCalendarProps {
  events: EconomicCalendarEvent[];
  defaultBucket?: BucketFilter;
}

export function EconomicCalendar({
  events,
  defaultBucket = "today",
}: EconomicCalendarProps) {
  const [bucket, setBucket] = useState<BucketFilter>(defaultBucket);
  const [country, setCountry] = useState<string>("ALL");
  const [importance, setImportance] = useState<ImportanceFilter>("ALL");

  const countries = useMemo(
    () => ["ALL", ...Array.from(new Set(events.map((e) => e.country)))],
    [events]
  );

  const counts = useMemo(
    () => ({
      all: events.length,
      today: events.filter((e) => e.bucket === "today").length,
      "this-week": events.filter((e) => e.bucket === "this-week").length,
      "next-week": events.filter((e) => e.bucket === "next-week").length,
    }),
    [events]
  );

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (bucket !== "all" && ev.bucket !== bucket) return false;
      if (country !== "ALL" && ev.country !== country) return false;
      if (importance !== "ALL" && ev.importance !== importance) return false;
      return true;
    });
  }, [events, bucket, country, importance]);

  const columns: DataColumn<EconomicCalendarEvent>[] = [
    {
      key: "time",
      header: "Release",
      sortValue: (row) => row.releaseTime,
      render: (row) => (
        <span className="font-mono-num text-[11.5px] text-[#9299A3]">
          {row.releaseTime}
        </span>
      ),
    },
    {
      key: "country",
      header: "Ctry",
      sortValue: (row) => row.country,
      render: (row) => (
        <span className="rounded border border-white/[0.09] bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[10.5px] font-semibold text-[#F0F2F5]">
          {row.country}
        </span>
      ),
    },
    {
      key: "event",
      header: "Event",
      sortValue: (row) => row.event,
      render: (row) => <span className="font-medium text-[#F0F2F5]">{row.event}</span>,
    },
    {
      key: "importance",
      header: "Impact",
      sortValue: (row) =>
        row.importance === "HIGH" ? 3 : row.importance === "MEDIUM" ? 2 : 1,
      render: (row) => (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono-num text-[10px] font-semibold",
            row.importance === "HIGH"
              ? "bg-[#F05454]/12 text-[#F05454]"
              : row.importance === "MEDIUM"
              ? "bg-[#D9B45C]/12 text-[#D9B45C]"
              : "bg-[#12161B] text-[#9299A3]"
          )}
        >
          {row.importance}
        </span>
      ),
    },
    {
      key: "previous",
      header: "Prev",
      align: "right",
      render: (row) => (
        <span className="font-mono-num text-[#9299A3]">{row.previous}</span>
      ),
    },
    {
      key: "consensus",
      header: "Cons",
      align: "right",
      render: (row) => (
        <span className="font-mono-num text-[#9299A3]">{row.consensus}</span>
      ),
    },
    {
      key: "actual",
      header: "Actual",
      align: "right",
      render: (row) =>
        row.actual ? (
          <span className="font-mono-num font-semibold text-[#FFFFFF]">{row.actual}</span>
        ) : (
          <span className="font-mono-num text-[#7A8390]">Pending</span>
        ),
    },
  ];

  if (events.length === 0) {
    return (
      <DataOpsEmptyState
        title="Economic Calendar Awaiting Live Data Sync"
        detail="Configure API keys and trigger Data Operations sync to load scheduled macroeconomic releases."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex max-w-full flex-wrap rounded-md border border-white/[0.09] bg-[#07090D] p-0.5">
          {(
            [
              { id: "today", label: "Today" },
              { id: "this-week", label: "This Week" },
              { id: "next-week", label: "Next Week" },
              { id: "all", label: "All" },
            ] as const
          ).map((item) => {
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setBucket(item.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  bucket === item.id
                    ? "bg-[#181B20] text-[#FFFFFF]"
                    : "text-[#9AA3B0] hover:text-[#F0F2F5]"
                )}
              >
                <span>{item.label}</span>
                <span
                  className={cn(
                    "rounded px-1 py-0.2 font-mono-num text-[10px]",
                    bucket === item.id
                      ? "bg-white/[0.12] text-[#FFFFFF]"
                      : "text-[#7A8390]"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-md border border-white/[0.09] bg-[#07090D] px-2.5 py-1 font-mono-num text-[11px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
          >
            {countries.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "All Countries" : c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter importance"
            value={importance}
            onChange={(e) => setImportance(e.target.value as ImportanceFilter)}
            className="rounded-md border border-white/[0.09] bg-[#07090D] px-2.5 py-1 font-mono-num text-[11px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
          >
            <option value="ALL">All Impact</option>
            <option value="HIGH">High Impact</option>
            <option value="MEDIUM">Medium Impact</option>
            <option value="LOW">Low Impact</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 && bucket === "today" && events.length > 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.09] bg-[#07090D]/50 px-4 py-8 text-center">
          <p className="text-[12.5px] font-medium text-[#F0F2F5]">
            No Scheduled Releases Logged for Today
          </p>
          <p className="mt-1 max-w-sm text-[11px] text-[#7D8694]">
            There are {counts["this-week"]} releases scheduled this week and {counts.all} across the full docket.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBucket("this-week")}
              className="rounded border border-white/[0.14] bg-[#12161B] px-3 py-1 font-mono-num text-[11px] font-medium text-[#FFFFFF] hover:border-white/30"
            >
              View This Week ({counts["this-week"]})
            </button>
            <button
              type="button"
              onClick={() => setBucket("all")}
              className="rounded border border-white/[0.08] bg-[#0A0D12] px-3 py-1 font-mono-num text-[11px] text-[#9AA3B0] hover:text-[#FFFFFF]"
            >
              View All ({counts.all})
            </button>
          </div>
        </div>
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          emptyMessage="No economic releases match the selected window and filters."
        />
      )}
    </div>
  );
}
