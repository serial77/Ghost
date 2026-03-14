import { getPool } from "@/lib/server/postgres";

// ---- Types ----

export interface TaskDelegation {
  delegationId: string;
  requestSummary: string | null;
  status: string | null;
  workerProvider: string | null;
  workerModel: string | null;
  workerAgentKey: string | null;
  workerDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskApproval {
  approvalId: string;
  status: string;
  approvalType: string;
  requestedAt: string;
  respondedAt: string | null;
  requestedCapabilities: string[];
  governanceEnvironment: string | null;
  outcomeStatus: string | null;
  resolvedBy: string | null;
}

export interface TaskGovernanceEvent {
  actionId: string;
  eventType: string;
  entity: string;
  summary: string;
  outcomeStatus: string | null;
  occurredAt: string;
  sourceSurface: string;
  approvalId: string | null;
}

export interface TaskContextPayload {
  taskId: string;
  delegations: TaskDelegation[];
  approvals: TaskApproval[];
  governanceEvents: TaskGovernanceEvent[];
  errors: string[];
}

// ---- DB row types ----

interface DelegationRow {
  delegation_id: string;
  request_summary: string | null;
  status: string | null;
  worker_provider: string | null;
  worker_model: string | null;
  worker_agent_key: string | null;
  worker_display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface ApprovalRow {
  approval_id: string;
  status: string;
  approval_type: string;
  requested_at: string;
  responded_at: string | null;
  requested_capabilities: string | null;
  governance_environment: string | null;
  outcome_status: string | null;
  resolved_by: string | null;
}

interface GovEventRow {
  action_id: string;
  event_type: string;
  entity: string;
  summary: string;
  outcome_status: string | null;
  occurred_at: string;
  source_surface: string;
  approval_id: string | null;
}

// ---- Main function ----

export async function getTaskContextPayload(taskId: string): Promise<TaskContextPayload> {
  const errors: string[] = [];
  let delegations: TaskDelegation[] = [];
  let approvals: TaskApproval[] = [];
  let governanceEvents: TaskGovernanceEvent[] = [];

  const pool = getPool("app");

  // Delegations linked by runtime_task_id (UUID column in conversation_delegations)
  try {
    const rows = await pool.query<DelegationRow>(
      `SELECT
         cd.id::text        AS delegation_id,
         cd.request_summary,
         cd.status,
         cd.worker_provider,
         cd.worker_model,
         cd.created_at::text,
         cd.updated_at::text,
         ag.agent_key       AS worker_agent_key,
         ag.display_name    AS worker_display_name
       FROM conversation_delegations cd
       LEFT JOIN agents ag ON ag.id = cd.worker_agent_id
       WHERE cd.runtime_task_id = $1::uuid
       ORDER BY cd.created_at DESC
       LIMIT 5`,
      [taskId],
    );
    delegations = rows.rows.map((r) => ({
      delegationId: r.delegation_id,
      requestSummary: r.request_summary,
      status: r.status,
      workerProvider: r.worker_provider,
      workerModel: r.worker_model,
      workerAgentKey: r.worker_agent_key,
      workerDisplayName: r.worker_display_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (err) {
    errors.push(`Delegation query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Approvals linked by metadata runtime_task_id (text comparison)
  try {
    const rows = await pool.query<ApprovalRow>(
      `SELECT
         id::text                                           AS approval_id,
         status,
         approval_type,
         requested_at::text,
         responded_at::text,
         metadata->>'requested_capabilities'               AS requested_capabilities,
         metadata->>'governance_environment'               AS governance_environment,
         (metadata->'governed_outcome'->>'outcome_status') AS outcome_status,
         (metadata->'governed_outcome'->>'resolved_by')    AS resolved_by
       FROM approvals
       WHERE metadata->>'runtime_task_id' = $1
       ORDER BY requested_at DESC
       LIMIT 5`,
      [taskId],
    );
    approvals = rows.rows.map((r) => {
      let caps: string[] = [];
      try {
        const parsed = r.requested_capabilities ? (JSON.parse(r.requested_capabilities) as unknown) : [];
        caps = Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
      } catch {
        caps = [];
      }
      return {
        approvalId: r.approval_id,
        status: r.status,
        approvalType: r.approval_type,
        requestedAt: r.requested_at,
        respondedAt: r.responded_at,
        requestedCapabilities: caps,
        governanceEnvironment: r.governance_environment,
        outcomeStatus: r.outcome_status,
        resolvedBy: r.resolved_by,
      };
    });
  } catch (err) {
    errors.push(`Approval query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Governance events from ghost_action_history (runtime_task_id is text column)
  try {
    const rows = await pool.query<GovEventRow>(
      `SELECT
         action_id,
         event_type,
         entity,
         summary,
         outcome_status,
         occurred_at::text,
         source_surface,
         approval_id
       FROM ghost_action_history
       WHERE runtime_task_id = $1
       ORDER BY occurred_at ASC
       LIMIT 20`,
      [taskId],
    );
    governanceEvents = rows.rows.map((r) => ({
      actionId: r.action_id,
      eventType: r.event_type,
      entity: r.entity,
      summary: r.summary,
      outcomeStatus: r.outcome_status,
      occurredAt: r.occurred_at,
      sourceSurface: r.source_surface,
      approvalId: r.approval_id,
    }));
  } catch (err) {
    errors.push(`Governance events query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { taskId, delegations, approvals, governanceEvents, errors };
}
