import type {
  OperationalTask,
  TaskBoardAgent,
  TaskBoardCard,
  TaskBoardCreateInput,
  TaskBoardFeedItem,
  TaskBoardLane,
  TaskBoardLaneId,
  TaskBoardPayload,
  TaskBoardSourceMode,
  TaskOverviewPayload,
} from "@/lib/operations";
import { getPool } from "@/lib/server/postgres";
import { getTaskOverviewPayload } from "@/lib/server/task-overview";

interface AgentRow {
  id: string;
  agent_key: string;
  display_name: string;
  agent_type: string;
  provider: string | null;
  model_name: string | null;
  status: string;
}

interface OrchestrationTaskRow {
  id: string;
  title: string;
  description: string;
  priority_label: string;
  stage: TaskBoardLaneId;
  status: string;
  orchestrator_agent_id: string | null;
  runtime_task_id: string | null;
  suggested_route: string | null;
  suggested_model: string | null;
  planning_note: string | null;
  deliverables_note: string | null;
  created_at: string;
  updated_at: string;
  orchestrator_label: string | null;
}

interface DelegationLinkRow {
  delegation_id: string;
  orchestration_task_id: string | null;
  runtime_task_id: string | null;
  parent_conversation_id: string | null;
  worker_conversation_id: string | null;
  worker_provider: string | null;
  worker_model: string | null;
  delegation_status: string;
  worker_agent_label: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface OrchestrationTaskEventRow {
  id: string;
  orchestration_task_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const laneMeta: Record<TaskBoardLaneId, { title: string; description: string }> = {
  planning: {
    title: "Planning",
    description: "Shaping work before it is actively queued or assigned.",
  },
  inbox: {
    title: "Inbox",
    description: "Newly visible work waiting for explicit orchestration attention.",
  },
  assigned: {
    title: "Assigned",
    description: "Ghost has accepted the work and orchestration ownership is attached.",
  },
  in_progress: {
    title: "In Progress",
    description: "Runtime execution or active implementation is underway.",
  },
  testing: {
    title: "Testing",
    description: "Verification or validation posture inferred from current phase and activity.",
  },
  review: {
    title: "Review",
    description: "Approval, stale review, or operator decision is needed.",
  },
  done: {
    title: "Done",
    description: "Terminally resolved work, either runtime-completed or operator-reconciled.",
  },
};

const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
const operatorStageOptions: TaskBoardLaneId[] = ["planning", "assigned", "in_progress", "review", "done"];

function includesToken(value: string | null | undefined, ...tokens: string[]) {
  const normalized = String(value || "").toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function compactText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function toUuid(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.replace(/^(orch|runtime)_/, "");
}

export function taskBoardWorkspaceHref(itemKind: TaskBoardCard["itemKind"], id: string) {
  return `/task-board/${itemKind === "orchestration_task" ? `orch_${id}` : `runtime_${id}`}`;
}

export function taskBoardRuntimeHref(taskId: string | null | undefined) {
  return taskId ? `/task-overview/${taskId}` : null;
}

export function taskBoardLaneMeta(laneId: TaskBoardLaneId) {
  return laneMeta[laneId];
}

export function taskBoardOperatorStageOptions() {
  return operatorStageOptions.map((laneId) => ({
    id: laneId,
    label: laneMeta[laneId]?.title ?? laneId,
    detail:
      laneId === "done"
        ? "Operator board stage only. Runtime completion remains canonical."
        : laneMeta[laneId]?.description ?? null,
  }));
}

function latestActivityByTask(payload: TaskOverviewPayload) {
  const map = new Map<string, { title: string; detail: string; timestamp: string }>();

  for (const event of payload.activity) {
    if (!event.taskId) {
      continue;
    }

    const previous = map.get(event.taskId);
    if (!previous || new Date(event.timestamp).getTime() > new Date(previous.timestamp).getTime()) {
      map.set(event.taskId, {
        title: event.title,
        detail: event.detail,
        timestamp: event.timestamp,
      });
    }
  }

  return map;
}

function laneForTask(task: OperationalTask): { laneId: TaskBoardLaneId; label: string; reason: string } {
  const terminal =
    task.status === "succeeded" ||
    task.status === "failed" ||
    Boolean(task.completedAt) ||
    task.completionSource === "operator_reconciled" ||
    task.completionSource === "runtime_confirmed";

  if (terminal) {
    return {
      laneId: "done",
      label: task.completionSource === "operator_reconciled" ? "Resolved by operator" : "Runtime complete",
      reason:
        task.completionSource === "operator_reconciled"
          ? "Terminal state was set later through operator reconciliation."
          : "A terminal state is already recorded in the canonical ledger.",
    };
  }

  if (
    task.staleCandidate ||
    task.approvalRequired ||
    task.status === "blocked" ||
    task.status === "attention" ||
    includesToken(task.currentPhase, "review", "approval")
  ) {
    return {
      laneId: "review",
      label: task.approvalRequired ? "Awaiting review" : "Needs operator review",
      reason: task.approvalRequired
        ? "Approval or review evidence is present in the ledger."
        : task.staleCandidate
          ? "Runtime activity looks stale and requires operator review."
          : "The current task state indicates review or intervention posture.",
    };
  }

  if (includesToken(task.currentPhase, "test", "verify", "qa", "validation")) {
    return {
      laneId: "testing",
      label: "Validation pass",
      reason: "Current phase language suggests verification or testing work.",
    };
  }

  if (task.status === "running" || task.latestRunStatus === "running") {
    return {
      laneId: "in_progress",
      label: "Active execution",
      reason: "Runtime execution is actively in flight.",
    };
  }

  if (task.assignedActor) {
    return {
      laneId: "assigned",
      label: "Owner attached",
      reason: "An actor is attached to the task, but active execution is not yet clear.",
    };
  }

  if (includesToken(task.currentPhase, "planning", "plan", "design")) {
    return {
      laneId: "planning",
      label: "Planning posture",
      reason: "Current phase language suggests planning or shaping work.",
    };
  }

  return {
    laneId: "inbox",
    label: "Needs triage",
    reason: "The task is visible in the ledger but has not yet been clearly staged.",
  };
}

function priorityLabel(task: OperationalTask) {
  if (task.staleCandidate || task.approvalRequired || task.status === "failed" || task.status === "blocked" || task.status === "attention") {
    return "Urgent";
  }

  if (task.status === "running" || task.latestRunStatus === "running") {
    return "Active";
  }

  if (task.completionSource) {
    return "Resolved";
  }

  return "Normal";
}

function handoffLabel(task: OperationalTask, laneId: TaskBoardLaneId) {
  if (task.approvalRequired) {
    return "Awaiting approval";
  }

  if (task.staleCandidate) {
    return "Needs operator review";
  }

  if (laneId === "testing") {
    return "Verification handoff";
  }

  if (laneId === "assigned" && task.assignedActor) {
    return `Assigned to ${task.assignedActor.label}`;
  }

  if (laneId === "done" && task.completionSource === "operator_reconciled") {
    return "Operator closed";
  }

  return null;
}

function cardForTask(
  task: OperationalTask,
  activity: Map<string, { title: string; detail: string; timestamp: string }>,
): TaskBoardCard {
  const lane = laneForTask(task);
  const latestActivity = activity.get(task.id);
  const ownership = ownershipForCard("live");

  return {
    id: `runtime_${task.id}`,
    itemKind: "runtime_task",
    taskId: task.id,
    runtimeTaskId: task.id,
    title: task.title,
    summary: task.summary,
    laneId: lane.laneId,
    stageLabel: lane.label,
    stageReason: lane.reason,
    priorityLabel: priorityLabel(task),
    handoffLabel: handoffLabel(task, lane.laneId),
    status: task.status,
    currentPhase: task.currentPhase ?? null,
    assignedActor: task.assignedActor ?? null,
    orchestrationOwner: null,
    routeProvider: task.routeProvider ?? null,
    entrypoint: task.entrypoint ?? null,
    freshnessLabel: task.freshnessLabel ?? null,
    freshnessDetail: task.freshnessDetail ?? null,
    latestActivityTitle: latestActivity?.title ?? null,
    latestActivityDetail: latestActivity?.detail ?? null,
    latestActivityAt: latestActivity?.timestamp ?? task.lastEventAt ?? null,
    approvalRequired: task.approvalRequired ?? false,
    artifactPath: task.artifactPath ?? null,
    staleCandidate: task.staleCandidate ?? false,
    completionSource: task.completionSource ?? null,
    boardStage: null,
    boardStageLabel: null,
    ownershipMode: ownership.mode,
    ownershipLabel: ownership.label,
    ownershipDetail: ownership.detail,
    updatedAt: task.updatedAt,
    detailHref: taskBoardWorkspaceHref("runtime_task", task.id),
    runtimeHref: taskBoardRuntimeHref(task.id),
    sourceMode: "live",
  };
}

function normalizePriority(value: string | null | undefined) {
  const normalized = compactText(value).toLowerCase();
  return allowedPriorities.has(normalized) ? normalized : "normal";
}

function laneLabel(laneId: TaskBoardLaneId) {
  return laneMeta[laneId]?.title ?? "Assigned";
}

function ownershipForCard(sourceMode: TaskBoardSourceMode) {
  if (sourceMode === "orchestration") {
    return {
      mode: "board_owned" as const,
      label: "Board-owned",
      detail: "Editable orchestration metadata. No runtime execution is linked yet.",
    };
  }
  if (sourceMode === "hybrid") {
    return {
      mode: "hybrid" as const,
      label: "Hybrid",
      detail: "Visible stage follows runtime truth. Board controls change orchestration metadata only.",
    };
  }
  return {
    mode: "runtime_owned" as const,
    label: "Runtime-owned",
    detail: "Observed from canonical runtime execution. Board does not directly control execution state.",
  };
}

function mapOrchestrationStatus(value: string | null | undefined): OperationalTask["status"] {
  const normalized = compactText(value).toLowerCase();
  if (!normalized || normalized === "awaiting_orchestration" || normalized === "queued") {
    return "queued";
  }
  if (normalized.includes("running") || normalized.includes("started")) {
    return "running";
  }
  if (normalized.includes("succeeded") || normalized.includes("completed")) {
    return "succeeded";
  }
  if (normalized.includes("failed")) {
    return "failed";
  }
  if (normalized.includes("blocked")) {
    return "blocked";
  }
  return "unknown";
}

function buildOrchestrationLinkageMaps(rows: DelegationLinkRow[]) {
  const byOrchestrationId = new Map<string, DelegationLinkRow>();
  const byRuntimeTaskId = new Map<string, DelegationLinkRow>();

  for (const row of rows) {
    if (row.orchestration_task_id && !byOrchestrationId.has(row.orchestration_task_id)) {
      byOrchestrationId.set(row.orchestration_task_id, row);
    }
    if (row.runtime_task_id && !byRuntimeTaskId.has(row.runtime_task_id)) {
      byRuntimeTaskId.set(row.runtime_task_id, row);
    }
  }

  return { byOrchestrationId, byRuntimeTaskId };
}

function cardForOrchestrationTask(
  row: OrchestrationTaskRow,
  linkage: DelegationLinkRow | null,
  runtimeTask: OperationalTask | null,
  activity: Map<string, { title: string; detail: string; timestamp: string }>,
): TaskBoardCard {
  const orchestratorLabel = row.orchestrator_label ?? "Ghost";
  const priority = normalizePriority(row.priority_label);
  const suggestedRoute = compactText(row.suggested_route) || null;
  const suggestedModel = compactText(row.suggested_model) || null;
  const linkedRuntimeActivity = row.runtime_task_id ? activity.get(row.runtime_task_id) : null;
  const runtimeLane = runtimeTask ? laneForTask(runtimeTask) : null;
  const laneId = runtimeLane?.laneId ?? row.stage;
  const status = runtimeTask?.status ?? mapOrchestrationStatus(row.status);
  const stageReasonParts = runtimeTask
    ? [
        "Ghost accepted this work and delegated it into a separate worker runtime.",
        linkage?.worker_agent_label ? `Worker: ${linkage.worker_agent_label}.` : null,
        linkage?.worker_provider ? `Provider: ${linkage.worker_provider}.` : null,
        linkage?.worker_model ? `Model: ${linkage.worker_model}.` : null,
      ].filter(Boolean)
    : [
        "Board-created work is queued to Ghost main orchestrator first.",
        suggestedRoute ? `Suggested route: ${suggestedRoute}.` : null,
        suggestedModel ? `Suggested model: ${suggestedModel}.` : null,
      ].filter(Boolean);
  const latestActivityTitle = linkedRuntimeActivity?.title ?? (runtimeTask ? "Delegation linked to runtime task" : "Queued for Ghost main orchestrator");
  const latestActivityDetail = linkedRuntimeActivity?.detail
    ?? (runtimeTask
      ? [
          linkage?.parent_conversation_id ? `Parent conversation: ${linkage.parent_conversation_id}` : null,
          linkage?.worker_conversation_id ? `Worker conversation: ${linkage.worker_conversation_id}` : null,
          row.runtime_task_id ? `Runtime task: ${row.runtime_task_id}` : null,
        ].filter(Boolean).join(" · ")
      : "Ghost main orchestrator owns first assignment and handoff decisions for this task.");
  const sourceMode: TaskBoardSourceMode = row.runtime_task_id ? "hybrid" : "orchestration";
  const ownership = ownershipForCard(sourceMode);

  return {
    id: `orch_${row.id}`,
    itemKind: "orchestration_task",
    taskId: row.runtime_task_id,
    runtimeTaskId: row.runtime_task_id,
    title: row.title,
    summary: row.description || (runtimeTask ? runtimeTask.summary : "Operator-created work waiting for Ghost orchestration."),
    laneId,
    stageLabel:
      runtimeTask && runtimeLane
        ? runtimeLane.label
        : row.stage === "assigned"
          ? "Queued for Ghost"
          : laneLabel(row.stage),
    stageReason: stageReasonParts.join(" "),
    priorityLabel: priority.charAt(0).toUpperCase() + priority.slice(1),
    handoffLabel: runtimeTask
      ? linkage?.worker_agent_label
        ? `Delegated to ${linkage.worker_agent_label}`
        : "Delegated worker session"
      : `Ghost intake · ${orchestratorLabel}`,
    status,
    currentPhase: runtimeTask?.currentPhase ?? (row.runtime_task_id ? "delegated_worker_execution" : "awaiting_ghost_orchestration"),
    assignedActor: {
      id: runtimeTask?.assignedActor?.id ?? row.orchestrator_agent_id ?? "ghost-main",
      label: runtimeTask?.assignedActor?.label ?? linkage?.worker_agent_label ?? orchestratorLabel,
      kind: runtimeTask?.assignedActor?.kind ?? (runtimeTask ? "worker" : "agent"),
    },
    orchestrationOwner: {
      id: row.orchestrator_agent_id ?? "ghost-main",
      label: orchestratorLabel,
      kind: "agent",
    },
    routeProvider: runtimeTask?.routeProvider ?? linkage?.worker_agent_label ?? suggestedRoute,
    entrypoint: runtimeTask?.entrypoint ?? "task_board",
    freshnessLabel: runtimeTask?.freshnessLabel ?? "awaiting orchestration",
    freshnessDetail:
      runtimeTask?.freshnessDetail
      ?? (row.runtime_task_id
        ? "This board item has a linked worker runtime task and now reflects runtime progress."
        : "This task was created from Task Board and has not been picked up by runtime execution yet."),
    latestActivityTitle,
    latestActivityDetail,
    latestActivityAt: linkedRuntimeActivity?.timestamp ?? runtimeTask?.lastEventAt ?? toIsoTimestamp(row.updated_at),
    approvalRequired: runtimeTask?.approvalRequired ?? false,
    artifactPath: runtimeTask?.artifactPath ?? null,
    staleCandidate: runtimeTask?.staleCandidate ?? false,
    completionSource: runtimeTask?.completionSource ?? null,
    suggestedRoute: linkage?.worker_provider ?? suggestedRoute,
    suggestedModel: linkage?.worker_model ?? suggestedModel,
    planningNote: row.planning_note,
    deliverablesNote: runtimeTask?.resultSummary ?? row.deliverables_note,
    boardStage: row.stage,
    boardStageLabel: laneLabel(row.stage),
    ownershipMode: ownership.mode,
    ownershipLabel: ownership.label,
    ownershipDetail: ownership.detail,
    updatedAt: linkedRuntimeActivity?.timestamp ?? runtimeTask?.updatedAt ?? (toIsoTimestamp(row.updated_at) ?? row.updated_at),
    detailHref: taskBoardWorkspaceHref("orchestration_task", row.id),
    runtimeHref: taskBoardRuntimeHref(row.runtime_task_id),
    sourceMode,
  };
}

function sortCards(cards: TaskBoardCard[]) {
  return [...cards].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

async function getAgents() {
  const pool = getPool("app");
  const result = await pool.query<AgentRow>(
    `
      SELECT
        id::text,
        agent_key,
        display_name,
        agent_type,
        provider,
        model_name,
        status
      FROM agents
      ORDER BY updated_at DESC, created_at ASC
    `,
  );
  return result.rows;
}

export async function getAssignableOrchestrationAgents() {
  const rows = await getAgents();
  return rows.map((row) => ({
    id: row.id,
    label: row.display_name,
    detail: [row.agent_type, row.provider, row.model_name].filter(Boolean).join(" · ") || "Orchestration actor",
  }));
}

async function getOrchestrationTasks() {
  const pool = getPool("app");

  try {
    const result = await pool.query<OrchestrationTaskRow>(
      `
        SELECT
          orchestration_tasks.id::text,
          orchestration_tasks.title,
          orchestration_tasks.description,
          orchestration_tasks.priority_label,
          orchestration_tasks.stage,
          orchestration_tasks.status,
          orchestration_tasks.orchestrator_agent_id::text,
          orchestration_tasks.runtime_task_id::text,
          orchestration_tasks.suggested_route,
          orchestration_tasks.suggested_model,
          orchestration_tasks.planning_note,
          orchestration_tasks.deliverables_note,
          orchestration_tasks.created_at::text,
          orchestration_tasks.updated_at::text,
          agents.display_name AS orchestrator_label
        FROM orchestration_tasks
        LEFT JOIN agents ON agents.id = orchestration_tasks.orchestrator_agent_id
        ORDER BY orchestration_tasks.updated_at DESC, orchestration_tasks.created_at DESC
      `,
    );

    return result.rows;
  } catch (error) {
    if (error instanceof Error && error.message.includes("relation \"orchestration_tasks\" does not exist")) {
      return [];
    }
    throw error;
  }
}

async function getDelegationLinks() {
  const pool = getPool("app");

  try {
    const result = await pool.query<DelegationLinkRow>(
      `
        SELECT DISTINCT ON (conversation_delegations.orchestration_task_id)
          conversation_delegations.id::text AS delegation_id,
          conversation_delegations.orchestration_task_id::text,
          conversation_delegations.runtime_task_id::text,
          conversation_delegations.parent_conversation_id::text,
          conversation_delegations.worker_conversation_id::text,
          conversation_delegations.worker_provider,
          conversation_delegations.worker_model,
          conversation_delegations.status AS delegation_status,
          worker_agents.display_name AS worker_agent_label,
          conversation_delegations.started_at::text,
          conversation_delegations.completed_at::text,
          conversation_delegations.updated_at::text
        FROM conversation_delegations
        LEFT JOIN agents AS worker_agents ON worker_agents.id = conversation_delegations.worker_agent_id
        WHERE conversation_delegations.orchestration_task_id IS NOT NULL
        ORDER BY conversation_delegations.orchestration_task_id, conversation_delegations.updated_at DESC, conversation_delegations.created_at DESC
      `,
    );

    return result.rows;
  } catch (error) {
    if (error instanceof Error && error.message.includes("relation \"conversation_delegations\" does not exist")) {
      return [];
    }
    throw error;
  }
}

async function getOrchestrationTaskEvents(orchestrationTaskId?: string | null) {
  const pool = getPool("app");

  try {
    const result = await pool.query<OrchestrationTaskEventRow>(
      `
        SELECT
          id::text,
          orchestration_task_id::text,
          event_type,
          actor_type,
          actor_id,
          metadata,
          created_at::text
        FROM orchestration_task_events
        ${orchestrationTaskId ? "WHERE orchestration_task_id = $1::uuid" : ""}
        ORDER BY created_at DESC
        LIMIT ${orchestrationTaskId ? "24" : "32"}
      `,
      orchestrationTaskId ? [orchestrationTaskId] : [],
    );

    return result.rows;
  } catch (error) {
    if (error instanceof Error && error.message.includes("relation \"orchestration_task_events\" does not exist")) {
      return [];
    }
    throw error;
  }
}

function eventTone(eventType: string) {
  if (includesToken(eventType, "reassigned")) {
    return "warning" as const;
  }
  if (includesToken(eventType, "moved")) {
    return "neutral" as const;
  }
  return "neutral" as const;
}

function formatOrchestrationEvent(row: OrchestrationTaskEventRow, taskTitle: string, href: string): TaskBoardFeedItem {
  const metadata = row.metadata || {};
  if (row.event_type === "operator_stage_changed") {
    const fromStage = compactText(String(metadata.from_stage || "")).replace(/_/g, " ");
    const toStage = compactText(String(metadata.to_stage || "")).replace(/_/g, " ");
    const runtimeLinked = Boolean(compactText(String(metadata.runtime_task_id || "")));
    return {
      id: `orch-event:${row.id}`,
      title: `Operator moved orchestration stage${toStage ? ` to ${toStage}` : ""}`,
      detail: [
        taskTitle,
        fromStage ? `${fromStage} → ${toStage}` : null,
        runtimeLinked ? "Runtime execution remains canonical." : "Board stage updated.",
        `Operator: ${row.actor_id}`,
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: toIsoTimestamp(row.created_at) ?? row.created_at,
      tone: eventTone(row.event_type),
      group: "operator_actions",
      actorLabel: row.actor_id,
      href,
    };
  }

  if (row.event_type === "operator_assignment_changed") {
    const fromLabel = compactText(String(metadata.from_agent_label || ""));
    const toLabel = compactText(String(metadata.to_agent_label || ""));
    const runtimeLinked = Boolean(compactText(String(metadata.runtime_task_id || "")));
    return {
      id: `orch-event:${row.id}`,
      title: `Operator reassigned orchestration owner${toLabel ? ` to ${toLabel}` : ""}`,
      detail: [
        taskTitle,
        fromLabel ? `${fromLabel} → ${toLabel}` : null,
        runtimeLinked ? "Worker runtime linkage is unchanged." : "Orchestration ownership updated.",
        `Operator: ${row.actor_id}`,
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: toIsoTimestamp(row.created_at) ?? row.created_at,
      tone: eventTone(row.event_type),
      group: "operator_actions",
      actorLabel: row.actor_id,
      href,
    };
  }

  return {
    id: `orch-event:${row.id}`,
    title: "Operator updated orchestration task",
    detail: [taskTitle, `Operator: ${row.actor_id}`].join(" · "),
    timestamp: toIsoTimestamp(row.created_at) ?? row.created_at,
    tone: "neutral",
    group: "operator_actions",
    actorLabel: row.actor_id,
    href,
  };
}

export async function getDelegationLinkForOrchestrationTask(orchestrationTaskId: string) {
  const orchestrationId = toUuid(orchestrationTaskId);
  if (!orchestrationId) {
    return null;
  }

  const rows = await getDelegationLinks();
  return rows.find((row) => row.orchestration_task_id === orchestrationId) ?? null;
}

export async function getDelegationLinkForRuntimeTask(runtimeTaskId: string) {
  const runtimeId = toUuid(runtimeTaskId);
  if (!runtimeId) {
    return null;
  }

  const rows = await getDelegationLinks();
  return rows.find((row) => row.runtime_task_id === runtimeId) ?? null;
}

export async function updateOrchestrationTaskControls(input: {
  orchestrationTaskId: string;
  stage?: TaskBoardLaneId | null;
  orchestratorAgentId?: string | null;
  actorId?: string | null;
}) {
  const orchestrationTaskId = toUuid(input.orchestrationTaskId);
  if (!orchestrationTaskId) {
    throw new Error("A valid orchestration task id is required.");
  }

  const actorId = compactText(input.actorId) || "ghost-operator-ui";
  const stage = input.stage ? String(input.stage) as TaskBoardLaneId : null;
  const nextAgentId = input.orchestratorAgentId ? compactText(input.orchestratorAgentId) : null;

  if (!stage && !nextAgentId) {
    throw new Error("At least one orchestration control change is required.");
  }

  if (stage && !operatorStageOptions.includes(stage)) {
    throw new Error("Unsupported orchestration stage.");
  }

  const pool = getPool("app");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentResult = await client.query<Omit<OrchestrationTaskRow, "orchestrator_label">>(
      `
        SELECT
          orchestration_tasks.id::text,
          orchestration_tasks.title,
          orchestration_tasks.description,
          orchestration_tasks.priority_label,
          orchestration_tasks.stage,
          orchestration_tasks.status,
          orchestration_tasks.orchestrator_agent_id::text,
          orchestration_tasks.runtime_task_id::text,
          orchestration_tasks.suggested_route,
          orchestration_tasks.suggested_model,
          orchestration_tasks.planning_note,
          orchestration_tasks.deliverables_note,
          orchestration_tasks.created_at::text,
          orchestration_tasks.updated_at::text
        FROM orchestration_tasks
        WHERE orchestration_tasks.id = $1::uuid
        FOR UPDATE
      `,
      [orchestrationTaskId],
    );

    const current = currentResult.rows[0];
    if (!current) {
      throw new Error("This orchestration task is no longer available.");
    }

    const currentAgentLabelResult = current.orchestrator_agent_id
      ? await client.query<{ display_name: string }>(
          `SELECT display_name FROM agents WHERE id = $1::uuid LIMIT 1`,
          [current.orchestrator_agent_id],
        )
      : { rows: [] as { display_name: string }[] };
    const currentAgentLabel = currentAgentLabelResult.rows[0]?.display_name ?? "Ghost";

    let resolvedAgentId = current.orchestrator_agent_id;
    let resolvedAgentLabel = currentAgentLabel;
    if (nextAgentId && nextAgentId !== current.orchestrator_agent_id) {
      const agentResult = await client.query<{ id: string; display_name: string }>(
        `SELECT id::text, display_name FROM agents WHERE id = $1::uuid LIMIT 1`,
        [nextAgentId],
      );
      const agent = agentResult.rows[0];
      if (!agent) {
        throw new Error("Selected orchestrator agent was not found.");
      }
      resolvedAgentId = agent.id;
      resolvedAgentLabel = agent.display_name;
    }

    const nextStage = stage ?? current.stage;
    const stageChanged = Boolean(stage && stage !== current.stage);
    const assignmentChanged = Boolean(nextAgentId && nextAgentId !== current.orchestrator_agent_id);

    if (!stageChanged && !assignmentChanged) {
      await client.query("ROLLBACK");
      return {
        id: current.id,
        changed: false,
      };
    }

    await client.query(
      `
        UPDATE orchestration_tasks
        SET stage = $2, orchestrator_agent_id = $3::uuid
        WHERE id = $1::uuid
      `,
      [orchestrationTaskId, nextStage, resolvedAgentId],
    );

    if (stageChanged) {
      await client.query(
        `
          INSERT INTO orchestration_task_events (
            orchestration_task_id,
            event_type,
            actor_type,
            actor_id,
            metadata
          )
          VALUES ($1::uuid, 'operator_stage_changed', 'operator', $2, $3::jsonb)
        `,
        [
          orchestrationTaskId,
          actorId,
          JSON.stringify({
            from_stage: current.stage,
            to_stage: nextStage,
            runtime_task_id: current.runtime_task_id,
          }),
        ],
      );
    }

    if (assignmentChanged) {
      await client.query(
        `
          INSERT INTO orchestration_task_events (
            orchestration_task_id,
            event_type,
            actor_type,
            actor_id,
            metadata
          )
          VALUES ($1::uuid, 'operator_assignment_changed', 'operator', $2, $3::jsonb)
        `,
        [
          orchestrationTaskId,
          actorId,
          JSON.stringify({
            from_agent_id: current.orchestrator_agent_id,
            from_agent_label: currentAgentLabel,
            to_agent_id: resolvedAgentId,
            to_agent_label: resolvedAgentLabel,
            runtime_task_id: current.runtime_task_id,
          }),
        ],
      );
    }

    await client.query("COMMIT");
    return {
      id: current.id,
      changed: true,
      stageChanged,
      assignmentChanged,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getGhostMainAgent() {
  const pool = getPool("app");
  const result = await pool.query<{ id: string; display_name: string }>(
    `
      SELECT id::text, display_name
      FROM agents
      WHERE agent_key = 'ghost-main'
      ORDER BY updated_at DESC, created_at ASC
      LIMIT 1
    `,
  );

  return result.rows[0] ?? null;
}

export async function createTaskBoardTask(input: TaskBoardCreateInput) {
  const title = compactText(input.title);
  const description = String(input.description || "").trim();
  const priorityLabel = normalizePriority(input.priorityLabel);
  const suggestedRoute = compactText(input.suggestedRoute) || null;
  const suggestedModel = compactText(input.suggestedModel) || null;
  const planningNote = String(input.planningNote || "").trim() || null;

  if (!title) {
    throw new Error("A task title is required.");
  }

  const ghostMain = await getGhostMainAgent();
  if (!ghostMain) {
    throw new Error("Ghost main orchestrator is not registered in the agents table.");
  }

  const pool = getPool("app");
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO orchestration_tasks (
        title,
        description,
        priority_label,
        stage,
        status,
        orchestrator_agent_id,
        suggested_route,
        suggested_model,
        planning_note
      )
      VALUES ($1, $2, $3, 'assigned', 'awaiting_orchestration', $4::uuid, $5, $6, $7)
      RETURNING id::text
    `,
    [title, description, priorityLabel, ghostMain.id, suggestedRoute, suggestedModel, planningNote],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Task creation did not return an orchestration task id.");
  }

  return {
    id,
    workspaceHref: taskBoardWorkspaceHref("orchestration_task", id),
    runtimeHref: null,
    orchestratorLabel: ghostMain.display_name,
  };
}

function activeLane(laneId: TaskBoardLaneId) {
  return laneId === "assigned" || laneId === "in_progress" || laneId === "testing" || laneId === "review";
}

function buildAgents(cards: TaskBoardCard[], rows: AgentRow[]): TaskBoardAgent[] {
  const cardGroups = new Map<string, TaskBoardCard[]>();

  for (const card of cards) {
    const actor = card.assignedActor;
    if (!actor) {
      continue;
    }

    const key = actor.id || actor.label;
    const group = cardGroups.get(key) ?? [];
    group.push(card);
    cardGroups.set(key, group);
  }

  const agents: TaskBoardAgent[] = rows.map((row) => {
    const cardsForAgent = cardGroups.get(row.id) ?? [];
    const activeCards = cardsForAgent.filter((card) => activeLane(card.laneId));
    const current = sortCards(activeCards)[0] ?? sortCards(cardsForAgent)[0] ?? null;
    const subtitle = [row.agent_type, row.provider, row.model_name].filter(Boolean).join(" · ") || "Runtime agent";

    return {
      id: row.id,
      label: row.display_name,
      subtitle,
      status: activeCards.length ? "working" : "standby",
      currentTaskTitle: current?.title ?? null,
      currentLaneTitle: current ? laneMeta[current.laneId].title : null,
      activeCardCount: activeCards.length,
      sourceMode: "live",
    };
  });

  const knownLabels = new Set(agents.map((agent) => agent.label.toLowerCase()));
  for (const card of cards) {
    const actor = card.assignedActor;
    if (!actor || knownLabels.has(actor.label.toLowerCase())) {
      continue;
    }

    const activeCards = cards.filter((candidate) => candidate.assignedActor?.label === actor.label && activeLane(candidate.laneId));
    const actorCards = cards.filter((candidate) => candidate.assignedActor?.label === actor.label);
    const current = sortCards(activeCards)[0] ?? sortCards(actorCards)[0] ?? null;

    agents.push({
      id: actor.id,
      label: actor.label,
      subtitle:
        card.sourceMode === "orchestration"
          ? "Ghost orchestration owner"
          : actor.kind === "worker"
            ? "Runtime worker"
            : actor.kind === "workflow"
              ? "External workflow"
              : "Runtime actor",
      status: activeCards.length ? "working" : "unknown",
      currentTaskTitle: current?.title ?? null,
      currentLaneTitle: current ? laneMeta[current.laneId].title : null,
      activeCardCount: activeCards.length,
      sourceMode: card.sourceMode === "orchestration" ? "orchestration" : "hybrid",
    });
    knownLabels.add(actor.label.toLowerCase());
  }

  const knownRoleLabels = new Set(agents.map((agent) => agent.label.toLowerCase()));
  const providerLabels = [
    ...new Set(cards.filter((card) => card.sourceMode !== "orchestration").map((card) => card.routeProvider).filter(Boolean) as string[]),
  ];
  for (const providerLabel of providerLabels) {
    if (knownRoleLabels.has(providerLabel.toLowerCase())) {
      continue;
    }

    const providerCards = cards.filter((card) => card.routeProvider === providerLabel);
    const activeCards = providerCards.filter((card) => activeLane(card.laneId));
    const current = sortCards(activeCards)[0] ?? sortCards(providerCards)[0] ?? null;

    agents.push({
      id: `runtime-role:${providerLabel.toLowerCase().replace(/\s+/g, "-")}`,
      label: providerLabel,
      subtitle: "Runtime route · hybrid orchestration role",
      status: activeCards.length ? "working" : "standby",
      currentTaskTitle: current?.title ?? null,
      currentLaneTitle: current ? laneMeta[current.laneId].title : null,
      activeCardCount: activeCards.length,
      sourceMode: "hybrid",
    });
    knownRoleLabels.add(providerLabel.toLowerCase());
  }

  return agents.sort((left, right) => {
    const statusScore = (value: TaskBoardAgent["status"]) => (value === "working" ? 0 : value === "standby" ? 1 : 2);
    return statusScore(left.status) - statusScore(right.status) || left.label.localeCompare(right.label);
  });
}

function toneForFeed(eventTitle: string, detail: string) {
  if (includesToken(eventTitle, "reconciled") || includesToken(detail, "reconciled")) {
    return "danger" as const;
  }
  if (includesToken(eventTitle, "approval") || includesToken(detail, "review") || includesToken(detail, "stale")) {
    return "warning" as const;
  }
  if (includesToken(eventTitle, "completed") || includesToken(eventTitle, "reply") || includesToken(eventTitle, "artifact") || includesToken(eventTitle, "queued")) {
    return "success" as const;
  }
  return "neutral" as const;
}

function buildRuntimeFeed(payload: TaskOverviewPayload, cards: TaskBoardCard[]): TaskBoardFeedItem[] {
  const cardsByTask = new Map(cards.filter((card) => card.taskId).map((card) => [card.taskId as string, card]));

  return [...payload.activity]
    .filter((event) => event.taskId && cardsByTask.has(event.taskId))
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .map<TaskBoardFeedItem>((event) => {
      const card = event.taskId ? cardsByTask.get(event.taskId) ?? null : null;
      const actorLabel = card?.assignedActor?.label ?? null;
      const laneTitle = card ? laneMeta[card.laneId].title : null;
      return {
        id: event.id,
        title: event.title,
        detail: [card?.title, laneTitle ? `Lane: ${laneTitle}` : null, actorLabel ? `Owner: ${actorLabel}` : null, event.detail]
          .filter(Boolean)
          .join(" · "),
        timestamp: event.timestamp,
        tone: toneForFeed(event.title, event.detail),
        group: "runtime_signals",
        taskId: event.taskId ?? null,
        actorLabel,
        href: card?.detailHref ?? (event.taskId ? `/task-overview/${event.taskId}` : null),
      };
    });
}

function buildOrchestrationFeed(
  rows: OrchestrationTaskRow[],
  links: Map<string, DelegationLinkRow>,
  events: Map<string, OrchestrationTaskEventRow[]>,
): TaskBoardFeedItem[] {
  const items = rows.flatMap<TaskBoardFeedItem>((row) => {
    const linkage = links.get(row.id) ?? null;
    const routeHint = compactText(row.suggested_route);
    const modelHint = compactText(row.suggested_model);
    const title = linkage
      ? linkage.completed_at
        ? "Delegated worker completed"
        : linkage.started_at
          ? "Delegated worker running"
          : "Delegated worker queued"
      : "Queued for Ghost orchestrator";
    const base: TaskBoardFeedItem = {
      id: `orch-feed:${row.id}`,
      title,
      detail: [
        row.title,
        `Lane: ${laneLabel(row.stage)}`,
        row.orchestrator_label ? `Owner: ${row.orchestrator_label}` : null,
        linkage?.worker_agent_label ? `Worker: ${linkage.worker_agent_label}` : null,
        linkage?.worker_conversation_id ? `Worker session: ${linkage.worker_conversation_id}` : null,
        routeHint ? `Suggested route: ${routeHint}` : null,
        modelHint ? `Suggested model: ${modelHint}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: toIsoTimestamp(linkage?.updated_at) ?? toIsoTimestamp(row.updated_at) ?? row.updated_at,
      tone: linkage?.completed_at ? "success" : linkage?.started_at ? "warning" : "neutral",
      group: linkage ? "runtime_signals" : "operator_actions",
      taskId: row.runtime_task_id,
      actorLabel: row.orchestrator_label,
      href: taskBoardWorkspaceHref("orchestration_task", row.id),
    };

    const eventItems = (events.get(row.id) ?? []).map((event) =>
      formatOrchestrationEvent(event, row.title, taskBoardWorkspaceHref("orchestration_task", row.id)),
    );
    return [base, ...eventItems];
  });
  return items;
}

function buildFeed(runtimeFeed: TaskBoardFeedItem[], orchestrationFeed: TaskBoardFeedItem[]) {
  return [...runtimeFeed, ...orchestrationFeed]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 16);
}

export async function getTaskBoardPayload(): Promise<TaskBoardPayload> {
  const [overview, agentRows, orchestrationRows, delegationRows, orchestrationEvents, agentOptions] = await Promise.all([
    getTaskOverviewPayload(),
    getAgents(),
    getOrchestrationTasks(),
    getDelegationLinks(),
    getOrchestrationTaskEvents(),
    getAssignableOrchestrationAgents(),
  ]);
  const activity = latestActivityByTask(overview);
  const runtimeTasksById = new Map(overview.tasks.map((task) => [task.id, task]));
  const links = buildOrchestrationLinkageMaps(delegationRows);
  const eventsByTask = new Map<string, OrchestrationTaskEventRow[]>();
  for (const event of orchestrationEvents) {
    const group = eventsByTask.get(event.orchestration_task_id) ?? [];
    group.push(event);
    eventsByTask.set(event.orchestration_task_id, group);
  }
  const orchestrationCards = orchestrationRows.map((row) =>
    cardForOrchestrationTask(row, links.byOrchestrationId.get(row.id) ?? null, row.runtime_task_id ? runtimeTasksById.get(row.runtime_task_id) ?? null : null, activity),
  );
  const linkedRuntimeTaskIds = new Set(orchestrationRows.map((row) => row.runtime_task_id).filter(Boolean) as string[]);
  const runtimeCards = overview.tasks
    .filter((task) => !linkedRuntimeTaskIds.has(task.id))
    .map((task) => cardForTask(task, activity));
  const cards = [...orchestrationCards, ...runtimeCards];

  const lanes: TaskBoardLane[] = (Object.keys(laneMeta) as TaskBoardLaneId[]).map((laneId) => {
    const laneCards = sortCards(cards.filter((card) => card.laneId === laneId));
    return {
      id: laneId,
      title: laneMeta[laneId].title,
      description: laneMeta[laneId].description,
      count: laneCards.length,
      cards: laneCards,
    };
  });

  const agents = buildAgents(cards, agentRows);
  const feed = buildFeed(buildRuntimeFeed(overview, cards), buildOrchestrationFeed(orchestrationRows, links.byOrchestrationId, eventsByTask));

  return {
    generatedAt: overview.generatedAt,
    summary: {
      totalCards: cards.length,
      activeAgents: agents.filter((agent) => agent.status === "working").length,
      tasksInQueue: lanes.filter((lane) => lane.id === "planning" || lane.id === "inbox" || lane.id === "assigned").reduce((sum, lane) => sum + lane.count, 0),
      tasksInProgress: lanes.filter((lane) => lane.id === "in_progress" || lane.id === "testing").reduce((sum, lane) => sum + lane.count, 0),
      reviewNeeded: lanes.find((lane) => lane.id === "review")?.count ?? 0,
      resolved: lanes.find((lane) => lane.id === "done")?.count ?? 0,
      lastUpdatedAt:
        [overview.summary.lastUpdatedAt ?? null, toIsoTimestamp(orchestrationRows[0]?.updated_at) ?? null]
          .filter(Boolean)
          .sort((left, right) => new Date(left as string).getTime() - new Date(right as string).getTime())
          .at(-1) ?? overview.generatedAt,
    },
    agents,
    lanes,
    feed,
    controls: {
      stageOptions: taskBoardOperatorStageOptions(),
      agentOptions,
    },
    degraded: overview.degraded,
    errors: overview.errors,
    mappingMode: orchestrationCards.length ? "live_plus_orchestration" : "derived_runtime_truth",
  };
}

export async function getOrchestrationTaskRecord(itemId: string) {
  const orchestrationId = toUuid(itemId);
  if (!orchestrationId) {
    return null;
  }

  const pool = getPool("app");
  const result = await pool.query<OrchestrationTaskRow>(
    `
      SELECT
        orchestration_tasks.id::text,
        orchestration_tasks.title,
        orchestration_tasks.description,
        orchestration_tasks.priority_label,
        orchestration_tasks.stage,
        orchestration_tasks.status,
        orchestration_tasks.orchestrator_agent_id::text,
        orchestration_tasks.runtime_task_id::text,
        orchestration_tasks.suggested_route,
        orchestration_tasks.suggested_model,
        orchestration_tasks.planning_note,
        orchestration_tasks.deliverables_note,
        orchestration_tasks.created_at::text,
        orchestration_tasks.updated_at::text,
        agents.display_name AS orchestrator_label
      FROM orchestration_tasks
      LEFT JOIN agents ON agents.id = orchestration_tasks.orchestrator_agent_id
      WHERE orchestration_tasks.id = $1::uuid
      LIMIT 1
    `,
    [orchestrationId],
  );

  return result.rows[0] ?? null;
}
