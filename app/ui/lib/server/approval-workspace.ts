import path from "node:path";
import { readFileSync } from "node:fs";
import { getPool } from "@/lib/server/postgres";

// ---- Capability descriptions (optional enrichment from foundation JSON) ----

interface CapEntry {
  id: string;
  class: "non_destructive" | "destructive";
  description: string;
}

function loadCapabilities(): Map<string, CapEntry> {
  try {
    const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), "../../ops/foundation/capabilities.json"), "utf8")) as {
      capabilities: CapEntry[];
    };
    return new Map(raw.capabilities.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

// ---- Public types ----

export interface ActionEvent {
  actionId: string;
  eventType: string;
  entity: string;
  summary: string;
  outcomeStatus: string | null;
  occurredAt: string;
  sourceSurface: string;
}

export interface ApprovalFollowThrough {
  followThroughId: string;
  executionState: string;
  followThroughType: string;
  workerLabel: string | null;
  outcomeStatus: string | null;
  retryDispatchedAt: string | null;
  retryReplySummary: string | null;
  retryN8nExecutionId: string | null;
}

export interface CapabilityDetail {
  id: string;
  cls: "non_destructive" | "destructive" | "unknown";
  description: string | null;
}

export interface ApprovalEnrichment {
  approvalId: string;
  // Delegation context (from conversation_delegations + agents)
  delegationRequestSummary: string | null;
  delegationStatus: string | null;
  workerAgentKey: string | null;
  workerDisplayName: string | null;
  workerProvider: string | null;
  workerModel: string | null;
  // Capability descriptions
  capabilityDetails: CapabilityDetail[];
  // Action history events linked to this approval
  actionEvents: ActionEvent[];
  // Follow-through record if present
  followThrough: ApprovalFollowThrough | null;
  errors: string[];
}

export interface GovernanceEvent {
  actionId: string;
  eventType: string;
  entity: string;
  summary: string;
  outcomeStatus: string | null;
  occurredAt: string;
  sourceSurface: string;
  approvalId: string | null;
  delegationId: string | null;
  runtimeTaskId: string | null;
}

export interface GovernanceAuditTrail {
  generatedAt: string;
  events: GovernanceEvent[];
  errors: string[];
}

// ---- Per-approval enrichment ----

interface DelegationRow {
  request_summary: string | null;
  status: string | null;
  worker_agent_key: string | null;
  worker_display_name: string | null;
  worker_provider: string | null;
  worker_model: string | null;
}

interface ActionRow {
  action_id: string;
  event_type: string;
  entity: string;
  summary: string;
  outcome_status: string | null;
  occurred_at: string;
  source_surface: string;
}

interface FollowThroughRow {
  followthrough_id: string;
  execution_state: string;
  followthrough_type: string;
  worker_label: string | null;
  outcome_status: string | null;
  retry_dispatched_at: string | null;
  retry_reply_summary: string | null;
  retry_n8n_execution_id: string | null;
}

export async function getApprovalEnrichment(approvalId: string): Promise<ApprovalEnrichment> {
  const errors: string[] = [];
  const capMap = loadCapabilities();

  // Fetch from approval row to find delegation_id
  let delegationId: string | null = null;
  let requestedCapabilities: string[] = [];
  let delegation: DelegationRow | null = null;
  let actionEvents: ActionEvent[] = [];
  let followThrough: ApprovalFollowThrough | null = null;

  try {
    const pool = getPool("app");

    // Get delegation_id and capabilities from the approval metadata
    const approvalRow = await pool.query<{ delegation_id: string | null; caps: string | null }>(
      `SELECT metadata->>'delegation_id' AS delegation_id, metadata->>'requested_capabilities' AS caps
       FROM approvals WHERE id = $1::uuid LIMIT 1`,
      [approvalId],
    );

    if (approvalRow.rows.length > 0) {
      delegationId = approvalRow.rows[0].delegation_id;
      try {
        const parsed = approvalRow.rows[0].caps ? (JSON.parse(approvalRow.rows[0].caps) as unknown) : [];
        requestedCapabilities = Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
      } catch {
        requestedCapabilities = [];
      }
    }

    // Delegation context
    if (delegationId) {
      const delRow = await pool.query<DelegationRow>(
        `SELECT
           cd.request_summary,
           cd.status,
           ag.agent_key  AS worker_agent_key,
           ag.display_name AS worker_display_name,
           cd.worker_provider,
           cd.worker_model
         FROM conversation_delegations cd
         LEFT JOIN agents ag ON ag.id = cd.worker_agent_id
         WHERE cd.id = $1::uuid
         LIMIT 1`,
        [delegationId],
      );
      if (delRow.rows.length > 0) delegation = delRow.rows[0];
    }

    // Action history linked to this approval
    const actionRows = await pool.query<ActionRow>(
      `SELECT
         action_id,
         event_type,
         entity,
         summary,
         outcome_status,
         occurred_at::text,
         source_surface
       FROM ghost_action_history
       WHERE approval_id = $1
       ORDER BY occurred_at ASC`,
      [approvalId],
    );
    actionEvents = actionRows.rows.map((r) => ({
      actionId: r.action_id,
      eventType: r.event_type,
      entity: r.entity,
      summary: r.summary,
      outcomeStatus: r.outcome_status,
      occurredAt: r.occurred_at,
      sourceSurface: r.source_surface,
    }));

    // Follow-through record
    const ftRow = await pool.query<FollowThroughRow>(
      `SELECT
         followthrough_id,
         execution_state,
         followthrough_type,
         worker_label,
         outcome_status,
         retry_dispatched_at::text,
         next_step_payload->>'retry_reply_summary'   AS retry_reply_summary,
         next_step_payload->>'retry_n8n_execution_id' AS retry_n8n_execution_id
       FROM ghost_governed_followthrough
       WHERE approval_queue_id = $1
       LIMIT 1`,
      [approvalId],
    );
    if (ftRow.rows.length > 0) {
      const ft = ftRow.rows[0];
      followThrough = {
        followThroughId: ft.followthrough_id,
        executionState: ft.execution_state,
        followThroughType: ft.followthrough_type,
        workerLabel: ft.worker_label,
        outcomeStatus: ft.outcome_status,
        retryDispatchedAt: ft.retry_dispatched_at,
        retryReplySummary: ft.retry_reply_summary,
        retryN8nExecutionId: ft.retry_n8n_execution_id,
      };
    }
  } catch (err) {
    errors.push(`Enrichment query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build capability detail list
  const capabilityDetails: CapabilityDetail[] = requestedCapabilities.map((id) => {
    const cap = capMap.get(id);
    return {
      id,
      cls: cap ? cap.class : "unknown",
      description: cap?.description ?? null,
    };
  });

  return {
    approvalId,
    delegationRequestSummary: delegation?.request_summary ?? null,
    delegationStatus: delegation?.status ?? null,
    workerAgentKey: delegation?.worker_agent_key ?? null,
    workerDisplayName: delegation?.worker_display_name ?? null,
    workerProvider: delegation?.worker_provider ?? null,
    workerModel: delegation?.worker_model ?? null,
    capabilityDetails,
    actionEvents,
    followThrough,
    errors,
  };
}

// ---- Governance audit trail (recent governed events, for right panel default) ----

interface AuditRow {
  action_id: string;
  event_type: string;
  entity: string;
  summary: string;
  outcome_status: string | null;
  occurred_at: string;
  source_surface: string;
  approval_id: string | null;
  delegation_id: string | null;
  runtime_task_id: string | null;
}

export async function getGovernanceAuditTrail(): Promise<GovernanceAuditTrail> {
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];
  let events: GovernanceEvent[] = [];

  try {
    const pool = getPool("app");
    const result = await pool.query<AuditRow>(`
      SELECT
        action_id,
        event_type,
        entity,
        summary,
        outcome_status,
        occurred_at::text,
        source_surface,
        approval_id,
        delegation_id,
        runtime_task_id
      FROM ghost_action_history
      WHERE (
        entity IN ('approval', 'outcome')
        OR event_type LIKE 'governance.%'
        OR event_type LIKE 'approval.%'
        OR event_type LIKE 'delegation.%'
      )
      ORDER BY occurred_at DESC
      LIMIT 25
    `);
    events = result.rows.map((r) => ({
      actionId: r.action_id,
      eventType: r.event_type,
      entity: r.entity,
      summary: r.summary,
      outcomeStatus: r.outcome_status,
      occurredAt: r.occurred_at,
      sourceSurface: r.source_surface,
      approvalId: r.approval_id,
      delegationId: r.delegation_id,
      runtimeTaskId: r.runtime_task_id,
    }));
  } catch (err) {
    errors.push(`Audit trail query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { generatedAt, events, errors };
}
