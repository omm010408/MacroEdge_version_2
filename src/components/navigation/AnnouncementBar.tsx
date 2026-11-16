"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { useTerminal } from "@/components/providers/TerminalProvider";

export function AnnouncementBar() {
  const pathname = usePathname();
  const { announcementVisible, dismissAnnouncement } = useTerminal();

  if (!announcementVisible || pathname === "/macrodashboard" || pathname === "/") return null;

  return (
    <div className="relative z-40 flex min-h-8 w-full items-center justify-between gap-3 border-b border-[#FFFFFF]/20 bg-gradient-to-r from-[#090B0E] via-[#0E1116] to-[#07090C] px-4 py-1 text-[#F0F2F5]">
      <div className="flex min-w-0 items-center gap-2.5 text-[11.5px]">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[#FFFFFF]/35 bg-[#FFFFFF]/12 px-1.5 py-0.5 font-mono-num text-[9.5px] font-semibold tracking-wider text-[#F0F2F5]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#FFFFFF]" />
          RELEASE 2.4
        </span>
        <span className="truncate font-medium text-[#F0F2F5]">
          MacroEdge Terminal · CFTC COT &amp; US CPI Analytics Pipeline
        </span>
        <span className="hidden truncate text-[#9AA3B0] md:inline">
          — Real-time sync, release tracking &amp; autonomous incident diagnostics
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/macrodashboard/economy/inflation"
          className="inline-flex items-center gap-1 rounded border border-[#FFFFFF]/30 bg-[#FFFFFF]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#F0F2F5] transition hover:border-[#FFFFFF]/50 hover:bg-[#FFFFFF]/20 hover:text-[#F0F2F5]"
        >
          Open Inflation
          <ArrowRight className="h-3 w-3" />
        </Link>
        <button
          type="button"
          onClick={dismissAnnouncement}
          aria-label="Dismiss announcement"
          className="rounded p-1 text-[#9AA3B0] transition hover:bg-white/[0.06] hover:text-[#F0F2F5]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
