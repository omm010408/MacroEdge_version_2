import {
  parseOptionalJsonBody,
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";
import type { IncidentActionType } from "@/lib/incidents/types";
import { handleIncidentAction } from "@/services/incidents/debugger-engine";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set<IncidentActionType>([
  "approve",
  "reject",
  "dismiss",
  "remediate",
  "investigate",
  "resolve",
  "reopen",
]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) {
    return syncErrorResponse("Unauthorized incident action request.", 401);
  }

  const { id } = await context.params;
  if (!id || !id.trim()) {
    return syncErrorResponse("Incident ID parameter is required.", 400);
  }

  const body = await parseOptionalJsonBody(req);
  if (!body) {
    return syncErrorResponse("Invalid JSON request payload.", 400);
  }

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action as IncidentActionType)) {
    return syncErrorResponse("Invalid or missing incident action.", 400);
  }

  try {
    const outcome = await handleIncidentAction(id.trim(), {
      action: action as IncidentActionType,
      actor: typeof body.actor === "string" ? body.actor : "operator",
      note: typeof body.note === "string" ? body.note : undefined,
    });

    if (!outcome.incident) {
      return syncErrorResponse(`Incident "${id}" not found.`, 404);
    }

    return syncJsonResponse({
      ok: outcome.ok,
      message: outcome.message,
      incident: outcome.incident,
      snapshot: outcome.snapshot,
    });
  } catch (err) {
    console.error(
      "[POST /api/incidents/[id]/action] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return syncErrorResponse("Failed to apply incident action.", 500);
  }
}
