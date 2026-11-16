import type { NextRequest } from "next/server";
import {
  macroErrorResponse,
  macroJsonResponse,
  runSafeMacroRoute,
} from "@/services/api-helpers";
import { getMacroOverviewData } from "@/services/macro-data";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = new Set([
  "FX",
  "Rates",
  "Volatility",
  "Commodities",
  "Equities",
  "Crypto",
]);

export async function GET(request: NextRequest) {
  return runSafeMacroRoute(async () => {
    const category = request.nextUrl.searchParams.get("category");
    if (category && !ALLOWED_CATEGORIES.has(category)) {
      return macroErrorResponse(
        "Invalid category parameter. Expected one of: FX, Rates, Volatility, Commodities, Equities, Crypto.",
        400
      );
    }

    const data = await getMacroOverviewData();
    const filteredCards = category
      ? data.cards.filter((card) => card.category === category)
      : data.cards;

    return macroJsonResponse(
      {
        cards: filteredCards,
        regimeFactors: data.regimeFactors,
        calendarEvents: data.calendarEvents,
        correlationAssets: data.correlationAssets,
        meta: data.meta,
        feedBreakdown: filteredCards.map((card) => ({
          id: card.id,
          symbol: card.symbol,
          source: card.meta.source,
          frequency: card.meta.frequency,
          mode: card.meta.mode,
          observationDate: card.meta.observationDate,
        })),
        timestamp: new Date().toISOString(),
      },
      data.meta.mode
    );
  }, "api:macro:overview");
}
