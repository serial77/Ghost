import { TaskBoardWorkspaceLive } from "@/components/task-board-workspace-live";
import { getTaskBoardWorkspacePayload } from "@/lib/server/task-board-workspace";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const payload = await getTaskBoardWorkspacePayload(itemId);

  return <TaskBoardWorkspaceLive initialPayload={payload} />;
}
