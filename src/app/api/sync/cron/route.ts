import { runScheduledOrchestratorTick } from "@/services/sync/orchestrator";
import { runDeterministicMonitorSweep } from "@/services/incidents/debugger-engine";
import {
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

async function handleCron(req: Request) {
  if (!verifySyncSecret(req, "CRON_SECRET")) {
    return syncErrorResponse("Unauthorized cron invocation.", 401);
  }

  try {
    const result = await runScheduledOrchestratorTick();
    const incidentSweep = await runDeterministicMonitorSweep({
      runDbProbe: true,
      autoRemediate: false,
      invokeAi: false,
      actor: "vercel-cron-monitor",
    }).catch((err) => {
      console.error(
        "[GET|POST /api/sync/cron] Agent 7 monitor sweep failed:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    });

    return syncJsonResponse({
      ok: true,
      result,
      incidentSweep,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[GET|POST /api/sync/cron] Scheduled orchestrator tick failed:",
      err instanceof Error ? err.message : String(err)
    );
    return syncErrorResponse("Scheduled orchestrator tick failed.", 500);
  }
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
