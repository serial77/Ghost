"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OperationalEvent, OperationalRun, OperationalRunStatus, OperationalTask, TaskAttentionHint, TaskDetailPayload, TaskStateDiff } from "@/lib/operations";
import { getOrCreateOperatorSession } from "@/lib/operator-session-client";
import { Card, SectionHeader, StatusPill } from "@/components/ui";
import { cn } from "@/lib/utils";

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

function formatEventJson(payload?: Record<string, unknown> | null) {
  if (!payload) {
    return null;
  }

  return JSON.stringify(payload, null, 2);
}

export function TaskDetailLive({
  initialPayload,
}: {
  initialPayload: TaskDetailPayload;
}) {
  const [payload, setPayload] = useState<TaskDetailPayload>(initialPayload);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [operatorIdentity, setOperatorIdentity] = useState("");
  const [operatorSessionId, setOperatorSessionId] = useState("");
  const [operatorSessionStartedAt, setOperatorSessionStartedAt] = useState("");
  const [reconcileNote, setReconcileNote] = useState("");
  const [error, setError] = useState<string | null>(initialPayload.errors[0] ?? null);

  const task = payload.task;

  useEffect(() => {
    const session = getOrCreateOperatorSession();
    setOperatorSessionId(session.operatorSessionId);
    setOperatorSessionStartedAt(session.operatorSessionStartedAt);
  }, []);

  async function loadMoreEvents() {
    if (!task || !payload.eventPage.hasMore || !payload.eventPage.nextBefore) {
      return;
    }

    setIsLoadingMore(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/operations/tasks/${task.id}?limit=${payload.eventPage.limit}&before=${encodeURIComponent(payload.eventPage.nextBefore)}`,
        { cache: "no-store" },
      );
      const nextPayload = (await response.json()) as TaskDetailPayload;
      if (!response.ok || !nextPayload.task) {
        throw new Error(nextPayload.errors[0] || "Task detail request failed.");
      }

      const seen = new Set(payload.activity.map((event) => event.id));
      const olderActivity: typeof payload.activity = [];
      for (const event of nextPayload.activity) {
        if (!seen.has(event.id)) {
          olderActivity.push(event);
        }
      }

      setPayload({
        ...nextPayload,
        activity: [...olderActivity, ...payload.activity],
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Task detail request failed.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function reconcileTask() {
    if (!task?.staleCandidate) {
      return;
    }

    setIsReconciling(true);
    setError(null);

    try {
      const response = await fetch(`/api/operations/tasks/${task.id}/reconcile`, {
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

      const refreshed = await fetch(`/api/operations/tasks/${task.id}?limit=${payload.eventPage.limit}`, { cache: "no-store" });
      const refreshedPayload = (await refreshed.json()) as TaskDetailPayload;
      if (!refreshed.ok || !refreshedPayload.task) {
        throw new Error(refreshedPayload.errors[0] || "Task detail refresh failed.");
      }

      setPayload(refreshedPayload);
      setOperatorIdentity("");
      setReconcileNote("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Stale reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  const latestRun = payload.runs[0] ?? null;

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Task Drill-down"
        title={task ? task.title : "Task not found"}
        copy="Phase 5E-U adds a lightweight evidence-based layer on top of the incident timeline: what changed between runs, what deserves attention, and where operator intervention materially altered the task history."
      />

      <div className="signal-row">
        <Link href="/task-overview" className="ghost-chip">
          Back To Overview
        </Link>
        {task ? <StatusPill label={task.provenance.label} /> : null}
        {task?.staleCandidate ? <StatusPill label="stale needs review" tone="warning" /> : null}
        {task?.completionSource === "operator_reconciled" ? <StatusPill label="operator reconciled" tone="danger" /> : null}
        {task ? <StatusPill label={completionLabel(task)} tone={task.completionSource === "operator_reconciled" ? "danger" : "success"} /> : null}
        {task ? <StatusPill label={labelForStatus(task.status)} tone={toneForStatus(task.status) as never} /> : null}
      </div>

      {error ? (
        <Card>
          <p className="caption">{error}</p>
        </Card>
      ) : null}

      {!task ? (
        <Card>
          <p className="caption">This task is not present in the canonical runtime ledger.</p>
        </Card>
      ) : (
        <>
          <div className="task-detail-page-layout">
            <Card>
              <div className="panel-header">
                <div>
                  <div className="kicker">Transition Summary</div>
                  <h3>Incident-style task story</h3>
                </div>
                <StatusPill label={`${payload.transitions.length} transitions`} />
              </div>

              <div className="task-activity-list" style={{ marginTop: 18 }}>
                {payload.transitions.length ? (
                  payload.transitions.map((transition) => (
                    <div key={transition.id} className={cn("task-activity-item", transition.kind === "operator_reconciled" && "operator")}>
                      <div className={cn("status-dot", toneForStatus(transition.status) === "success" && "success", toneForStatus(transition.status) === "warning" && "warning", toneForStatus(transition.status) === "danger" && "danger")} />
                      <div className="task-event-body">
                        <div className="task-activity-topline">
                          <strong>{transition.title}</strong>
                          <span className="caption">{absoluteTime(transition.timestamp)}</span>
                        </div>
                        <p className="caption">{transition.detail}</p>
                        <div className="task-event-meta">
                          <span>{transition.evidence.replace(/_/g, " ")}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="caption">The canonical ledger does not yet contain enough evidence to derive a concise transition story for this task.</p>
                )}
              </div>
            </Card>

            <div className="task-detail-stack">
              {payload.diffs.length ? (
                <Card>
                  <div className="panel-header">
                    <div>
                      <div className="kicker">State Diffs</div>
                      <h3>What changed</h3>
                    </div>
                    <StatusPill label={`${payload.diffs.length} changes`} />
                  </div>

                  <div className="task-activity-list" style={{ marginTop: 18 }}>
                    {payload.diffs.map((diff: TaskStateDiff) => (
                      <div key={diff.id} className="task-activity-item">
                        <div className="status-dot warning" />
                        <div className="task-event-body">
                          <div className="task-activity-topline">
                            <strong>{diff.title}</strong>
                          </div>
                          <p className="caption">{diff.detail}</p>
                          <div className="task-event-meta">
                            <span>{diff.evidence.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {payload.attentionHints.length ? (
                <Card>
                  <div className="panel-header">
                    <div>
                      <div className="kicker">Attention</div>
                      <h3>What deserves review</h3>
                    </div>
                    <StatusPill label={`${payload.attentionHints.length} hints`} tone="warning" />
                  </div>

                  <div className="task-activity-list" style={{ marginTop: 18 }}>
                    {payload.attentionHints.map((hint: TaskAttentionHint) => (
                      <div key={hint.id} className={cn("task-activity-item", hint.tone === "danger" && "operator")}>
                        <div className={cn("status-dot", hint.tone === "danger" && "danger", hint.tone === "warning" && "warning")} />
                        <div className="task-event-body">
                          <div className="task-activity-topline">
                            <strong>{hint.title}</strong>
                          </div>
                          <p className="caption">{hint.detail}</p>
                          <div className="task-event-meta">
                            <span>{hint.evidence.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>

            <Card>
              <div className="panel-header">
                <div>
                  <div className="kicker">Task Truth</div>
                  <h3>Ledger identity and provenance</h3>
                </div>
                <StatusPill label={`${task.eventCount} events`} />
              </div>

              {task.staleCandidate ? (
                <div className="task-review-banner warning" style={{ marginTop: 18 }}>
                  <strong>Stale needs review.</strong>
                  <span>{task.freshnessDetail}</span>
                </div>
              ) : null}

              {task.completionSource === "operator_reconciled" ? (
                <div className="task-review-banner danger" style={{ marginTop: 18 }}>
                  <strong>Operator-reconciled terminal state.</strong>
                  <span>Runtime did not confirm completion. An operator later marked this task as failed.</span>
                </div>
              ) : null}

              <div className="task-detail-grid" style={{ marginTop: 18 }}>
                <div>
                  <div className="metric-label">Task Id</div>
                  <p className="caption task-detail-code">{task.id}</p>
                </div>
                <div>
                  <div className="metric-label">Ledger Source</div>
                  <p className="caption">{task.source}</p>
                </div>
                <div>
                  <div className="metric-label">Entrypoint</div>
                  <p className="caption">{task.entrypoint ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Current Phase</div>
                  <p className="caption">{task.currentPhase ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Completion Truth</div>
                  <p className="caption">{completionLabel(task)}</p>
                </div>
                <div>
                  <div className="metric-label">Freshness</div>
                  <p className="caption">{task.freshnessLabel ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Assigned Actor</div>
                  <p className="caption">{task.assignedActor?.label ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Latest Activity</div>
                  <p className="caption">{task.lastEventAt ? `${relativeTime(task.lastEventAt)} · ${absoluteTime(task.lastEventAt)}` : "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Execution Target</div>
                  <p className="caption">{task.executionTarget ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Workflow</div>
                  <p className="caption">{task.workflowName ?? "Unknown"}</p>
                </div>
                <div>
                  <div className="metric-label">Route</div>
                  <p className="caption">
                    {task.routeProvider ?? "Unknown"}
                    {task.routeModel ? ` · ${task.routeModel}` : ""}
                  </p>
                </div>
                <div>
                  <div className="metric-label">n8n Execution Id</div>
                  <p className="caption">{latestRun?.executionId ?? "Unrecorded"}</p>
                </div>
                <div>
                  <div className="metric-label">Created</div>
                  <p className="caption">{absoluteTime(task.createdAt)}</p>
                </div>
                <div>
                  <div className="metric-label">Started</div>
                  <p className="caption">{absoluteTime(task.startedAt)}</p>
                </div>
                <div>
                  <div className="metric-label">Completed</div>
                  <p className="caption">{absoluteTime(task.completedAt)}</p>
                </div>
                <div>
                  <div className="metric-label">Run Count</div>
                  <p className="caption">{task.runCount}</p>
                </div>
                {task.reconciledAt ? (
                  <div>
                    <div className="metric-label">Reconciled At</div>
                    <p className="caption">{absoluteTime(task.reconciledAt)}</p>
                  </div>
                ) : null}
                {task.operatorIdentity ? (
                  <div>
                    <div className="metric-label">Operator Identity</div>
                    <p className="caption">{task.operatorIdentity}</p>
                  </div>
                ) : null}
                {task.operatorSource ? (
                  <div>
                    <div className="metric-label">Recorded Via</div>
                    <p className="caption">
                      {task.operatorSource}
                      {task.operatorIdentitySource ? ` · ${task.operatorIdentitySource.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                ) : null}
                {task.operatorSessionId ? (
                  <div>
                    <div className="metric-label">Operator Session</div>
                    <p className="caption task-detail-code">{task.operatorSessionId}</p>
                  </div>
                ) : null}
                {task.operatorSessionStartedAt ? (
                  <div>
                    <div className="metric-label">Session Started</div>
                    <p className="caption">{absoluteTime(task.operatorSessionStartedAt)}</p>
                  </div>
                ) : null}
                {task.requestOrigin ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Request Origin Context</div>
                    <p className="caption task-detail-code">
                      {task.requestOrigin}
                      {task.requestReferer ? ` · ${task.requestReferer}` : ""}
                    </p>
                  </div>
                ) : null}
                {task.artifactPath ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Artifact Path</div>
                    <p className="caption task-detail-code">{task.artifactPath}</p>
                  </div>
                ) : null}
                {task.reconciliationNote ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Operator Reconciliation Note</div>
                    <p className="caption">{task.reconciliationNote}</p>
                  </div>
                ) : null}
                {task.latestUserMessage ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Latest User Prompt</div>
                    <p className="caption">{task.latestUserMessage}</p>
                  </div>
                ) : null}
                {task.latestAssistantReply ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Latest Assistant Reply</div>
                    <p className="caption">{task.latestAssistantReply}</p>
                  </div>
                ) : null}
                {task.resultSummary ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Result Summary</div>
                    <p className="caption">{task.resultSummary}</p>
                  </div>
                ) : null}
                {task.errorSummary ? (
                  <div className="task-detail-span">
                    <div className="metric-label">Error Summary</div>
                    <p className="caption">{task.errorSummary}</p>
                  </div>
                ) : null}
              </div>

              {task.staleCandidate ? (
                <div className="task-reconcile-panel" style={{ marginTop: 18 }}>
                  <div className="panel-header">
                    <div>
                      <div className="kicker">Reconciliation</div>
                      <h4>Mark stale run as operator-reconciled failed</h4>
                    </div>
                    <StatusPill label="manual action" tone="warning" />
                  </div>
                  <p className="caption" style={{ marginTop: 10 }}>
                    This records operator judgment only. It does not claim runtime-confirmed termination, and the operator identity below is self-declared text rather than authenticated identity.
                  </p>
                  {operatorSessionId ? (
                    <p className="caption">
                      Browser session context: {operatorSessionId}
                      {operatorSessionStartedAt ? ` · started ${absoluteTime(operatorSessionStartedAt)}` : ""}
                    </p>
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
                      onClick={reconcileTask}
                    >
                      {isReconciling ? "Reconciling..." : "Reconcile As Failed"}
                    </button>
                  </div>
                </div>
              ) : null}
            </Card>

            <div className="task-detail-stack">
              <Card>
                <div className="panel-header">
                  <div>
                    <div className="kicker">Task Runs</div>
                    <h3>Known runtime attempts</h3>
                  </div>
                  <StatusPill label={`${payload.runs.length} runs`} />
                </div>

                <div className="task-run-list" style={{ marginTop: 18 }}>
                  {payload.runs.map((run: OperationalRun) => (
                    <div key={run.id} className={cn("task-run-item", run.completionSource === "operator_reconciled" && "stale")}>
                      <div className="task-run-header">
                        <div>
                          <div className="kicker">{run.executionTarget ?? "runtime run"}</div>
                          <h4>{run.workflowName ?? "Ghost runtime"}</h4>
                        </div>
                        <div className="task-run-pills">
                          {run.completionSource === "operator_reconciled" ? <StatusPill label="operator reconciled" tone="danger" /> : null}
                          {run.staleCandidate ? <StatusPill label="stale needs review" tone="warning" /> : null}
                          <StatusPill label={labelForStatus(run.status)} tone={toneForStatus(run.status) as never} />
                        </div>
                      </div>
                      <p className="caption task-run-summary">{run.summary}</p>
                      <div className="task-run-meta">
                        <span>{absoluteTime(run.startedAt)}</span>
                        <span>{run.finishedAt ? absoluteTime(run.finishedAt) : "No finish recorded"}</span>
                        <span>{durationLabel(run.durationMs)}</span>
                        <span>{run.executionId ?? "execution id unrecorded"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="panel-header">
                  <div>
                    <div className="kicker">Event History</div>
                    <h3>Chronological ledger trail</h3>
                  </div>
                  <StatusPill label={`${payload.activity.length} loaded`} />
                </div>

                <div className="task-activity-list" style={{ marginTop: 18 }}>
                  {payload.activity.length ? (
                    payload.activity.map((event: OperationalEvent) => (
                      <div key={event.id} className={cn("task-activity-item", event.type === "operator_reconciled" && "operator")}>
                        <div className={cn("status-dot", toneForStatus(event.status) === "success" && "success", toneForStatus(event.status) === "warning" && "warning", toneForStatus(event.status) === "danger" && "danger")} />
                        <div className="task-event-body">
                          <div className="task-activity-topline">
                            <strong>{event.title}</strong>
                            <span className="caption">{absoluteTime(event.timestamp)}</span>
                          </div>
                          <p className="caption">{event.detail}</p>
                          <div className="task-event-meta">
                            <span>{event.provenance.label}</span>
                            <span>{event.toolName ?? "unknown tool"}</span>
                            <span>{event.runId}</span>
                          </div>
                          {event.payload ? (
                            <details className="task-event-disclosure">
                              <summary>Payload detail</summary>
                              <pre className="task-event-payload">{formatEventJson(event.payload)}</pre>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="caption">No durable events available for this task.</p>
                  )}
                </div>

                {payload.eventPage.hasMore ? (
                  <div className="task-detail-actions">
                    <button type="button" className="action-button" disabled={isLoadingMore} onClick={loadMoreEvents}>
                      {isLoadingMore ? "Loading..." : `Load ${payload.eventPage.limit} older events`}
                    </button>
                    <p className="caption">Showing the most recent task-scoped event slice first, then loading older ledger history on demand.</p>
                  </div>
                ) : null}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
