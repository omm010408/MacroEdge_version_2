"use client";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { DailyCheckEntry, WatchlistItem } from "@/lib/types";

export type AutoSyncPeriod = "off" | "30s" | "60s" | "5m" | "15m";
export type ThemeMode = "dark" | "light" | "system";

export interface UserPreferencesState {
  announcementDismissed: boolean;
  defaultTimeframe: "3M" | "6M" | "1Y" | "3Y" | "5Y";
  compactDensity: boolean;
  userName: string;
  userRole: string;
  userRank: string;
  autoSyncPeriod: AutoSyncPeriod;
  theme: ThemeMode;
}

const PREFS_KEY = "macroedge.preferences.v1";
const WATCHLIST_KEY = "macroedge.watchlist.v1";
const DAILY_CHECK_KEY = "macroedge.daily_checks.v1";

export const DEFAULT_PREFERENCES: UserPreferencesState = {
  announcementDismissed: false,
  defaultTimeframe: "1Y",
  compactDensity: false,
  userName: "A. Vance",
  userRole: "Macro Research Desk",
  userRank: "Tier I · Analyst",
  autoSyncPeriod: "60s",
  theme: "dark",
};

export function loadPreferences(): UserPreferencesState {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(next: Partial<UserPreferencesState>): Promise<UserPreferencesState> {
  const merged = { ...loadPreferences(), ...next };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent("macroedge:prefs-updated", { detail: merged }));
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (data.user && supabase) {
      await supabase.from("user_preferences").upsert({
        user_id: data.user.id,
        announcement_dismissed: merged.announcementDismissed,
        default_timeframe: merged.defaultTimeframe,
        compact_density: merged.compactDensity,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return merged;
}

export function loadWatchlist(fallback: WatchlistItem[]): WatchlistItem[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as WatchlistItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function saveWatchlist(items: WatchlistItem[]): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (data.user && supabase) {
      await supabase.from("watchlists").delete().eq("user_id", data.user.id);
      if (items.length > 0) {
        await supabase.from("watchlists").insert(
          items.map((item, idx) => ({
            user_id: data.user!.id,
            symbol: item.symbol,
            name: item.name,
            category: item.category,
            note: item.note,
            sort_order: idx,
          }))
        );
      }
    }
  }
}

export function loadDailyChecks(fallback: DailyCheckEntry[]): DailyCheckEntry[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(DAILY_CHECK_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as DailyCheckEntry[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function saveDailyCheck(entry: DailyCheckEntry, existing: DailyCheckEntry[]): Promise<DailyCheckEntry[]> {
  const filtered = existing.filter((item) => item.date !== entry.date);
  const next = [entry, ...filtered].sort((a, b) => b.date.localeCompare(a.date));

  if (typeof window !== "undefined") {
    window.localStorage.setItem(DAILY_CHECK_KEY, JSON.stringify(next));
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseBrowserClient();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (data.user && supabase) {
      await supabase.from("daily_checks").upsert({
        user_id: data.user.id,
        check_date: entry.date,
        overall_regime: entry.regime,
        net_score: entry.netScore,
        pillars: entry.pillars,
        summary_note: entry.summaryNote,
      });
    }
  }

  return next;
}
