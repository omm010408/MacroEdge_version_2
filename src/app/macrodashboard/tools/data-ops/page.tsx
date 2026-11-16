import { getSyncSystemSnapshot } from "@/services/sync/store";
import { DataOpsView } from "@/components/views/DataOpsView";

export const dynamic = "force-dynamic";

export default async function DataOperationsPage() {
  const snapshot = await getSyncSystemSnapshot();

  return <DataOpsView initialSnapshot={snapshot} />;
}
