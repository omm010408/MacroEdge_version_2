import { getCreditRiskData } from "@/services/macro-data";
import { CreditRiskView } from "@/components/views/CreditRiskView";

export default async function CreditRiskPage() {
  const data = await getCreditRiskData();

  return <CreditRiskView series={data.series} meta={data.meta} />;
}
