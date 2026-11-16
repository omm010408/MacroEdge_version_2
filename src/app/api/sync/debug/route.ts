import {
  clearOrphanedSyncLocks,
  getAutoSyncDiagnostics,
  resetRateLimitHistory,
  runAutoSyncProbe,
} from "@/services/sync/debug";
import { runDeterministicMonitorSweep } from "@/services/incidents/debugger-engine";
import {
  NO_STORE_HEADERS,
  isValidProviderId,
  parseOptionalJsonBody,
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "probe") {
      const probe = await runAutoSyncProbe();
      const diagnostics = await getAutoSyncDiagnostics();
      return syncJsonResponse({ ok: probe.ok, probe, diagnostics });
    }

    const diagnostics = await getAutoSyncDiagnostics();
    const adminTokenRequired = Boolean(process.env.SYNC_ADMIN_TOKEN?.trim());

    return syncJsonResponse(
      { ok: true, diagnostics },
      200,
      {
        ...NO_STORE_HEADERS,
        "X-Sync-Admin-Auth-Required": adminTokenRequired ? "true" : "false",
      }
    );
  } catch (err) {
    console.error("[GET /api/sync/debug] Error:", err);
    return syncErrorResponse("Failed to generate synchronization diagnostics.", 500);
  }
}

export async function POST(req: Request) {
  if (!verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) {
    return syncErrorResponse("Unauthorized synchronization debug request.", 401);
  }

  const body = await parseOptionalJsonBody(req);
  const action = body?.action ?? "probe";

  try {
    let result: unknown = null;

    switch (action) {
      case "probe":
        result = await runAutoSyncProbe();
        break;
      case "clear-locks":
        result = await clearOrphanedSyncLocks();
        break;
      case "reset-rate-history":
        result = await resetRateLimitHistory(
          isValidProviderId(body?.providerId) ? body.providerId : undefined
        );
        break;
      case "sweep":
        result = await runDeterministicMonitorSweep({
          actor: "autosync-debugger-sweep",
          autoRemediate: false,
          invokeAi: false,
        });
        break;
      default:
        return syncErrorResponse(`Unknown debug action: ${String(action)}`, 400);
    }

    const diagnostics = await getAutoSyncDiagnostics();
    return syncJsonResponse({
      ok: true,
      action,
      result,
      diagnostics,
    });
  } catch (err) {
    console.error("[POST /api/sync/debug] Error:", err);
    return syncErrorResponse("Debug action execution failed.", 500);
  }
}
