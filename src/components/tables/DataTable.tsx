"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string | null;
  emptyMessage?: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyMessage = "No records match the active filter.",
  defaultSortKey,
  defaultSortDir = "desc",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;

    return [...data].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [data, columns, sortKey, sortDir]);

  function handleSort(col: DataColumn<T>) {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  }

  return (
    <div className="terminal-card w-full overflow-x-auto rounded-xl border border-[#1C1C1C] bg-[#0A0A0A]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#1C1C1C] bg-[#0A0A0A]">
            {columns.map((col) => {
              const sortable = Boolean(col.sortValue);
              const isSorted = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  aria-sort={
                    sortable
                      ? isSorted
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={cn(
                    "whitespace-nowrap px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#6B6B6B]",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.className
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      className={cn(
                        "inline-flex cursor-pointer select-none items-center gap-1 rounded transition-colors hover:text-[#FFFFFF] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#FFFFFF]",
                        col.align === "right" && "flex-row-reverse"
                      )}
                    >
                      <span>{col.header}</span>
                      {isSorted ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-[#FFFFFF]" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-[#FFFFFF]" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-[#6B6B6B]" />
                      )}
                    </button>
                  ) : (
                    <span>{col.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1C1C1C]">
          {sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-[12px] text-[#6B6B6B]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row) => {
              const key = rowKey(row);
              const selected = selectedRowKey === key;
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={onRowClick ? selected : undefined}
                  className={cn(
                    "transition-colors",
                    onRowClick &&
                      "cursor-pointer focus-visible:bg-[#141414] focus-visible:outline-none",
                    selected
                      ? "bg-[#141414] shadow-[inset_2px_0_0_#FFFFFF]"
                      : "hover:bg-[#141414]"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "whitespace-nowrap px-3.5 py-2.5 text-[12.5px] text-[#FFFFFF]",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                        col.className
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
