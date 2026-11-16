"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type ThemeMode,
  type UserPreferencesState,
} from "@/lib/storage/preferences";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { installGlobalFrontendMonitors } from "@/lib/incidents/client-reporter";
import type { RegimeLensId } from "@/lib/types";

const SIDEBAR_STORAGE_KEY = "macroedge.sidebar_expanded.v1";

interface TerminalContextValue {
  prefs: UserPreferencesState;
  announcementVisible: boolean;
  dismissAnnouncement: () => void;
  restoreAnnouncement: () => void;
  updatePrefs: (next: Partial<UserPreferencesState>) => Promise<void>;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  hydrated: boolean;
  sidebarExpanded: Record<string, boolean> | null;
  toggleSidebarGroup: (id: string, currentExpanded: boolean) => void;
  ensureSidebarGroupExpanded: (id: string) => void;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  userEmail: string | null;
  signInLocalOrSupabase: (email: string, password?: string) => Promise<{ error?: string }>;
  signOutUser: () => Promise<void>;
  supabaseReady: boolean;
  activeRegimeLens: RegimeLensId;
  setActiveRegimeLens: (lens: RegimeLensId) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

function applyThemeToDOM(themeMode: ThemeMode) {
  if (typeof document === "undefined") return;
  void themeMode;
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
}

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferencesState>(DEFAULT_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState<Record<string, boolean> | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>("a.vance@macroedge.io");
  const [activeRegimeLens, setActiveRegimeLens] = useState<RegimeLensId>("general");

  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    const loaded = loadPreferences();
    setPrefs(loaded);
    applyThemeToDOM(loaded.theme);
    try {
      const raw = window.sessionStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        if (parsed && typeof parsed === "object") {
          setSidebarExpanded(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
    setHydrated(true);

    if (supabaseReady) {
      const supabase = getSupabaseBrowserClient();
      supabase?.auth.getUser().then(({ data }) => {
        if (data.user?.email) {
          setUserEmail(data.user.email);
        }
      });
    }
  }, [supabaseReady]);

  useEffect(() => {
    return installGlobalFrontendMonitors();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setAuthModalOpen(false);
        setMobileSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleSidebarGroup = useCallback((id: string, currentExpanded: boolean) => {
    setSidebarExpanded((prev) => {
      const next = { ...(prev ?? {}), [id]: !currentExpanded };
      try {
        window.sessionStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const ensureSidebarGroupExpanded = useCallback((id: string) => {
    setSidebarExpanded((prev) => {
      if (prev && prev[id] === true) return prev;
      const next = { ...(prev ?? {}), [id]: true };
      try {
        window.sessionStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const updatePrefs = useCallback(async (next: Partial<UserPreferencesState>) => {
    const merged = await savePreferences(next);
    setPrefs(merged);
  }, []);

  const dismissAnnouncement = useCallback(() => {
    void updatePrefs({ announcementDismissed: true });
  }, [updatePrefs]);

  const restoreAnnouncement = useCallback(() => {
    void updatePrefs({ announcementDismissed: false });
  }, [updatePrefs]);

  const signInLocalOrSupabase = useCallback(
    async (email: string, password?: string): Promise<{ error?: string }> => {
      if (supabaseReady) {
        const supabase = getSupabaseBrowserClient();
        if (supabase && password) {
          const { error, data } = await supabase.auth.signInWithPassword({ email, password });
          if (error) return { error: error.message };
          setUserEmail(data.user?.email ?? email);
          setAuthModalOpen(false);
          return {};
        }
      }
      const handle = email.split("@")[0] || "Analyst";
      setUserEmail(email);
      await updatePrefs({ userName: handle });
      setAuthModalOpen(false);
      return {};
    },
    [supabaseReady, updatePrefs]
  );

  const signOutUser = useCallback(async () => {
    if (supabaseReady) {
      const supabase = getSupabaseBrowserClient();
      await supabase?.auth.signOut();
    }
    setUserEmail(null);
  }, [supabaseReady]);

  const setTheme = useCallback(
    async (mode: ThemeMode) => {
      applyThemeToDOM(mode);
      await updatePrefs({ theme: mode });
    },
    [updatePrefs]
  );

  const toggleTheme = useCallback(async () => {
    const current = prefs.theme ?? "dark";
    const next: ThemeMode = current === "light" ? "dark" : "light";
    await setTheme(next);
  }, [prefs.theme, setTheme]);

  return (
    <TerminalContext.Provider
      value={{
        prefs,
        announcementVisible: hydrated ? !prefs.announcementDismissed : true,
        dismissAnnouncement,
        restoreAnnouncement,
        updatePrefs,
        searchOpen,
        setSearchOpen,
        mobileSidebarOpen,
        setMobileSidebarOpen,
        hydrated,
        sidebarExpanded,
        toggleSidebarGroup,
        ensureSidebarGroupExpanded,
        authModalOpen,
        setAuthModalOpen,
        userEmail,
        signInLocalOrSupabase,
        signOutUser,
        supabaseReady,
        activeRegimeLens,
        setActiveRegimeLens,
        theme: prefs.theme ?? "dark",
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error("useTerminal must be used within TerminalProvider");
  }
  return ctx;
}

export function useOptionalTerminal() {
  return useContext(TerminalContext);
}
