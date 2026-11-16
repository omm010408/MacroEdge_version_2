"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { ALL_TERMINAL_ROUTES, isRouteActive } from "@/config/navigation";
import { useTerminal } from "@/components/providers/TerminalProvider";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/navigation/NavIcon";
import { MacroEdgeLogo } from "@/components/navigation/MacroEdgeLogo";

const PRIMARY_DESKS = [
  { label: "Terminal", href: "/macrodashboard", matchPrefix: "/macrodashboard" },
  { label: "Command", href: "/dashboard", matchPrefix: "/dashboard" },
  { label: "AI Bias", href: "/macrodashboard/tools/ai-bias", matchPrefix: "/macrodashboard/tools/ai-bias" },
  { label: "Data Ops", href: "/macrodashboard/tools/data-ops", matchPrefix: "/macrodashboard/tools/data-ops" },
  { label: "Incidents", href: "/macrodashboard/tools/incidents", matchPrefix: "/macrodashboard/tools/incidents" },
] as const;

const NOTIFICATIONS = [
  { id: "n1", title: "Data Operations & Sync", meta: "Configure live API feeds & trigger worker sync", href: "/macrodashboard/tools/data-ops" },
  { id: "n2", title: "Incident Response Console", meta: "Agent 7 autonomous diagnostics & system health", href: "/macrodashboard/tools/incidents" },
  { id: "n3", title: "Inflation & Monetary Desk", meta: "Live FRED, BLS & BEA observation monitors", href: "/macrodashboard/economy/inflation" },
];

