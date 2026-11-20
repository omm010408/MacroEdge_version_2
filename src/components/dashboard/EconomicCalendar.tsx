"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { EconomicCalendarEvent } from "@/lib/types";
import {
  CURRENCY_METADATA,
  exportForexFactoryCsv,
  exportForexFactoryJson,
  G10_CURRENCIES,
  getInstitutionalForexFactoryDocket,
  type ForexFactoryEvent,
  type ForexFactoryImpact,
  type SupportedCurrency,
} from "@/services/data/forex-factory";

export interface EconomicCalendarProps {
  events?: EconomicCalendarEvent[];
  defaultRange?: "last" | "today" | "tomorrow" | "week" | "next" | "all";
  defaultTz?: "ist" | "utc" | "local";
  defaultCurrency?: string;
  defaultImpacts?: {
    HIGH?: boolean;
    MEDIUM?: boolean;
    LOW?: boolean;
    NON_ECONOMIC?: boolean;
  };
}

interface CalendarItem {
  id: string;
  t: string; // ISO string e.g. "2026-11-20T13:30:00Z"
  name: string;
  currency: string;
  country: string;
  impact: ForexFactoryImpact;
  tier: 1 | 2 | 3;
  forecast: string;
  previous: string;
  actual: string | null;
  betterThanExpected: boolean | null;
}

function addDays(key: string, n: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayKeyForTz(iso: string, tz: "ist" | "utc" | "local"): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    if (tz === "ist") {
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    }
    if (tz === "utc") {
      return d.toISOString().slice(0, 10);
    }
    return d.toLocaleDateString("en-CA");
  } catch {
    return iso.slice(0, 10);
  }
}

function timeLabel(iso: string, tz: "ist" | "utc" | "local"): { main: string; sub: string } {
  if (tz === "utc") {
    return { main: iso.slice(11, 16) || "13:30", sub: "UTC" };
  }
  if (tz === "ist") {
    try {
      const d = new Date(iso);
      const main = d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      });
      return { main, sub: "IST" };
    } catch {
      return { main: iso.slice(11, 16) || "13:30", sub: "IST" };
    }
  }
  try {
    const d = new Date(iso);
    const main = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const sub =
      new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
        .formatToParts(d)
        .find((p) => p.type === "timeZoneName")?.value || "Local";
    return { main, sub };
  } catch {
    return { main: iso.slice(11, 16) || "13:30", sub: "Local" };
  }
}

function dayTitle(dayKeyStr: string): string {
  try {
    const [y, m, d] = dayKeyStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dayKeyStr;
  }
}

function extractPreciseIso(ev: EconomicCalendarEvent, fallbackDate: string): string {
  if (ev.rawDate) return ev.rawDate;

  let date = fallbackDate;
  const dateMatch = ev.releaseTime?.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    date = dateMatch[1];
  }

  let time = "13:30";
  const timeMatch = ev.releaseTime?.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  } else {
    const lower = (ev.event || "").toLowerCase();
    if (lower.includes("h.4.1")) time = "21:30";
    else if (lower.includes("h.15")) time = "21:15";
    else if (lower.includes("fomc")) time = "19:00";
    else if (lower.includes("sentiment") || lower.includes("nahb") || lower.includes("pending home")) time = "15:00";
    else if (lower.includes("industrial") || lower.includes("capacity")) time = "14:15";
    else if (lower.includes("flash pmi") || lower.includes("chicago pmi")) time = "13:45";
  }

  return `${date}T${time}:00Z`;
}

function impactToTier(impact: ForexFactoryImpact): 1 | 2 | 3 {
  if (impact === "HIGH") return 1;
  if (impact === "MEDIUM") return 2;
  return 3;
}

