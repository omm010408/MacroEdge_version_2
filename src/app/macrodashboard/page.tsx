import { getMacroOverviewData } from "@/services/macro-data";
import { getLatestAiBiasSummary } from "@/services/ai-models/runner";
import { getGoldAndUs30News } from "@/services/marketaux/client";
import { MacroOverviewView } from "@/components/views/MacroOverviewView";

export const dynamic = "force-dynamic";

export default async function MacrodashboardOverviewPage() {
  const [data, aiSummary, newsData] = await Promise.all([
    getMacroOverviewData(),
    getLatestAiBiasSummary(),
    getGoldAndUs30News(),
  ]);

  return (
    <MacroOverviewView
      cards={data.cards}
      regimeFactors={data.regimeFactors}
      calendarEvents={data.calendarEvents}
      correlationAssets={data.correlationAssets}
      meta={data.meta}
      aiSummary={aiSummary}
      news={newsData.news}
      newsLastUpdated={newsData.lastUpdated}
    />
  );
}
