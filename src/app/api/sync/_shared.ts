import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { MarketSymbol, ProviderId, WorkerId } from "@/lib/sync/types";
import {
  MARKET_INSTRUMENT_MAPPINGS,
  PROVIDER_REGISTRY,
} from "@/services/sync/provider-registry";

export const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
};

const VALID_WORKERS = new Set<WorkerId>([
  "orchestrator",
  "market-engine",
  "macro-engine",
  "positioning-engine",
  "liquidity-risk-engine",
  "validation-recovery",
  "ai-supervisor",
]);

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies bearer/admin token against an optional server env secret.
 * When the configured env var is empty/unset, access is permitted for local dev.
 */
export function verifySyncSecret(
  req: Request,
  envVarName: "SYNC_ADMIN_TOKEN" | "CRON_SECRET"
): boolean {
  const expected = process.env[envVarName]?.trim();
  if (!expected) return true;

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (bearer && timingSafeEqualString(bearer, expected)) {
    return true;
  }

  if (envVarName === "SYNC_ADMIN_TOKEN") {
    const customToken = req.headers.get("x-sync-admin-token")?.trim() ?? "";
    if (customToken && timingSafeEqualString(customToken, expected)) {
      return true;
    }
  }

  return false;
}

export function syncJsonResponse<T>(
  payload: T,
  status = 200,
  extraHeaders?: Record<string, string>
): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

export function syncErrorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      status,
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    }
  );
}

export async function parseOptionalJsonBody(
  req: Request
): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isValidWorkerId(value: unknown): value is WorkerId {
  return typeof value === "string" && VALID_WORKERS.has(value as WorkerId);
}

export function isValidProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDER_REGISTRY;
}

export function isValidMarketSymbol(value: unknown): value is MarketSymbol {
  return typeof value === "string" && value in MARKET_INSTRUMENT_MAPPINGS;
}
