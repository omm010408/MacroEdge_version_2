"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { WatchlistItem } from "@/lib/types";
import { loadWatchlist, saveWatchlist } from "@/lib/storage/preferences";
import { useMacroRealtime } from "@/lib/realtime/useMacroRealtime";
import { cn, formatNumber } from "@/lib/utils";
import { PageHeader, TimeframeSelector } from "@/components/dashboard/FilterControls";
import { DataOpsEmptyState, EmptyState } from "@/components/dashboard/FeedbackStates";

function MiniSpark({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) {
    return <span className="font-mono-num text-[11px] text-[#555D68]">—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values
    .map((v, i) => `${((i / (values.length - 1)) * 72).toFixed(1)},${(22 - ((v - min) / range) * 20).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 72 24" className="h-6 w-18">
      <polyline
        fill="none"
        stroke={positive ? "#00C985" : "#F05454"}
        strokeWidth="1.5"
        points={coords}
      />
    </svg>
  );
}

export function WatchListView({
  defaultItems,
  universe,
}: {
  defaultItems: WatchlistItem[];
  universe: WatchlistItem[];
}) {
  const [items, setItems] = useState<WatchlistItem[]>(defaultItems);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [customSymbol, setCustomSymbol] = useState("");
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<WatchlistItem["category"]>("FX");
  const [savedFlag, setSavedFlag] = useState<string | null>(null);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtime = useMacroRealtime({ fetchOnMount: true, pollIntervalMs: 30000 });

  function showFlag(label: string) {
    setSavedFlag(label);
    if (flagTimeoutRef.current) clearTimeout(flagTimeoutRef.current);
    flagTimeoutRef.current = setTimeout(() => setSavedFlag(null), 1800);
  }

  useEffect(() => {
    setItems(loadWatchlist(defaultItems));
    return () => {
      if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
      if (flagTimeoutRef.current) clearTimeout(flagTimeoutRef.current);
    };
  }, [defaultItems]);

  async function persist(next: WatchlistItem[], label = "Saved") {
    if (noteDebounceRef.current) {
      clearTimeout(noteDebounceRef.current);
      noteDebounceRef.current = null;
    }
    setItems(next);
    await saveWatchlist(next);
    showFlag(label);
  }

  function addPreset(item: WatchlistItem) {
    if (items.some((i) => i.symbol === item.symbol)) {
      showFlag(`${item.symbol} already added`);
      return;
    }
    void persist([...items, item], `Added ${item.symbol}`);
  }

  function addCustom(e: React.FormEvent) {
    e.preventDefault();
    const sym = customSymbol.trim().toUpperCase();
    if (!sym) return;
    if (items.some((i) => i.symbol === sym)) {
      showFlag(`${sym} already in list`);
      return;
    }
    const entry: WatchlistItem = {
      id: `custom-${sym}-${Date.now()}`,
      symbol: sym,
      name: customName.trim() || `${sym} Custom Watch`,
      category: customCategory,
      price: null,
      changePct: null,
      note: "Added to custom terminal desk",
      sparkline: [],
    };
    setCustomSymbol("");
    setCustomName("");
    void persist([...items, entry], `Added ${sym}`);
  }

  function removeItem(id: string) {
    void persist(
      items.filter((i) => i.id !== id),
      "Removed"
    );
  }

  const availableAddons = useMemo(
    () => universe.filter((u) => !items.some((i) => i.symbol === u.symbol)),
    [universe, items]
  );

  const visibleItems = useMemo(
    () =>
      categoryFilter === "ALL"
        ? items
        : items.filter((item) => item.category === categoryFilter),
    [items, categoryFilter]
  );

  function moveVisibleItem(visibleIndex: number, direction: -1 | 1) {
    const targetVisibleIndex = visibleIndex + direction;
    if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleItems.length) return;
    const sourceId = visibleItems[visibleIndex]?.id;
    const targetId = visibleItems[targetVisibleIndex]?.id;
    if (!sourceId || !targetId) return;

    const fromIdx = items.findIndex((i) => i.id === sourceId);
    const toIdx = items.findIndex((i) => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const copy = [...items];
    const tmp = copy[fromIdx];
    copy[fromIdx] = copy[toIdx];
    copy[toIdx] = tmp;
    void persist(copy, "Reordered");
  }

  function updateNote(id: string, note: string) {
    const next = items.map((item) => (item.id === id ? { ...item, note } : item));
    setItems(next);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      void persist(next, "Note saved");
    }, 450);
  }

  function flushNotes(latestItems: WatchlistItem[]) {
    if (noteDebounceRef.current) {
      clearTimeout(noteDebounceRef.current);
      noteDebounceRef.current = null;
      void persist(latestItems, "Note saved");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instrument Watch List"
        subtitle="Track priority cross-asset benchmarks, reorder desk hierarchy, and persist thesis notes."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {savedFlag && (
              <span className="rounded border border-[#00C985]/35 bg-[#00C985]/10 px-2 py-1 font-mono-num text-[11px] text-[#00C985]">
                {savedFlag}
              </span>
            )}
            <TimeframeSelector
              options={["ALL", "FX", "Rates", "Commodities", "Equities", "Crypto"] as const}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>
        }
      />

      {/* Quick Add Preset + Custom Form */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 xl:col-span-7">
          <div className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
            Quick Add Terminal Benchmarks
          </div>
          {availableAddons.length === 0 ? (
            <div className="text-[12px] text-[#7A8390]">
              All benchmark instruments are currently active in your watch list.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableAddons.map((addon) => (
                <button
                  key={addon.symbol}
                  type="button"
                  onClick={() => addPreset(addon)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#0E1218] px-2.5 py-1.5 font-mono-num text-[11.5px] text-[#F0F2F5] transition hover:border-[#FFFFFF]/50 hover:text-[#FFFFFF]"
                >
                  <Plus className="h-3.5 w-3.5 text-[#FFFFFF]" />
                  {addon.symbol}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={addCustom}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-white/[0.09] bg-[#0A0D12] p-4 xl:col-span-5"
        >
          <div className="min-w-[90px] flex-1">
            <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-[#9299A3]">
              Ticker
            </label>
            <input
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value)}
              placeholder="EURGBP"
              className="w-full rounded border border-white/[0.09] bg-[#07090D] px-2.5 py-1.5 font-mono-num text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
            />
          </div>
          <div className="min-w-[120px] flex-1">
            <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-[#9299A3]">
              Label
            </label>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Euro / Pound"
              className="w-full rounded border border-white/[0.09] bg-[#07090D] px-2.5 py-1.5 text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-[#9299A3]">
              Class
            </label>
            <select
              aria-label="Custom instrument class"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value as WatchlistItem["category"])}
              className="rounded border border-white/[0.09] bg-[#07090D] px-2 py-1.5 font-mono-num text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
            >
              <option value="FX">FX</option>
              <option value="Rates">Rates</option>
              <option value="Commodities">Commodities</option>
              <option value="Equities">Equities</option>
              <option value="Crypto">Crypto</option>
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1 rounded bg-[#FFFFFF] px-3 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </form>
      </div>

      {/* Watchlist Table */}
      {visibleItems.length === 0 ? (
        items.length === 0 ? (
          <DataOpsEmptyState
            title="Watch List Empty — Awaiting Live Data Sync"
            detail="Add benchmarks or custom tickers above, or configure API keys and trigger Data Operations sync for live quotes."
          />
        ) : (
          <EmptyState
            title="No instruments in selected category"
            detail="Add instruments above or switch the category filter."
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/[0.09] bg-[#0A0D12]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#07090D] text-[10.5px] font-semibold uppercase tracking-wider text-[#9299A3]">
                <th className="px-3.5 py-2.5">Instrument</th>
                <th className="px-3.5 py-2.5">Class</th>
                <th className="px-3.5 py-2.5 text-right">Price</th>
                <th className="px-3.5 py-2.5 text-right">Daily Δ</th>
                <th className="px-3.5 py-2.5">7D Trend</th>
                <th className="px-3.5 py-2.5">Desk Note</th>
                <th className="px-3.5 py-2.5 text-right">Order / Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {visibleItems.map((item, idx) => {
                const liveQuote = realtime.marketQuotes[item.symbol];
                const liveSeries = realtime.latestValues[item.symbol];
                const resolvedPrice =
                  liveQuote && liveQuote.price > 0 && liveQuote.status !== "DISCONNECTED" && liveQuote.status !== "FAILED"
                    ? liveQuote.price
                    : liveSeries && liveSeries.status !== "DISCONNECTED" && liveSeries.status !== "FAILED"
                    ? liveSeries.value
                    : item.price;
                const resolvedChangePct =
                  liveQuote && liveQuote.price > 0 && liveQuote.status !== "DISCONNECTED" && liveQuote.status !== "FAILED"
                    ? liveQuote.changePct
                    : liveSeries && liveSeries.status !== "DISCONNECTED" && liveSeries.status !== "FAILED"
                    ? liveSeries.changePct ?? item.changePct
                    : item.changePct;
                const hasPrice = resolvedPrice !== null && Number.isFinite(resolvedPrice);
                const hasChangePct = resolvedChangePct !== null && Number.isFinite(resolvedChangePct);
                const isUp = (resolvedChangePct ?? 0) >= 0;
                const isFirst = idx === 0;
                const isLast = idx === visibleItems.length - 1;
                return (
                  <tr key={item.id} className="hover:bg-[#0E1218]">
                    <td className="whitespace-nowrap px-3.5 py-3">
                      <div className="font-mono-num text-[12px] font-semibold text-[#FFFFFF]">
                        {item.symbol}
                      </div>
                      <div className="text-[11.5px] text-[#9299A3]">{item.name}</div>
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3">
                      <span className="rounded border border-white/[0.09] bg-[#12161B] px-2 py-0.5 font-mono-num text-[10.5px] text-[#9299A3]">
                        {item.category}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 text-right font-mono-num text-[13px] font-semibold text-[#F0F2F5]">
                      {hasPrice
                        ? formatNumber(
                            resolvedPrice!,
                            resolvedPrice! > 1000 ? 0 : resolvedPrice! < 10 ? 4 : 2
                          )
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 text-right">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono-num text-[11px] font-medium",
                          !hasChangePct
                            ? "bg-[#12161B] text-[#7A8390]"
                            : isUp
                            ? "bg-[#00C985]/10 text-[#00C985]"
                            : "bg-[#F05454]/10 text-[#F05454]"
                        )}
                      >
                        {hasChangePct
                          ? `${isUp ? "+" : ""}${resolvedChangePct!.toFixed(2)}%`
                          : "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3">
                      <MiniSpark values={item.sparkline} positive={isUp} />
                    </td>
                    <td className="min-w-[240px] px-3.5 py-3">
                      <input
                        value={item.note}
                        onChange={(e) => updateNote(item.id, e.target.value)}
                        onBlur={() => flushNotes(items)}
                        aria-label={`Note for ${item.symbol}`}
                        className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-[12px] text-[#F0F2F5] transition hover:border-white/[0.09] focus:border-[#FFFFFF] focus:bg-[#07090D] focus:outline-none"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => moveVisibleItem(idx, -1)}
                          aria-label={`Move ${item.symbol} up`}
                          className="rounded border border-white/[0.08] p-1 text-[#9299A3] hover:text-[#F0F2F5] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => moveVisibleItem(idx, 1)}
                          aria-label={`Move ${item.symbol} down`}
                          className="rounded border border-white/[0.08] p-1 text-[#9299A3] hover:text-[#F0F2F5] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.symbol}`}
                          className="rounded border border-white/[0.08] p-1 text-[#F05454] hover:bg-[#F05454]/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
