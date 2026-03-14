import { getAgentRegistryPayload } from "@/lib/server/agent-registry";
import { AgentRegistryLive } from "@/components/agent-registry-live";

export default async function Page() {
  const payload = await getAgentRegistryPayload();
  return <AgentRegistryLive initialPayload={payload} />;
}
