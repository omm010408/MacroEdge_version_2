"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { Activity, X } from "lucide-react";
import { isRouteActive, MACRO_SIDEBAR_GROUPS } from "@/config/navigation";
import { useTerminal } from "@/components/providers/TerminalProvider";
import { SidebarCategory } from "@/components/sidebar/SidebarCategory";
import { SidebarMenuItem } from "@/components/sidebar/SidebarMenuItem";
import { MacroRadarPanel } from "@/components/sidebar/MacroRadarPanel";

function findActiveGroupId(pathname: string): string | null {
  for (const group of MACRO_SIDEBAR_GROUPS) {
    if (group.items?.some((item) => isRouteActive(pathname, item.href))) {
      return group.id;
    }
  }
  return null;
}

function getExpandedDefaults(pathname: string): Record<string, boolean> {
  const map: Record<string, boolean> = {
    positioning: true,
    liquidity: true,
    economy: true,
  };

  const activeGroupId = findActiveGroupId(pathname);
  if (activeGroupId) {
    map[activeGroupId] = true;
  }
  return map;
}

export function Sidebar() {
  const pathname = usePathname();
  const {
    mobileSidebarOpen,
    setMobileSidebarOpen,
    hydrated,
    sidebarExpanded,
    toggleSidebarGroup,
    ensureSidebarGroupExpanded,
  } = useTerminal();

  const activeGroupId = findActiveGroupId(pathname);

  const expanded = useMemo(() => {
    const defaults = getExpandedDefaults(pathname);
    if (!hydrated || !sidebarExpanded) {
      return defaults;
    }
    return { ...defaults, ...sidebarExpanded };
  }, [pathname, hydrated, sidebarExpanded]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname, setMobileSidebarOpen]);

  useEffect(() => {
    if (hydrated && activeGroupId) {
      ensureSidebarGroupExpanded(activeGroupId);
    }
  }, [hydrated, activeGroupId, ensureSidebarGroupExpanded]);

  const statsGroups = MACRO_SIDEBAR_GROUPS.filter((g) => g.section === "STATISTICS");
  const toolsGroups = MACRO_SIDEBAR_GROUPS.filter((g) => g.section === "TOOLS");

  const toggleGroup = (id: string) => {
    toggleSidebarGroup(id, Boolean(expanded[id]));
  };

  const closeMobile = () => setMobileSidebarOpen(false);

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-[#000000] px-3 py-4">
      <div className="space-y-4 overflow-y-auto pr-0.5">
        <div>
          <SidebarMenuItem
            label="Macro Overview"
            href="/macrodashboard"
            icon="activity"
            active={isRouteActive(pathname, "/macrodashboard")}
            onNavigate={closeMobile}
          />
        </div>

        <div>
          <div className="px-2.5 pb-1 font-mono-num text-[10.5px] font-semibold tracking-wider text-[#6B6B6B]">
            STATISTICS
          </div>
          <div className="space-y-0.5">
            {statsGroups.map((group) => (
              <SidebarCategory
                key={group.id}
                group={group}
                pathname={pathname}
                isExpanded={Boolean(expanded[group.id])}
                onToggle={() => toggleGroup(group.id)}
                onNavigate={closeMobile}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="px-2.5 pb-1 font-mono-num text-[10.5px] font-semibold tracking-wider text-[#6B6B6B]">
            TOOLS
          </div>
          <div className="space-y-0.5">
            {toolsGroups.map((item) => (
              <SidebarMenuItem
                key={item.id}
                label={item.label}
                href={item.href || `/macrodashboard/tools/${item.id}`}
                icon={item.icon}
                active={isRouteActive(pathname, item.href || `/macrodashboard/tools/${item.id}`)}
                onNavigate={closeMobile}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2">
        <MacroRadarPanel onNavigate={closeMobile} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed / Sticky Sidebar */}
      <aside
        aria-label="Terminal sidebar navigation"
        className="sticky top-[3.25rem] hidden h-[calc(100vh-3.25rem)] w-[216px] shrink-0 self-start overflow-hidden border-r border-white/[0.09] bg-[#000000] lg:block z-20"
      >
        <div className="h-full overflow-y-auto overscroll-contain">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile / Tablet Off-Canvas Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={closeMobile}
          />
          <aside
            id="mobile-macro-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Macro Navigation"
            className="relative z-10 flex h-full w-[216px] max-w-[85vw] flex-col border-r border-white/[0.09] bg-[#000000]"
          >
            <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-4">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#F0F2F5]">
                <Activity className="h-4 w-4 text-[#FFFFFF]" />
                Macro Navigation
              </span>
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close navigation drawer"
                className="rounded p-1 text-[#9299A3] hover:text-[#F0F2F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">{sidebarContent}</div>
          </aside>
        </div>
      )}
    </>
  );
}
