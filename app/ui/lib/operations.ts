export type OperationsSourceId = "ghost_app" | "n8n_core";

export type OperationalRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "attention"
  | "unknown";

export type OperationalEventType =
  | "user_prompt"
  | "assistant_reply"
  | "execution_started"
  | "execution_finished"
  | "approval_required"
  | "artifact_emitted"
  | "operator_reconciled";

export interface OperatorSessionContext {
  operatorIdentity?: string | null;
  operatorIdentitySource?: "operator_provided" | null;
  operatorSource?: string | null;
  operatorSessionId?: string | null;
  operatorSessionStartedAt?: string | null;
  requestOrigin?: string | null;
  requestReferer?: string | null;
  requestUserAgent?: string | null;
}

export interface TaskTransition {
  id: string;
  kind:
    | "task_created"
    | "dispatch_started"
    | "approval_required"
    | "artifact_emitted"
    | "reply_recorded"
    | "runtime_completed"
    | "runtime_failed"
    | "operator_reconciled";
  title: string;
  detail: string;
  timestamp: string;
  status: OperationalRunStatus;
  evidence: "explicit_event" | "task_record" | "run_record" | "reconciliation_metadata";
}

export interface TaskStateDiff {
  id: string;
  category:
    | "completion_mode"
    | "status"
    | "entrypoint"
    | "execution_target"
    | "workflow"
    | "provider"
    | "model"
    | "approval"
    | "artifact"
    | "duration";
  title: string;
  detail: string;
  evidence: "run_comparison" | "task_vs_reconciliation";
}

export interface TaskAttentionHint {
  id: string;
  tone: "warning" | "danger" | "neutral";
  title: string;
  detail: string;
  evidence: "task_record" | "run_comparison" | "event_gap" | "reconciliation_metadata";
}

export interface OperationalActor {
  id: string;
  label: string;
  kind: "agent" | "worker" | "workflow";
}

export interface SourceProvenance {
  sourceId: OperationsSourceId;
  label: string;
  detail: string;
}

export interface OperationalTask {
  id: string;
  title: string;
  status: OperationalRunStatus;
  source: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  currentPhase?: string | null;
  conversationId?: string | null;
  taskType?: string | null;
  assignedActor?: OperationalActor | null;
  latestRunId?: string | null;
  latestRunStatus?: OperationalRunStatus | null;
  latestRunDurationMs?: number | null;
  eventCount: number;
  runCount: number;
  approvalRequired?: boolean;
  artifactPath?: string | null;
  latestUserMessage?: string | null;
  latestAssistantReply?: string | null;
  errorSummary?: string | null;
  resultSummary?: string | null;
  entrypoint?: string | null;
  executionTarget?: string | null;
  workflowName?: string | null;
  routeProvider?: string | null;
  routeModel?: string | null;
  lastEventAt?: string | null;
  freshnessLabel?: string | null;
  freshnessDetail?: string | null;
  staleCandidate?: boolean;
  completionSource?: "runtime_confirmed" | "operator_reconciled" | null;
  reconciledAt?: string | null;
  reconciledBy?: string | null;
  operatorIdentity?: string | null;
  operatorIdentitySource?: "operator_provided" | null;
  operatorSource?: string | null;
  operatorSessionId?: string | null;
  operatorSessionStartedAt?: string | null;
  requestOrigin?: string | null;
  requestReferer?: string | null;
  reconciliationNote?: string | null;
  provenance: SourceProvenance;
}

