import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdminClient: SupabaseClient | null = null;

function resolveSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    ""
  );
}

function resolveServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

/**
 * Checks whether server-side Supabase service-role persistence is configured.
 * Always returns false if evaluated in a browser environment.
 */
export function isSupabaseAdminConfigured(): boolean {
  if (typeof window !== "undefined") {
    return false;
  }
  return Boolean(resolveSupabaseUrl() && resolveServiceRoleKey());
}

/**
 * Strictly server-only Supabase admin client using SUPABASE_SERVICE_ROLE_KEY.
 * Throws if accidentally called in a browser bundle, and returns null cleanly
 * when Supabase admin credentials are not configured.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "Supabase admin client with service-role privileges cannot run in the browser."
    );
  }

  const url = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  if (!url || !serviceRoleKey) {
    return null;
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedAdminClient;
}
