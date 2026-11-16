import type { MarketSymbol, ProviderId, WorkerId } from "@/lib/sync/types";
import { dispatchSyncJob } from "@/services/sync/orchestrator";
import { getSyncSystemSnapshot } from "@/services/sync/store";
import {
  isValidMarketSymbol,
  isValidProviderId,
  isValidWorkerId,
  parseOptionalJsonBody,
  syncErrorResponse,
  syncJsonResponse,
  verifySyncSecret,
} from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifySyncSecret(req, "SYNC_ADMIN_TOKEN")) {
    return syncErrorResponse("Unauthorized synchronization trigger request.", 401);
  }

  const body = await parseOptionalJsonBody(req);
  if (body === null) {
    return syncErrorResponse("Invalid JSON request body.", 400);
  }

  let workerId: WorkerId | undefined;
  let providerId: ProviderId | undefined;

  if (body.workerId !== undefined && body.workerId !== null && body.workerId !== "") {
    if (!isValidWorkerId(body.workerId)) {
      return syncErrorResponse("Invalid workerId specified.", 400);
    }
    workerId = body.workerId;
  }

  if (body.providerId !== undefined && body.providerId !== null && body.providerId !== "") {
    if (!isValidProviderId(body.providerId)) {
      return syncErrorResponse("Invalid providerId specified.", 400);
    }
    providerId = body.providerId;
  }

  if (body.backfill !== undefined && typeof body.backfill !== "boolean") {
    return syncErrorResponse("backfill must be a boolean.", 400);
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    return syncErrorResponse("force must be a boolean.", 400);
  }

  let seriesKeys: string[] | undefined;
  if (body.seriesKeys !== undefined) {
    if (
      !Array.isArray(body.seriesKeys) ||
      !body.seriesKeys.every((k) => typeof k === "string" && k.trim().length > 0)
    ) {
      return syncErrorResponse("seriesKeys must be a non-empty string array.", 400);
    }
    seriesKeys = body.seriesKeys.map((k) => k.trim());
  }

  let symbols: MarketSymbol[] | undefined;
  if (body.symbols !== undefined) {
    if (!Array.isArray(body.symbols) || !body.symbols.every(isValidMarketSymbol)) {
      return syncErrorResponse("symbols contains an invalid market symbol.", 400);
    }
    symbols = body.symbols;
  }

  try {
    const result = await dispatchSyncJob({
      workerId,
      providerId,
      trigger: "manual",
      force: body.force ?? true,
      backfill: Boolean(body.backfill),
      seriesKeys,
      symbols,
    });
    const snapshot = await getSyncSystemSnapshot();

    return syncJsonResponse({
      ok: result.ok,
      ...(result.ok
        ? {}
        : {
            error:
              result.errors.map((e) => e.message).join("; ") ||
              "One or more sync workers failed.",
          }),
      result,
      snapshot,
    });
  } catch {
    return syncErrorResponse("Synchronization trigger execution failed.", 500);
  }
}
