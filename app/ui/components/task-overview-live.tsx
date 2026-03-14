"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApprovalQueueItem, ApprovalQueuePayload } from "@/lib/server/approval-queue";
import type { OperationalEvent, OperationalRunStatus, OperationalTask, TaskOverviewPayload } from "@/lib/operations";
import { getOrCreateOperatorSession } from "@/lib/operator-session-client";
import { Card, SectionHeader, StatusPill } from "@/components/ui";
import { cn } from "@/lib/utils";

const pollingIntervalMs = 15_000;

function relativeTime(value?: string | null) {
  if (!value) {
    return "No timestamp";
  }

  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.abs(seconds) < 60 ? Math.round(seconds) : Math.round(seconds / 60),
    Math.abs(seconds) < 60 ? "second" : "minute",
  );
}

function absoluteTime(value?: string | null) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function durationLabel(durationMs?: number | null) {
  if (!durationMs && durationMs !== 0) {
    return "No duration";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function toneForStatus(status: OperationalRunStatus) {
  if (status === "succeeded") return "success";
  if (status === "running" || status === "attention") return "warning";
  if (status === "failed" || status === "blocked") return "danger";
  return "neutral";
}

function labelForStatus(status: OperationalRunStatus) {
  return status.replace(/_/g, " ");
}

function completionLabel(task: OperationalTask | null) {
  if (!task) {
    return "Unknown";
  }

  if (task.completionSource === "operator_reconciled") {
    return "Operator-reconciled";
  }

  if (task.completionSource === "runtime_confirmed") {
    return "Runtime-confirmed";
  }

  return "In progress";
}

export function TaskOverviewLive({
  initialPayload,
}: {
  initialPayload: TaskOverviewPayload;
}) {
  const [payload, setPayload] = useState<TaskOverviewPayload | null>(initialPayload);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialPayload.tasks[0]?.id ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [operatorIdentity, setOperatorIdentity] = useState("");
  const [operatorSessionId, setOperatorSessionId] = useState("");
  const [operatorSessionStartedAt, setOperatorSessionStartedAt] = useState("");
  const [reconcileNote, setReconcileNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approvalPayload, setApprovalPayload] = useState<ApprovalQueuePayload | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  async function loadApprovals() {
    try {
      const response = await fetch("/api/operations/approvals", { cache: "no-store" });
      const next = (await response.json()) as ApprovalQueuePayload;
      setApprovalPayload(next);
    } catch {
      // non-fatal: approval panel shows stale data
    }
  }

  async function resolveApproval(approvalId: string, outcome: "approved" | "rejected") {
    setResolvingApprovalId(approvalId);
    setApprovalError(null);
    try {
      const response = await fetch(`/api/operations/approvals/${approvalId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, resolved_by: operatorIdentity || "operator-ui" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Resolve failed.");
      }
      await loadApprovals();
    } catch (nextError) {
      setApprovalError(nextError instanceof Error ? nextError.message : "Resolve failed.");
    } finally {
      setResolvingApprovalId(null);
    }
  }

  async function load() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/operations/task-overview", { cache: "no-store" });
      const nextPayload = (await response.json()) as TaskOverviewPayload;
      setPayload(nextPayload);
      setSelectedTaskId((current) => {
        if (!current) {
          return nextPayload.tasks[0]?.id ?? null;
        }

        return nextPayload.tasks.some((task) => task.id === current) ? current : nextPayload.tasks[0]?.id ?? null;
      });
      setError(response.ok ? null : nextPayload.errors[0] ?? "Task overview request failed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Task overview request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const session = getOrCreateOperatorSession();
    setOperatorSessionId(session.operatorSessionId);
    setOperatorSessionStartedAt(session.operatorSessionStartedAt);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWithCancellation() {
      if (cancelled) {
        return;
      }

      await load();
    }

    loadWithCancellation();
    void loadApprovals();
    const interval = window.setInterval(() => {
      void loadWithCancellation();
      void loadApprovals();
    }, pollingIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const selectedTask = payload?.tasks.find((task) => task.id === selectedTaskId) ?? payload?.tasks[0] ?? null;
  const selectedRun = selectedTask?.latestRunId ? payload?.runs.find((run) => run.id === selectedTask.latestRunId) ?? null : null;
  const selectedEvents = selectedTask
    ? [...(payload?.activity.filter((event) => event.taskId === selectedTask.id) ?? [])].sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      )
    : [];

  async function reconcileSelectedTask() {
    if (!selectedTask?.staleCandidate) {
      return;
    }

    setIsReconciling(true);
    setError(null);

    try {
      const response = await fetch(`/api/operations/tasks/${selectedTask.id}/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operatorIdentity,
          operatorSessionId,
          operatorSessionStartedAt,
          note: reconcileNote,
        }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "Stale reconciliation failed.");
      }

      setOperatorIdentity("");
      setReconcileNote("");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Stale reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Task Overview"
        title="What Ghost is doing right now, and what needs operator review."
        copy="Phase 5E-R deepens the canonical runtime ledger: provenance, entrypoint, chronological events, stale-running detection, and explicit operator reconciliation all sit on top of durable `tasks`, `task_runs`, and `tool_events`."
      />

      <div className="task-summary-grid">
        <Card>
          <div className="metric">
            <div className="metric-label">Active now</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>
              {payload?.summary.activeNow ?? 0}
            </div>
            <p className="caption">Runtime rows still marked running.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Durable tasks</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>
              {payload?.tasks.length ?? 0}
            </div>
            <p className="caption">Canonical ledger rows available for operator inspection.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Stale candidates</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>
              {payload?.summary.staleRuns ?? 0}
            </div>
            <p className="caption">Heuristic stale-running rows needing explicit operator review.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Blocked or failed</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>
              {(payload?.summary.blockedRuns ?? 0) + (payload?.summary.failedRuns ?? 0)}
            </div>
            <p className="caption">Terminal or approval-blocked work across the visible slice.</p>
          </div>
        </Card>
      </div>

      {payload?.summary.staleRuns ? (
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Operator Review</div>
              <h3>Stale running ledger rows detected</h3>
            </div>
            <StatusPill label={`${payload.summary.staleRuns} needs review`} tone="warning" />
          </div>
          <p className="caption" style={{ marginTop: 12 }}>
            Stale means running long enough, with no recent ledger activity, to justify review. It does not mean runtime-confirmed failure.
          </p>
        </Card>
      ) : null}

      {approvalPayload && (approvalPayload.counts.pending > 0 || approvalPayload.counts.resolved > 0) ? (
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Approval Queue</div>
              <h3>{approvalPayload.counts.pending > 0 ? "Governed requests awaiting operator action" : "Governed approval queue"}</h3>
            </div>
            <StatusPill
              label={approvalPayload.counts.pending > 0 ? `${approvalPayload.counts.pending} pending` : "No pending"}
              tone={approvalPayload.counts.pending > 0 ? "warning" : "neutral"}
            />
          </div>
          {approvalError ? (
            <p className="caption" style={{ marginTop: 8, color: "var(--color-danger)" }}>{approvalError}</p>
          ) : null}
          <div className="list" style={{ marginTop: 16 }}>
            {approvalPayload.approvals.map((approval: ApprovalQueueItem) => (
              <div key={approval.approvalId} className="list-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <StatusPill
                      label={approval.status}
                      tone={
                        approval.status === "pending" ? "warning"
                        : approval.status === "approved" ? "success"
                        : approval.status === "rejected" ? "danger"
                        : "neutral"
                      }
                    />
                    <span className="caption">{approval.approvalType}</span>
                    {approval.governanceEnvironment ? (
                      <span className="caption" style={{ opacity: 0.6 }}>{approval.governanceEnvironment}</span>
                    ) : null}
                  </div>
                  <p style={{ fontSize: "0.82rem", margin: "0 0 4px", lineHeight: 1.4 }}>
                    {approval.promptText.slice(0, 200)}
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {approval.requestedCapabilities.length > 0 ? (
                      <span className="caption" style={{ opacity: 0.7 }}>
                        caps: {approval.requestedCapabilities.join(", ")}
                      </span>
                    ) : null}
                    {approval.conversationId ? (
                      <span className="caption" style={{ opacity: 0.6 }}>conv: {approval.conversationId.slice(0, 8)}…</span>
                    ) : null}
                    <span className="caption" style={{ opacity: 0.5 }}>{relativeTime(approval.requestedAt)}</span>
                  </div>
                  {approval.status !== "pending" && approval.resolvedBy ? (
                    <p className="caption" style={{ marginTop: 4, opacity: 0.6 }}>
                      resolved by {approval.resolvedBy}
                      {approval.outcomeStatus ? ` · ${approval.outcomeStatus}` : ""}
                    </p>
                  ) : null}
                  {approval.status === "approved" ? (
                    <p className="caption" style={{ marginTop: 6, padding: "4px 8px", background: "var(--color-surface-2, rgba(255,255,255,0.04))", borderRadius: 4, fontFamily: "monospace", fontSize: "0.75rem" }}>
                      Follow-through is manual. Run: <code>bash ops/resolve-approval-queue.sh</code> then <code>bash ops/execute-governed-followthrough.sh</code>
                    </p>
                  ) : null}
                </div>
                {approval.status === "pending" ? (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      className="btn btn-sm"
                      disabled={resolvingApprovalId === approval.approvalId}
                      onClick={() => void resolveApproval(approval.approvalId, "approved")}
                      style={{ background: "var(--color-success-muted, #1a3a2a)", color: "var(--color-success, #4ade80)", border: "1px solid var(--color-success, #4ade80)", borderRadius: 4, padding: "4px 10px", fontSize: "0.78rem", cursor: "pointer" }}
                    >
                      {resolvingApprovalId === approval.approvalId ? "…" : "Approve"}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={resolvingApprovalId === approval.approvalId}
                      onClick={() => void resolveApproval(approval.approvalId, "rejected")}
                      style={{ background: "var(--color-danger-muted, #3a1a1a)", color: "var(--color-danger, #f87171)", border: "1px solid var(--color-danger, #f87171)", borderRadius: 4, padding: "4px 10px", fontSize: "0.78rem", cursor: "pointer" }}
                    >
                      {resolvingApprovalId === approval.approvalId ? "…" : "Reject"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="task-live-layout">
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Ledger Field</div>
              <h3>Canonical Ghost work</h3>
            </div>
            <StatusPill
              label={
                isLoading
                  ? "Loading"
                  : payload?.degraded
                    ? "Degraded"
                    : `${payload?.tasks.length ?? 0} ledger items`
              }
              tone={isLoading ? "warning" : payload?.degraded ? "warning" : "success"}
            />
          </div>

          <div className="task-run-list" style={{ marginTop: 18 }}>
            {payload?.tasks.length ? (
              payload.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={cn("task-run-item", selectedTask?.id === task.id && "active", task.staleCandidate && "stale")}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <div className="task-run-header">
                    <div>
                      <div className="kicker">{task.provenance.label}</div>
                      <h4>{task.title}</h4>
                    </div>
                    <div className="task-run-pills">
                      {task.staleCandidate ? <StatusPill label="stale needs review" tone="warning" /> : null}
                      {task.completionSource === "operator_reconciled" ? <StatusPill label="operator reconciled" tone="danger" /> : null}
                      <StatusPill label={labelForStatus(task.status)} tone={toneForStatus(task.status) as never} />
                    </div>
                  </div>
                  <p className="caption task-run-summary">{task.summary}</p>
                  <div className="task-run-meta">
                    <span>{task.entrypoint ?? "unknown entrypoint"}</span>
                    <span>{task.freshnessLabel ?? "unknown freshness"}</span>
                    <span>{relativeTime(task.updatedAt)}</span>
                    <span>{task.eventCount} event(s)</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="task-empty-state">
                <h4>No durable task rows yet</h4>
                <p className="caption">
                  {error ?? "The ledger is reachable, but there are no durable task rows in the current slice."}
                </p>
              </div>
            )}
          </div>
        </Card>

        <div className="task-detail-stack">
          <Card>
            <div className="panel-header">
              <div>
                <div className="kicker">Selected Task</div>
                <h3>{selectedTask?.title ?? "No task selected"}</h3>
              </div>
              {selectedTask ? (
                  <div className="task-run-pills">
                    <Link href={`/task-overview/${selectedTask.id}`} className="ghost-chip">
                      Open Drill-down
                    </Link>
                    {selectedTask.staleCandidate ? <StatusPill label="stale needs review" tone="warning" /> : null}
                    <StatusPill label={completionLabel(selectedTask)} tone={selectedTask.completionSource === "operator_reconciled" ? "danger" : "success"} />
                    <StatusPill label={labelForStatus(selectedTask.status)} tone={toneForStatus(selectedTask.status) as never} />
                </div>
              ) : null}
            </div>

            {selectedTask ? (
              <>
                {selectedTask.staleCandidate ? (
                  <div className="task-review-banner warning" style={{ marginTop: 18 }}>
                    <strong>Stale needs review.</strong>
                    <span>{selectedTask.freshnessDetail}</span>
                  </div>
                ) : null}

                {selectedTask.completionSource === "operator_reconciled" ? (
                  <div className="task-review-banner danger" style={{ marginTop: 18 }}>
                    <strong>Operator-reconciled terminal state.</strong>
                    <span>Runtime did not confirm completion. The operator later marked this task as failed.</span>
                  </div>
                ) : null}

                <div className="task-detail-grid" style={{ marginTop: 18 }}>
                  <div>
                    <div className="metric-label">Ledger Source</div>
                    <p className="caption">{selectedTask.source}</p>
                  </div>
                  <div>
                    <div className="metric-label">Provenance</div>
                    <p className="caption">{selectedTask.provenance.detail}</p>
                  </div>
                  <div>
                    <div className="metric-label">Entrypoint</div>
                    <p className="caption">{selectedTask.entrypoint ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Current Phase</div>
                    <p className="caption">{selectedTask.currentPhase ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Freshness</div>
                    <p className="caption">{selectedTask.freshnessLabel ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Latest Activity</div>
                    <p className="caption">{selectedTask.lastEventAt ? `${relativeTime(selectedTask.lastEventAt)} · ${absoluteTime(selectedTask.lastEventAt)}` : "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Completion Truth</div>
                    <p className="caption">{completionLabel(selectedTask)}</p>
                  </div>
                  <div>
                    <div className="metric-label">Assigned Actor</div>
                    <p className="caption">{selectedTask.assignedActor?.label ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Execution Target</div>
                    <p className="caption">{selectedTask.executionTarget ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Workflow</div>
                    <p className="caption">{selectedTask.workflowName ?? "Unknown"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Run Route</div>
                    <p className="caption">
                      {selectedTask.routeProvider ?? "Unknown"}
                      {selectedTask.routeModel ? ` · ${selectedTask.routeModel}` : ""}
                    </p>
                  </div>
                  <div>
                    <div className="metric-label">n8n Execution Id</div>
                    <p className="caption">{selectedRun?.executionId ?? "Unrecorded"}</p>
                  </div>
                  <div>
                    <div className="metric-label">Created</div>
                    <p className="caption">{absoluteTime(selectedTask.createdAt)}</p>
                  </div>
                  <div>
                    <div className="metric-label">Latest Run Duration</div>
                    <p className="caption">{durationLabel(selectedTask.latestRunDurationMs)}</p>
                  </div>
                  <div>
                    <div className="metric-label">Started</div>
                    <p className="caption">{absoluteTime(selectedTask.startedAt)}</p>
                  </div>
                  <div>
                    <div className="metric-label">Completed</div>
                    <p className="caption">{absoluteTime(selectedTask.completedAt)}</p>
                  </div>
                  {selectedTask.reconciledAt ? (
                    <div>
                      <div className="metric-label">Reconciled At</div>
                      <p className="caption">{absoluteTime(selectedTask.reconciledAt)}</p>
                    </div>
                  ) : null}
                  {selectedTask.operatorIdentity ? (
                    <div>
                      <div className="metric-label">Operator Identity</div>
                      <p className="caption">{selectedTask.operatorIdentity}</p>
                    </div>
                  ) : null}
                  {selectedTask.operatorSource ? (
                    <div>
                      <div className="metric-label">Recorded Via</div>
                      <p className="caption">{selectedTask.operatorSource}</p>
                    </div>
                  ) : null}
                  {selectedTask.artifactPath ? (
                    <div className="task-detail-span">
                      <div className="metric-label">Artifact Path</div>
                      <p className="caption task-detail-code">{selectedTask.artifactPath}</p>
                    </div>
                  ) : null}
                  {selectedTask.reconciliationNote ? (
                    <div className="task-detail-span">
                      <div className="metric-label">Operator Reconciliation Note</div>
                      <p className="caption">{selectedTask.reconciliationNote}</p>
                    </div>
                  ) : null}
                  {selectedTask.latestUserMessage ? (
                    <div className="task-detail-span">
                      <div className="metric-label">Latest User Prompt</div>
                      <p className="caption">{selectedTask.latestUserMessage}</p>
                    </div>
                  ) : null}
                  {selectedTask.latestAssistantReply ? (
                    <div className="task-detail-span">
                      <div className="metric-label">Latest Assistant Reply</div>
                      <p className="caption">{selectedTask.latestAssistantReply}</p>
                    </div>
                  ) : null}
                  {selectedTask.errorSummary ? (
                    <div className="task-detail-span">
                      <div className="metric-label">Error Summary</div>
                      <p className="caption">{selectedTask.errorSummary}</p>
                    </div>
                  ) : null}
                </div>

                {selectedTask.staleCandidate ? (
                  <div className="task-reconcile-panel" style={{ marginTop: 18 }}>
                    <div className="panel-header">
                      <div>
                        <div className="kicker">Reconciliation</div>
                        <h4>Mark stale run as operator-reconciled failed</h4>
                      </div>
                      <StatusPill label="manual action" tone="warning" />
                    </div>
                    <p className="caption" style={{ marginTop: 10 }}>
                      This does not claim runtime-confirmed failure. It records that the operator reviewed a stale running ledger row and explicitly reconciled it with operator-provided identity and browser-session context.
                    </p>
                    {operatorSessionId ? (
                      <p className="caption">Session context: {operatorSessionId}</p>
                    ) : null}
                    <input
                      className="task-reconcile-identity"
                      placeholder="Required operator-provided identity, for example initials or handle."
                      value={operatorIdentity}
                      onChange={(event) => setOperatorIdentity(event.target.value)}
                    />
                    <textarea
                      className="task-reconcile-note"
                      placeholder="Required operator note for why this stale running row is being reconciled."
                      value={reconcileNote}
                      onChange={(event) => setReconcileNote(event.target.value)}
                    />
                    <div className="task-reconcile-actions">
                      <button
                        type="button"
                        className="action-button"
                        disabled={isReconciling || !operatorIdentity.trim() || !reconcileNote.trim()}
                        onClick={reconcileSelectedTask}
                      >
                        {isReconciling ? "Reconciling..." : "Reconcile As Failed"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="caption" style={{ marginTop: 18 }}>
                Select a task to inspect provenance, freshness, runtime events, and reconciliation state.
              </p>
            )}
          </Card>

          <Card>
            <div className="panel-header">
              <div>
                <div className="kicker">Runtime Event Trail</div>
                <h3>{selectedTask ? "Chronological ledger history" : "Ledger timeline"}</h3>
              </div>
              <StatusPill label={`${selectedTask ? selectedEvents.length : payload?.activity.length ?? 0} events`} />
            </div>

            <div className="task-activity-list" style={{ marginTop: 18 }}>
              {(selectedTask ? selectedEvents : payload?.activity ?? []).length ? (
                (selectedTask ? selectedEvents : payload?.activity ?? []).map((event: OperationalEvent) => (
                  <div key={event.id} className={cn("task-activity-item", event.type === "operator_reconciled" && "operator")}>
                    <div className={cn("status-dot", toneForStatus(event.status) === "success" && "success", toneForStatus(event.status) === "warning" && "warning", toneForStatus(event.status) === "danger" && "danger")} />
                    <div>
                      <div className="task-activity-topline">
                        <strong>{event.title}</strong>
                        <span className="caption">{absoluteTime(event.timestamp)}</span>
                      </div>
                      <p className="caption">{event.detail}</p>
                      <p className="caption">{event.provenance.label}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="caption">No durable events available for the current selection.</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="panel-header">
              <div>
                <div className="kicker">Source Health</div>
                <h3>Live feed integrity</h3>
              </div>
              <StatusPill label={payload?.degraded ? "Partial" : "Healthy"} tone={payload?.degraded ? "warning" : "success"} />
            </div>

            <div className="list" style={{ marginTop: 18 }}>
              {payload?.sourceHealth.map((source) => (
                <div key={source.sourceId} className="list-row">
                  <div>
                    <h4>{source.label}</h4>
                    <p className="caption" style={{ marginTop: 6 }}>
                      {source.detail}
                    </p>
                  </div>
                  <StatusPill label={source.status} tone={source.status === "live" ? "success" : source.status === "degraded" ? "warning" : "danger"} />
                </div>
              ))}
              {payload?.errors.length ? (
                <div className="task-errors">
                  {payload.errors.map((entry) => (
                    <p key={entry} className="caption">
                      {entry}
                    </p>
                  ))}
                </div>
              ) : null}
              {error ? (
                <div className="task-errors">
                  <p className="caption">{error}</p>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
