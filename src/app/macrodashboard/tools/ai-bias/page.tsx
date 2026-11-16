import { AiBiasEngineView } from "@/components/views/AiBiasEngineView";
import { getLatestAiModelsSnapshot } from "@/services/ai-models/runner";

export const dynamic = "force-dynamic";

export default async function AiBiasPage() {
  const snapshot = await getLatestAiModelsSnapshot();
  return <AiBiasEngineView initialSnapshot={snapshot} />;
}
