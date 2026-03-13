import type { OperationalEvent, OperationalTask, TaskTransition } from "@/lib/operations";
import {
  type TaskStateEvidenceSnapshot,
} from "@/lib/server/canonical-state-evidence";
import { CANONICAL_EVENT_TITLES } from "@/lib/server/runtime-activity-presentation";

function detailOrFallback(detail: string | null | undefined, fallback: string) {
  const text = String(detail || "").trim();
  return text || fallback;
}

function timestampOrNull(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export function deriveTaskTransitions(task: OperationalTask, activity: OperationalEvent[], evidence: TaskStateEvidenceSnapshot): TaskTransition[] {
  const transitions: TaskTransition[] = [];
  const seen = new Set<string>();

  function push(transition: TaskTransition | null) {
    if (!transition || seen.has(transition.id)) {
      return;
    }

    seen.add(transition.id);
    transitions.push(transition);
  }

  push({
    id: `task-created:${task.id}`,
    kind: "task_created",
    title: CANONICAL_EVENT_TITLES.taskCreated,
    detail: detailOrFallback(task.latestUserMessage || task.title, "Canonical task row created in the ledger."),
    timestamp: timestampOrNull(task.createdAt) || new Date().toISOString(),
    status: "queued",
    evidence: "task_record",
  });

  const dispatchEvent = activity.find((event) => event.type === "execution_started");
  if (dispatchEvent) {
    push({
      id: `dispatch:${dispatchEvent.id}`,
      kind: "dispatch_started",
      title: CANONICAL_EVENT_TITLES.dispatchStarted,
      detail: dispatchEvent.detail,
      timestamp: timestampOrNull(dispatchEvent.timestamp) || new Date().toISOString(),
      status: eventStatusOrFallback(dispatchEvent.status, "running"),
      evidence: "explicit_event",
    });
  } else if (task.startedAt) {
    push({
      id: `dispatch-inferred:${task.id}`,
      kind: "dispatch_started",
      title: CANONICAL_EVENT_TITLES.dispatchStarted,
      detail: "No explicit dispatch-start event was recorded. This transition is inferred from the run start timestamp.",
      timestamp: timestampOrNull(task.startedAt) || new Date().toISOString(),
      status: "running",
      evidence: "run_record",
    });
  }

  for (const event of activity) {
    if (event.type === "approval_required") {
      push({
        id: `approval:${event.id}`,
        kind: "approval_required",
        title: CANONICAL_EVENT_TITLES.approvalRequired,
        detail: event.detail,
        timestamp: timestampOrNull(event.timestamp) || new Date().toISOString(),
        status: eventStatusOrFallback(event.status, "blocked"),
        evidence: "explicit_event",
      });
    }

    if (event.type === "artifact_emitted") {
      push({
        id: `artifact:${event.id}`,
        kind: "artifact_emitted",
        title: CANONICAL_EVENT_TITLES.artifactRecorded,
        detail: event.detail,
        timestamp: timestampOrNull(event.timestamp) || new Date().toISOString(),
        status: eventStatusOrFallback(event.status, "succeeded"),
        evidence: "explicit_event",
      });
    }
  }

  const replyEvent = evidence.replyRecordedEvidence;
  if (replyEvent) {
    push({
      id: `reply:${replyEvent.id}`,
      kind: "reply_recorded",
      title: CANONICAL_EVENT_TITLES.replyRecorded,
      detail:
        replyEvent.title === CANONICAL_EVENT_TITLES.taskCreated
          ? detailOrFallback(task.latestAssistantReply, replyEvent.detail)
          : replyEvent.detail,
      timestamp: timestampOrNull(replyEvent.timestamp) || new Date().toISOString(),
      status: eventStatusOrFallback(replyEvent.status, "succeeded"),
      evidence: "explicit_event",
    });
  } else if (task.latestAssistantReply && task.completedAt) {
    push({
      id: `reply-inferred:${task.id}`,
      kind: "reply_recorded",
      title: CANONICAL_EVENT_TITLES.replyRecorded,
      detail: "No dedicated reply-recorded event was found. This transition is inferred from the completed task result.",
      timestamp: timestampOrNull(task.completedAt) || new Date().toISOString(),
      status: "succeeded",
      evidence: "task_record",
    });
  }

  if (evidence.operatorReconciled && task.reconciledAt) {
    push({
      id: `operator:${task.id}:${task.reconciledAt}`,
      kind: "operator_reconciled",
      title: CANONICAL_EVENT_TITLES.operatorReconciled,
      detail: detailOrFallback(
        task.reconciliationNote,
        "Runtime did not confirm a terminal state. An operator later marked the task as failed.",
      ),
      timestamp: timestampOrNull(task.reconciledAt) || new Date().toISOString(),
      status: "failed",
      evidence: "reconciliation_metadata",
    });
  } else if (task.status === "failed" && task.completedAt) {
    push({
      id: `failed:${task.id}`,
      kind: "runtime_failed",
      title: "Runtime failure recorded",
      detail: detailOrFallback(task.errorSummary, "The ledger recorded a terminal failed state."),
      timestamp: timestampOrNull(task.completedAt) || new Date().toISOString(),
      status: "failed",
      evidence: "task_record",
    });
  } else if (task.completedAt) {
    push({
      id: `completed:${task.id}`,
      kind: "runtime_completed",
      title: CANONICAL_EVENT_TITLES.runtimeCompleted,
      detail: detailOrFallback(task.resultSummary, "The ledger recorded a terminal completed state."),
      timestamp: timestampOrNull(task.completedAt) || new Date().toISOString(),
      status: "succeeded",
      evidence: "task_record",
    });
  }

  return transitions.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function eventStatusOrFallback(value: OperationalEvent["status"] | undefined, fallback: TaskTransition["status"]) {
  return value || fallback;
}
