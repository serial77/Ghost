import { getPool } from "@/lib/server/postgres";

export interface ApprovalQueueItem {
  approvalId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "superseded";
  approvalType: string;
  promptText: string;
  requestedAt: string;
  respondedAt: string | null;
  responseText: string | null;
  conversationId: string | null;
  delegationId: string | null;
  orchestrationTaskId: string | null;
  runtimeTaskId: string | null;
  n8nExecutionId: string | null;
  responseMod: string | null;
  governanceEnvironment: string | null;
  requestedCapabilities: string[];
  outcomeStatus: string | null;
  resolvedBy: string | null;
  sourcePath: string | null;
}

export interface ApprovalQueuePayload {
  generatedAt: string;
  approvals: ApprovalQueueItem[];
  counts: {
    pending: number;
    resolved: number;
    total: number;
  };
  degraded: boolean;
  errors: string[];
}

export interface ResolveApprovalResult {
  approvalQueueId: string;
  previousState: string;
  resolvedState: string;
  respondedAt: string;
  responseText: string;
  outcomeStatus: string;
}

interface ApprovalRow {
  approval_id: string;
  status: string;
  approval_type: string;
  prompt_text: string;
  requested_at: string;
  responded_at: string | null;
  response_text: string | null;
  conversation_id: string | null;
  delegation_id: string | null;
  orchestration_task_id: string | null;
  runtime_task_id: string | null;
  n8n_execution_id: string | null;
  response_mode: string | null;
  governance_environment: string | null;
  requested_capabilities: string | null;
  outcome_status: string | null;
  resolved_by: string | null;
  source_path: string | null;
}

export async function getApprovalQueuePayload(): Promise<ApprovalQueuePayload> {
  const pool = getPool("app");
  const generatedAt = new Date().toISOString();

  const result = await pool.query<ApprovalRow>(`
    SELECT
      id::text AS approval_id,
      status,
      approval_type,
      prompt_text,
      requested_at::text,
      responded_at::text,
      response_text,
      metadata->>'conversation_id' AS conversation_id,
      metadata->>'delegation_id' AS delegation_id,
      metadata->>'orchestration_task_id' AS orchestration_task_id,
      metadata->>'runtime_task_id' AS runtime_task_id,
      metadata->>'n8n_execution_id' AS n8n_execution_id,
      metadata->>'response_mode' AS response_mode,
      metadata->>'governance_environment' AS governance_environment,
      metadata->>'requested_capabilities' AS requested_capabilities,
      (metadata->'governed_outcome'->>'outcome_status') AS outcome_status,
      (metadata->'governed_outcome'->>'resolved_by') AS resolved_by,
      metadata->>'source_path' AS source_path
    FROM approvals
    ORDER BY requested_at DESC
    LIMIT 100
  `);

  const approvals: ApprovalQueueItem[] = result.rows.map((row) => ({
    approvalId: row.approval_id,
    status: row.status as ApprovalQueueItem["status"],
    approvalType: row.approval_type,
    promptText: row.prompt_text,
    requestedAt: row.requested_at,
    respondedAt: row.responded_at,
    responseText: row.response_text,
    conversationId: row.conversation_id,
    delegationId: row.delegation_id,
    orchestrationTaskId: row.orchestration_task_id,
    runtimeTaskId: row.runtime_task_id,
    n8nExecutionId: row.n8n_execution_id,
    responseMod: row.response_mode,
    governanceEnvironment: row.governance_environment,
    requestedCapabilities: row.requested_capabilities
      ? JSON.parse(row.requested_capabilities).filter((c: unknown) => typeof c === "string")
      : [],
    outcomeStatus: row.outcome_status,
    resolvedBy: row.resolved_by,
    sourcePath: row.source_path,
  }));

  const pending = approvals.filter((a) => a.status === "pending").length;

  return {
    generatedAt,
    approvals,
    counts: {
      pending,
      resolved: approvals.length - pending,
      total: approvals.length,
    },
    degraded: false,
    errors: [],
  };
}

export async function resolveApproval(params: {
  approvalQueueId: string;
  outcome: "approved" | "rejected";
  resolvedBy: string;
  responseText: string;
}): Promise<ResolveApprovalResult> {
  const { approvalQueueId, outcome, resolvedBy, responseText } = params;
  const pool = getPool("app");

  // Load current approval
  const current = await pool.query<{ status: string }>(
    `SELECT status FROM approvals WHERE id = $1::uuid LIMIT 1`,
    [approvalQueueId],
  );

  if (current.rows.length === 0) {
    throw new Error(`approval not found: ${approvalQueueId}`);
  }

  const previousState = current.rows[0].status;
  if (previousState !== "pending") {
    throw new Error(`approval is not pending (current state: ${previousState})`);
  }

  const resolvedState = outcome === "approved" ? "approved" : "rejected";
  const outcomeStatus = outcome === "approved" ? "allowed" : "denied";
  const respondedAt = new Date().toISOString();

  const governedOutcome = {
    resolved_at: respondedAt,
    resolved_by: resolvedBy,
    outcome_status: outcomeStatus,
    resolution_state: resolvedState,
    approval_queue_id: approvalQueueId,
    resolved_via: "operator-ui",
  };

  await pool.query(
    `UPDATE approvals
     SET status = $1,
         response_text = $2,
         responded_at = NOW(),
         metadata = metadata ||
           jsonb_build_object(
             'governed_outcome', $3::jsonb,
             'outcome_status', $4::text
           )
     WHERE id = $5::uuid AND status = 'pending'`,
    [resolvedState, responseText || null, JSON.stringify(governedOutcome), outcomeStatus, approvalQueueId],
  );

  return {
    approvalQueueId,
    previousState,
    resolvedState,
    respondedAt,
    responseText: responseText || "",
    outcomeStatus,
  };
}
