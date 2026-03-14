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

// ---- Main export ----

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
