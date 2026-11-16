import { getLiveComparatorUniverse } from "@/services/macro-data";
import { ComparatorView } from "@/components/views/ComparatorView";

export default async function ComparatorPage() {
  const universe = await getLiveComparatorUniverse();
  return <ComparatorView universe={universe} />;
}
