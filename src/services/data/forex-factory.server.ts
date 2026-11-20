import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ForexFactoryEvent,
  type ForexFactoryRawItem,
  getInstitutionalForexFactoryDocket,
  normalizeForexFactoryItem,
} from "@/services/data/forex-factory";

const CACHE_FILE_PATH = path.join(process.cwd(), "ml", "data", "forex_factory_calendar.json");
const CACHE_MAX_AGE_MS = 3600_000; // 1 hour freshness policy

export interface ForexFactoryCalendarResult {
  events: ForexFactoryEvent[];
  source: "live_nfs" | "disk_cache" | "institutional_docket";
  lastUpdated: string;
}

/**
 * Server-only service: Fetches live Forex Factory calendar with disk caching and offline fallback.
 * Operates exclusively on Node.js runtime and guarantees zero browser bundling.
 */
export async function getForexFactoryCalendar(options?: {
  forceRefresh?: boolean;
}): Promise<ForexFactoryCalendarResult> {
  const force = options?.forceRefresh ?? false;

  // 1. Try reading disk cache first if recent and not forcing refresh
  if (!force) {
    try {
      const stat = await fs.stat(CACHE_FILE_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < CACHE_MAX_AGE_MS) {
        const raw = await fs.readFile(CACHE_FILE_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return {
            events: parsed as ForexFactoryEvent[],
            source: "disk_cache",
            lastUpdated: new Date(stat.mtimeMs).toISOString(),
          };
        }
      }
    } catch {
      // Disk cache missing or unreadable; proceed to live fetch
    }
  }

  // 2. Fetch live Forex Factory / Fair Economy media calendar feeds
  try {
    const urls = [
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
    ];

    const responses = await Promise.allSettled(
      urls.map(async (u) => {
        const res = await fetch(u, {
          headers: {
            "User-Agent": "MacroEdge-QuantCalendar/2.0 (Institutional Risk Platform)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ForexFactoryRawItem[];
      })
    );

    const mergedRaw: ForexFactoryRawItem[] = [];
    for (const r of responses) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        mergedRaw.push(...r.value);
      }
    }

    if (mergedRaw.length > 0) {
      const normalized = mergedRaw.map((item, idx) => normalizeForexFactoryItem(item, idx));

      // Attempt to save to disk cache gracefully (non-fatal if filesystem is read-only)
      try {
        await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(normalized, null, 2), "utf-8");
      } catch {
        // Filesystem is read-only or permission-restricted (e.g. some serverless containers)
      }

      return {
        events: normalized,
        source: "live_nfs",
        lastUpdated: new Date().toISOString(),
      };
    }
  } catch {
    // External network failure; proceed to disk cache fallback
  }

  // 3. Fallback to existing disk cache if present (even if older than 1 hour)
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        events: parsed as ForexFactoryEvent[],
        source: "disk_cache",
        lastUpdated: new Date().toISOString(),
      };
    }
  } catch {
    // Fallback to institutional docket
  }

  // 4. Guaranteed institutional fallback docket
  const institutional = getInstitutionalForexFactoryDocket();
  return {
    events: institutional,
    source: "institutional_docket",
    lastUpdated: new Date().toISOString(),
  };
}
