import { TaskOverviewLive } from "@/components/task-overview-live";
import { getTaskOverviewPayload } from "@/lib/server/task-overview";

export default async function Page() {
  const payload = await getTaskOverviewPayload();
  return <TaskOverviewLive initialPayload={payload} />;
}
