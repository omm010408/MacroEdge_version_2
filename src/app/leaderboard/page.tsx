"use client";

import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/tables/DataTable";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";
import { TimeframeSelector } from "@/components/dashboard/FilterControls";

interface AnalystRankRow {
  rank: number;
  analyst: string;
  tier: string;
  specialty: string;
  accuracyPct: number;
  streakDays: number;
  points: number;
}

const LEADERS: AnalystRankRow[] = [
  { rank: 1, analyst: "M. Lindqvist", tier: "Tier IV · MD", specialty: "G10 Rates", accuracyPct: 78.4, streakDays: 94, points: 5420 },
  { rank: 2, analyst: "K. Takahashi", tier: "Tier III · Senior", specialty: "FX & BoJ", accuracyPct: 74.9, streakDays: 68, points: 4310 },
  { rank: 3, analyst: "S. Okafor", tier: "Tier III · Senior", specialty: "Inflation / TIPS", accuracyPct: 72.1, streakDays: 52, points: 3680 },
  { rank: 4, analyst: "R. Chen", tier: "Tier II · Associate", specialty: "Fed Liquidity", accuracyPct: 69.5, streakDays: 39, points: 2390 },
  { rank: 5, analyst: "A. Vance", tier: "Tier I · Analyst", specialty: "Macro Regime", accuracyPct: 66.8, streakDays: 14, points: 1640 },
  { rank: 6, analyst: "E. Moreau", tier: "Tier II · Associate", specialty: "Credit OAS", accuracyPct: 65.2, streakDays: 24, points: 1510 },
];

export default function LeaderboardPage() {
  const [specialty, setSpecialty] = useState<string>("ALL");
  const rows =
    specialty === "ALL"
      ? LEADERS
      : LEADERS.filter((l) => l.specialty.toLowerCase().includes(specialty.toLowerCase()));

  const columns: DataColumn<AnalystRankRow>[] = [
    {
      key: "rank",
      header: "#",
      sortValue: (r) => r.rank,
      render: (r) => <span className="font-mono-num font-semibold text-[#FFFFFF]">#{r.rank}</span>,
    },
    {
      key: "analyst",
      header: "Analyst",
      sortValue: (r) => r.analyst,
      render: (r) => <span className="font-medium text-[#F0F2F5]">{r.analyst}</span>,
    },
    {
      key: "tier",
      header: "Rank Tier",
      render: (r) => <MarketStatusBadge label={r.tier} tone="neutral" />,
    },
    {
      key: "specialty",
      header: "Desk Focus",
      render: (r) => <span className="font-mono-num text-[12px] text-[#9299A3]">{r.specialty}</span>,
    },
    {
      key: "accuracy",
      header: "Regime Hit %",
      align: "right",
      sortValue: (r) => r.accuracyPct,
      render: (r) => <span className="font-mono-num text-[#00C985]">{r.accuracyPct.toFixed(1)}%</span>,
    },
    {
      key: "streak",
      header: "Daily Streak",
      align: "right",
      sortValue: (r) => r.streakDays,
      render: (r) => <span className="font-mono-num">{r.streakDays}D</span>,
    },
    {
      key: "points",
      header: "Score",
      align: "right",
      sortValue: (r) => r.points,
      render: (r) => <span className="font-mono-num font-semibold text-[#F0F2F5]">{r.points.toLocaleString()}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div>
          <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#FFFFFF]">
            Research Rankings
          </span>
          <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#F0F2F5]">
            Global Desk Leaderboard
          </h1>
        </div>
        <TimeframeSelector
          options={["ALL", "Rates", "Inflation", "FX", "Liquidity"] as const}
          value={specialty}
          onChange={setSpecialty}
        />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.rank)}
        defaultSortKey="points"
        defaultSortDir="desc"
      />
    </div>
  );
}
