import { NextResponse } from "next/server";
import { resolveApproval } from "@/lib/server/approval-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const { approvalId } = await params;
    const body = await request.json().catch(() => ({}));
    const outcome = String(body.outcome ?? "").trim();
    const resolvedBy = String(body.resolved_by ?? "operator-ui").trim();
    const responseText = String(body.response_text ?? "").trim();

    if (outcome !== "approved" && outcome !== "rejected") {
      return NextResponse.json(
        { error: "outcome must be 'approved' or 'rejected'" },
        { status: 400 },
      );
    }

    const result = await resolveApproval({
      approvalQueueId: approvalId,
      outcome,
      resolvedBy,
      responseText,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resolve failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
