import { NextRequest, NextResponse } from "next/server";
import { reconcileStaleTask } from "@/lib/server/runtime-ledger-operator";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const payload = (await request.json().catch(() => ({}))) as {
    note?: unknown;
    operatorIdentity?: unknown;
    operatorSessionId?: unknown;
    operatorSessionStartedAt?: unknown;
  };
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  const operatorIdentity = typeof payload.operatorIdentity === "string" ? payload.operatorIdentity.trim() : "";
  const operatorSessionId = typeof payload.operatorSessionId === "string" ? payload.operatorSessionId.trim() : "";
  const operatorSessionStartedAt = typeof payload.operatorSessionStartedAt === "string" ? payload.operatorSessionStartedAt.trim() : "";

  if (!note) {
    return NextResponse.json(
      {
        ok: false,
        error: "Operator note is required for stale reconciliation.",
      },
      { status: 400 },
    );
  }

  if (!operatorIdentity) {
    return NextResponse.json(
      {
        ok: false,
        error: "Operator-provided identity is required for stale reconciliation.",
      },
      { status: 400 },
    );
  }

  if (note.length > 500) {
    return NextResponse.json(
      {
        ok: false,
        error: "Operator note must be 500 characters or fewer.",
      },
      { status: 400 },
    );
  }

  if (operatorIdentity.length > 120) {
    return NextResponse.json(
      {
        ok: false,
        error: "Operator-provided identity must be 120 characters or fewer.",
      },
      { status: 400 },
    );
  }

  if (operatorSessionId.length > 120) {
    return NextResponse.json(
      {
        ok: false,
        error: "Operator session id must be 120 characters or fewer.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await reconcileStaleTask(taskId, note, operatorIdentity, {
      operatorSessionId: operatorSessionId || null,
      operatorSessionStartedAt: operatorSessionStartedAt || null,
      requestOrigin: request.headers.get("origin"),
      requestReferer: request.headers.get("referer"),
      requestUserAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json(result, {
      status: result.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stale reconciliation failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
