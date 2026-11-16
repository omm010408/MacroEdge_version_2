import { getPrimaryDealerData } from "@/services/macro-data";
import { PrimaryDealerView } from "@/components/views/PrimaryDealerView";

export default async function PrimaryDealerStatsPage() {
  const data = await getPrimaryDealerData();

  return (
    <PrimaryDealerView
      buckets={data.buckets}
      auctions={data.auctions}
      liquiditySeries={data.liquiditySeries}
      meta={data.meta}
    />
  );
}
