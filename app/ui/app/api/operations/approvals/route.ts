import { NextResponse } from "next/server";
import { getApprovalQueuePayload } from "@/lib/server/approval-queue";

export async function GET() {
  try {
    const payload = await getApprovalQueuePayload();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval queue query failed.";
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), approvals: [], degraded: true, errors: [message] },
      { status: 500 },
    );
  }
}