export function TopNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    prefs,
    searchOpen,
    setSearchOpen,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    authModalOpen,
    setAuthModalOpen,
    userEmail,
    signInLocalOrSupabase,
    signOutUser,
    supabaseReady,
    restoreAnnouncement,
    announcementVisible,
  } = useTerminal();

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [emailInput, setEmailInput] = useState(userEmail ?? "a.vance@macroedge.io");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNotifOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const isMacroRoute =
    isRouteActive(pathname, "/macrodashboard", "/macrodashboard") ||
    isRouteActive(pathname, "/dashboard", "/dashboard");

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_TERMINAL_ROUTES;
    return ALL_TERMINAL_ROUTES.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
    );
  }, [query]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setActiveResultIdx(0);
  };

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (filteredRoutes.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveResultIdx((prev) => (prev + 1) % filteredRoutes.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveResultIdx((prev) => (prev - 1 + filteredRoutes.length) % filteredRoutes.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredRoutes[activeResultIdx] ?? filteredRoutes[0];
      if (target) {
        router.push(target.href);
        closeSearch();
      }
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    const res = await signInLocalOrSupabase(emailInput, passwordInput);
    if (res.error) setAuthError(res.error);
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-13 w-full items-center justify-between gap-4 border-b border-white/[0.085] bg-[#06080B]/95 px-4 backdrop-blur-md lg:px-5">
        {/* Left: Brand + Mobile Sidebar Toggle */}
        <div className="flex shrink-0 items-center gap-3">
          {isMacroRoute && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
              aria-label="Toggle sidebar navigation"
              aria-expanded={mobileSidebarOpen}
              aria-controls="mobile-macro-sidebar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.09] bg-[#0A0D12] text-[#9AA3B0] hover:border-white/20 hover:text-[#F0F2F5] lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}

          <Link href="/macrodashboard" className="group flex items-center gap-2.5">
            <div className="flex h-7 items-center justify-center rounded-md border border-white/[0.14] bg-[#0A0D12] px-1.5 py-1 shadow-[0_0_14px_rgba(255,255,255,0.08)] transition group-hover:border-white/40">
              <MacroEdgeLogo height={18} />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[14px] font-semibold tracking-tight text-[#F0F2F5]">
                MacroEdge
              </span>
              <span className="hidden rounded border border-white/[0.08] bg-[#0D1117] px-1.5 py-0.5 font-mono-num text-[9px] uppercase tracking-wider text-[#9AA3B0] sm:inline">
                TERMINAL
              </span>
            </div>
          </Link>
        </div>

        {/* Center: Primary Desk Quick Switcher */}
        <nav
          aria-label="Primary terminal desks"
          className="hidden items-center gap-1 rounded-lg border border-white/[0.07] bg-[#0A0D12] p-0.5 lg:flex"
        >
          {PRIMARY_DESKS.map((desk) => {
            const isExactTool =
              desk.href !== "/macrodashboard" &&
              pathname.startsWith(desk.matchPrefix);
            const isTerminalRoot =
              desk.href === "/macrodashboard" &&
              pathname.startsWith("/macrodashboard") &&
              !pathname.startsWith("/macrodashboard/tools/ai-bias") &&
              !pathname.startsWith("/macrodashboard/tools/data-ops") &&
              !pathname.startsWith("/macrodashboard/tools/incidents");
            const active = isExactTool || isTerminalRoot;
            return (
              <Link
                key={desk.href}
                href={desk.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                  active
                    ? "bg-[#181B20] text-[#F0F2F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-[#9AA3B0] hover:bg-white/[0.03] hover:text-[#F0F2F5]"
                )}
              >
                {desk.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Search, Status, Notifications, Profile */}
        <div ref={menuContainerRef} className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-white/[0.09] bg-[#0A0D12] px-2.5 text-[12px] text-[#9AA3B0] transition hover:border-white/20 hover:text-[#F0F2F5]"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden items-center gap-0.5 rounded border border-white/[0.09] bg-[#12161B] px-1 font-mono-num text-[10px] text-[#7D8694] sm:inline-flex">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>

          <Link
            href="/ranks"
            className="hidden items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#0A0D12] px-2.5 py-1 font-mono-num text-[11px] text-[#F0F2F5] transition hover:border-[#FFFFFF]/40 sm:inline-flex"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{prefs.userRank}</span>
          </Link>

          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((prev) => !prev);
                setProfileOpen(false);
              }}
              aria-label="Notifications"
              aria-expanded={notifOpen}
              className="relative flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.09] bg-[#0A0D12] text-[#9AA3B0] transition hover:border-white/20 hover:text-[#F0F2F5]"
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#FFFFFF]" />
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-10 z-50 w-72 rounded-lg border border-white/[0.09] bg-[#0A0D12] p-2 shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-2 pb-2 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9299A3]">
                    Desk Alerts
                  </span>
                  <span className="font-mono-num text-[10px] text-[#FFFFFF]">3 Active</span>
                </div>
                <div className="mt-1 space-y-1">
                  {NOTIFICATIONS.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setNotifOpen(false)}
                      className="block rounded-md px-2 py-2 transition hover:bg-[#12161B]"
                    >
                      <div className="text-[12px] font-medium text-[#F0F2F5]">{item.title}</div>
                      <div className="font-mono-num text-[11px] text-[#9299A3]">{item.meta}</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Profile dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileOpen((prev) => !prev);
                setNotifOpen(false);
              }}
              aria-expanded={profileOpen}
              className="flex h-8 items-center gap-2 rounded-md border border-white/[0.09] bg-[#0B0D10] px-2 text-[12px] text-[#F0F2F5] transition hover:border-white/20"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[#FFFFFF]/15 font-mono-num text-[10px] font-semibold text-[#FFFFFF]">
                {prefs.userName.slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden max-w-[90px] truncate md:inline">{prefs.userName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#555D68]" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-10 z-50 w-60 rounded-lg border border-white/[0.09] bg-[#0A0D12] p-1.5 shadow-2xl">
                <div className="border-b border-white/[0.06] px-2.5 py-2">
                  <div className="text-[12.5px] font-semibold text-[#F0F2F5]">
                    {prefs.userName}
                  </div>
                  <div className="font-mono-num text-[11px] text-[#9299A3]">
                    {userEmail ?? "Guest Terminal Session"}
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-[#12161B] px-1.5 py-0.5 font-mono-num text-[10px] text-[#00C985]">
                    {supabaseReady ? "Supabase Cloud" : "Local Persistence"}
                  </div>
                </div>

                <div className="mt-1 space-y-0.5">
                  <Link
                    href="/dashboard"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-[#9299A3] hover:bg-[#12161B] hover:text-[#F0F2F5]"
                  >
                    <User className="h-3.5 w-3.5" />
                    Research Dashboard
                  </Link>
                  <Link
                    href="/macrodashboard/tools/watch-list"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-[#9299A3] hover:bg-[#12161B] hover:text-[#F0F2F5]"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Watch List &amp; Notes
                  </Link>
                  {!announcementVisible && (
                    <button
                      type="button"
                      onClick={() => {
                        restoreAnnouncement();
                        setProfileOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[#9299A3] hover:bg-[#12161B] hover:text-[#F0F2F5]"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      Show Release Bar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      setAuthError(null);
                      setEmailInput(userEmail ?? "a.vance@macroedge.io");
                      setPasswordInput("");
                      setAuthModalOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[#FFFFFF] hover:bg-[#12161B]"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {userEmail ? "Switch Account" : "Sign In"}
                  </button>
                  {userEmail && (
                    <button
                      type="button"
                      onClick={() => {
                        void signOutUser();
                        setProfileOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[#F05454] hover:bg-[#12161B]"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign Out
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Search Modal */}
      {searchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quick terminal search"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 pt-20 backdrop-blur-xs"
          onClick={closeSearch}
        >
          <div
            className="mx-3 w-full max-w-lg rounded-lg border border-white/[0.12] bg-[#0A0D12] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3">
              <Search className="h-4 w-4 text-[#FFFFFF]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveResultIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Jump to module, indicator, or tool (e.g. inflation, cot, yields)..."
                className="w-full bg-transparent text-[13px] text-[#F0F2F5] placeholder-[#555D68] focus:outline-none"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="rounded p-1 text-[#555D68] hover:text-[#F0F2F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredRoutes.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-[#555D68]">
                  No matching terminal modules.
                </div>
              ) : (
                filteredRoutes.map((route, idx) => {
                  const highlighted = idx === activeResultIdx;
                  return (
                    <button
                      key={route.id}
                      type="button"
                      onMouseEnter={() => setActiveResultIdx(idx)}
                      onClick={() => {
                        router.push(route.href);
                        closeSearch();
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition",
                        highlighted ? "bg-[#12161B]" : "hover:bg-[#12161B]"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <NavIcon name={route.icon} className="h-4 w-4 text-[#FFFFFF]" />
                        <div>
                          <div className="text-[13px] font-medium text-[#F0F2F5]">{route.label}</div>
                          <div className="text-[11px] text-[#555D68]">{route.category}</div>
                        </div>
                      </div>
                      <span className="font-mono-num text-[10px] text-[#9299A3]">{route.href}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auth / Session Modal */}
      {authModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="MacroEdge Desk Session"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setAuthModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-white/[0.12] bg-[#0A0D12] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="text-[14px] font-semibold text-[#F0F2F5]">
                MacroEdge Desk Session
              </h3>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                aria-label="Close session modal"
                className="text-[#555D68] hover:text-[#F0F2F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-[#9299A3]">
                  Analyst Email
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full rounded-md border border-white/[0.09] bg-[#080A0D] px-3 py-2 font-mono-num text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
                />
              </div>
              {supabaseReady && (
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-[#9299A3]">
                    Password
                  </label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full rounded-md border border-white/[0.09] bg-[#080A0D] px-3 py-2 font-mono-num text-[12px] text-[#F0F2F5] focus:border-[#FFFFFF] focus:outline-none"
                  />
                </div>
              )}
              {authError && (
                <div className="rounded border border-[#F05454]/40 bg-[#F05454]/10 px-2.5 py-1.5 text-[11.5px] text-[#F05454]">
                  {authError}
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono-num text-[10.5px] text-[#555D68]">
                  {supabaseReady ? "Supabase Auth Enabled" : "Local Profile Mode"}
                </span>
                <button
                  type="submit"
                  className="rounded-md bg-[#FFFFFF] px-3.5 py-1.5 text-[12px] font-semibold text-[#050608] transition hover:bg-[#E2E6EC]"
                >
                  Connect Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
