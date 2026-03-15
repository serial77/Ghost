import { NextResponse } from "next/server";
import { getApprovalEnrichment } from "@/lib/server/approval-workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  try {
    const payload = await getApprovalEnrichment(approvalId);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval enrichment failed.";
    return NextResponse.json(
      { approvalId, delegationRequestSummary: null, actionEvents: [], followThrough: null, errors: [message] },
      { status: 500 },
    );
  }
}
