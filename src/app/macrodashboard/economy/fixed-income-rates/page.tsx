import { getFixedIncomeRatesData } from "@/services/macro-data";
import { FixedIncomeView } from "@/components/views/FixedIncomeView";

export default async function FixedIncomeRatesPage() {
  const data = await getFixedIncomeRatesData();

  return (
    <FixedIncomeView
      curve={data.curve}
      history={data.history}
      auctions={data.auctions}
      meta={data.meta}
    />
  );
}
