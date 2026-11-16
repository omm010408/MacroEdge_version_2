import { getG10IndicatorsData } from "@/services/macro-data";
import { G10View } from "@/components/views/G10View";

export default async function G10IndicatorsPage() {
  const data = await getG10IndicatorsData();

  return <G10View economies={data.economies} meta={data.meta} />;
}
