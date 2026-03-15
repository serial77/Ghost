import { getSystemHealthPayload } from "@/lib/server/system-health";
import { SystemHealthLive } from "@/components/system-health-live";

export default async function Page() {
  const initialPayload = await getSystemHealthPayload();
  return <SystemHealthLive initialPayload={initialPayload} />;
}
