import { NextRequest, NextResponse } from "next/server";
import { getTaskDetailPayload } from "@/lib/server/task-detail";

function parseLimit(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { searchParams } = new URL(request.url);

  try {
    const payload = await getTaskDetailPayload(taskId, {
      eventLimit: parseLimit(searchParams.get("limit")),
      before: searchParams.get("before"),
    });

    return NextResponse.json(payload, {
      status: payload.task ? 200 : 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task detail request failed.";
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        task: null,
        runs: [],
        activity: [],
        transitions: [],
        diffs: [],
        attentionHints: [],
        operatorSession: null,
        eventPage: {
          limit: 30,
          hasMore: false,
          nextBefore: null,
        },
        degraded: true,
        errors: [message],
      },
      { status: 500 },
    );
  }
}
