import { getPool } from "@/lib/server/postgres";
import { getOperationsRuntimeConfig } from "@/lib/server/runtime-env";

const CANONICAL_WORKFLOW_ID = "Yh6h9OJyVCfREbp3";
const CANONICAL_WEBHOOK_PATH = "ghost-runtime";

export interface ServiceCheck {
  id: string;
  label: string;
  status: "ok" | "degraded" | "error";
  detail: string;
  latencyMs: number | null;
}

export interface WorkflowStatus {
  id: string;
  name: string;
  active: boolean;
  webhookPath: string;
  webhookRegistered: boolean;
}

export interface RuntimeSummary {
  activeTasks: number;
  staleTasks: number;
  recentExecutions: number;
  approvalsPending: number;
}

export interface SystemHealthPayload {
  generatedAt: string;
  degraded: boolean;
  services: ServiceCheck[];
  workflow: WorkflowStatus | null;
  runtime: RuntimeSummary;
  errors: string[];
}

async function checkN8n(baseUrl: string): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(baseUrl, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (response && (response.status === 200 || response.status === 302 || response.status === 401)) {
      return { id: "n8n", label: "ghost-n8n", status: "ok", detail: `HTTP ${response.status}`, latencyMs };
    }
    return { id: "n8n", label: "ghost-n8n", status: "degraded", detail: `HTTP ${response?.status ?? "no response"}`, latencyMs };
  } catch {
    return { id: "n8n", label: "ghost-n8n", status: "error", detail: "unreachable", latencyMs: Date.now() - start };
  }
}

async function checkPostgresApp(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const pool = getPool("app");
    await pool.query("SELECT 1");
    return { id: "postgres_app", label: "ghost-postgres (app)", status: "ok", detail: "ghost_app reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { id: "postgres_app", label: "ghost-postgres (app)", status: "error", detail: err instanceof Error ? err.message : "query failed", latencyMs: Date.now() - start };
  }
}

async function checkPostgresCore(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const pool = getPool("core");
    await pool.query("SELECT 1");
    return { id: "postgres_core", label: "ghost-postgres (core)", status: "ok", detail: "ghost_core reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { id: "postgres_core", label: "ghost-postgres (core)", status: "error", detail: err instanceof Error ? err.message : "query failed", latencyMs: Date.now() - start };
  }
}

async function getWorkflowStatus(): Promise<WorkflowStatus | null> {
  try {
    const pool = getPool("core");
    const wfRow = await pool.query<{ name: string; active: boolean }>(
      `SELECT name, active FROM workflow_entity WHERE id = $1 LIMIT 1`,
      [CANONICAL_WORKFLOW_ID],
    );
    if (wfRow.rows.length === 0) return null;
    const webhookRow = await pool.query<{ webhookpath: string }>(
      `SELECT "webhookPath" AS webhookpath FROM webhook_entity WHERE "workflowId" = $1 AND method = 'POST' AND "webhookPath" = $2 LIMIT 1`,
      [CANONICAL_WORKFLOW_ID, CANONICAL_WEBHOOK_PATH],
    );
    return {
      id: CANONICAL_WORKFLOW_ID,
      name: wfRow.rows[0].name,
      active: wfRow.rows[0].active,
      webhookPath: CANONICAL_WEBHOOK_PATH,
      webhookRegistered: webhookRow.rows.length > 0,
    };
  } catch {
    return null;
  }
}

async function getRuntimeSummary(): Promise<RuntimeSummary> {
  try {
    const pool = getPool("app");
    const result = await pool.query<{
      active_tasks: string;
      stale_tasks: string;
      recent_executions: string;
      approvals_pending: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE t.status = 'running') AS active_tasks,
        COUNT(*) FILTER (
          WHERE t.status = 'running'
            AND t.updated_at < NOW() - INTERVAL '30 minutes'
        ) AS stale_tasks,
        COUNT(*) FILTER (
          WHERE t.created_at > NOW() - INTERVAL '24 hours'
        ) AS recent_executions,
        (SELECT COUNT(*) FROM approvals WHERE status = 'pending') AS approvals_pending
      FROM tasks t
    `);
    const row = result.rows[0];
    return {
      activeTasks: parseInt(row.active_tasks ?? "0", 10),
      staleTasks: parseInt(row.stale_tasks ?? "0", 10),
      recentExecutions: parseInt(row.recent_executions ?? "0", 10),
      approvalsPending: parseInt(row.approvals_pending ?? "0", 10),
    };
  } catch {
    return { activeTasks: 0, staleTasks: 0, recentExecutions: 0, approvalsPending: 0 };
  }
}

export async function getSystemHealthPayload(): Promise<SystemHealthPayload> {
  const config = getOperationsRuntimeConfig();
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];

  const [n8nCheck, appCheck, coreCheck, workflow, runtime] = await Promise.all([
    checkN8n(config.n8nBaseUrl),
    checkPostgresApp(),
    checkPostgresCore(),
    getWorkflowStatus(),
    getRuntimeSummary(),
  ]);

  const services: ServiceCheck[] = [n8nCheck, appCheck, coreCheck];

  if (workflow !== null) {
    if (!workflow.active) {
      services.push({ id: "workflow", label: "runtime workflow", status: "error", detail: "workflow not active", latencyMs: null });
    } else if (!workflow.webhookRegistered) {
      services.push({ id: "workflow", label: "runtime workflow", status: "degraded", detail: "webhook not registered", latencyMs: null });
    } else {
      services.push({ id: "workflow", label: "runtime workflow", status: "ok", detail: `${workflow.name} · POST /${workflow.webhookPath}`, latencyMs: null });
    }
  } else {
    errors.push("Could not read workflow state from ghost_core");
  }

  for (const svc of services) {
    if (svc.status === "error") errors.push(`${svc.label}: ${svc.detail}`);
  }

  const degraded = services.some((s) => s.status === "error" || s.status === "degraded") || workflow === null;

  return { generatedAt, degraded, services, workflow, runtime, errors };
}
