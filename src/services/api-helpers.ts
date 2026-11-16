import { NextResponse } from "next/server";
import type { FeedMode } from "@/lib/types";

export function macroJsonResponse<T>(
  payload: T,
  mode: FeedMode,
  status = 200
): NextResponse {
  const cacheControl =
    mode === "LIVE_API"
      ? "public, s-maxage=300, stale-while-revalidate=600"
      : "public, s-maxage=60, stale-while-revalidate=300";

  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "X-MacroEdge-Data-Mode": mode,
    },
  });
}

export function macroErrorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json(
    {
      error: message,
      status,
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

export async function runSafeMacroRoute(
  handler: () => Promise<NextResponse>,
  routeName = "api:macro"
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    try {
      const { ingestTelemetryAndClassify } = await import(
        "@/services/incidents/debugger-engine"
      );
      await ingestTelemetryAndClassify({
        domain: "backend",
        severity: "High",
        affectedComponent: routeName,
        errorDescription:
          err instanceof Error ? err.message : "Unhandled macro API error",
        stackTrace: err instanceof Error ? err.stack ?? err.message : String(err),
        telemetry: {
          sourceComponent: routeName,
          metricType: "api_latency",
          ok: false,
          detail:
            err instanceof Error ? err.message : "Unhandled macro API exception",
        },
      });
    } catch {
      // Never let incident reporting obscure API error response
    }
    return macroErrorResponse(
      "Unable to retrieve macroeconomic dataset at this time.",
      500
    );
  }
}
