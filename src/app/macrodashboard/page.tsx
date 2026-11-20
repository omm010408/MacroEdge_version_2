import { getMacroOverviewData } from "@/services/macro-data";
import { getDualAiBiasSummary } from "@/services/ai-models/runner";
import { getGoldAndUs30News } from "@/services/marketaux/client";
import { MacroOverviewView } from "@/components/views/MacroOverviewView";

export const dynamic = "force-dynamic";

export default async function MacrodashboardOverviewPage() {
  const [data, dualAiSummary, newsData] = await Promise.all([
    getMacroOverviewData(),
    getDualAiBiasSummary(),
    getGoldAndUs30News(),
  ]);

  return (
    <MacroOverviewView
      cards={data.cards}
      regimeFactors={data.regimeFactors}
      calendarEvents={data.calendarEvents}
      correlationAssets={data.correlationAssets}
      meta={data.meta}
      aiSummary={dualAiSummary.xauusd}
      us30AiSummary={dualAiSummary.us30}
      news={newsData.news}
      newsLastUpdated={newsData.lastUpdated}
    />
  );
}
