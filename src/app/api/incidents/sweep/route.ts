import {
  parseOptionalJsonBody,
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";
import { runDeterministicMonitorSweep } from "@/services/incidents/debugger-engine";
import { getIncidentDashboardSnapshot } from "@/services/incidents/store";

export const dynamic = "force-dynamic";

function isAuthorizedSweepRequest(req: Request): boolean {
  const adminConfigured = Boolean(process.env.SYNC_ADMIN_TOKEN?.trim());
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  if (!adminConfigured && !cronConfigured) return true;
  if (adminConfigured && verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) return true;
  if (cronConfigured && verifySyncSecret(req, "CRON_SECRET")) return true;
  return false;
}

export async function POST(req: Request) {
  if (!isAuthorizedSweepRequest(req)) {
    return syncErrorResponse("Unauthorized incident sweep invocation.", 401);
  }

  const body = await parseOptionalJsonBody(req);
  if (!body) {
    return syncErrorResponse("Invalid JSON request body.", 400);
  }

  try {
    const runDbProbe = body.runDbProbe !== false;
    const autoRemediate = body.autoRemediate !== false;
    const invokeAi = Boolean(body.invokeAi);

    const sweep = await runDeterministicMonitorSweep({
      runDbProbe,
      autoRemediate,
      invokeAi,
      actor: "manual-diagnostic-sweep",
    });
    const snapshot = await getIncidentDashboardSnapshot();

    return syncJsonResponse({
      ok: true,
      sweep,
      snapshot,
    });
  } catch (err) {
    console.error(
      "[POST /api/incidents/sweep] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return syncErrorResponse("Diagnostic monitor sweep failed.", 500);
  }
}
