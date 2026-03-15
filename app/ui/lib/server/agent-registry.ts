import path from "node:path";
import { readFileSync } from "node:fs";
import { getPool } from "@/lib/server/postgres";

// ---- Foundation JSON shapes ----

interface WorkersJson {
  version: string;
  workers: Array<{
    id: string;
    visibility_label: string;
    role: string;
    purpose: string;
    operator_identity: string;
    environment_scope: string[];
    success_contract: string;
    failure_contract: string;
  }>;
}

interface CapabilitiesJson {
  version: string;
  capabilities: Array<{
    id: string;
    class: "non_destructive" | "destructive";
    approval_required: boolean;
    description: string;
  }>;
  worker_capabilities: Record<string, string[]>;
}

// ---- Worker → DB agent mapping ----
//
// Architectural fact: ghost_main is the conversation owner (ghost-main agent).
// forge is the implementation role wired to the Codex OAuth worker (codex-worker agent).
// All other foundation workers (probe, rector, archivist, operator, scout) have no
// DB agent bound yet — they are defined in foundation policy but not yet dispatched.

const WORKER_TO_AGENT_KEY: Record<string, string> = {
  ghost_main: "ghost-main",
  forge: "codex-worker",
};

// ---- Public types ----

export type WorkerRuntimeStatus = "active" | "registered" | "defined";

export interface FoundationWorker {
  id: string;
  visibilityLabel: string;
  role: string;
  purpose: string;
  successContract: string;
  failureContract: string;
  environmentScope: string[];
  capabilities: string[];
  operatorIdentity: string;
  /** Whether this worker has an active DB execution identity or is foundation-only. */
  runtimeStatus: WorkerRuntimeStatus;
  /** agent_key of the DB execution identity bound to this role, if any. */
  boundAgentKey: string | null;
}

export interface RuntimeAgent {
  agentKey: string;
  displayName: string;
  agentType: string;
  provider: string | null;
  modelName: string | null;
  dbStatus: string;
  taskCount: number;
  delegationCount: number;
  lastActive: string | null;
  runtimeStatus: "active" | "registered";
  /** Foundation worker role ids bound to this execution identity. */
  boundWorkerIds: string[];
}

export interface Capability {
  id: string;
  cls: "non_destructive" | "destructive";
  approvalRequired: boolean;
  description: string;
}

export interface AgentRegistryPayload {
  generatedAt: string;
  foundationVersion: string;
  foundationWorkers: FoundationWorker[];
  runtimeAgents: RuntimeAgent[];
  capabilities: Capability[];
  errors: string[];
}

// ---- Detail payload (fetched on demand per agent) ----

export interface RecentTask {
  taskId: string;
  title: string;
  status: string;
  taskType: string;
  source: string;
  workerName: string | null;
  executionTarget: string | null;
  n8nExecutionId: string | null;
  durationMs: number | null;
  runStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecentDelegation {
  delegationId: string;
  status: string;
  requestSummary: string;
  resultSummary: string | null;
  workerProvider: string | null;
  workerModel: string | null;
  createdAt: string;
}

export interface AgentDetailPayload {
  agentKey: string;
  recentTasks: RecentTask[];
  recentDelegations: RecentDelegation[];
  errors: string[];
}

// ---- Helpers ----

function readFoundationJson<T>(filename: string): T {
  const filepath = path.resolve(process.cwd(), "../../ops/foundation", filename);
  return JSON.parse(readFileSync(filepath, "utf8")) as T;
}

interface AgentRow {
  agent_key: string;
  display_name: string;
  agent_type: string;
  provider: string | null;
  model_name: string | null;
  status: string;
  task_count: string;
  delegation_count: string;
  last_active: string | null;
}

// ---- Main registry payload ----

export async function getAgentRegistryPayload(): Promise<AgentRegistryPayload> {
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];

  let workersJson: WorkersJson;
  let capabilitiesJson: CapabilitiesJson;

  try {
    workersJson = readFoundationJson<WorkersJson>("workers.json");
    capabilitiesJson = readFoundationJson<CapabilitiesJson>("capabilities.json");
  } catch (err) {
    errors.push(`Could not read foundation config: ${err instanceof Error ? err.message : String(err)}`);
    return { generatedAt, foundationVersion: "unknown", foundationWorkers: [], runtimeAgents: [], capabilities: [], errors };
  }

