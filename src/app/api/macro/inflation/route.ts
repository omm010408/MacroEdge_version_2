import type { NextRequest } from "next/server";
import {
  macroErrorResponse,
  macroJsonResponse,
  runSafeMacroRoute,
} from "@/services/api-helpers";
import { getInflationDashboardData } from "@/services/macro-data";

export const dynamic = "force-dynamic";

const TIMEFRAME_MONTHS: Record<string, number> = {
  "1Y": 12,
  "2Y": 24,
  "3Y": 36,
};

export async function GET(request: NextRequest) {
  return runSafeMacroRoute(async () => {
    const timeframe = request.nextUrl.searchParams.get("timeframe");
    if (timeframe && !(timeframe in TIMEFRAME_MONTHS)) {
      return macroErrorResponse(
        "Invalid timeframe parameter. Expected one of: 1Y, 2Y, 3Y.",
        400
      );
    }

    const data = await getInflationDashboardData();
    const history = timeframe
      ? data.history.slice(-TIMEFRAME_MONTHS[timeframe])
      : data.history;

    return macroJsonResponse(
      {
        topMetrics: data.topMetrics,
        components: data.components,
        history,
        meta: data.meta,
        feedBreakdown: data.topMetrics.map((m) => ({
          id: m.id,
          label: m.label,
          seriesId: m.seriesId,
          source: m.source,
          cadence: m.cadence,
          mode: m.mode ?? data.meta.mode,
          observationDate: m.observationDate ?? m.releaseDate,
          releaseDate: m.releaseDate,
        })),
        timestamp: new Date().toISOString(),
      },
      data.meta.mode
    );
  }, "api:macro:inflation");
}
