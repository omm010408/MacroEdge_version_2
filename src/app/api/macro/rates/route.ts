import { macroJsonResponse, runSafeMacroRoute } from "@/services/api-helpers";
import { getFixedIncomeRatesData } from "@/services/macro-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return runSafeMacroRoute(async () => {
    const data = await getFixedIncomeRatesData();
    return macroJsonResponse(
      {
        curve: data.curve,
        history: data.history,
        auctions: data.auctions,
        meta: data.meta,
        timestamp: new Date().toISOString(),
      },
      data.meta.mode
    );
  }, "api:macro:rates");
}