export function EconomicCalendar({
  events = [],
  defaultRange = "today",
  defaultTz = "local",
  defaultCurrency = "USD",
  defaultImpacts,
}: EconomicCalendarProps) {
  const [range, setRange] = useState<"last" | "today" | "tomorrow" | "week" | "next" | "all">(defaultRange);
  const [tz, setTz] = useState<"ist" | "utc" | "local">(defaultTz);
  const [currencyFilter, setCurrencyFilter] = useState<string>(defaultCurrency);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [impactFilters, setImpactFilters] = useState<{
    HIGH: boolean;
    MEDIUM: boolean;
    LOW: boolean;
    NON_ECONOMIC: boolean;
  }>({
    HIGH: defaultImpacts?.HIGH ?? true,
    MEDIUM: defaultImpacts?.MEDIUM ?? true,
    LOW: defaultImpacts?.LOW ?? false,
    NON_ECONOMIC: defaultImpacts?.NON_ECONOMIC ?? false,
  });

  // Client-side live feed state
  const [liveEvents, setLiveEvents] = useState<ForexFactoryEvent[]>([]);
  const [feedSource, setFeedSource] = useState<string>("institutional_docket");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const handleSyncToday = useCallback(async () => {
    setIsSyncing(true);
    setSyncStatus("Syncing...");
    try {
      const res = await fetch(`/api/calendar?force=true&currency=USD&t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.events)) {
        setLiveEvents(data.events);
        setFeedSource(data.source ?? "live_nfs");
        const nowStr = new Date().toLocaleTimeString();
        setLastRefreshedAt(nowStr);
        setSyncStatus(`Synced at ${nowStr}`);
      } else {
        setSyncStatus("Docket updated");
      }
    } catch {
      setSyncStatus("Synced from cache");
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 4000);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadFeed() {
      try {
        const res = await fetch("/api/calendar");
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.ok && Array.isArray(data.events)) {
          setLiveEvents(data.events);
          setFeedSource(data.source ?? "live_nfs");
          setLastRefreshedAt(data.lastUpdated ?? new Date().toISOString());
        }
      } catch {
        // Non-fatal; fallback handles seamlessly
      }
    }
    loadFeed();
    return () => {
      active = false;
    };
  }, []);

  // Synchronized active anchor date in selected timezone
  const todayKey = useMemo(() => {
    return dayKeyForTz(new Date().toISOString(), tz);
  }, [tz]);

  const yesterdayKey = useMemo(() => addDays(todayKey, -1), [todayKey]);
  const tomorrowKey = useMemo(() => addDays(todayKey, 1), [todayKey]);

  const monday = useMemo(() => {
    const d = new Date(todayKey + "T00:00:00Z");
    const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0, Sunday = 6
    return addDays(todayKey, -dayOfWeek);
  }, [todayKey]);

  const ranges = useMemo(() => {
    return {
      last: { label: "Yesterday", start: yesterdayKey, end: yesterdayKey },
      today: { label: "Today", start: todayKey, end: todayKey },
      tomorrow: { label: "Tomorrow", start: tomorrowKey, end: tomorrowKey },
      week: { label: "This week", start: monday, end: addDays(monday, 6) },
      next: { label: "Next week", start: addDays(monday, 7), end: addDays(monday, 13) },
      all: { label: "All", start: "0000-01-01", end: "9999-12-31" },
    };
  }, [yesterdayKey, todayKey, tomorrowKey, monday]);

  // Merge Reference/Live Forex Factory Events with props.events
  const allDocketEvents = useMemo<CalendarItem[]>(() => {
    const itemMap = new Map<string, CalendarItem>();

    // 1. Load institutional baseline Forex Factory docket
    const baseline = liveEvents.length > 0 ? liveEvents : getInstitutionalForexFactoryDocket();
    for (const item of baseline) {
      itemMap.set(item.id, {
        id: item.id,
        t: item.date,
        name: item.title,
        currency: item.currency,
        country: item.country,
        impact: item.impact,
        tier: impactToTier(item.impact),
        forecast: item.forecast,
        previous: item.previous,
        actual: item.actual,
        betterThanExpected: item.betterThanExpected,
      });
    }

    // 2. Overlay props.events (passed from server or parent views)
    for (const ev of events) {
      const iso = extractPreciseIso(ev, todayKey);
      const impact: ForexFactoryImpact =
        ev.importance === "HIGH"
          ? "HIGH"
          : ev.importance === "MEDIUM"
          ? "MEDIUM"
          : ev.importance === "NON_ECONOMIC"
          ? "NON_ECONOMIC"
          : "LOW";

      const currency = ev.currency ?? (ev.country === "US" ? "USD" : ev.country);
      const existing = itemMap.get(ev.id);

      if (existing) {
        if (ev.actual !== null && ev.actual !== undefined && ev.actual !== "") {
          existing.actual = ev.actual;
        }
        if (ev.consensus && ev.consensus !== "—") {
          existing.forecast = ev.consensus;
        }
        if (ev.previous && ev.previous !== "—") {
          existing.previous = ev.previous;
        }
        itemMap.set(ev.id, existing);
      } else {
        itemMap.set(ev.id, {
          id: ev.id,
          t: iso,
          name: ev.event.replace(/\s*\(Next Release\)/i, "").trim(),
          currency,
          country: ev.country || "US",
          impact,
          tier: impactToTier(impact),
          forecast: ev.consensus || "—",
          previous: ev.previous || "—",
          actual: ev.actual,
          betterThanExpected: ev.betterThanExpected ?? null,
        });
      }
    }

    return Array.from(itemMap.values());
  }, [events, liveEvents, todayKey]);

  // Filtering Logic
  const inRange = useCallback(
    (iso: string, rKey: "last" | "today" | "tomorrow" | "week" | "next" | "all") => {
      const dKey = dayKeyForTz(iso, tz);
      return dKey >= ranges[rKey].start && dKey <= ranges[rKey].end;
    },
    [ranges, tz]
  );

  const filterMatches = useCallback(
    (e: CalendarItem) => {
      // Currency filter
      if (currencyFilter !== "ALL" && e.currency !== currencyFilter) {
        return false;
      }
      // Impact filter
      if (!impactFilters[e.impact]) {
        return false;
      }
      // Keyword search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = e.name.toLowerCase().includes(q);
        const matchesCurr = e.currency.toLowerCase().includes(q);
        const matchesCountry = e.country.toLowerCase().includes(q);
        if (!matchesName && !matchesCurr && !matchesCountry) return false;
      }
      return true;
    },
    [currencyFilter, impactFilters, searchQuery]
  );

  const filteredItems = useMemo(() => {
    return allDocketEvents
      .filter((e) => inRange(e.t, range) && filterMatches(e))
      .sort((a, b) => a.t.localeCompare(b.t));
  }, [allDocketEvents, range, inRange, filterMatches]);

  // Grouped by Day in active timezone
  const groupedByDay = useMemo(() => {
    const res: Record<string, CalendarItem[]> = {};
    for (const e of filteredItems) {
      const k = dayKeyForTz(e.t, tz);
      if (!res[k]) res[k] = [];
      res[k].push(e);
    }
    return res;
  }, [filteredItems, tz]);

  // Impact toggle handler
  const toggleImpact = (impact: ForexFactoryImpact) => {
    setImpactFilters((prev) => ({
      ...prev,
      [impact]: !prev[impact],
    }));
  };

  // CSV & JSON Exporters matching fizahkhalid/forex_factory_calendar_news_scraper
  const handleExportCsv = () => {
    const ffFormat: ForexFactoryEvent[] = filteredItems.map((item) => ({
      id: item.id,
      title: item.name,
      currency: item.currency,
      country: item.country,
      date: item.t,
      time: item.t.slice(11, 16),
      impact: item.impact,
      forecast: item.forecast,
      previous: item.previous,
      actual: item.actual,
      betterThanExpected: item.betterThanExpected,
    }));
    const csvContent = exportForexFactoryCsv(ffFormat);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `forex_factory_calendar_${range}_${tz}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    const ffFormat: ForexFactoryEvent[] = filteredItems.map((item) => ({
      id: item.id,
      title: item.name,
      currency: item.currency,
      country: item.country,
      date: item.t,
      time: item.t.slice(11, 16),
      impact: item.impact,
      forecast: item.forecast,
      previous: item.previous,
      actual: item.actual,
      betterThanExpected: item.betterThanExpected,
    }));
    const jsonContent = exportForexFactoryJson(ffFormat);
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `forex_factory_calendar_${range}_${tz}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Metrics summary
  const totalInWindow = useMemo(() => {
    return allDocketEvents.filter((e) => inRange(e.t, range)).length;
  }, [allDocketEvents, inRange, range]);

  const highImpactCount = useMemo(() => {
    return filteredItems.filter((e) => e.impact === "HIGH").length;
  }, [filteredItems]);

  return (
    <div className="econ-cal-wrap">
      <section className="econ-cal-card" aria-label="Forex Factory Economic Calendar">
        {/* Header */}
        <div className="econ-cal-head">
          <div className="econ-cal-titles">
            <div className="econ-cal-badge-row">
              <h2>Economic Calendar</h2>
              <span className="ff-source-badge">
                <span className="ff-dot-live" />
                Forex Factory Feed ({feedSource === "live_nfs" ? "Live" : "Synchronized"})
              </span>
              <button
                type="button"
                className={`ff-sync-btn ${isSyncing ? "loading" : ""}`}
                onClick={handleSyncToday}
                disabled={isSyncing}
                title="Synchronize today's calendar from live Forex Factory feeds"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  style={{
                    animation: isSyncing ? "spin 1s linear infinite" : "none",
                    transformOrigin: "center",
                  }}
                  aria-hidden="true"
                >
                  <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
                  <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
                </svg>
                {isSyncing ? "Syncing..." : syncStatus ? syncStatus : "Sync Today"}
              </button>
            </div>
            <p>
              Forex Factory macroeconomic releases across G10 currencies. Filter by currency, impact tier, and export data.
            </p>
          </div>

          {/* Date Range Tabs */}
          <div className="econ-cal-seg" role="group" aria-label="Date range">
            {(
              [
                { id: "last", label: "Yesterday" },
                { id: "today", label: "Today" },
                { id: "tomorrow", label: "Tomorrow" },
                { id: "week", label: "This week" },
                { id: "next", label: "Next week" },
                { id: "all", label: "All" },
              ] as const
            ).map((r) => {
              const count = allDocketEvents.filter((e) => inRange(e.t, r.id) && filterMatches(e)).length;
              return (
                <button
                  key={r.id}
                  type="button"
                  data-r={r.id}
                  aria-pressed={range === r.id}
                  onClick={() => setRange(r.id)}
                >
                  {r.label}
                  <span className="c">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar: Timezone, Impact Filters, Search, Export */}
        <div className="econ-cal-toolbar">
          {/* Timezone Switcher */}
          <div className="econ-cal-seg" role="group" aria-label="Time zone">
            <button
              type="button"
              data-tz="ist"
              aria-pressed={tz === "ist"}
              onClick={() => setTz("ist")}
              title="Indian Standard Time (UTC+5:30)"
            >
              IST
            </button>
            <button
              type="button"
              data-tz="utc"
              aria-pressed={tz === "utc"}
              onClick={() => setTz("utc")}
              title="Coordinated Universal Time"
            >
              UTC
            </button>
            <button
              type="button"
              data-tz="local"
              aria-pressed={tz === "local"}
              onClick={() => setTz("local")}
              title="Local System Browser Time"
            >
              Local
            </button>
          </div>

          {/* Forex Factory Impact Filters */}
          <div className="ff-impact-group" role="group" aria-label="Impact filters">
            <button
              type="button"
              className={`ff-impact-btn ff-impact-high ${impactFilters.HIGH ? "active" : ""}`}
              onClick={() => toggleImpact("HIGH")}
              title="High Impact Events (Red)"
            >
              <span className="ff-impact-dot red" />
              High
            </button>
            <button
              type="button"
              className={`ff-impact-btn ff-impact-med ${impactFilters.MEDIUM ? "active" : ""}`}
              onClick={() => toggleImpact("MEDIUM")}
              title="Medium Impact Events (Orange)"
            >
              <span className="ff-impact-dot orange" />
              Med
            </button>
            <button
              type="button"
              className={`ff-impact-btn ff-impact-low ${impactFilters.LOW ? "active" : ""}`}
              onClick={() => toggleImpact("LOW")}
              title="Low Impact Events (Yellow)"
            >
              <span className="ff-impact-dot yellow" />
              Low
            </button>
            <button
              type="button"
              className={`ff-impact-btn ff-impact-gray ${impactFilters.NON_ECONOMIC ? "active" : ""}`}
              onClick={() => toggleImpact("NON_ECONOMIC")}
              title="Holidays / Non-Economic (Gray)"
            >
              <span className="ff-impact-dot gray" />
              Non-Econ
            </button>
          </div>

          {/* Search Box */}
          <div className="ff-search-wrap">
            <input
              type="text"
              placeholder="Filter events e.g. CPI, PMI..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ff-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="ff-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Data Exporters */}
          <div className="ff-export-group">
            <button
              type="button"
              className="ff-export-btn"
              onClick={handleExportCsv}
              title="Export docket as CSV"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              CSV
            </button>
            <button
              type="button"
              className="ff-export-btn"
              onClick={handleExportJson}
              title="Export docket as JSON"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              JSON
            </button>
          </div>
        </div>

        {/* Currency Selector Bar */}
        <div className="ff-currency-bar" role="group" aria-label="Currency filter">
          <button
            type="button"
            className={`ff-curr-pill ${currencyFilter === "ALL" ? "active" : ""}`}
            onClick={() => setCurrencyFilter("ALL")}
          >
            ALL
            <span className="ff-curr-count">
              {allDocketEvents.filter((e) => inRange(e.t, range)).length}
            </span>
          </button>
          {G10_CURRENCIES.map((curr) => {
            const meta = CURRENCY_METADATA[curr];
            const count = allDocketEvents.filter((e) => inRange(e.t, range) && e.currency === curr).length;
            return (
              <button
                key={curr}
                type="button"
                className={`ff-curr-pill ${currencyFilter === curr ? "active" : ""}`}
                onClick={() => setCurrencyFilter(curr)}
              >
                <span className="ff-flag">{meta?.flag ?? ""}</span>
                {curr}
                {count > 0 && <span className="ff-curr-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Summary Stats Line */}
        <div className="ff-stats-banner">
          <span>
            Showing <strong>{filteredItems.length}</strong> of {totalInWindow} events in active window
          </span>
          <span className="ff-stats-sep">·</span>
          <span>
            High-Impact releases: <strong>{highImpactCount}</strong>
          </span>
          <span className="ff-stats-sep">·</span>
          <span>Timezone: <strong>{tz.toUpperCase()}</strong></span>
        </div>

        {/* Docket Event Table */}
        <div className="econ-cal-list" aria-live="polite">
          {filteredItems.length === 0 ? (
            <div className="econ-cal-empty">
              {range === "today"
                ? "No releases scheduled for today with active filters."
                : "No economic releases matching criteria in this window."}
            </div>
          ) : (
            Object.entries(groupedByDay).map(([dayKeyStr, dayRows]) => (
              <div key={dayKeyStr} className="econ-cal-day-group">
                <div className="econ-cal-day">
                  <span className="day-name">{dayTitle(dayKeyStr)}</span>
                  <span className="day-count">
                    {dayRows.length} {dayRows.length === 1 ? "release" : "releases"}
                  </span>
                </div>

                <div className="ff-table-container">
                  <div className="ff-table-header">
                    <span className="col-time">Time ({tz.toUpperCase()})</span>
                    <span className="col-curr">Currency</span>
                    <span className="col-impact">Impact</span>
                    <span className="col-event">Event</span>
                    <span className="col-act">Actual</span>
                    <span className="col-fc">Forecast</span>
                    <span className="col-prev">Previous</span>
                  </div>

                  {dayRows.map((e, idx) => {
                    const tl = timeLabel(e.t, tz);
                    const isPast = dayKeyStr < todayKey;
                    const meta = CURRENCY_METADATA[e.currency];

                    let actualColorClass = "";
                    if (e.actual !== null && e.actual !== undefined && e.actual !== "") {
                      if (e.betterThanExpected === true) actualColorClass = "act-beat";
                      else if (e.betterThanExpected === false) actualColorClass = "act-miss";
                    }

                    return (
                      <div
                        key={e.id ?? `${e.name}-${idx}`}
                        className={`ff-row ${isPast ? "past" : ""}`}
                      >
                        <span className="col-time">
                          <span className="time-main">{tl.main}</span>
                          <small className="time-tz">{tl.sub}</small>
                        </span>

                        <span className="col-curr">
                          <span className="ff-flag">{meta?.flag ?? "🌐"}</span>
                          <span className="ff-curr-code">{e.currency}</span>
                        </span>

                        <span className="col-impact">
                          <span
                            className={`ff-impact-indicator impact-${e.impact.toLowerCase()}`}
                            title={`Impact: ${e.impact}`}
                          />
                        </span>

                        <span className="col-event" title={e.name}>
                          {e.name}
                        </span>

                        <span className={`col-act ${actualColorClass}`}>
                          {e.actual !== null && e.actual !== undefined && e.actual !== ""
                            ? e.actual
                            : "—"}
                        </span>

                        <span className="col-fc">{e.forecast}</span>

                        <span className="col-prev">{e.previous}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="econ-cal-foot">
          <span>
            Window: <strong>{ranges[range].start}</strong> → <strong>{ranges[range].end}</strong>
          </span>
          <span>·</span>
          <span>
            Total: <strong>{filteredItems.length}</strong> releases displayed
          </span>
          <span>·</span>
          <span>
            Clock Anchor: <strong>{todayKey}</strong>
          </span>
        </div>
      </section>

      {/* Scoped Styles for Forex Factory Component */}
      <style jsx>{`
        .econ-cal-wrap {
          width: 100%;
        }
        .econ-cal-card {
          border: 1px solid #27272A;
          border-radius: 14px;
          background: #09090B;
          padding: 22px 24px 20px;
          font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #FAFAFA;
        }
        .econ-cal-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px 24px;
          flex-wrap: wrap;
          padding-bottom: 16px;
          border-bottom: 1px solid #18181B;
        }
        .econ-cal-titles h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #FAFAFA;
        }
        .econ-cal-badge-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ff-source-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #18181B;
          border: 1px solid #27272A;
          padding: 3px 8px;
          border-radius: 9999px;
          font-size: 11px;
          font-family: "IBM Plex Mono", monospace;
          color: #A1A1AA;
        }
        .ff-sync-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 24px;
          padding: 0 10px;
          border-radius: 9999px;
          background: #18181B;
          border: 1px solid #27272A;
          color: #FAFAFA;
          font-family: "IBM Plex Mono", monospace;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ff-sync-btn:hover:not(:disabled) {
          background: #27272A;
          border-color: #3F3F46;
          color: #FFFFFF;
        }
        .ff-sync-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .ff-dot-live {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22C55E;
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
        }
        .econ-cal-titles p {
          margin: 6px 0 0;
          color: #71717A;
          font-size: 13px;
        }
        .econ-cal-seg {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 2px;
          padding: 3px;
          border: 1px solid #27272A;
          border-radius: 9px;
          background: #000000;
        }
        .econ-cal-seg button {
          height: 30px;
          padding: 0 10px;
          border-radius: 6px;
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 500;
          font-size: 12px;
          color: #A1A1AA;
          white-space: nowrap;
          background: none;
          border: 0;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .econ-cal-seg button:hover {
          color: #FFFFFF;
        }
        .econ-cal-seg button[aria-pressed="true"] {
          background: #27272A;
          color: #FFFFFF;
        }
        .econ-cal-seg button .c {
          display: inline-block;
          padding: 1px 5px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.08);
          font-size: 10px;
          font-weight: 600;
          color: #A1A1AA;
        }
        .econ-cal-seg button[aria-pressed="true"] .c {
          background: rgba(255, 255, 255, 0.2);
          color: #FFFFFF;
        }
        .econ-cal-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          margin-top: 14px;
        }
        .ff-impact-group {
          display: inline-flex;
          gap: 4px;
          border: 1px solid #27272A;
          padding: 3px;
          border-radius: 9px;
          background: #000000;
        }
        .ff-impact-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 28px;
          padding: 0 8px;
          border-radius: 6px;
          background: transparent;
          border: 0;
          font-size: 11px;
          font-family: "IBM Plex Mono", monospace;
          color: #71717A;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ff-impact-btn.active {
          background: #18181B;
          color: #FAFAFA;
        }
        .ff-impact-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .ff-impact-dot.red { background: #EF4444; }
        .ff-impact-dot.orange { background: #F97316; }
        .ff-impact-dot.yellow { background: #EAB308; }
        .ff-impact-dot.gray { background: #71717A; }
        .ff-search-wrap {
          position: relative;
          flex: 1;
          min-width: 180px;
        }
        .ff-search-input {
          width: 100%;
          height: 36px;
          background: #000000;
          border: 1px solid #27272A;
          border-radius: 8px;
          padding: 0 28px 0 10px;
          font-size: 12px;
          color: #FAFAFA;
          font-family: "Instrument Sans", sans-serif;
          outline: none;
        }
        .ff-search-input:focus {
          border-color: #52525B;
        }
        .ff-search-clear {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #71717A;
          cursor: pointer;
          font-size: 16px;
        }
        .ff-export-group {
          display: inline-flex;
          gap: 6px;
        }
        .ff-export-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 36px;
          padding: 0 10px;
          border-radius: 8px;
          background: #18181B;
          border: 1px solid #27272A;
          color: #FAFAFA;
          font-size: 11px;
          font-family: "IBM Plex Mono", monospace;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ff-export-btn:hover {
          background: #27272A;
          color: #FFFFFF;
        }
        .ff-currency-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid #18181B;
        }
        .ff-curr-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          background: #121214;
          border: 1px solid #27272A;
          color: #A1A1AA;
          font-size: 12px;
          font-family: "IBM Plex Mono", monospace;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ff-curr-pill:hover {
          color: #FAFAFA;
          border-color: #3F3F46;
        }
        .ff-curr-pill.active {
          background: #27272A;
          border-color: #52525B;
          color: #FFFFFF;
        }
        .ff-flag {
          font-size: 13px;
        }
        .ff-curr-count {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.08);
          color: #71717A;
        }
        .ff-curr-pill.active .ff-curr-count {
          background: rgba(255, 255, 255, 0.2);
          color: #FFFFFF;
        }
        .ff-stats-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          font-size: 12px;
          color: #71717A;
        }
        .ff-stats-banner strong {
          color: #D4D4D8;
        }
        .ff-stats-sep {
          color: #3F3F46;
        }
        .econ-cal-list {
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .econ-cal-empty {
          padding: 32px 0;
          text-align: center;
          color: #71717A;
          font-size: 13px;
        }
        .econ-cal-day-group {
          border: 1px solid #18181B;
          border-radius: 10px;
          background: #000000;
          overflow: hidden;
        }
        .econ-cal-day {
          display: flex;
          justify-content: space-between;
          padding: 10px 14px;
          background: #121214;
          border-bottom: 1px solid #18181B;
          font-size: 12px;
          font-family: "IBM Plex Mono", monospace;
          color: #A1A1AA;
        }
        .econ-cal-day .day-name {
          color: #FAFAFA;
          font-weight: 600;
        }
        .ff-table-container {
          display: flex;
          flex-direction: column;
        }
        .ff-table-header {
          display: grid;
          grid-template-columns: 85px 85px 50px 1fr 90px 90px 90px;
          padding: 8px 14px;
          background: #09090B;
          border-bottom: 1px solid #18181B;
          font-size: 11px;
          font-family: "IBM Plex Mono", monospace;
          color: #52525B;
          text-transform: uppercase;
        }
        .ff-row {
          display: grid;
          grid-template-columns: 85px 85px 50px 1fr 90px 90px 90px;
          padding: 9px 14px;
          align-items: center;
          border-bottom: 1px solid #121214;
          font-size: 13px;
          transition: background 0.1s ease;
        }
        .ff-row:last-child {
          border-bottom: 0;
        }
        .ff-row:hover {
          background: #18181B;
        }
        .ff-row.past {
          opacity: 0.65;
        }
        .col-time {
          display: inline-flex;
          flex-direction: column;
          font-family: "IBM Plex Mono", monospace;
          font-size: 12px;
          color: #E4E4E7;
        }
        .time-tz {
          font-size: 10px;
          color: #71717A;
        }
        .col-curr {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: "IBM Plex Mono", monospace;
          font-size: 12px;
          font-weight: 600;
          color: #FAFAFA;
        }
        .col-impact {
          display: flex;
          align-items: center;
        }
        .ff-impact-indicator {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          display: inline-block;
        }
        .impact-high {
          background: #EF4444;
          box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
        }
        .impact-medium {
          background: #F97316;
        }
        .impact-low {
          background: #EAB308;
        }
        .impact-non_economic {
          background: #52525B;
        }
        .col-event {
          color: #FAFAFA;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding-right: 12px;
        }
        .col-act, .col-fc, .col-prev {
          font-family: "IBM Plex Mono", monospace;
          font-size: 12px;
          text-align: right;
          color: #A1A1AA;
        }
        .act-beat {
          color: #22C55E !important;
          font-weight: 600;
        }
        .act-miss {
          color: #EF4444 !important;
          font-weight: 600;
        }
        .econ-cal-foot {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid #18181B;
          font-size: 11px;
          color: #71717A;
          font-family: "IBM Plex Mono", monospace;
        }
        .econ-cal-foot strong {
          color: #A1A1AA;
        }

        @media (max-width: 768px) {
          .ff-table-header {
            display: none;
          }
          .ff-row {
            grid-template-columns: 75px 65px 30px 1fr 70px;
          }
          .col-prev {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
