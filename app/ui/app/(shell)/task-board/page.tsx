import { TaskBoardLive } from "@/components/task-board-live";
import { getTaskBoardPayload } from "@/lib/server/task-board";

export const dynamic = "force-dynamic";

export default async function Page() {
  const payload = await getTaskBoardPayload();
  return <TaskBoardLive initialPayload={payload} />;
}
