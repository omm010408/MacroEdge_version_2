import { getCotDashboardData } from "@/services/macro-data";
import { CotView } from "@/components/views/CotView";

export default async function CommitmentsOfTradersPage() {
  const data = await getCotDashboardData();

  return (
    <CotView
      instruments={data.instruments}
      reportDate={data.reportDate}
      releaseDate={data.releaseDate}
      meta={data.meta}
    />
  );
}
