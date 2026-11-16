import type { DatasetMeta, FeedMode, TreasuryAuctionRow } from "@/lib/types";
import { fetchProviderJsonWithRetry } from "@/services/sync/workers/rest-adapters";

export interface TreasuryAuctionDataset {
  auctions: TreasuryAuctionRow[];
  meta: DatasetMeta;
}

const FISCAL_DATA_AUCTIONS_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";

interface FiscalAuctionRawRow {
  record_date?: string;
  issue_date?: string;
  security_term?: string;
  security_type?: string;
  offering_amt?: string;
  total_accepted?: string;
  high_yield?: string;
  bid_to_cover_ratio?: string;
  indirect_bidder_accepted?: string;
}

interface FiscalAuctionPayload {
  data?: FiscalAuctionRawRow[];
}

function buildEmptyDataset(mode: FeedMode): TreasuryAuctionDataset {
  return {
    auctions: [],
    meta: {
      source: "US Treasury · Fiscal Data",
      seriesId: "UST-AUCTIONS",
      observationDate: "—",
      lastUpdated: new Date().toISOString(),
      frequency: "DAILY",
      units: "% / Ratio",
      mode,
    },
  };
}

/**
 * Fetches live US Treasury auction clears from Fiscal Data `auctions_query`
 * when `ENABLE_PUBLIC_TREASURY_LIVE === "true"`. Never returns synthetic rows.
 */
export async function fetchTreasuryAuctions(): Promise<TreasuryAuctionDataset> {
  if (typeof window !== "undefined") {
    return buildEmptyDataset("UNCONFIGURED");
  }

  const enabled = process.env.ENABLE_PUBLIC_TREASURY_LIVE?.trim() === "true";
  if (!enabled) {
    return buildEmptyDataset("UNCONFIGURED");
  }

  const url = `${FISCAL_DATA_AUCTIONS_URL}?filter=security_type:in:(Note,Bond)&sort=-record_date&page[size]=12`;
  const res = await fetchProviderJsonWithRetry<FiscalAuctionPayload>(
    "us_treasury",
    url,
    { cache: "no-store" },
    { timeoutMs: 6000 }
  );

  if (!res.ok || !res.data || !Array.isArray(res.data.data)) {
    return buildEmptyDataset("AWAITING_SYNC");
  }

  const auctions: TreasuryAuctionRow[] = [];
  for (const row of res.data.data) {
    const date = (row.record_date ?? row.issue_date ?? "").slice(0, 10);
    const highYield = Number(row.high_yield);
    const bidToCover = Number(row.bid_to_cover_ratio);
    const totalAccepted = Number(row.total_accepted ?? row.offering_amt);
    const indirectAccepted = Number(row.indirect_bidder_accepted);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(highYield) ||
      !Number.isFinite(bidToCover) ||
      !Number.isFinite(totalAccepted) ||
      totalAccepted <= 0
    ) {
      continue;
    }

    const indirectPct =
      Number.isFinite(indirectAccepted) && totalAccepted > 0
        ? Number(((indirectAccepted / totalAccepted) * 100).toFixed(1))
        : 0;
    const tenor = `${row.security_term ?? ""} ${row.security_type ?? ""}`.trim() || "UST";

    auctions.push({
      date,
      tenor,
      sizeBn: Number((totalAccepted / 1_000_000_000).toFixed(1)),
      highYield: Number(highYield.toFixed(3)),
      tailBps: 0,
      bidToCover: Number(bidToCover.toFixed(2)),
      indirectPct,
    });
  }

  if (auctions.length === 0) {
    return buildEmptyDataset("AWAITING_SYNC");
  }

  const latestAuctionDate = auctions[0].date;
  return {
    auctions,
    meta: {
      source: "US Treasury · Fiscal Data",
      seriesId: "UST-AUCTIONS",
      observationDate: latestAuctionDate,
      releaseDate: latestAuctionDate,
      lastUpdated: new Date().toISOString(),
      frequency: "DAILY",
      units: "% / Ratio",
      mode: "LIVE_API",
    },
  };
}
