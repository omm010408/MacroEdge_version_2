import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/app/api/sync/_shared";
import { getIncidentDashboardSnapshot } from "@/services/incidents/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getIncidentDashboardSnapshot();
    const adminAuthRequired = Boolean(process.env.SYNC_ADMIN_TOKEN?.trim());

    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "X-Sync-Admin-Auth-Required": adminAuthRequired ? "true" : "false",
      },
    });
  } catch (err) {
    console.error(
      "[GET /api/incidents] Snapshot error:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "Failed to load incident dashboard snapshot." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
