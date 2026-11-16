"use client";

import { isRouteActive, type SidebarCategoryGroup } from "@/config/navigation";
import { SidebarMenuItem } from "@/components/sidebar/SidebarMenuItem";
import { cn } from "@/lib/utils";

interface SidebarCategoryProps {
  group: SidebarCategoryGroup;
  pathname: string;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export function SidebarCategory({
  group,
  pathname,
  isExpanded,
  onToggle,
  onNavigate,
}: SidebarCategoryProps) {
  if (group.href && !group.items) {
    return (
      <SidebarMenuItem
        label={group.label}
        href={group.href}
        icon={group.icon}
        active={isRouteActive(pathname, group.href)}
        onNavigate={onNavigate}
      />
    );
  }

  const hasActiveChild =
    group.items?.some((item) => isRouteActive(pathname, item.href)) ?? false;

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
          hasActiveChild
            ? "text-[#FFFFFF]"
            : "text-[#A3A3A3] hover:text-[#FFFFFF]"
        )}
      >
        <span>{group.label}</span>
        <span className="font-mono-num text-[14px] text-[#6B6B6B]">
          {isExpanded ? "−" : "+"}
        </span>
      </button>

      {isExpanded && group.items && (
        <div className="space-y-0.5">
          {group.items.map((child) => (
            <SidebarMenuItem
              key={child.id}
              label={child.label}
              href={child.href}
              icon={child.icon}
              active={isRouteActive(pathname, child.href)}
              indented
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
