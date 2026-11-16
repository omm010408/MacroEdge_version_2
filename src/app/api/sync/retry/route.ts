import { retryFailedSyncJob } from "@/services/sync/orchestrator";
import { getSyncSystemSnapshot } from "@/services/sync/store";
import {
  parseOptionalJsonBody,
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) {
    return syncErrorResponse("Unauthorized retry request.", 401);
  }

  const body = await parseOptionalJsonBody(req);
  if (body === null) {
    return syncErrorResponse("Invalid JSON request body.", 400);
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) {
    return syncErrorResponse("Missing required runId.", 400);
  }

  try {
    const result = await retryFailedSyncJob(runId);
    const snapshot = await getSyncSystemSnapshot();

    if (!result.ok && result.summaries.length === 0) {
      return syncJsonResponse(
        {
          ok: false,
          error: result.errors[0]?.message ?? `Sync run "${runId}" was not found.`,
          result,
          snapshot,
        },
        404
      );
    }

    return syncJsonResponse({
      ok: result.ok,
      ...(result.ok
        ? {}
        : {
            error:
              result.errors.map((e) => e.message).join("; ") ||
              "Retry execution failed.",
          }),
      result,
      snapshot,
    });
  } catch {
    return syncErrorResponse("Unable to retry sync job.", 500);
  }
}
