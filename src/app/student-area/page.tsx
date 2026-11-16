"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";

interface CurriculumModule {
  id: string;
  code: string;
  title: string;
  track: "Rates" | "Inflation" | "Positioning" | "Liquidity";
  duration: string;
  terminalHref: string;
  completed: boolean;
}

const STORAGE_KEY = "macroedge.student_modules.v1";

const INITIAL_MODULES: CurriculumModule[] = [
  { id: "m1", code: "MOD-01", title: "CPI vs Core PCE & Fed Reaction Functions", track: "Inflation", duration: "25m", terminalHref: "/macrodashboard/economy/inflation", completed: true },
  { id: "m2", code: "MOD-02", title: "CFTC COT Extremes & Commercial Hedger Flow", track: "Positioning", duration: "30m", terminalHref: "/macrodashboard/positioning/commitments-of-traders", completed: true },
  { id: "m3", code: "MOD-03", title: "2s10s Bear Steepening & ACM Term Premium", track: "Rates", duration: "35m", terminalHref: "/macrodashboard/economy/fixed-income-rates", completed: true },
  { id: "m4", code: "MOD-04", title: "Net Liquidity: WALCL, TGA & ON RRP Mechanics", track: "Liquidity", duration: "40m", terminalHref: "/macrodashboard/liquidity/primary-dealer-stats", completed: false },
  { id: "m5", code: "MOD-05", title: "OIS Implied Rate Curves & G10 Differentials", track: "Rates", duration: "30m", terminalHref: "/macrodashboard/liquidity/monetary-policy", completed: false },
  { id: "m6", code: "MOD-06", title: "Cross-Asset Correlation Regime Shifts", track: "Positioning", duration: "20m", terminalHref: "/macrodashboard/positioning/correlation-matrix", completed: false },
];

export default function StudentAreaPage() {
  const [modules, setModules] = useState(INITIAL_MODULES);
  const [track, setTrack] = useState<string>("ALL");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const doneIds = new Set(JSON.parse(raw) as string[]);
        setModules(INITIAL_MODULES.map((m) => ({ ...m, completed: doneIds.has(m.id) })));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  function toggleComplete(id: string) {
    setModules((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, completed: !m.completed } : m));
      try {
        const doneIds = next.filter((m) => m.completed).map((m) => m.id);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doneIds));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  const completedCount = modules.filter((m) => m.completed).length;
  const pct = Math.round((completedCount / modules.length) * 100);
  const visible = track === "ALL" ? modules : modules.filter((m) => m.track === track);

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
        <div>
          <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#FFFFFF]">
            Institutional Frameworks
          </span>
          <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#F0F2F5]">
            Student Area
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-white/[0.09] bg-[#0B0D10] px-3 py-1.5 font-mono-num text-[12px]">
            Progress: <span className="font-semibold text-[#00C985]">{pct}%</span> ({completedCount}/{modules.length})
          </div>
        </div>
      </div>

      {/* Track Filters */}
      <div className="flex flex-wrap gap-1.5">
        {["ALL", "Inflation", "Rates", "Positioning", "Liquidity"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTrack(t)}
            className={cn(
              "rounded-md border px-3 py-1.5 font-mono-num text-[11.5px] transition",
              track === t
                ? "border-[#FFFFFF]/45 bg-[#FFFFFF]/12 text-[#FFFFFF]"
                : "border-white/[0.09] bg-[#0B0D10] text-[#9299A3] hover:text-[#F0F2F5]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((mod) => (
          <div
            key={mod.id}
            className="flex flex-col justify-between rounded-lg border border-white/[0.09] bg-[#0B0D10] p-4"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono-num text-[11px] font-semibold text-[#FFFFFF]">
                  {mod.code}
                </span>
                <MarketStatusBadge label={mod.track} tone="neutral" />
              </div>
              <h2 className="mt-2.5 text-[14px] font-semibold text-[#F0F2F5]">
                {mod.title}
              </h2>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
              <button
                type="button"
                onClick={() => toggleComplete(mod.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 font-mono-num text-[11.5px]",
                  mod.completed ? "text-[#00C985]" : "text-[#9299A3] hover:text-[#F0F2F5]"
                )}
              >
                {mod.completed ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                {mod.completed ? "Completed" : `Mark Done · ${mod.duration}`}
              </button>

              <Link
                href={mod.terminalHref}
                className="inline-flex items-center gap-1 font-mono-num text-[11px] text-[#FFFFFF] hover:underline"
              >
                Open Lab
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
