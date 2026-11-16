import { NextResponse } from "next/server";
import { runSafeMacroRoute } from "@/services/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  return runSafeMacroRoute(async () => {
    const fredConfigured = Boolean(process.env.FRED_API_KEY?.trim());
    const blsConfigured = Boolean(process.env.BLS_API_KEY?.trim());
    const beaConfigured = Boolean(process.env.BEA_API_KEY?.trim());
    const cftcLive = process.env.ENABLE_PUBLIC_CFTC_LIVE?.trim() === "true";
    const treasuryLive = process.env.ENABLE_PUBLIC_TREASURY_LIVE?.trim() === "true";
    const supabaseConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    );

    return NextResponse.json(
      {
        brand: "MacroEdge",
        status: "operational",
        providers: {
          fred: fredConfigured ? "LIVE_CONFIGURED" : "UNCONFIGURED",
          bls: blsConfigured ? "LIVE_CONFIGURED" : "UNCONFIGURED",
          bea: beaConfigured ? "LIVE_CONFIGURED" : "UNCONFIGURED",
          cftc: cftcLive ? "LIVE_CONFIGURED" : "UNCONFIGURED",
          treasury: treasuryLive ? "LIVE_CONFIGURED" : "UNCONFIGURED",
          supabase: supabaseConfigured ? "CONNECTED" : "LOCAL_AUTH",
        },
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }, "api:macro:health");
}
