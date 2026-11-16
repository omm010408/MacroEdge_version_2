import { getDailyCheckDashboardData } from "@/services/macro-data";
import { DailyCheckView } from "@/components/views/DailyCheckView";

export default async function DailyCheckPage() {
  const data = await getDailyCheckDashboardData();

  return (
    <DailyCheckView
      lenses={data.lenses}
      calendarEvents={data.calendarEvents}
      defaultEntries={data.defaultEntries}
      meta={data.meta}
    />
  );
}
