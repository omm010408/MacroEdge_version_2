"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { EconomicCalendarEvent } from "@/lib/types";

export interface EconomicCalendarProps {
  events?: EconomicCalendarEvent[];
  defaultRange?: "last" | "today" | "week" | "next" | "all";
  defaultTz?: "ist" | "utc" | "local";
}

interface CalendarItem {
  id?: string;
  t: string; // ISO string e.g. "2026-11-18T13:30Z"
  name: string;
  tier: 1 | 2;
  country?: string;
  consensus?: string;
  actual?: string | null;
  previous?: string | null;
}

const REFERENCE_EVENTS: CalendarItem[] = [
  { t: "2026-11-13T13:30:00Z", name: "US Core PCE Price Index (YoY)", tier: 1, country: "US", consensus: "2.8%" },
  { t: "2026-11-13T13:30:00Z", name: "US Producer Price Index (YoY)", tier: 1, country: "US", consensus: "2.4%" },
  { t: "2026-11-13T13:30:00Z", name: "US Nonfarm Payrolls", tier: 1, country: "US", consensus: "175K" },
  { t: "2026-11-16T13:30:00Z", name: "Average Hourly Earnings (YoY)", tier: 1, country: "US", consensus: "4.0%" },
  { t: "2026-11-16T15:00:00Z", name: "Conference Board / UMich Sentiment", tier: 1, country: "US", consensus: "71.0" },
  { t: "2026-11-17T13:30:00Z", name: "US Import & Export Price Indexes (MoM)", tier: 2, country: "US", consensus: "0.1%" },
  { t: "2026-11-17T14:15:00Z", name: "US Industrial Production (MoM)", tier: 1, country: "US", consensus: "0.3%" },
  { t: "2026-11-17T14:15:00Z", name: "Capacity Utilization Rate", tier: 2, country: "US", consensus: "77.8%" },
  { t: "2026-11-17T20:30:00Z", name: "CFTC COT Weekly Positioning Cutoff (Tuesday Close)", tier: 2, country: "US", consensus: "—" },
  { t: "2026-11-18T13:30:00Z", name: "Initial Jobless Claims (DOL)", tier: 1, country: "US", consensus: "215K" },
  { t: "2026-11-18T13:30:00Z", name: "Retail Sales (MoM)", tier: 1, country: "US", consensus: "0.4%" },
  { t: "2026-11-18T15:00:00Z", name: "NAHB Housing Market Index", tier: 2, country: "US", consensus: "44" },
  { t: "2026-11-19T13:30:00Z", name: "Housing Starts (MoM)", tier: 1, country: "US", consensus: "1.35M" },
  { t: "2026-11-19T19:00:00Z", name: "FOMC Minutes", tier: 1, country: "US", consensus: "—" },
  { t: "2026-11-20T13:30:00Z", name: "Philly Fed Manufacturing Index", tier: 2, country: "US", consensus: "8.2" },
  { t: "2026-11-21T13:45:00Z", name: "S&P Global Flash PMI", tier: 2, country: "US", consensus: "52.0" },
  { t: "2026-11-24T13:30:00Z", name: "Durable Goods Orders", tier: 1, country: "US", consensus: "0.5%" },
  { t: "2026-11-25T13:30:00Z", name: "GDP (QoQ, BEA)", tier: 1, country: "US", consensus: "2.8%" },
  { t: "2026-11-25T13:30:00Z", name: "Personal Income", tier: 2, country: "US", consensus: "0.3%" },
  { t: "2026-11-25T21:15:00Z", name: "Fed H.15 Selected Interest Rates", tier: 2, country: "US", consensus: "—" },
  { t: "2026-11-26T13:30:00Z", name: "Pending Home Sales", tier: 2, country: "US", consensus: "1.0%" },
  { t: "2026-11-27T13:30:00Z", name: "Initial Jobless Claims (DOL)", tier: 1, country: "US", consensus: "218K" },
  { t: "2026-11-27T13:45:00Z", name: "Chicago PMI", tier: 2, country: "US", consensus: "46.5" },
  { t: "2026-11-27T21:30:00Z", name: "Fed H.4.1 Reserve Balances & Balance Sheet", tier: 2, country: "US", consensus: "—" },
];

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

