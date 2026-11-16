"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Copy,
  ExternalLink,
  Factory,
  Filter,
  Layers,
  Newspaper,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { FilteredMarketauxArticle } from "@/services/marketaux/ai-filter";
import { cn } from "@/lib/utils";

interface GoldUs30NewsSectionProps {
  initialNews: FilteredMarketauxArticle[];
  lastUpdated?: string;
}

export function GoldUs30NewsSection({
  initialNews,
  lastUpdated: initialLastUpdated,
}: GoldUs30NewsSectionProps) {
  const [news, setNews] = useState<FilteredMarketauxArticle[]>(initialNews);
  const [assetFilter, setAssetFilter] = useState<"ALL" | "GOLD" | "US30">("ALL");
  const [stanceFilter, setStanceFilter] = useState<"ALL" | "BULLISH" | "BEARISH" | "NEUTRAL">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "match" | "sentiment">("newest");
  const [expandedUuids, setExpandedUuids] = useState<Set<string>>(new Set());
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(
    initialLastUpdated || new Date().toISOString()
  );

  // Sync news live from Marketaux API
  async function handleRefresh() {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/news/gold-us30?refresh=1");
      const json = await res.json();
      if (json.ok && Array.isArray(json.news)) {
        setNews(json.news);
        setLastUpdated(json.lastUpdated || new Date().toISOString());
        setStatusMessage(`Successfully synced ${json.news.length} verified macro intelligence items.`);
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        setStatusMessage("Failed to sync latest feed; cached intelligence active.");
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.warn("Failed to refresh Gold/US30 news:", err);
      setStatusMessage("Network error; cached intelligence active.");
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setLoading(false);
    }
  }

  // Toggle card details
  function toggleExpand(uuid: string) {
    setExpandedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }

  // Copy formatted bullet summary
  function handleCopySummary(item: FilteredMarketauxArticle) {
    const formatted = [
      `[MACROEDGE AI INTELLIGENCE]`,
      `• Target Asset: ${item.targetAsset === "BOTH" ? "Gold (XAUUSD) & Dow Jones (US30)" : item.targetAsset === "GOLD" ? "Gold (XAUUSD)" : "Dow Jones (US30)"}`,
      `• Transmission Channel: ${item.transmissionChannel}`,
      `• AI Stance: ${item.goldImpact ? `XAU ${item.goldImpact}` : ""} ${item.us30Impact ? `| US30 ${item.us30Impact}` : ""}`.trim(),
      `• Core Headline: ${item.title}`,
      `• Summary: ${item.summary}`,
      `• AI Analysis: ${item.aiRationale}`,
      `• Key Drivers: ${item.keyDrivers.join(", ")}`,
      `• Source: ${item.source} (${new Date(item.publishedAt).toLocaleDateString()})`,
      `• URL: ${item.url}`,
    ].join("\n");

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(formatted).then(() => {
        setCopiedUuid(item.uuid);
        setTimeout(() => setCopiedUuid(null), 2500);
      });
    }
  }

  // Send news to AI Simulator
  function handleSimulate(item: FilteredMarketauxArticle) {
    const textToSimulate = `${item.title}: ${item.aiRationale}`;
    const targetUrl = `/macrodashboard/tools/ai-bias?news=${encodeURIComponent(textToSimulate)}`;
    window.location.href = targetUrl;
  }

  // Comprehensive filtered and sorted news
  const filteredNews = useMemo(() => {
    let result = news.filter((item) => {
      // 1. Asset filter
      if (assetFilter === "GOLD" && item.targetAsset !== "GOLD" && item.targetAsset !== "BOTH") {
        return false;
      }
      if (assetFilter === "US30" && item.targetAsset !== "US30" && item.targetAsset !== "BOTH") {
        return false;
      }

      // 2. Stance filter
      if (stanceFilter !== "ALL") {
        const matchesGold = item.goldImpact === stanceFilter;
        const matchesUs30 = item.us30Impact === stanceFilter;
        if (!matchesGold && !matchesUs30) {
          return false;
        }
      }

      // 3. Entity filter
      if (selectedEntity && !item.entities.includes(selectedEntity)) {
        return false;
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inSummary = item.summary.toLowerCase().includes(q);
        const inRationale = item.aiRationale.toLowerCase().includes(q);
        const inChannel = item.transmissionChannel.toLowerCase().includes(q);
        const inDrivers = item.keyDrivers.some((d) => d.toLowerCase().includes(q));
        const inEntities = item.entities.some((e) => e.toLowerCase().includes(q));
        if (!inTitle && !inSummary && !inRationale && !inChannel && !inDrivers && !inEntities) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    result = [...result].sort((a, b) => {
      if (sortBy === "match") {
        return b.relevanceScore - a.relevanceScore;
      }
      if (sortBy === "sentiment") {
        return Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore);
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    return result;
  }, [news, assetFilter, stanceFilter, selectedEntity, searchQuery, sortBy]);

  // Aggregate entity tags from current news
  const allEntities = useMemo(() => {
    const set = new Set<string>();
    for (const item of news) {
      for (const ent of item.entities) {
        if (ent) set.add(ent);
      }
    }
    return Array.from(set).slice(0, 10);
  }, [news]);

  const goldCount = news.filter(
    (n) => n.targetAsset === "GOLD" || n.targetAsset === "BOTH"
  ).length;
  const us30Count = news.filter(
    (n) => n.targetAsset === "US30" || n.targetAsset === "BOTH"
  ).length;

  return (
    <section className="dashboard-panel terminal-card overflow-hidden rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] text-[#FFFFFF]">
      {/* ============================================================== */}
      {/* 1. INSTITUTIONAL HEADER BAR                                     */}
      {/* ============================================================== */}
      <div className="border-b border-[#1C1C1C] bg-[#0A0A0A] px-4 py-4 lg:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#1C1C1C] bg-[#141414] text-[#FFFFFF]">
              <Newspaper className="h-4.5 w-4.5" />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0A0A0A] bg-[#22C55E]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-bold tracking-tight text-[#FFFFFF]">
                  Market intelligence
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-2 py-0.5 font-mono-num text-[9px] font-semibold uppercase tracking-wide text-[#22C55E]">
                  <Zap className="h-2.5 w-2.5" />
                  Live feed
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#6B6B6B]">
                AI-filtered catalysts mapped to Gold and US30 with directional impact and transmission context.
              </p>
            </div>
          </div>

          {/* REFRESH & SYNC ACTION */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <div className="hidden text-right sm:block">
              <div className="font-mono-num text-[10px] text-[#A3A3A3]">
                Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="font-mono-num text-[9px] text-[#6B6B6B]">
                {news.length} stories
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#141414] px-3 py-1.5 text-[10px] font-semibold text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C] disabled:opacity-50"
              title="Force refresh live news from Marketaux API"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              <span>{loading ? "Syncing..." : "Refresh feed"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* STATUS NOTIFICATION BANNER */}
      {statusMessage && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-[#1C1C1C] bg-[#141414] px-3 py-2 text-[11px] text-[#FFFFFF] lg:mx-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-[#A3A3A3] hover:text-[#FFFFFF]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. WORKING INTERACTIVE TOOLBAR & CONTROLS                       */}
      {/* ============================================================== */}
      <div className="mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-3.5 lg:mx-5">
        {/* ROW 1: ASSET TABS & STANCE FILTER */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* ASSET TABS */}
          <div className="flex items-center gap-1 rounded-lg border border-[#1C1C1C] bg-[#000000] p-1">
            <button
              onClick={() => { setAssetFilter("ALL"); setSelectedEntity(null); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono-num text-[11px] font-medium transition",
                assetFilter === "ALL"
                  ? "bg-[#FFFFFF] text-[#000000] font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-[#FFFFFF]"
              )}
            >
              <Layers className="h-3 w-3" />
              All Catalysts ({news.length})
            </button>

            <button
              onClick={() => { setAssetFilter("GOLD"); setSelectedEntity(null); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono-num text-[11px] font-medium transition",
                assetFilter === "GOLD"
                  ? "bg-[#FFFFFF] text-[#000000] font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-[#FFFFFF]"
              )}
            >
              <Coins className="h-3 w-3" />
              Gold (XAUUSD) ({goldCount})
            </button>

            <button
              onClick={() => { setAssetFilter("US30"); setSelectedEntity(null); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono-num text-[11px] font-medium transition",
                assetFilter === "US30"
                  ? "bg-[#FFFFFF] text-[#000000] font-bold shadow-sm"
                  : "text-[#A3A3A3] hover:text-[#FFFFFF]"
              )}
            >
              <Factory className="h-3 w-3" />
              Dow Jones (US30) ({us30Count})
            </button>
          </div>

          {/* STANCE & SORT DROPDOWNS */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-[#A3A3A3]">
              <Filter className="h-3 w-3 text-[#6B6B6B]" />
              <span>Signal:</span>
              <select
                value={stanceFilter}
                onChange={(e) =>
                  setStanceFilter(e.target.value as "ALL" | "BULLISH" | "BEARISH" | "NEUTRAL")
                }
                className="rounded-md border border-[#1C1C1C] bg-[#141414] px-2 py-1 font-mono-num text-[11px] text-[#FFFFFF] outline-none focus:border-[#FFFFFF]"
              >
                <option value="ALL">All Signals</option>
                <option value="BULLISH">Bullish Only</option>
                <option value="BEARISH">Bearish Only</option>
                <option value="NEUTRAL">Neutral Only</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-[#A3A3A3]">
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "newest" | "match" | "sentiment")
                }
                className="rounded-md border border-[#1C1C1C] bg-[#141414] px-2 py-1 font-mono-num text-[11px] text-[#FFFFFF] outline-none focus:border-[#FFFFFF]"
              >
                <option value="newest">Newest First</option>
                <option value="match">Highest AI Match</option>
                <option value="sentiment">Largest Sentiment</option>
              </select>
            </div>
          </div>
        </div>

        {/* ROW 2: SEARCH INPUT & CLICKABLE ENTITY CHIPS */}
        <div className="flex flex-col gap-2.5 pt-2 border-t border-[#1C1C1C] sm:flex-row sm:items-center sm:justify-between">
          {/* SEARCH BAR */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6B6B6B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by catalyst, driver, ticker (e.g. yields, caterpillar, inflation)..."
              className="w-full rounded-md border border-[#1C1C1C] bg-[#141414] pl-8 pr-7 py-1.5 text-[11.5px] text-[#FFFFFF] placeholder:text-[#6B6B6B] outline-none focus:border-[#FFFFFF]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B6B6B] hover:text-[#FFFFFF]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* CLICKABLE ENTITY CHIPS */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="font-mono-num text-[#6B6B6B] uppercase">Filter Ticker:</span>
            {allEntities.map((ticker) => {
              const isSelected = selectedEntity === ticker;
              return (
                <button
                  key={ticker}
                  onClick={() => setSelectedEntity(isSelected ? null : ticker)}
                  className={cn(
                    "rounded px-2 py-0.5 font-mono-num transition border",
                    isSelected
                      ? "border-[#FFFFFF] bg-[#FFFFFF] text-[#000000] font-bold"
                      : "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3] hover:border-[#2E2E2E] hover:text-[#FFFFFF]"
                  )}
                >
                  {ticker}
                </button>
              );
            })}
          </div>
        </div>

        {/* ACTIVE FILTER STATUS SUMMARY BAR */}
        {(selectedEntity || searchQuery || stanceFilter !== "ALL" || assetFilter !== "ALL") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1C1C1C] pt-2 text-[10.5px] text-[#A3A3A3]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Active Constraints:</span>
              {assetFilter !== "ALL" && (
                <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 text-[#FFFFFF]">
                  Asset: {assetFilter}
                </span>
              )}
              {stanceFilter !== "ALL" && (
                <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 text-[#FFFFFF]">
                  Stance: {stanceFilter}
                </span>
              )}
              {selectedEntity && (
                <span className="rounded border border-[#FFFFFF] bg-[#FFFFFF] text-[#000000] font-bold px-1.5 py-0.5">
                  Ticker: {selectedEntity}
                </span>
              )}
              {searchQuery && (
                <span className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 text-[#FFFFFF]">
                  Query: &quot;{searchQuery}&quot;
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setAssetFilter("ALL");
                setStanceFilter("ALL");
                setSelectedEntity(null);
                setSearchQuery("");
              }}
              className="text-[#FFFFFF] hover:underline font-mono-num"
            >
              [ Reset All Filters ]
            </button>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 3. STRUCTURED POINTER-BASED NEWS GRID                           */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 lg:p-5">
        {filteredNews.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-[#1C1C1C] bg-[#0A0A0A] p-8 text-center">
            <Newspaper className="mx-auto h-7 w-7 text-[#6B6B6B]" />
            <p className="mt-2.5 text-xs font-semibold text-[#FFFFFF] uppercase tracking-wider">
              No matching macro intelligence found
            </p>
            <p className="mt-1 text-[11px] text-[#6B6B6B] max-w-md mx-auto">
              All unrelated news stories without direct, quantified transmission to Gold or US30 are suppressed. Try resetting your search or filter tags.
            </p>
            <button
              onClick={() => {
                setAssetFilter("ALL");
                setStanceFilter("ALL");
                setSelectedEntity(null);
                setSearchQuery("");
              }}
              className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#141414] px-3 py-1.5 text-xs text-[#FFFFFF] hover:border-[#FFFFFF] hover:bg-[#FFFFFF] hover:text-[#000000]"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredNews.map((item) => {
            const isExpanded = expandedUuids.has(item.uuid);
            const isCopied = copiedUuid === item.uuid;
            const primaryImpact =
              item.targetAsset === "GOLD"
                ? item.goldImpact
                : item.targetAsset === "US30"
                ? item.us30Impact
                : item.goldImpact || item.us30Impact;

            return (
              <div
                key={item.uuid}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-[#1C1C1C] bg-[#0A0A0A] p-4 transition-colors hover:border-[#2E2E2E] hover:bg-[#141414]"
              >
                <div
                  className={cn(
                    "absolute inset-x-0 top-0 h-0.5",
                    primaryImpact === "BULLISH"
                      ? "bg-[#22C55E]"
                      : primaryImpact === "BEARISH"
                      ? "bg-[#EF4444]"
                      : "bg-[#FFFFFF]"
                  )}
                />
                <div>
                  {/* TOP ROW: ASSET TAG + CHANNEL + MATCH */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1C1C1C] pb-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-[#1C1C1C] bg-[#141414] px-2 py-0.5 font-mono-num text-[9px] font-bold tracking-wide text-[#FFFFFF]">
                        {item.targetAsset === "BOTH"
                          ? "DUAL IMPACT (XAU & US30)"
                          : item.targetAsset === "GOLD"
                          ? "GOLD · XAUUSD"
                          : "US30 · DOW JONES"}
                      </span>

                      <span className="rounded border border-[#1C1C1C] bg-[#141414] px-2 py-0.5 font-mono-num text-[9px] text-[#A3A3A3] font-medium">
                        {item.transmissionChannel}
                      </span>
                    </div>

                    <span className="flex items-center gap-1.5 font-mono-num text-[9px] text-[#6B6B6B]">
                      <span>{item.relevanceScore}% match</span>
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-[#1C1C1C]">
                        <span
                          className="block h-full rounded-full bg-[#FFFFFF]"
                          style={{ width: `${Math.min(100, Math.max(0, item.relevanceScore))}%` }}
                        />
                      </span>
                    </span>
                  </div>

                  {/* ARTICLE HEADLINE */}
                  <h3 className="mt-3 text-[14px] font-semibold leading-snug tracking-[-0.01em] text-[#FFFFFF]">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 hover:underline"
                    >
                      <span>{item.title}</span>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B6B6B]" />
                    </a>
                  </h3>

                  {/* STRUCTURED ANALYTICAL POINTERS */}
                  <div className="mt-3 space-y-2 rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-3 text-[11px] leading-relaxed">
                    {/* POINTER 1: DIRECTIONAL SIGNAL */}
                    <div className="flex items-start gap-2">
                      <span className="font-mono-num text-[#6B6B6B] shrink-0">•</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono-num text-[#A3A3A3] uppercase">AI Signal:</span>
                        {item.goldImpact && (
                          <span
                            className={cn(
                              "rounded border px-1.5 py-0.5 font-mono-num text-[10px] font-bold",
                              item.goldImpact === "BULLISH"
                                ? "border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]"
                                : item.goldImpact === "BEARISH"
                                ? "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]"
                                : "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3]"
                            )}
                          >
                            XAUUSD: {item.goldImpact}
                          </span>
                        )}
                        {item.us30Impact && (
                          <span
                            className={cn(
                              "rounded border px-1.5 py-0.5 font-mono-num text-[10px] font-bold",
                              item.us30Impact === "BULLISH"
                                ? "border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]"
                                : item.us30Impact === "BEARISH"
                                ? "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]"
                                : "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3]"
                            )}
                          >
                            US30: {item.us30Impact}
                          </span>
                        )}
                        <span className="font-mono-num text-[10px] text-[#6B6B6B]">
                          (Sentiment: {item.sentimentScore > 0 ? `+${item.sentimentScore.toFixed(2)}` : item.sentimentScore.toFixed(2)})
                        </span>
                      </div>
                    </div>

                    {/* POINTER 2: CORE CATALYST SUMMARY */}
                    <div className="flex items-start gap-2">
                      <span className="font-mono-num text-[#6B6B6B] shrink-0">•</span>
                      <div>
                        <span className="font-mono-num text-[#A3A3A3] uppercase">Catalyst: </span>
                        <span className="text-[#FFFFFF]">{item.summary}</span>
                      </div>
                    </div>

                    {/* POINTER 3: AI MACRO TRANSMISSION MECHANISM */}
                    <div className="flex items-start gap-2">
                      <span className="font-mono-num text-[#6B6B6B] shrink-0">•</span>
                      <div>
                        <span className="font-mono-num text-[#A3A3A3] uppercase">Transmission: </span>
                        <span className="text-[#A3A3A3]">{item.aiRationale}</span>
                      </div>
                    </div>

                    {/* POINTER 4: KEY MARKET DRIVERS */}
                    {item.keyDrivers && item.keyDrivers.length > 0 && (
                      <div className="flex items-start gap-2 pt-0.5">
                        <span className="font-mono-num text-[#6B6B6B] shrink-0">•</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-mono-num text-[#A3A3A3] uppercase mr-1">Drivers:</span>
                          {item.keyDrivers.map((driver) => (
                            <button
                              key={driver}
                              onClick={() => setSearchQuery(driver)}
                              className="rounded border border-[#1C1C1C] bg-[#141414] px-1.5 py-0.5 font-mono-num text-[9.5px] text-[#A3A3A3] hover:border-[#2E2E2E] hover:text-[#FFFFFF]"
                              title={`Filter news by ${driver}`}
                            >
                              {driver}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* POINTER 5: CONSTITUENT ENTITIES */}
                    {item.entities && item.entities.length > 0 && (
                      <div className="flex items-start gap-2 pt-0.5">
                        <span className="font-mono-num text-[#6B6B6B] shrink-0">•</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-mono-num text-[#A3A3A3] uppercase mr-1">Tickers:</span>
                          {item.entities.map((ticker) => (
                            <button
                              key={ticker}
                              onClick={() => setSelectedEntity(ticker === selectedEntity ? null : ticker)}
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono-num text-[9.5px] font-bold border transition",
                                selectedEntity === ticker
                                  ? "border-[#FFFFFF] bg-[#FFFFFF] text-[#000000]"
                                  : "border-[#1C1C1C] bg-[#141414] text-[#A3A3A3] hover:border-[#2E2E2E] hover:text-[#FFFFFF]"
                              )}
                              title={`Filter news by ${ticker}`}
                            >
                              {ticker}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* EXPANDABLE TECHNICAL DETAILS ACCORDION */}
                  {isExpanded && (
                    <div className="mt-2.5 rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-3 font-mono-num text-[10.5px] space-y-1.5 text-[#A3A3A3]">
                      <div className="flex justify-between border-b border-[#1C1C1C] pb-1">
                        <span className="text-[#6B6B6B]">Canonical UUID:</span>
                        <span className="text-[#FFFFFF] select-all">{item.uuid}</span>
                      </div>
                      <div className="flex justify-between border-b border-[#1C1C1C] pb-1">
                        <span className="text-[#6B6B6B]">Ingestion Timestamp:</span>
                        <span className="text-[#FFFFFF]">{item.publishedAt}</span>
                      </div>
                      <div className="flex justify-between border-b border-[#1C1C1C] pb-1">
                        <span className="text-[#6B6B6B]">Verified Source:</span>
                        <span className="text-[#FFFFFF]">{item.source}</span>
                      </div>
                      <div className="flex justify-between border-b border-[#1C1C1C] pb-1">
                        <span className="text-[#6B6B6B]">AI Relevance Score:</span>
                        <span className="text-[#FFFFFF]">{item.relevanceScore} / 100</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#6B6B6B]">Raw Sentiment Score:</span>
                        <span className="text-[#FFFFFF]">{item.sentimentScore}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ============================================================== */}
                {/* 4. WORKABLE ACTIONS ROW                                        */}
                {/* ============================================================== */}
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#1C1C1C] pt-2.5 text-[11px]">
                  <div className="flex items-center gap-2 text-[#6B6B6B] font-mono-num text-[10px]">
                    <span className="text-[#A3A3A3] font-medium">{item.source}</span>
                    <span>•</span>
                    <span>
                      {new Date(item.publishedAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* WORKING INTERACTIVE BUTTONS */}
                  <div className="flex items-center gap-1.5">
                    {/* SIMULATE IN AI BIAS ENGINE */}
                    <button
                      onClick={() => handleSimulate(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#141414] px-2 py-1 font-mono-num text-[10px] text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C]"
                      title="Load this news into the AI Bias Engine simulator"
                    >
                      <Play className="h-2.5 w-2.5" />
                      Simulate
                    </button>

                    {/* COPY SUMMARY */}
                    <button
                      onClick={() => handleCopySummary(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#141414] px-2 py-1 font-mono-num text-[10px] text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C]"
                      title="Copy structured intelligence pointers to clipboard"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-2.5 w-2.5 text-[#22C55E]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-2.5 w-2.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    {/* EXPAND DETAILS */}
                    <button
                      onClick={() => toggleExpand(item.uuid)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#141414] px-2 py-1 font-mono-num text-[10px] text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C]"
                      title="View metadata and technical audit breakdown"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-2.5 w-2.5" />
                          <span>Close</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-2.5 w-2.5" />
                          <span>Details</span>
                        </>
                      )}
                    </button>

                    {/* OPEN SOURCE URL */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#141414] px-2 py-1 font-mono-num text-[10px] text-[#FFFFFF] transition-colors hover:border-[#FFFFFF] hover:bg-[#1C1C1C]"
                      title="Open verified publisher article in new tab"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Source
                    </a>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
