import type { OperationalEvent, OperationalRun, OperationalTask, TaskAttentionHint, TaskStateDiff } from "@/lib/operations";
import {
  type TaskStateEvidenceSnapshot,
} from "@/lib/server/canonical-state-evidence";

function hasText(value: string | null | undefined) {
  return Boolean(String(value || "").trim());
}

function fmt(value: string | null | undefined, fallback = "unknown") {
  return hasText(value) ? String(value).trim() : fallback;
}

function diff(
  diffs: TaskStateDiff[],
  category: TaskStateDiff["category"],
  title: string,
  previous: string | null | undefined,
  current: string | null | undefined,
  evidence: TaskStateDiff["evidence"],
) {
  const left = hasText(previous) ? String(previous).trim() : null;
  const right = hasText(current) ? String(current).trim() : null;

  if (left === right || (!left && !right)) {
    return;
  }

  diffs.push({
    id: `${category}:${evidence}:${left ?? "none"}:${right ?? "none"}`,
    category,
    title,
    detail: `Changed from ${fmt(left)} to ${fmt(right)}.`,
    evidence,
  });
}

function boolDiff(
  diffs: TaskStateDiff[],
  category: Extract<TaskStateDiff["category"], "approval" | "artifact">,
  title: string,
  previous: boolean,
  current: boolean,
  evidence: TaskStateDiff["evidence"],
) {
  if (previous === current) {
    return;
  }

  diffs.push({
    id: `${category}:${evidence}:${previous}:${current}`,
    category,
    title,
    detail: `Changed from ${previous ? "present" : "absent"} to ${current ? "present" : "absent"}.`,
    evidence,
  });
}

function durationLabel(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "unknown";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

export function deriveTaskDiffs(task: OperationalTask, runs: OperationalRun[], evidence: TaskStateEvidenceSnapshot): TaskStateDiff[] {
  const diffs: TaskStateDiff[] = [];
  const latestRun = evidence.latestRun ?? runs[0] ?? null;
  const previousRun = evidence.previousRun ?? runs[1] ?? null;

  if (evidence.operatorReconciled) {
    diffs.push({
      id: `completion-mode:${task.id}`,
      category: "completion_mode",
      title: "Completion mode changed",
      detail: "Runtime confirmation was not recorded. The terminal state now reflects later operator reconciliation.",
      evidence: "task_vs_reconciliation",
    });
  }

  if (!latestRun || !previousRun) {
    return diffs;
  }

  diff(diffs, "status", "Run status changed", previousRun.status, latestRun.status, "run_comparison");
  diff(diffs, "execution_target", "Execution target changed", previousRun.executionTarget, latestRun.executionTarget, "run_comparison");
  diff(diffs, "workflow", "Workflow changed", previousRun.workflowName, latestRun.workflowName, "run_comparison");
  diff(diffs, "provider", "Provider changed", previousRun.providerUsed, latestRun.providerUsed, "run_comparison");
  diff(diffs, "model", "Model changed", previousRun.modelUsed, latestRun.modelUsed, "run_comparison");
  boolDiff(diffs, "approval", "Approval requirement changed", evidence.previousRunApprovalRequired, evidence.latestRunApprovalRequired, "run_comparison");
  boolDiff(diffs, "artifact", "Artifact output changed", evidence.previousRunArtifactPresent, evidence.latestRunArtifactPresent, "run_comparison");

  if (
    latestRun.durationMs !== null &&
    latestRun.durationMs !== undefined &&
    previousRun.durationMs !== null &&
    previousRun.durationMs !== undefined &&
    previousRun.durationMs > 0
  ) {
    const ratio = latestRun.durationMs / previousRun.durationMs;
    if (ratio >= 2 || ratio <= 0.5) {
      diffs.push({
        id: `duration:run_comparison:${previousRun.id}:${latestRun.id}`,
        category: "duration",
        title: "Run duration changed materially",
        detail: `Changed from ${durationLabel(previousRun.durationMs)} to ${durationLabel(latestRun.durationMs)}.`,
        evidence: "run_comparison",
      });
    }
  }

  return diffs;
}

export function deriveTaskAttentionHints(
  task: OperationalTask,
  runs: OperationalRun[],
  activity: OperationalEvent[],
  evidence: TaskStateEvidenceSnapshot,
): TaskAttentionHint[] {
  const hints: TaskAttentionHint[] = [];
  const latestRun = evidence.latestRun ?? runs[0] ?? null;
  const previousRun = evidence.previousRun ?? runs[1] ?? null;

  if (evidence.operatorReconciled) {
    hints.push({
      id: `operator-reconciled:${task.id}`,
      tone: "danger",
      title: "Operator intervention set the terminal state",
      detail: "The runtime did not confirm a terminal outcome. An operator later reconciled this task as failed.",
      evidence: "reconciliation_metadata",
    });
  }

  if (task.staleCandidate) {
    hints.push({
      id: `stale:${task.id}`,
      tone: "warning",
      title: "Task still looks stale",
      detail: task.freshnessDetail || "The latest running state looks stale and still needs review.",
      evidence: "task_record",
    });
  }

  if (evidence.runtimeConfirmedCompletion && task.completedAt && !evidence.hasExplicitRuntimeCompletionEvent) {
    hints.push({
      id: `missing-runtime-completion:${task.id}`,
      tone: "warning",
      title: "Terminal state exists without an explicit runtime completion event",
      detail: "The task has a terminal ledger state, but the current event trail does not include a dedicated runtime-completed event.",
      evidence: "event_gap",
    });
  }

  if (previousRun && latestRun) {
    if (
      hasText(previousRun.providerUsed) &&
      hasText(latestRun.providerUsed) &&
      previousRun.providerUsed !== latestRun.providerUsed
    ) {
      hints.push({
        id: `provider-shift:${task.id}`,
        tone: "warning",
        title: "Provider changed between runs",
        detail: `Previous run used ${fmt(previousRun.providerUsed)}; latest run used ${fmt(latestRun.providerUsed)}.`,
        evidence: "run_comparison",
      });
    }

    if (
      hasText(previousRun.modelUsed) &&
      hasText(latestRun.modelUsed) &&
      previousRun.modelUsed !== latestRun.modelUsed
    ) {
      hints.push({
        id: `model-shift:${task.id}`,
        tone: "warning",
        title: "Model changed between runs",
        detail: `Previous run used ${fmt(previousRun.modelUsed)}; latest run used ${fmt(latestRun.modelUsed)}.`,
        evidence: "run_comparison",
      });
    }
  }

  return hints;
}
