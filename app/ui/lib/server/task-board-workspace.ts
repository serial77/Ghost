import type { TaskBoardFeedItem, TaskBoardWorkspaceItem, TaskBoardWorkspacePayload } from "@/lib/operations";
import { getTaskDetailPayload } from "@/lib/server/task-detail";
import {
  getAssignableOrchestrationAgents,
  getDelegationLinkForOrchestrationTask,
  getDelegationLinkForRuntimeTask,
  getTaskBoardPayload,
  getOrchestrationTaskRecord,
  taskBoardOperatorStageOptions,
  taskBoardLaneMeta,
  taskBoardRuntimeHref,
} from "@/lib/server/task-board";

function compactText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function statusLabel(value: string | null | undefined) {
  const normalized = compactText(value);
  return normalized ? normalized.replace(/_/g, " ") : "unknown";
}

function toIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function workspaceOwnership(sourceMode: TaskBoardWorkspaceItem["sourceMode"], runtimeOverridesBoardStage: boolean) {
  if (sourceMode === "orchestration" && !runtimeOverridesBoardStage) {
    return {
      mode: "board_owned" as const,
      label: "Board-owned",
      detail: "You are editing orchestration metadata directly. No canonical runtime execution is linked yet.",
    };
  }
  if (runtimeOverridesBoardStage || sourceMode === "hybrid") {
    return {
      mode: "hybrid" as const,
      label: "Hybrid",
      detail: "Runtime execution owns the visible execution state. Board controls only adjust orchestration metadata.",
    };
  }
  return {
    mode: "runtime_owned" as const,
    label: "Runtime-owned",
    detail: "This workspace reflects canonical runtime truth. Board controls are read-only here.",
  };
}

function parseBoardItemId(itemId: string) {
  if (itemId.startsWith("orch_")) {
    return { kind: "orchestration_task" as const, id: itemId.slice(5) };
  }
  if (itemId.startsWith("runtime_")) {
    return { kind: "runtime_task" as const, id: itemId.slice(8) };
  }
  return null;
}

function runtimeSummaryFromDetail(payload: Awaited<ReturnType<typeof getTaskDetailPayload>>) {
  const task = payload.task;
  if (!task) {
    return null;
  }

  return {
    runtimeTaskId: task.id,
    runtimeHref: taskBoardRuntimeHref(task.id),
    statusLabel: statusLabel(task.status),
    runCount: task.runCount,
    eventCount: task.eventCount,
    lastRuntimeAt: task.lastEventAt ?? task.updatedAt ?? null,
  };
}

function boardActivityForTask(activity: TaskBoardFeedItem[], taskId: string) {
  return activity.filter((item) => item.taskId === taskId).slice(0, 12);
}