export interface OperationalRun {
  id: string;
  taskId?: string | null;
  title: string;
  status: OperationalRunStatus;
  sourceType: "ghost_turn" | "workflow_execution";
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  conversationId?: string | null;
  executionId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  taskClass?: string | null;
  providerUsed?: string | null;
  modelUsed?: string | null;
  artifactPath?: string | null;
  approvalRequired?: boolean;
  latestUserMessage?: string | null;
  latestAssistantReply?: string | null;
  actor?: OperationalActor | null;
  executionTarget?: string | null;
  lastEventAt?: string | null;
  freshnessLabel?: string | null;
  freshnessDetail?: string | null;
  staleCandidate?: boolean;
  completionSource?: "runtime_confirmed" | "operator_reconciled" | null;
  reconciledAt?: string | null;
  reconciledBy?: string | null;
  operatorIdentity?: string | null;
  operatorIdentitySource?: "operator_provided" | null;
  operatorSource?: string | null;
  operatorSessionId?: string | null;
  operatorSessionStartedAt?: string | null;
  requestOrigin?: string | null;
  requestReferer?: string | null;
  reconciliationNote?: string | null;
  provenance: SourceProvenance;
}

export interface OperationalEvent {
  id: string;
  taskId?: string | null;
  runId: string;
  type: OperationalEventType;
  status: OperationalRunStatus;
  title: string;
  detail: string;
  timestamp: string;
  toolName?: string | null;
  payload?: Record<string, unknown> | null;
  actor?: OperationalActor | null;
  provenance: SourceProvenance;
}

export interface OperationalSourceHealth {
  sourceId: OperationsSourceId;
  label: string;
  status: "live" | "degraded" | "unavailable";
  detail: string;
  lastSeenAt?: string | null;
}

export interface TaskOverviewSummary {
  activeNow: number;
  recentRuns: number;
  technicalRuns: number;
  blockedRuns: number;
  failedRuns: number;
  staleRuns: number;
  lastUpdatedAt?: string | null;
}

export interface TaskOverviewPayload {
  generatedAt: string;
  summary: TaskOverviewSummary;
  tasks: OperationalTask[];
  runs: OperationalRun[];
  activity: OperationalEvent[];
  sourceHealth: OperationalSourceHealth[];
  degraded: boolean;
  errors: string[];
}

export type TaskBoardLaneId = "planning" | "inbox" | "assigned" | "in_progress" | "testing" | "review" | "done";
export type TaskBoardSourceMode = "live" | "hybrid" | "orchestration";
export type TaskBoardItemKind = "runtime_task" | "orchestration_task";

export interface TaskBoardCard {
  id: string;
  itemKind: TaskBoardItemKind;
  taskId?: string | null;
  runtimeTaskId?: string | null;
  title: string;
  summary: string;
  laneId: TaskBoardLaneId;
  stageLabel: string;
  stageReason: string;
  priorityLabel?: string | null;
  handoffLabel?: string | null;
  status: OperationalRunStatus;
  currentPhase?: string | null;
  assignedActor?: OperationalActor | null;
  orchestrationOwner?: OperationalActor | null;
  routeProvider?: string | null;
  entrypoint?: string | null;
  freshnessLabel?: string | null;
  freshnessDetail?: string | null;
  latestActivityTitle?: string | null;
  latestActivityDetail?: string | null;
  latestActivityAt?: string | null;
  approvalRequired?: boolean;
  artifactPath?: string | null;
  staleCandidate?: boolean;
  completionSource?: "runtime_confirmed" | "operator_reconciled" | null;
  suggestedRoute?: string | null;
  suggestedModel?: string | null;
  planningNote?: string | null;
  deliverablesNote?: string | null;
  boardStage?: TaskBoardLaneId | null;
  boardStageLabel?: string | null;
  ownershipMode: "board_owned" | "runtime_owned" | "hybrid";
  ownershipLabel: string;
  ownershipDetail: string;
  updatedAt: string;
  detailHref: string;
  runtimeHref?: string | null;
  sourceMode: TaskBoardSourceMode;
}

export interface TaskBoardLane {
  id: TaskBoardLaneId;
  title: string;
  description: string;
  count: number;
  cards: TaskBoardCard[];
}

export interface TaskBoardAgent {
  id: string;
  label: string;
  subtitle: string;
  status: "working" | "standby" | "unknown";
  currentTaskTitle?: string | null;
  currentLaneTitle?: string | null;
  activeCardCount: number;
  sourceMode: TaskBoardSourceMode;
}

