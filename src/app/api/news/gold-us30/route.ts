import { NextRequest, NextResponse } from "next/server";
import { getGoldAndUs30News } from "@/services/marketaux/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const refresh = searchParams.get("refresh") === "1" || searchParams.get("refresh") === "true";
    const rawAsset = (searchParams.get("asset") || "ALL").toUpperCase();
    const asset = rawAsset === "GOLD" ? "GOLD" : rawAsset === "US30" ? "US30" : "ALL";

    const data = await getGoldAndUs30News({
      forceRefresh: refresh,
      targetFilter: asset,
    });

    return NextResponse.json({
      ok: true,
      asset,
      count: data.news.length,
      totalAvailable: data.totalAvailable,
      lastUpdated: data.lastUpdated,
      news: data.news,
    });
  } catch (err) {
    console.error("[api/news/gold-us30] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load Gold and US30 news intelligence.",
      },
      { status: 500 }
    );
  }
}