  let dbAgents: AgentRow[] = [];
  try {
    const pool = getPool("app");
    const result = await pool.query<AgentRow>(`
      SELECT
        a.agent_key,
        a.display_name,
        a.agent_type,
        a.provider,
        a.model_name,
        a.status,
        COUNT(DISTINCT t.id)::text   AS task_count,
        COUNT(DISTINCT cd.id)::text  AS delegation_count,
        MAX(t.updated_at)::text      AS last_active
      FROM agents a
      LEFT JOIN tasks t  ON t.assigned_agent_id  = a.id
      LEFT JOIN conversation_delegations cd ON cd.worker_agent_id = a.id
      GROUP BY a.agent_key, a.display_name, a.agent_type, a.provider, a.model_name, a.status
      ORDER BY a.agent_key
    `);
    dbAgents = result.rows;
  } catch (err) {
    errors.push(`DB agents query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const dbAgentMap = new Map(dbAgents.map((a) => [a.agent_key, a]));

  // Reverse map: agent_key → foundation worker ids
  const agentToWorkers = new Map<string, string[]>();
  for (const [workerId, agentKey] of Object.entries(WORKER_TO_AGENT_KEY)) {
    agentToWorkers.set(agentKey, [...(agentToWorkers.get(agentKey) ?? []), workerId]);
  }

  // Build foundation workers
  const foundationWorkers: FoundationWorker[] = workersJson.workers.map((w) => {
    const boundAgentKey = WORKER_TO_AGENT_KEY[w.id] ?? null;
    const dbAgent = boundAgentKey ? dbAgentMap.get(boundAgentKey) : null;

    let runtimeStatus: WorkerRuntimeStatus = "defined";
    if (dbAgent) {
      const tasks = parseInt(dbAgent.task_count, 10);
      const delegations = parseInt(dbAgent.delegation_count, 10);
      runtimeStatus = tasks > 0 || delegations > 0 ? "active" : "registered";
    }

    return {
      id: w.id,
      visibilityLabel: w.visibility_label,
      role: w.role,
      purpose: w.purpose,
      successContract: w.success_contract,
      failureContract: w.failure_contract,
      environmentScope: w.environment_scope,
      capabilities: capabilitiesJson.worker_capabilities[w.id] ?? [],
      operatorIdentity: w.operator_identity,
      runtimeStatus,
      boundAgentKey,
    };
  });

  // Build runtime agents
  const runtimeAgents: RuntimeAgent[] = dbAgents.map((a) => {
    const tasks = parseInt(a.task_count, 10);
    const delegations = parseInt(a.delegation_count, 10);
    return {
      agentKey: a.agent_key,
      displayName: a.display_name,
      agentType: a.agent_type,
      provider: a.provider,
      modelName: a.model_name,
      dbStatus: a.status,
      taskCount: tasks,
      delegationCount: delegations,
      lastActive: a.last_active,
      runtimeStatus: tasks > 0 || delegations > 0 ? "active" : "registered",
      boundWorkerIds: agentToWorkers.get(a.agent_key) ?? [],
    };
  });

  // Build capability list
  const capabilities: Capability[] = capabilitiesJson.capabilities.map((c) => ({
    id: c.id,
    cls: c.class,
    approvalRequired: c.approval_required,
    description: c.description,
  }));

  return {
    generatedAt,
    foundationVersion: workersJson.version,
    foundationWorkers,
    runtimeAgents,
    capabilities,
    errors,
  };
}

// ---- Per-agent detail payload (recent activity, fetched on demand) ----

interface TaskActivityRow {
  task_id: string;
  title: string;
  status: string;
  task_type: string;
  source: string;
  worker_name: string | null;
  execution_target: string | null;
  n8n_execution_id: string | null;
  duration_ms: string | null;
  run_status: string | null;
  created_at: string;
  updated_at: string;
}

interface DelegationActivityRow {
  delegation_id: string;
  status: string;
  request_summary: string;
  result_summary: string | null;
  worker_provider: string | null;
  worker_model: string | null;
  created_at: string;
}

export async function getAgentDetailPayload(agentKey: string): Promise<AgentDetailPayload> {
  const errors: string[] = [];
  let recentTasks: RecentTask[] = [];
  let recentDelegations: RecentDelegation[] = [];

  try {
    const pool = getPool("app");

    const tasksResult = await pool.query<TaskActivityRow>(`
      SELECT
        t.id            AS task_id,
        t.title,
        t.status,
        t.task_type,
        t.source,
        tr.worker_name,
        tr.execution_target,
        tr.n8n_execution_id,
        tr.duration_ms::text  AS duration_ms,
        tr.status             AS run_status,
        t.created_at::text,
        t.updated_at::text
      FROM tasks t
      LEFT JOIN LATERAL (
        SELECT worker_name, execution_target, n8n_execution_id, duration_ms, status
        FROM task_runs
        WHERE task_id = t.id
        ORDER BY run_number DESC
        LIMIT 1
      ) tr ON true
      JOIN agents a ON a.id = t.assigned_agent_id
      WHERE a.agent_key = $1
      ORDER BY t.updated_at DESC
      LIMIT 8
    `, [agentKey]);

    recentTasks = tasksResult.rows.map((r) => ({
      taskId: r.task_id,
      title: r.title,
      status: r.status,
      taskType: r.task_type,
      source: r.source,
      workerName: r.worker_name,
      executionTarget: r.execution_target,
      n8nExecutionId: r.n8n_execution_id,
      durationMs: r.duration_ms !== null ? parseInt(r.duration_ms, 10) : null,
      runStatus: r.run_status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const delegationsResult = await pool.query<DelegationActivityRow>(`
      SELECT
        cd.id              AS delegation_id,
        cd.status,
        cd.request_summary,
        cd.result_summary,
        cd.worker_provider,
        cd.worker_model,
        cd.created_at::text
      FROM conversation_delegations cd
      JOIN agents a ON a.id = cd.worker_agent_id
      WHERE a.agent_key = $1
      ORDER BY cd.created_at DESC
      LIMIT 8
    `, [agentKey]);

    recentDelegations = delegationsResult.rows.map((r) => ({
      delegationId: r.delegation_id,
      status: r.status,
      requestSummary: r.request_summary,
      resultSummary: r.result_summary,
      workerProvider: r.worker_provider,
      workerModel: r.worker_model,
      createdAt: r.created_at,
    }));
  } catch (err) {
    errors.push(`Activity query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { agentKey, recentTasks, recentDelegations, errors };
}
