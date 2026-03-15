import { getApprovalQueuePayload } from "@/lib/server/approval-queue";
import { getGovernanceAuditTrail } from "@/lib/server/approval-workspace";
import { ApprovalsLive } from "@/components/approvals-live";

export default async function Page() {
  const [payload, audit] = await Promise.all([
    getApprovalQueuePayload(),
    getGovernanceAuditTrail(),
  ]);
  return <ApprovalsLive initialPayload={payload} initialAudit={audit} />;
}