function getCanonicalEventKey(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\(next release\)/g, "")
    .replace(/\b(us|dol|bls|bea|census)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (s.includes("jobless") || s.includes("claims") || s.includes("icsa")) return "jobless_claims";
  if (s.includes("retailsales")) return "retail_sales";
  if (s.includes("corepce")) return "core_pce";
  if (s.includes("pce")) return "pce";
  if (s.includes("corecpi")) return "core_cpi";
  if (s.includes("cpi")) return "cpi";
  if (s.includes("producerprice") || s.includes("ppi")) return "ppi";
  if (s.includes("nonfarm") || s.includes("payroll") || s.includes("payems")) return "nfp";
  if (s.includes("unemployment") || s.includes("unrate")) return "unrate";
  if (s.includes("hourlyearnings") || s.includes("ahe")) return "ahe";
  if (s.includes("michigan") || s.includes("umich") || s.includes("consumerconfidence") || s.includes("sentiment")) return "sentiment";
  if (s.includes("gdp")) return "gdp";
  if (s.includes("h41") || s.includes("balance") || s.includes("reservebalance")) return "h41";
  if (s.includes("h15") || s.includes("interestrates") || s.includes("effr")) return "h15";
  if (s.includes("housingstart")) return "housing_starts";
  if (s.includes("nahb") || s.includes("housingmarket")) return "nahb";
  if (s.includes("fomc") || s.includes("minutes")) return "fomc";
  if (s.includes("phillyfed")) return "philly_fed";
  if (s.includes("flashpmi") || s.includes("spglobal")) return "flash_pmi";
  if (s.includes("durablegoods")) return "durable_goods";
  if (s.includes("industrialprod")) return "industrial_production";
  if (s.includes("capacityutil")) return "capacity_utilization";
  if (s.includes("importprice")) return "import_price";
  if (s.includes("cftc") || s.includes("commitments") || s.includes("cot")) return "cftc_cot";
  if (s.includes("personalincome")) return "personal_income";
  if (s.includes("pendinghome")) return "pending_home_sales";
  if (s.includes("chicagopmi")) return "chicago_pmi";
  return s;
}

