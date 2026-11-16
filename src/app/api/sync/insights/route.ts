import { getSyncSystemSnapshot } from "@/services/sync/store";
import { runAiSupervisorCycle } from "@/services/sync/workers/ai-supervisor";
import {
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) {
    return syncErrorResponse("Unauthorized AI supervisor trigger.", 401);
  }

  try {
    const result = await runAiSupervisorCycle({ trigger: "manual" });
    const snapshot = await getSyncSystemSnapshot();
    const ok = result.status !== "FAILED" && result.status !== "DEAD_LETTER";

    return syncJsonResponse({
      ok,
      ...(ok ? {} : { error: result.error ?? "AI supervisor cycle failed." }),
      result,
      snapshot,
    });
  } catch {
    return syncErrorResponse("Unable to run AI research supervisor cycle.", 500);
  }
}
