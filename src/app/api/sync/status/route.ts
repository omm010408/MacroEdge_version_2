import { getSyncSystemSnapshot } from "@/services/sync/store";
import { syncErrorResponse, syncJsonResponse } from "@/app/api/sync/_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getSyncSystemSnapshot();
    const adminTokenRequired = Boolean(process.env.SYNC_ADMIN_TOKEN?.trim());

    return syncJsonResponse(snapshot, 200, {
      "X-Sync-Admin-Auth-Required": adminTokenRequired ? "true" : "false",
    });
  } catch {
    return syncErrorResponse("Unable to retrieve synchronization status.", 500);
  }
}
