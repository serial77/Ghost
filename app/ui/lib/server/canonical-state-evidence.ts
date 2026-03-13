import type { OperationalEvent, OperationalRun, OperationalTask } from "@/lib/operations";
import { CANONICAL_EVENT_TITLES } from "@/lib/server/runtime-activity-presentation";

function hasText(value: string | null | undefined) {
  return Boolean(String(value || "").trim());
}

export function isOperatorReconciled(entity: Pick<OperationalTask, "completionSource"> | Pick<OperationalRun, "completionSource"> | null | undefined) {
  return entity?.completionSource === "operator_reconciled";
}

export function isRuntimeConfirmedCompletion(
  entity: Pick<OperationalTask, "completionSource" | "completedAt"> | Pick<OperationalRun, "completionSource" | "finishedAt"> | null | undefined,
) {
  if (!entity) {
    return false;
  }

  return entity.completionSource === "runtime_confirmed";
}

export function hasApprovalRequiredState(entity: Pick<OperationalTask, "approvalRequired"> | Pick<OperationalRun, "approvalRequired"> | null | undefined) {
  return entity?.approvalRequired === true;
}

export function hasArtifactState(entity: Pick<OperationalTask, "artifactPath"> | Pick<OperationalRun, "artifactPath"> | null | undefined) {
  return hasText(entity?.artifactPath);
}

export function hasExplicitRuntimeCompletionEvent(activity: OperationalEvent[]) {
  return activity.some(
    (event) =>
      event.type === "execution_finished" &&
      event.toolName === "ghost-runtime" &&
      (event.title === CANONICAL_EVENT_TITLES.dispatchCompleted ||
        event.title === CANONICAL_EVENT_TITLES.dispatchFailed ||
        event.title === CANONICAL_EVENT_TITLES.runtimeCompleted ||
        event.title === CANONICAL_EVENT_TITLES.runtimeFailed),
  );
}

export function findReplyRecordedEvidence(activity: OperationalEvent[]) {
  return [...activity]
    .reverse()
    .find(
      (event) =>
        event.title === CANONICAL_EVENT_TITLES.replyRecorded ||
        (event.type === "assistant_reply" && event.title === CANONICAL_EVENT_TITLES.taskCreated),
    );
}

export interface TaskStateEvidenceSnapshot {
  latestRun: OperationalRun | null;
  previousRun: OperationalRun | null;
  replyRecordedEvidence: OperationalEvent | null;
  operatorReconciled: boolean;
  runtimeConfirmedCompletion: boolean;
  hasExplicitRuntimeCompletionEvent: boolean;
  latestRunApprovalRequired: boolean;
  previousRunApprovalRequired: boolean;
  latestRunArtifactPresent: boolean;
  previousRunArtifactPresent: boolean;
}

export function buildTaskStateEvidenceSnapshot(
  task: OperationalTask,
  runs: OperationalRun[],
  activity: OperationalEvent[],
): TaskStateEvidenceSnapshot {
  const latestRun = runs[0] ?? null;
  const previousRun = runs[1] ?? null;

  return {
    latestRun,
    previousRun,
    replyRecordedEvidence: findReplyRecordedEvidence(activity) ?? null,
    operatorReconciled: isOperatorReconciled(task),
    runtimeConfirmedCompletion: isRuntimeConfirmedCompletion(task),
    hasExplicitRuntimeCompletionEvent: hasExplicitRuntimeCompletionEvent(activity),
    latestRunApprovalRequired: hasApprovalRequiredState(latestRun),
    previousRunApprovalRequired: hasApprovalRequiredState(previousRun),
    latestRunArtifactPresent: hasArtifactState(latestRun),
    previousRunArtifactPresent: hasArtifactState(previousRun),
  };
}
