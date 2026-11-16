import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketStatusBadge } from "@/components/cards/MarketStatusBadge";

const PARTNERS = [
  {
    name: "FRED Federal Reserve Data",
    category: "Economic Series",
    status: "Integrated",
    tone: "bullish" as const,
    spec: "Server-side API connector · DGS10, DFII10, FEDFUNDS, BAMLH0A0HYM2",
    href: "/macrodashboard/economy/fixed-income-rates",
  },
  {
    name: "CFTC Public Reporting",
    category: "Futures Positioning",
    status: "Integrated",
    tone: "bullish" as const,
    spec: "Weekly Tuesday close COT legacy & disaggregated contracts",
    href: "/macrodashboard/positioning/commitments-of-traders",
  },
  {
    name: "BLS & BEA Official Releases",
    category: "Inflation & GDP",
    status: "Integrated",
    tone: "bullish" as const,
    spec: "CPI, Core CPI, PPI, NFP, PCE, and NIPA GDP tables",
    href: "/macrodashboard/economy/inflation",
  },
  {
    name: "US Treasury Fiscal Data",
    category: "Auctions & Curve",
    status: "Integrated",
    tone: "bullish" as const,
    spec: "Auction bid-to-cover, tail bps, indirect share & daily par curve",
    href: "/macrodashboard/liquidity/primary-dealer-stats",
  },
  {
    name: "Supabase Cloud Auth",
    category: "User Persistence",
    status: "Env Ready",
    tone: "neutral" as const,
    spec: "PostgreSQL RLS for watchlists, daily checks & terminal preferences",
    href: "/macrodashboard/tools/watch-list",
  },
  {
    name: "CME / ICE Market Bridge",
    category: "Real-Time Feed",
    status: "Optional Key",
    tone: "mixed" as const,
    spec: "Upgrade delayed reference benchmarks to live streaming quotes",
    href: "/macrodashboard",
  },
];

export default function PartnerOffersPage() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="border-b border-white/[0.08] pb-4">
        <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#FFFFFF]">
          Data Providers &amp; Terminal Integrations
        </span>
        <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-[#F0F2F5]">
          Partner Offers &amp; Data Feeds
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PARTNERS.map((partner) => (
          <div
            key={partner.name}
            className="flex flex-col justify-between rounded-lg border border-white/[0.09] bg-[#0B0D10] p-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-num text-[10.5px] uppercase tracking-wider text-[#9299A3]">
                  {partner.category}
                </span>
                <MarketStatusBadge label={partner.status} tone={partner.tone} />
              </div>
              <h2 className="mt-2 text-[14.5px] font-semibold text-[#F0F2F5]">
                {partner.name}
              </h2>
              <div className="mt-2 font-mono-num text-[11.5px] text-[#9299A3]">
                {partner.spec}
              </div>
            </div>

            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <Link
                href={partner.href}
                className="inline-flex items-center gap-1 font-mono-num text-[11.5px] text-[#FFFFFF] hover:underline"
              >
                Inspect Connected Module
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
