"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NavIconKey } from "@/config/navigation";

interface SidebarMenuItemProps {
  label: string;
  href: string;
  icon: NavIconKey;
  active: boolean;
  indented?: boolean;
  onNavigate?: () => void;
}

export function SidebarMenuItem({
  label,
  href,
  icon: _icon,
  active,
  indented = false,
  onNavigate,
}: SidebarMenuItemProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-nav-icon={_icon}
      className={cn(
        "group relative flex items-center rounded-md px-2.5 py-1.5 text-[13px] transition-all",
        indented ? "pl-[22px]" : "",
        active
          ? "border border-transparent bg-[#141414] font-semibold text-[#FFFFFF]"
          : "border border-transparent text-[#A3A3A3] hover:text-[#FFFFFF]"
      )}
    >
      <span className="truncate">{label}</span>
    </Link>
  );
}