export async function getTaskBoardWorkspacePayload(itemId: string): Promise<TaskBoardWorkspacePayload> {
  const parsed = parseBoardItemId(itemId);
  if (!parsed) {
      return {
        generatedAt: new Date().toISOString(),
        item: null,
        activity: [],
        runtimeActivity: [],
        runtimeSummary: null,
        controls: {
          editable: false,
          stageOptions: taskBoardOperatorStageOptions(),
          agentOptions: [],
        },
        degraded: true,
        errors: ["Unknown task board item id."],
      };
  }

  if (parsed.kind === "orchestration_task") {
    const [row, board, delegation, agentOptions] = await Promise.all([
      getOrchestrationTaskRecord(parsed.id),
      getTaskBoardPayload(),
      getDelegationLinkForOrchestrationTask(parsed.id),
      getAssignableOrchestrationAgents(),
    ]);
    if (!row) {
      return {
        generatedAt: new Date().toISOString(),
        item: null,
        activity: [],
        runtimeActivity: [],
        runtimeSummary: null,
        controls: {
          editable: false,
          stageOptions: taskBoardOperatorStageOptions(),
          agentOptions,
        },
        degraded: true,
        errors: ["This orchestration task is no longer available."],
      };
    }

    const boardCard = board.lanes.flatMap((lane) => lane.cards).find((entry) => entry.id === `orch_${row.id}`) ?? null;
    const lane = taskBoardLaneMeta(row.stage);
    const ownership = workspaceOwnership(boardCard?.sourceMode ?? "orchestration", Boolean(row.runtime_task_id));
    const item: TaskBoardWorkspaceItem = {
      id: `orch_${row.id}`,
      kind: "orchestration_task",
      title: row.title,
      summary: boardCard?.summary ?? row.description ?? "Operator-created work waiting for Ghost orchestration.",
      description: row.description,
      stageLabel: boardCard?.stageLabel ?? (row.stage === "assigned" ? "Queued for Ghost" : lane.title),
      stageReason: boardCard?.stageReason ?? "Ghost main orchestrator owns first assignment and handoff decisions for this task.",
      statusLabel: boardCard ? statusLabel(boardCard.status) : statusLabel(row.status),
      priorityLabel: row.priority_label,
      orchestratorLabel: row.orchestrator_label ?? "Ghost",
      orchestrationOwner: boardCard?.orchestrationOwner ?? {
        id: row.orchestrator_agent_id ?? "ghost-main",
        label: row.orchestrator_label ?? "Ghost",
        kind: "agent",
      },
      assignedActor: boardCard?.assignedActor ?? {
        id: row.orchestrator_agent_id ?? "ghost-main",
        label: row.orchestrator_label ?? "Ghost",
        kind: "agent",
      },
      freshnessLabel: boardCard?.freshnessLabel ?? "awaiting orchestration",
      freshnessDetail: boardCard?.freshnessDetail ?? "This task exists in the orchestration layer and has not yet produced canonical runtime ledger work.",
      latestActivityTitle: boardCard?.latestActivityTitle ?? "Queued for Ghost main orchestrator",
      latestActivityDetail: boardCard?.latestActivityDetail ?? "Ghost main orchestrator is the default intake path for board-created work.",
      latestActivityAt: boardCard?.latestActivityAt ?? toIsoTimestamp(row.updated_at),
      suggestedRoute: boardCard?.suggestedRoute ?? row.suggested_route,
      suggestedModel: boardCard?.suggestedModel ?? row.suggested_model,
      planningNote: row.planning_note,
      deliverablesNote: boardCard?.deliverablesNote ?? row.deliverables_note,
      artifactPath: boardCard?.artifactPath ?? null,
      runtimeTaskId: row.runtime_task_id,
      runtimeHref: taskBoardRuntimeHref(row.runtime_task_id),
      delegationId: delegation?.delegation_id ?? null,
      delegationStatus: delegation?.delegation_status ?? null,
      parentConversationId: delegation?.parent_conversation_id ?? null,
      workerConversationId: delegation?.worker_conversation_id ?? null,
      workerAgentLabel: delegation?.worker_agent_label ?? null,
      workerProvider: delegation?.worker_provider ?? null,
      workerModel: delegation?.worker_model ?? null,
      delegationStartedAt: toIsoTimestamp(delegation?.started_at) ?? delegation?.started_at ?? null,
      delegationCompletedAt: toIsoTimestamp(delegation?.completed_at) ?? delegation?.completed_at ?? null,
      boardStage: row.stage,
      boardStageLabel: lane.title,
      runtimeOverridesBoardStage: Boolean(row.runtime_task_id),
      ownershipMode: ownership.mode,
      ownershipLabel: ownership.label,
      ownershipDetail: ownership.detail,
      sourceMode: boardCard?.sourceMode ?? "orchestration",
      createdAt: toIsoTimestamp(row.created_at) ?? row.created_at,
      updatedAt: boardCard?.updatedAt ?? toIsoTimestamp(row.updated_at) ?? row.updated_at,
    };

    const activity: TaskBoardFeedItem[] = [
      {
        id: `workspace-orch:${row.id}`,
        title: delegation ? "Delegation linked to worker runtime" : "Queued for Ghost orchestrator",
        detail: [
          row.title,
          delegation?.worker_agent_label ? `Worker: ${delegation.worker_agent_label}` : null,
          delegation?.parent_conversation_id ? `Parent: ${delegation.parent_conversation_id}` : null,
          delegation?.worker_conversation_id ? `Worker session: ${delegation.worker_conversation_id}` : null,
          row.suggested_route ? `Suggested route: ${row.suggested_route}` : null,
          row.suggested_model ? `Suggested model: ${row.suggested_model}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        timestamp: toIsoTimestamp(delegation?.updated_at) ?? toIsoTimestamp(row.updated_at) ?? row.updated_at,
        tone: delegation?.completed_at ? "success" : delegation?.started_at ? "warning" : "neutral",
        group: delegation ? "runtime_signals" : "operator_actions",
        taskId: row.runtime_task_id,
        actorLabel: row.orchestrator_label ?? "Ghost",
        href: null,
      },
      ...board.feed.filter((feedItem) => feedItem.href === `/task-board/orch_${row.id}`),
    ];

    let runtimeActivity = [] as TaskBoardWorkspacePayload["runtimeActivity"];
    let runtimeSummary = null as TaskBoardWorkspacePayload["runtimeSummary"];

    if (row.runtime_task_id) {
      const runtimeDetail = await getTaskDetailPayload(row.runtime_task_id, { eventLimit: 8 });
      runtimeActivity = runtimeDetail.activity;
      runtimeSummary = runtimeSummaryFromDetail(runtimeDetail);
    }

    return {
      generatedAt: board.generatedAt,
      item,
      activity,
      runtimeActivity,
      runtimeSummary,
      controls: {
        editable: true,
        stageOptions: taskBoardOperatorStageOptions(),
        agentOptions,
      },
      degraded: board.degraded,
      errors: board.errors,
    };
  }

  const [board, runtimeDetail] = await Promise.all([getTaskBoardPayload(), getTaskDetailPayload(parsed.id, { eventLimit: 12 })]);
  const card = board.lanes.flatMap((lane) => lane.cards).find((entry) => entry.id === `runtime_${parsed.id}`) ?? null;
  const task = runtimeDetail.task;

  if (!card || !task) {
    return {
      generatedAt: new Date().toISOString(),
      item: null,
      activity: [],
      runtimeActivity: [],
      runtimeSummary: null,
      controls: {
        editable: false,
        stageOptions: taskBoardOperatorStageOptions(),
        agentOptions: [],
      },
      degraded: true,
      errors: ["This runtime-backed board task is no longer available."],
    };
  }

  const delegation = await getDelegationLinkForRuntimeTask(parsed.id);
  const ownership = workspaceOwnership(card.sourceMode, false);
  const item: TaskBoardWorkspaceItem = {
    id: card.id,
    kind: "runtime_task",
    title: card.title,
    summary: card.summary,
    description: task.latestUserMessage ?? card.summary,
    stageLabel: card.stageLabel,
    stageReason: card.stageReason,
    statusLabel: statusLabel(card.status),
    priorityLabel: card.priorityLabel,
    orchestratorLabel: "Ghost",
    assignedActor: card.assignedActor ?? null,
    orchestrationOwner: card.orchestrationOwner ?? null,
    freshnessLabel: card.freshnessLabel ?? null,
    freshnessDetail: card.freshnessDetail ?? null,
    latestActivityTitle: card.latestActivityTitle ?? null,
    latestActivityDetail: card.latestActivityDetail ?? null,
    latestActivityAt: card.latestActivityAt ?? null,
    suggestedRoute: card.suggestedRoute ?? null,
    suggestedModel: card.suggestedModel ?? null,
    planningNote: card.planningNote ?? null,
    deliverablesNote: task.resultSummary ?? card.deliverablesNote ?? null,
    artifactPath: task.artifactPath ?? card.artifactPath ?? null,
    runtimeTaskId: task.id,
    runtimeHref: taskBoardRuntimeHref(task.id),
    delegationId: delegation?.delegation_id ?? null,
    delegationStatus: delegation?.delegation_status ?? null,
    parentConversationId: delegation?.parent_conversation_id ?? task.conversationId ?? null,
    workerConversationId: delegation?.worker_conversation_id ?? null,
    workerAgentLabel: delegation?.worker_agent_label ?? task.assignedActor?.label ?? null,
    workerProvider: delegation?.worker_provider ?? task.routeProvider ?? null,
    workerModel: delegation?.worker_model ?? task.routeModel ?? null,
    delegationStartedAt: toIsoTimestamp(delegation?.started_at) ?? delegation?.started_at ?? null,
    delegationCompletedAt: toIsoTimestamp(delegation?.completed_at) ?? delegation?.completed_at ?? null,
    boardStage: null,
    boardStageLabel: null,
    runtimeOverridesBoardStage: false,
    ownershipMode: ownership.mode,
    ownershipLabel: ownership.label,
    ownershipDetail: ownership.detail,
    sourceMode: card.sourceMode,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  return {
    generatedAt: board.generatedAt,
    item,
    activity: boardActivityForTask(board.feed, task.id),
    runtimeActivity: runtimeDetail.activity,
    runtimeSummary: runtimeSummaryFromDetail(runtimeDetail),
    controls: {
      editable: false,
      stageOptions: taskBoardOperatorStageOptions(),
      agentOptions: [],
    },
    degraded: board.degraded || runtimeDetail.degraded,
    errors: [...board.errors, ...runtimeDetail.errors],
  };
}
