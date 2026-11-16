import { getEconomyLaborData } from "@/services/macro-data";
import { EconomyLaborView } from "@/components/views/EconomyLaborView";

export default async function EconomyLaborPage() {
  const data = await getEconomyLaborData();

  return <EconomyLaborView series={data.series} meta={data.meta} />;
}
