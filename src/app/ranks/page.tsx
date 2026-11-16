import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";

const TIERS = [
  {
    tier: "Tier I · Analyst",
    pointsReq: "0 – 999 pts",
    streakReq: "7D Daily Check",
    status: "Active Tier",
    tone: "bullish" as const,
    perks: ["Full Macrodashboard Access", "Custom Watchlist Sync", "Daily Check History"],
  },
  {
    tier: "Tier II · Associate",
    pointsReq: "1,000 – 2,499 pts",
    streakReq: "21D Daily Check",
    status: "64% Progress",
    tone: "neutral" as const,
    perks: ["COT Extreme Alerts", "G10 Differential Matrix", "Comparator Exports"],
  },
  {
    tier: "Tier III · Senior Macro",
    pointsReq: "2,500 – 4,999 pts",
    streakReq: "45D Daily Check",
    status: "Locked",
    tone: "mixed" as const,
    perks: ["Verified Desk Calls", "Cross-Asset Backtest Templates", "Leaderboard Badge"],
  },
  {
    tier: "Tier IV · Managing Director",
    pointsReq: "5,000+ pts",
    streakReq: "90D Daily Check",
    status: "Locked",
    tone: "mixed" as const,
    perks: ["Institutional Roundtable", "API Webhook Quota", "Custom Regime Models"],
  },
];

export default function RanksPage() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div>
          <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#FFFFFF]">
            Desk Progression
          </span>
          <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#F0F2F5]">
            Analyst Ranks &amp; Credentials
          </h1>
        </div>
        <div className="rounded-md border border-white/[0.09] bg-[#0B0D10] px-3 py-1.5 font-mono-num text-[12px] text-[#F0F2F5]">
          Current Score: 1,640 pts · 14D Streak
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TIERS.map((item) => (
          <div
            key={item.tier}
            className="flex flex-col justify-between rounded-lg border border-white/[0.09] bg-[#0B0D10] p-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#F0F2F5]">{item.tier}</span>
                <MarketStatusBadge label={item.status} tone={item.tone} />
              </div>
              <div className="mt-2 font-mono-num text-[12px] text-[#FFFFFF]">
                {item.pointsReq}
              </div>
              <div className="mt-0.5 font-mono-num text-[11px] text-[#555D68]">
                Req: {item.streakReq}
              </div>

              <ul className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3 text-[12px] text-[#9299A3]">
                {item.perks.map((p) => (
                  <li key={p} className="font-mono-num text-[11.5px]">
                    · {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