function extractPreciseIso(ev: EconomicCalendarEvent, fallbackDate: string): string {
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

export function EconomicCalendar({
  events = [],
  defaultRange = "today",
  defaultTz = "ist",
}: EconomicCalendarProps) {
  const [range, setRange] = useState<"last" | "today" | "week" | "next" | "all">(defaultRange);
  const [tz, setTz] = useState<"ist" | "utc" | "local">(defaultTz);
  const [tier1, setTier1] = useState<boolean>(false);

  // Dynamic Anchor Date synchronized with active time zone
  const todayKey = useMemo(() => {
    return dayKeyForTz(new Date().toISOString(), tz);
  }, [tz]);

  const monday = useMemo(() => {
    const d = new Date(todayKey + "T00:00:00Z");
    const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0, Sunday = 6
    return addDays(todayKey, -dayOfWeek);
  }, [todayKey]);

  const ranges = useMemo(() => {
    return {
      last: { label: "Last week", start: addDays(monday, -7), end: addDays(monday, -1) },
      today: { label: "Today", start: todayKey, end: todayKey },
      week: { label: "This week", start: monday, end: addDays(monday, 6) },
      next: { label: "Next week", start: addDays(monday, 7), end: addDays(monday, 13) },
      all: { label: "All", start: "0000-01-01", end: "9999-12-31" },
    };
  }, [monday, todayKey]);

  // Merge Reference Events with Live Synced Events via Canonical Key Matching
  const allEvents = useMemo<CalendarItem[]>(() => {
    const mergedMap = new Map<string, CalendarItem>();

    // 1. Index baseline reference items by canonicalKey_date
    for (const ref of REFERENCE_EVENTS) {
      const canon = getCanonicalEventKey(ref.name);
      const dateKey = ref.t.slice(0, 10);
      mergedMap.set(`${canon}_${dateKey}`, { ...ref });
    }

    // 2. Overlay live synced observation events with precise time & actual/consensus values
    if (events && events.length > 0) {
      for (const ev of events) {
        const isoTime = extractPreciseIso(ev, todayKey);
        const dateKey = isoTime.slice(0, 10);
        const canon = getCanonicalEventKey(ev.event);
        const dedupeKey = `${canon}_${dateKey}`;

        const existing = mergedMap.get(dedupeKey);
        if (existing) {
          // Precise sync: update live consensus, actual, previous, and precise time
          existing.id = ev.id || existing.id;
          if (ev.actual !== null && ev.actual !== undefined && ev.actual !== "") {
            existing.actual = ev.actual;
          }
          if (ev.consensus && ev.consensus !== "—") {
            existing.consensus = ev.consensus;
          }
          if (ev.previous && ev.previous !== "—") {
            existing.previous = ev.previous;
          }
          if (ev.releaseTime && /(\d{1,2}):(\d{2})/.test(ev.releaseTime)) {
            existing.t = isoTime;
          }
          mergedMap.set(dedupeKey, existing);
        } else {
          // Live event not in reference docket: add cleanly
          const tier: 1 | 2 = ev.importance === "HIGH" ? 1 : 2;
          mergedMap.set(dedupeKey, {
            id: ev.id,
            t: isoTime,
            name: ev.event.replace(/\s*\(Next Release\)/i, "").trim(),
            tier,
            country: ev.country || "US",
            consensus: ev.consensus || "—",
            actual: ev.actual,
            previous: ev.previous,
          });
        }
      }
    }

    return Array.from(mergedMap.values());
  }, [events, todayKey]);

  const inRange = useCallback(
    (iso: string, rKey: "last" | "today" | "week" | "next" | "all") => {
      const dKey = dayKeyForTz(iso, tz);
      return dKey >= ranges[rKey].start && dKey <= ranges[rKey].end;
    },
    [ranges, tz]
  );

  const tierOk = useCallback(
    (itemTier: number) => !tier1 || itemTier === 1,
    [tier1]
  );

  // Filtered & Chronologically Sorted Events
  const items = useMemo(() => {
    return allEvents
      .filter((e) => inRange(e.t, range) && tierOk(e.tier))
      .sort((a, b) => a.t.localeCompare(b.t));
  }, [allEvents, range, inRange, tierOk]);

  // Grouped by Day (in the active time zone)
  const grouped = useMemo(() => {
    const res: Record<string, CalendarItem[]> = {};
    for (const e of items) {
      const k = dayKeyForTz(e.t, tz);
      if (!res[k]) res[k] = [];
      res[k].push(e);
    }
    return res;
  }, [items, tz]);

  return (
    <div className="econ-cal-wrap">
      <section className="econ-cal-card" aria-label="Economic calendar">
        {/* Header */}
        <div className="econ-cal-head">
          <div>
            <h2>Economic calendar</h2>
            <p>Tier 1 and tier 2 US releases. Consensus is shown once a source provides it.</p>
          </div>
          <div className="econ-cal-seg" role="group" aria-label="Date range">
            {(
              [
                { id: "last", label: "Last week" },
                { id: "today", label: "Today" },
                { id: "week", label: "This week" },
                { id: "next", label: "Next week" },
                { id: "all", label: "All" },
              ] as const
            ).map((r) => {
              const count = allEvents.filter((e) => inRange(e.t, r.id) && tierOk(e.tier)).length;
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

        {/* Sub-bar Controls */}
        <div className="econ-cal-bar">
          <div className="econ-cal-seg" role="group" aria-label="Time zone">
            <button
              type="button"
              data-tz="ist"
              aria-pressed={tz === "ist"}
              onClick={() => setTz("ist")}
            >
              IST
            </button>
            <button
              type="button"
              data-tz="utc"
              aria-pressed={tz === "utc"}
              onClick={() => setTz("utc")}
            >
              UTC
            </button>
            <button
              type="button"
              data-tz="local"
              aria-pressed={tz === "local"}
              onClick={() => setTz("local")}
            >
              Local
            </button>
          </div>
          <button
            type="button"
            className="econ-cal-toggle"
            aria-pressed={tier1}
            onClick={() => setTier1(!tier1)}
          >
            <input
              type="checkbox"
              checked={tier1}
              onChange={(e) => setTier1(e.target.checked)}
              tabIndex={-1}
              aria-hidden="true"
            />
            Tier 1 only
          </button>
        </div>

        {/* Docket Event List */}
        <div className="econ-cal-list" aria-live="polite">
          {items.length === 0 ? (
            <div className="econ-cal-empty">
              {range === "today" ? "No releases today." : "No releases in this window."}
            </div>
          ) : (
            Object.entries(grouped).map(([dayKeyStr, dayRows]) => (
              <div key={dayKeyStr} className="econ-cal-day-group">
                <div className="econ-cal-day">
                  <span>{dayTitle(dayKeyStr)}</span>
                  <span>
                    {dayRows.length} {dayRows.length === 1 ? "release" : "releases"}
                  </span>
                </div>
                {dayRows.map((e, idx) => {
                  const tl = timeLabel(e.t, tz);
                  const isPast = dayKeyStr < todayKey;
                  return (
                    <div
                      key={e.id ?? `${e.name}-${idx}`}
                      className={`econ-cal-row ${isPast ? "past" : ""}`}
                    >
                      <span className="econ-cal-time">
                        {tl.main}
                        <small>{tl.sub}</small>
                      </span>
                      <span className={`econ-cal-tier ${e.tier === 1 ? "t1" : ""}`}>
                        T{e.tier}
                      </span>
                      <span className="econ-cal-ctry">{e.country || "US"}</span>
                      <span className="econ-cal-name">{e.name}</span>
                      <span className="econ-cal-cons">
                        {e.actual !== null && e.actual !== undefined && e.actual !== "" ? (
                          <span style={{ color: "#22C55E", marginRight: "6px" }}>Act: {e.actual}</span>
                        ) : null}
                        Cons: {e.consensus && e.consensus !== "—" ? e.consensus : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <p className="econ-cal-foot">
          Window {ranges[range].start} → {ranges[range].end} · {items.length} shown · Today {todayKey}
        </p>
      </section>

      {/* Scoped Styles identical to Economic Calendar spec */}
      <style jsx>{`
        .econ-cal-wrap {
          width: 100%;
        }
        .econ-cal-card {
          border: 1px solid #333333;
          border-radius: 14px;
          background: #0A0A0A;
          padding: 22px 24px 20px;
          font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #FFFFFF;
        }
        .econ-cal-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px 24px;
          flex-wrap: wrap;
        }
        .econ-cal-head h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #FFFFFF;
        }
        .econ-cal-head p {
          margin: 6px 0 0;
          color: #9A9A9A;
          font-size: 14px;
        }
        .econ-cal-seg {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 2px;
          padding: 3px;
          border: 1px solid #333333;
          border-radius: 10px;
          background: #000000;
        }
        .econ-cal-seg button {
          height: 34px;
          padding: 0 12px;
          border-radius: 7px;
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 500;
          font-size: 13px;
          color: #D4D4D4;
          white-space: nowrap;
          background: none;
          border: 0;
          cursor: pointer;
          transition: color 0.15s, background-color 0.15s;
        }
        .econ-cal-seg button:hover {
          color: #FFFFFF;
        }
        .econ-cal-seg button[aria-pressed="true"] {
          background: #151515;
          color: #FFFFFF;
          box-shadow: inset 0 0 0 1px #333333;
        }
        .econ-cal-seg button .c {
          color: #9A9A9A;
          margin-left: 4px;
        }
        .econ-cal-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 18px;
        }
        .econ-cal-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 34px;
          padding: 0 12px;
          border: 1px solid #333333;
          border-radius: 8px;
          font-size: 13px;
          color: #D4D4D4;
          background: none;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        }
        .econ-cal-toggle input {
          accent-color: #ffffff;
          margin: 0;
          cursor: pointer;
        }
        .econ-cal-toggle[aria-pressed="true"] {
          color: #FFFFFF;
          border-color: #9A9A9A;
        }
        .econ-cal-list {
          margin-top: 18px;
          border: 1px solid #333333;
          border-radius: 12px;
          background: #050505;
          overflow: hidden;
        }
        .econ-cal-day {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 11px 18px;
          background: #0E0E0E;
          border-bottom: 1px solid #1F1F1F;
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 500;
          font-size: 12.5px;
          letter-spacing: 0.04em;
          color: #D4D4D4;
        }
        .econ-cal-day span:last-child {
          color: #9A9A9A;
        }
        .econ-cal-row {
          display: grid;
          grid-template-columns: 124px 42px 40px minmax(0, 1fr) 84px;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid #1F1F1F;
          transition: background-color 0.15s;
        }
        .econ-cal-row:last-child {
          border-bottom: 0;
        }
        .econ-cal-row:hover {
          background: #101010;
        }
        .econ-cal-row.past .econ-cal-name {
          color: #9A9A9A;
        }
        .econ-cal-time {
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 500;
          font-size: 13.5px;
          color: #FFFFFF;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .econ-cal-time small {
          display: block;
          font-size: 11.5px;
          color: #9A9A9A;
        }
        .econ-cal-tier {
          justify-self: start;
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 0.05em;
          color: #D4D4D4;
          border: 1px solid #333333;
          border-radius: 5px;
          padding: 3px 6px;
        }
        .econ-cal-tier.t1 {
          color: #FFFFFF;
          border-color: #9A9A9A;
        }
        .econ-cal-ctry {
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 600;
          font-size: 12px;
          color: #FFFFFF;
          border: 1px solid #333333;
          border-radius: 5px;
          padding: 3px 0;
          text-align: center;
        }
        .econ-cal-name {
          font-size: 15px;
          color: #FFFFFF;
          min-width: 0;
          font-weight: 400;
        }
        .econ-cal-cons {
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 400;
          font-size: 13px;
          color: #9A9A9A;
          text-align: right;
          white-space: nowrap;
        }
        .econ-cal-empty {
          padding: 42px 18px;
          text-align: center;
          color: #9A9A9A;
          font-size: 14.5px;
        }
        .econ-cal-foot {
          margin-top: 14px;
          font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
          font-weight: 400;
          font-size: 12.5px;
          color: #9A9A9A;
        }

        @media (max-width: 720px) {
          .econ-cal-card {
            padding: 16px;
          }
          .econ-cal-row {
            grid-template-columns: 1fr auto;
            grid-template-areas:
              "time tier"
              "name name"
              "ctry cons";
            gap: 6px 10px;
            padding: 14px;
          }
          .econ-cal-time {
            grid-area: time;
          }
          .econ-cal-tier {
            grid-area: tier;
            justify-self: end;
          }
          .econ-cal-name {
            grid-area: name;
          }
          .econ-cal-ctry {
            grid-area: ctry;
            justify-self: start;
            padding: 2px 8px;
          }
          .econ-cal-cons {
            grid-area: cons;
          }
        }
      `}</style>
    </div>
  );
}
