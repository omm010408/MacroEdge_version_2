import { getCorrelationMatrixData } from "@/services/macro-data";
import { CorrelationMatrixView } from "@/components/views/CorrelationMatrixView";

export default async function CorrelationMatrixPage() {
  const data = await getCorrelationMatrixData();

  return <CorrelationMatrixView assets={data.assets} meta={data.meta} />;
}
