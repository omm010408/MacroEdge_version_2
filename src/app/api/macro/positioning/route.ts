import type { NextRequest } from "next/server";
import {
  macroErrorResponse,
  macroJsonResponse,
  runSafeMacroRoute,
} from "@/services/api-helpers";
import { getCotDashboardData } from "@/services/macro-data";

export const dynamic = "force-dynamic";

const ALLOWED_ASSET_CLASSES = new Set([
  "FX",
  "Rates",
  "Metals",
  "Energy",
  "Equities",
  "Crypto",
]);

export async function GET(request: NextRequest) {
  return runSafeMacroRoute(async () => {
    const assetClass = request.nextUrl.searchParams.get("assetClass");
    if (assetClass && !ALLOWED_ASSET_CLASSES.has(assetClass)) {
      return macroErrorResponse(
        "Invalid assetClass parameter. Expected one of: FX, Rates, Metals, Energy, Equities, Crypto.",
        400
      );
    }

    const data = await getCotDashboardData();
    const instruments = assetClass
      ? data.instruments.filter((i: { assetClass: string }) => i.assetClass === assetClass)
      : data.instruments;

    return macroJsonResponse(
      {
        instruments,
        reportDate: data.reportDate,
        releaseDate: data.releaseDate,
        meta: data.meta,
        timestamp: new Date().toISOString(),
      },
      data.meta.mode
    );
  }, "api:macro:positioning");
}
