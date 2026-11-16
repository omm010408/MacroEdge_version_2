import { getInternationalData } from "@/services/macro-data";
import { InternationalView } from "@/components/views/InternationalView";

export default async function InternationalPage() {
  const data = await getInternationalData();

  return (
    <InternationalView
      economies={data.economies}
      usReference={data.usReference}
      meta={data.meta}
    />
  );
}
