import { getMonetaryPolicyData } from "@/services/macro-data";
import { MonetaryPolicyView } from "@/components/views/MonetaryPolicyView";

export default async function MonetaryPolicyPage() {
  const data = await getMonetaryPolicyData();

  return (
    <MonetaryPolicyView
      centralBanks={data.centralBanks}
      fomcHistory={data.fomcHistory}
      liquiditySeries={data.liquiditySeries}
      meta={data.meta}
    />
  );
}
