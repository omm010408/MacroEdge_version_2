import { getInflationDashboardData } from "@/services/macro-data";
import { InflationView } from "@/components/views/InflationView";

export default async function InflationPage() {
  const data = await getInflationDashboardData();

  return (
    <InflationView
      topMetrics={data.topMetrics}
      components={data.components}
      history={data.history}
      meta={data.meta}
    />
  );
}
