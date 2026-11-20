import { NextResponse } from "next/server";
import {
  exportForexFactoryCsv,
  exportForexFactoryJson,
  toEconomicCalendarEvent,
} from "@/services/data/forex-factory";
import { getForexFactoryCalendar } from "@/services/data/forex-factory.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const currency = searchParams.get("currency")?.toUpperCase();
    const impact = searchParams.get("impact")?.toUpperCase();
    const range = searchParams.get("range")?.toLowerCase();
    const format = searchParams.get("format")?.toLowerCase();

    const result = await getForexFactoryCalendar({ forceRefresh: force });
    let events = result.events;

    if (currency && currency !== "ALL") {
      events = events.filter((e) => e.currency === currency);
    }

    if (impact && impact !== "ALL") {
      const impacts = impact.split(",").map((s) => s.trim());
      events = events.filter((e) => impacts.includes(e.impact));
    }

    if (range === "today") {
      const todayIso = new Date().toISOString().slice(0, 10);
      events = events.filter((e) => e.date.startsWith(todayIso));
    }

    // CSV Download
    if (format === "csv") {
      const csv = exportForexFactoryCsv(events);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="forex_factory_calendar.csv"',
        },
      });
    }

    // JSON Download
    if (format === "download_json") {
      const jsonStr = exportForexFactoryJson(events);
      return new NextResponse(jsonStr, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="forex_factory_calendar.json"',
        },
      });
    }

    const legacyEvents = events.map(toEconomicCalendarEvent);

    return NextResponse.json({
      ok: true,
      source: result.source,
      lastUpdated: result.lastUpdated,
      total: events.length,
      events,
      legacyEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load economic calendar";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const currency = searchParams.get("currency")?.toUpperCase() || "USD";
    const impact = searchParams.get("impact")?.toUpperCase() || "HIGH,MEDIUM";
    const range = searchParams.get("range")?.toLowerCase() || "today";

    const result = await getForexFactoryCalendar({ forceRefresh: true });
    let events = result.events;

    if (currency && currency !== "ALL") {
      events = events.filter((e) => e.currency === currency);
    }

    if (impact && impact !== "ALL") {
      const impacts = impact.split(",").map((s) => s.trim());
      events = events.filter((e) => impacts.includes(e.impact));
    }

    if (range === "today") {
      const todayIso = new Date().toISOString().slice(0, 10);
      events = events.filter((e) => e.date.startsWith(todayIso));
    }

    return NextResponse.json({
      ok: true,
      synced: true,
      source: result.source,
      lastUpdated: result.lastUpdated,
      total: events.length,
      events,
      legacyEvents: events.map(toEconomicCalendarEvent),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Economic calendar sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
