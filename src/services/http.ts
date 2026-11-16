export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
  timeoutMs = 3500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export type FetchJsonResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; reason: string };

/**
 * Fetches JSON with an abort timer covering both response headers and body parsing.
 * Never throws or includes request URLs (which may contain API keys) in error reasons.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
  timeoutMs = 3500
): Promise<FetchJsonResult<T>> {
  if (typeof window !== "undefined") {
    return { ok: false, status: 0, reason: "server-only" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, status: res.status, reason: `http-${res.status}` };
    }

    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, status: 0, reason: isAbort ? "timeout" : "network-or-parse-error" };
  } finally {
    clearTimeout(timer);
  }
}
