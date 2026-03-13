import { TaskDetailLive } from "@/components/task-detail-live";
import { getTaskDetailPayload } from "@/lib/server/task-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const payload = await getTaskDetailPayload(taskId);

  return <TaskDetailLive initialPayload={payload} />;
}
