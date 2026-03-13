import { NextResponse } from "next/server";
import { getTaskBoardWorkspacePayload } from "@/lib/server/task-board-workspace";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await context.params;
    const payload = await getTaskBoardWorkspacePayload(itemId);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task board workspace query failed.";
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        item: null,
        activity: [],
        runtimeActivity: [],
        runtimeSummary: null,
        controls: {
          editable: false,
          stageOptions: [],
          agentOptions: [],
        },
        degraded: true,
        errors: [message],
      },
      { status: 500 },
    );
  }
}