export interface TaskBoardFeedItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: "neutral" | "success" | "warning" | "danger";
  group: "operator_actions" | "runtime_signals";
  taskId?: string | null;
  actorLabel?: string | null;
  href?: string | null;
}

export interface TaskBoardSummary {
  totalCards: number;
  activeAgents: number;
  tasksInQueue: number;
  tasksInProgress: number;
  reviewNeeded: number;
  resolved: number;
  lastUpdatedAt?: string | null;
}

export interface TaskBoardPayload {
  generatedAt: string;
  summary: TaskBoardSummary;
  agents: TaskBoardAgent[];
  lanes: TaskBoardLane[];
  feed: TaskBoardFeedItem[];
  controls: {
    stageOptions: TaskBoardWorkspaceControlOption[];
    agentOptions: TaskBoardWorkspaceControlOption[];
  };
  degraded: boolean;
  errors: string[];
  mappingMode: "derived_runtime_truth" | "live_plus_orchestration";
}

export interface TaskBoardCreateInput {
  title: string;
  description: string;
  priorityLabel?: string | null;
  suggestedRoute?: string | null;
  suggestedModel?: string | null;
  planningNote?: string | null;
}

export interface TaskBoardWorkspaceItem {
  id: string;
  kind: TaskBoardItemKind;
  title: string;
  summary: string;
  description: string;
  stageLabel: string;
  stageReason: string;
  statusLabel: string;
  priorityLabel?: string | null;
  orchestratorLabel?: string | null;
  assignedActor?: OperationalActor | null;
  orchestrationOwner?: OperationalActor | null;
  freshnessLabel?: string | null;
  freshnessDetail?: string | null;
  latestActivityTitle?: string | null;
  latestActivityDetail?: string | null;
  latestActivityAt?: string | null;
  suggestedRoute?: string | null;
  suggestedModel?: string | null;
  planningNote?: string | null;
  deliverablesNote?: string | null;
  artifactPath?: string | null;
  runtimeTaskId?: string | null;
  runtimeHref?: string | null;
  delegationId?: string | null;
  delegationStatus?: string | null;
  parentConversationId?: string | null;
  workerConversationId?: string | null;
  workerAgentLabel?: string | null;
  workerProvider?: string | null;
  workerModel?: string | null;
  delegationStartedAt?: string | null;
  delegationCompletedAt?: string | null;
  boardStage?: TaskBoardLaneId | null;
  boardStageLabel?: string | null;
  runtimeOverridesBoardStage?: boolean;
  ownershipMode: "board_owned" | "runtime_owned" | "hybrid";
  ownershipLabel: string;
  ownershipDetail: string;
  sourceMode: TaskBoardSourceMode;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBoardWorkspaceControlOption {
  id: string;
  label: string;
  detail?: string | null;
}

export interface TaskBoardWorkspacePayload {
  generatedAt: string;
  item: TaskBoardWorkspaceItem | null;
  activity: TaskBoardFeedItem[];
  runtimeActivity: OperationalEvent[];
  runtimeSummary: {
    runtimeTaskId: string | null;
    runtimeHref: string | null;
    statusLabel: string | null;
    runCount: number;
    eventCount: number;
    lastRuntimeAt: string | null;
  } | null;
  controls: {
    editable: boolean;
    stageOptions: TaskBoardWorkspaceControlOption[];
    agentOptions: TaskBoardWorkspaceControlOption[];
  };
  degraded: boolean;
  errors: string[];
}

export interface TaskDetailPayload {
  generatedAt: string;
  task: OperationalTask | null;
  runs: OperationalRun[];
  activity: OperationalEvent[];
  transitions: TaskTransition[];
  diffs: TaskStateDiff[];
  attentionHints: TaskAttentionHint[];
  operatorSession: OperatorSessionContext | null;
  eventPage: {
    limit: number;
    hasMore: boolean;
    nextBefore: string | null;
  };
  degraded: boolean;
  errors: string[];
}
