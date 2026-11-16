import { IncidentDashboardView } from "@/components/views/IncidentDashboardView";
import { getIncidentDashboardSnapshot } from "@/services/incidents/store";

export const dynamic = "force-dynamic";

export default async function IncidentResponsePage() {
  const snapshot = await getIncidentDashboardSnapshot();
  return <IncidentDashboardView initialSnapshot={snapshot} />;
}
