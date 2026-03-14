import { NextResponse } from "next/server";
import { getTaskContextPayload } from "@/lib/server/task-context";

export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    const payload = await getTaskContextPayload(taskId);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task context query failed.";
    return NextResponse.json(
      { taskId, delegations: [], approvals: [], governanceEvents: [], errors: [message] },
      { status: 500 },
    );
  }
}
