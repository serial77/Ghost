"use client";

import { useEffect, useRef, useState } from "react";
import type { ApprovalQueueItem, ApprovalQueuePayload } from "@/lib/server/approval-queue";
import type { OperationalEvent, OperationalRun, OperationalRunStatus, OperationalTask, TaskOverviewPayload } from "@/lib/operations";
import type { TaskContextPayload } from "@/lib/server/task-context";
import { getOrCreateOperatorSession } from "@/lib/operator-session-client";
import { Card, SectionHeader, StatusPill } from "@/components/ui";
import { cn } from "@/lib/utils";

const pollingIntervalMs = 15_000;

type TaskTab = "Overview" | "Activity" | "Delegation" | "Governance" | "Outputs" | "IDs";

// ---- Formatters ----

function relativeTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.abs(seconds) < 60 ? Math.round(seconds) : Math.round(seconds / 60),
    Math.abs(seconds) < 60 ? "second" : "minute",
  );
}

function absoluteTime(value?: string | null) {
  if (!value) return "—";
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
  if (durationMs == null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
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

function approvalStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

// ---- WorkspaceTabs ----

function WorkspaceTabs({ active, onChange }: { active: TaskTab; onChange: (t: TaskTab) => void }) {
  const tabs: TaskTab[] = ["Overview", "Activity", "Delegation", "Governance", "Outputs", "IDs"];
  return (
    <div className="workspace-tabs">
      {tabs.map((tab) => (
        <button key={tab} type="button" className={cn("workspace-tab", active === tab && "active")} onClick={() => onChange(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

// ---- WField: compact label/value row ----

function WField({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="workspace-field">
      <span className="workspace-field-label">{label}</span>
      <span className={cn("workspace-field-value", mono && "task-detail-code")}>{children}</span>
    </div>
  );
}

// ---- CtxCard: a card within a tab ----

function CtxCard({ children }: { children: React.ReactNode }) {
  return <div className="task-ctx-card">{children}</div>;
}

function CtxLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="task-ctx-label" style={style}>{children}</div>;
}

function HonestEmpty({ message }: { message: string }) {
  return <p style={{ fontSize: "0.83rem", color: "var(--text-dim)", paddingTop: 4 }}>{message}</p>;
}

// ---- Overview Tab ----

function OverviewTab({
  task,
  run,
  isReconciling,
  operatorIdentity,
  operatorSessionId,
  reconcileNote,
  reconcileError,
  onIdentityChange,
  onNoteChange,
  onReconcile,
}: {
  task: OperationalTask;
  run: OperationalRun | null;
  isReconciling: boolean;
  operatorIdentity: string;
  operatorSessionId: string;
  reconcileNote: string;
  reconcileError: string | null;
  onIdentityChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onReconcile: () => void;
}) {
  return (
    <div>
      {task.staleCandidate && (
        <div className="task-alert-banner task-alert-warning">
          <strong>Stale — needs review.</strong>
          <span>{task.freshnessDetail}</span>
        </div>
      )}
      {task.completionSource === "operator_reconciled" && (
        <div className="task-alert-banner task-alert-danger">
          <strong>Operator-reconciled.</strong>
          <span>Runtime did not confirm completion — operator marked this task as failed.</span>
        </div>
      )}

      <CtxLabel>State</CtxLabel>
      <WField label="Status">
        <StatusPill label={labelForStatus(task.status)} tone={toneForStatus(task.status) as never} />
      </WField>
      <WField label="Phase">{task.currentPhase ?? "—"}</WField>
      <WField label="Freshness">{task.freshnessLabel ?? "—"}</WField>
      <WField label="Completion">{task.completionSource === "operator_reconciled" ? "Operator-reconciled" : task.completionSource === "runtime_confirmed" ? "Runtime-confirmed" : "In progress"}</WField>
      {task.errorSummary && <WField label="Error">{task.errorSummary}</WField>}

      <CtxLabel style={{ marginTop: 16 }}>Timing</CtxLabel>
      <WField label="Created">{absoluteTime(task.createdAt)}</WField>
      <WField label="Started">{absoluteTime(task.startedAt)}</WField>
      <WField label="Updated">{relativeTime(task.updatedAt)} · {absoluteTime(task.updatedAt)}</WField>
      {task.completedAt && <WField label="Completed">{absoluteTime(task.completedAt)}</WField>}
      {task.reconciledAt && <WField label="Reconciled">{absoluteTime(task.reconciledAt)}</WField>}
      <WField label="Duration">{durationLabel(task.latestRunDurationMs)}</WField>

      <CtxLabel style={{ marginTop: 16 }}>Execution</CtxLabel>
      <WField label="Actor">{task.assignedActor?.label ?? "—"}</WField>
      <WField label="Entrypoint">{task.entrypoint ?? "—"}</WField>
      <WField label="Target">{task.executionTarget ?? "—"}</WField>
      <WField label="Workflow">{task.workflowName ?? "—"}</WField>
      <WField label="Route">{[task.routeProvider, task.routeModel].filter(Boolean).join(" · ") || "—"}</WField>
      <WField label="Source">{task.source}</WField>
      <WField label="Type">{task.taskType ?? "—"}</WField>
      {task.conversationId && <WField label="Conversation" mono>{task.conversationId}</WField>}

      {task.operatorIdentity && (
        <>
          <CtxLabel style={{ marginTop: 16 }}>Operator Record</CtxLabel>
          <WField label="Identity">{task.operatorIdentity}</WField>
          {task.operatorSource && <WField label="Via">{task.operatorSource}</WField>}
          {task.reconciliationNote && <WField label="Note">{task.reconciliationNote}</WField>}
        </>
      )}

      {task.staleCandidate && (
        <div className="task-reconcile-panel" style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="kicker">Reconciliation</div>
            <h4 style={{ margin: "4px 0 0" }}>Mark stale run as operator-reconciled failed</h4>
          </div>
          <p className="caption" style={{ marginBottom: 10 }}>
            Records that the operator reviewed a stale running row and explicitly reconciled it. This does not claim runtime-confirmed failure.
          </p>
          {operatorSessionId && <p className="caption" style={{ marginBottom: 8 }}>Session: {operatorSessionId}</p>}
          {reconcileError && <p className="caption" style={{ color: "var(--color-danger)", marginBottom: 8 }}>{reconcileError}</p>}
          <input
            className="task-reconcile-identity"
            placeholder="Required: operator identity (initials or handle)"
            value={operatorIdentity}
            onChange={(e) => onIdentityChange(e.target.value)}
          />
          <textarea
            className="task-reconcile-note"
            placeholder="Required: why is this stale row being reconciled?"
            value={reconcileNote}
            onChange={(e) => onNoteChange(e.target.value)}
          />
          <div className="task-reconcile-actions">
            <button
              type="button"
              className="action-button"
              disabled={isReconciling || !operatorIdentity.trim() || !reconcileNote.trim()}
              onClick={onReconcile}
            >
              {isReconciling ? "Reconciling…" : "Reconcile As Failed"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Activity Tab ----

function ActivityTab({ events }: { events: OperationalEvent[] }) {
  if (!events.length) {
    return <HonestEmpty message="No durable events recorded for this task." />;
  }
  return (
    <div className="task-activity-list">
      {events.map((event) => (
        <div key={event.id} className={cn("task-activity-item", event.type === "operator_reconciled" && "operator")}>
          <div className={cn("status-dot",
            toneForStatus(event.status) === "success" && "success",
            toneForStatus(event.status) === "warning" && "warning",
            toneForStatus(event.status) === "danger" && "danger",
          )} />
          <div>
            <div className="task-activity-topline">
              <strong style={{ fontSize: "0.84rem" }}>{event.title}</strong>
              <span className="caption">{absoluteTime(event.timestamp)}</span>
            </div>
            {event.detail && <p className="caption" style={{ marginTop: 3 }}>{event.detail}</p>}
            <p className="caption" style={{ opacity: 0.5 }}>{event.provenance.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Delegation Tab ----

function DelegationTab({ context, loading }: { context: TaskContextPayload | null; loading: boolean }) {
  if (loading) return <HonestEmpty message="Loading delegation context…" />;
  if (!context) return <HonestEmpty message="Context unavailable." />;
  if (context.delegations.length === 0) {
    return <HonestEmpty message="No delegation recorded for this task. Task executed directly without worker handoff." />;
  }
  return (
    <div>
      {context.delegations.map((d) => (
        <CtxCard key={d.delegationId}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>{d.workerDisplayName ?? d.workerAgentKey ?? "Unknown worker"}</span>
            {d.status && <StatusPill label={d.status} tone={d.status === "completed" ? "success" : d.status === "blocked" || d.status === "failed" ? "danger" : "warning"} />}
          </div>
          {d.requestSummary && (
            <p style={{ fontSize: "0.82rem", color: "var(--text-soft)", margin: "0 0 10px", lineHeight: 1.55 }}>{d.requestSummary}</p>
          )}
          <WField label="Provider">{d.workerProvider ?? "—"}</WField>
          <WField label="Model">{d.workerModel ?? "—"}</WField>
          <WField label="Agent Key" mono>{d.workerAgentKey ?? "—"}</WField>
          <WField label="Started">{absoluteTime(d.createdAt)}</WField>
          <WField label="Updated">{relativeTime(d.updatedAt)}</WField>
          <WField label="Delegation ID" mono>{d.delegationId}</WField>
        </CtxCard>
      ))}
      {context.errors.filter((e) => e.includes("Delegation")).map((e) => (
        <p key={e} className="caption" style={{ color: "var(--color-danger)", marginTop: 8 }}>{e}</p>
      ))}
    </div>
  );
}

// ---- Governance Tab ----

function GovernanceTab({ context, loading }: { context: TaskContextPayload | null; loading: boolean }) {
  if (loading) return <HonestEmpty message="Loading governance context…" />;
  if (!context) return <HonestEmpty message="Context unavailable." />;

  const hasApprovals = context.approvals.length > 0;
  const hasEvents = context.governanceEvents.length > 0;

  if (!hasApprovals && !hasEvents) {
    return <HonestEmpty message="No governance record found for this task. Task executed without approval gate." />;
  }

  return (
    <div>
      {hasApprovals && (
        <>
          <CtxLabel>Approvals</CtxLabel>
          {context.approvals.map((a) => (
            <CtxCard key={a.approvalId}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <StatusPill label={a.status} tone={approvalStatusTone(a.status)} />
                <span className="caption">{a.approvalType}</span>
                {a.governanceEnvironment && <span className="caption" style={{ opacity: 0.6 }}>{a.governanceEnvironment}</span>}
              </div>
              {a.requestedCapabilities.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {a.requestedCapabilities.map((cap) => (
                    <span key={cap} className="status-pill status-pill--neutral" style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{cap}</span>
                  ))}
                </div>
              )}
              <WField label="Requested">{absoluteTime(a.requestedAt)}</WField>
              {a.respondedAt && <WField label="Responded">{absoluteTime(a.respondedAt)}</WField>}
              {a.outcomeStatus && <WField label="Outcome">{a.outcomeStatus}</WField>}
              {a.resolvedBy && <WField label="Resolved by">{a.resolvedBy}</WField>}
              <WField label="Approval ID" mono>{a.approvalId}</WField>
            </CtxCard>
          ))}
        </>
      )}

      {hasEvents && (
        <>
          <CtxLabel style={{ marginTop: hasApprovals ? 16 : 0 }}>Governance Event Chain</CtxLabel>
          <div className="task-activity-list">
            {context.governanceEvents.map((ev) => (
              <div key={ev.actionId} className="task-activity-item">
                <div className="status-dot" />
                <div>
                  <div className="task-activity-topline">
                    <strong style={{ fontSize: "0.82rem", fontFamily: "var(--font-mono)" }}>{ev.eventType}</strong>
                    <span className="caption">{absoluteTime(ev.occurredAt)}</span>
                  </div>
                  {ev.summary && <p className="caption" style={{ marginTop: 3 }}>{ev.summary}</p>}
                  <p className="caption" style={{ opacity: 0.5 }}>{ev.sourceSurface}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {context.errors.filter((e) => e.includes("Approval") || e.includes("Governance")).map((e) => (
        <p key={e} className="caption" style={{ color: "var(--color-danger)", marginTop: 8 }}>{e}</p>
      ))}
    </div>
  );
}

// ---- Outputs Tab ----

function OutputsTab({ task }: { task: OperationalTask }) {
  const hasResult = !!task.resultSummary;
  const hasArtifact = !!task.artifactPath;
  const hasReply = !!task.latestAssistantReply;
  const hasInput = !!task.latestUserMessage;

  if (!hasResult && !hasArtifact && !hasReply && !hasInput) {
    return <HonestEmpty message="No recorded outputs for this task. Result summary and artifact path are not present." />;
  }

  return (
    <div>
      {hasInput && (
        <>
          <CtxLabel>Input</CtxLabel>
          <p style={{ fontSize: "0.83rem", color: "var(--text-soft)", lineHeight: 1.6, marginBottom: 14 }}>{task.latestUserMessage}</p>
        </>
      )}
      {hasResult && (
        <>
          <CtxLabel style={{ marginTop: hasInput ? 8 : 0 }}>Result</CtxLabel>
          <p style={{ fontSize: "0.83rem", color: "var(--text-soft)", lineHeight: 1.6, marginBottom: 14 }}>{task.resultSummary}</p>
        </>
      )}
      {hasReply && task.latestAssistantReply !== task.resultSummary && (
        <>
          <CtxLabel style={{ marginTop: 8 }}>Latest Assistant Reply</CtxLabel>
          <p style={{ fontSize: "0.83rem", color: "var(--text-soft)", lineHeight: 1.6, marginBottom: 14 }}>{task.latestAssistantReply}</p>
        </>
      )}
      {hasArtifact && (
        <>
          <CtxLabel style={{ marginTop: 8 }}>Artifact Path</CtxLabel>
          <p className="task-detail-code caption">{task.artifactPath}</p>
        </>
      )}
    </div>
  );
}

// ---- IDs Tab ----

function IDsTab({ task, run, context }: { task: OperationalTask; run: OperationalRun | null; context: TaskContextPayload | null }) {
  return (
    <div>
      <CtxLabel>Task</CtxLabel>
      <WField label="Task ID" mono>{task.id}</WField>
      {task.conversationId && <WField label="Conversation ID" mono>{task.conversationId}</WField>}
      {run?.id && <WField label="Latest Run ID" mono>{run.id}</WField>}
      {run?.executionId && <WField label="n8n Execution ID" mono>{run.executionId}</WField>}

      {context?.delegations.length ? (
        <>
          <CtxLabel style={{ marginTop: 16 }}>Delegation IDs</CtxLabel>
          {context.delegations.map((d) => (
            <WField key={d.delegationId} label={d.workerAgentKey ?? "delegation"} mono>{d.delegationId}</WField>
          ))}
        </>
      ) : null}

      {context?.approvals.length ? (
        <>
          <CtxLabel style={{ marginTop: 16 }}>Approval IDs</CtxLabel>
          {context.approvals.map((a) => (
            <WField key={a.approvalId} label={a.status} mono>{a.approvalId}</WField>
          ))}
        </>
      ) : null}
    </div>
  );
}

// ---- Task queue row ----

function TaskQueueRow({
  task,
  selected,
  onClick,
}: {
  task: OperationalTask;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("task-run-item", selected && "active", task.staleCandidate && "stale")}
      onClick={onClick}
    >
      <div className="task-run-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kicker">{task.taskType ?? task.source}</div>
          <h4 style={{ margin: "2px 0 0", fontSize: "0.88rem", lineHeight: 1.35 }}>{task.title}</h4>
        </div>
        <div className="task-run-pills">
          {task.staleCandidate && <StatusPill label="stale" tone="warning" />}
          <StatusPill label={labelForStatus(task.status)} tone={toneForStatus(task.status) as never} />
        </div>
      </div>
      {task.summary && task.summary !== task.title && (
        <p className="caption task-run-summary" style={{ margin: "8px 0 0", WebkitLineClamp: 2, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" }}>
          {task.summary}
        </p>
      )}
      <div className="task-run-meta" style={{ marginTop: 8 }}>
        <span>{task.entrypoint ?? task.executionTarget ?? "—"}</span>
        <span>{relativeTime(task.updatedAt)}</span>
        <span>{task.eventCount} event{task.eventCount !== 1 ? "s" : ""}</span>
      </div>
    </button>
  );
}

// ---- Main component ----

export function TaskOverviewLive({ initialPayload }: { initialPayload: TaskOverviewPayload }) {
  const [payload, setPayload] = useState<TaskOverviewPayload | null>(initialPayload);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialPayload.tasks[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<TaskTab>("Overview");
  const [taskContext, setTaskContext] = useState<TaskContextPayload | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
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
  const prevSelectedRef = useRef<string | null>(null);

  async function loadApprovals() {
    try {
      const response = await fetch("/api/operations/approvals", { cache: "no-store" });
      const next = (await response.json()) as ApprovalQueuePayload;
      setApprovalPayload(next);
    } catch {
      // non-fatal
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
        if (!current) return nextPayload.tasks[0]?.id ?? null;
        return nextPayload.tasks.some((t) => t.id === current) ? current : nextPayload.tasks[0]?.id ?? null;
      });
      setError(response.ok ? null : nextPayload.errors[0] ?? "Task overview request failed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Task overview request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadContext(taskId: string) {
    setContextLoading(true);
    setTaskContext(null);
    try {
      const response = await fetch(`/api/operations/tasks/${taskId}/context`, { cache: "no-store" });
      const data = (await response.json()) as TaskContextPayload;
      setTaskContext(data);
    } catch {
      // non-fatal: tabs show unavailable state
    } finally {
      setContextLoading(false);
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
      if (cancelled) return;
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

  // Fetch context when selection changes
  useEffect(() => {
    if (!selectedTaskId || selectedTaskId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedTaskId;
    setActiveTab("Overview");
    void loadContext(selectedTaskId);
  }, [selectedTaskId]);

  async function reconcileSelectedTask() {
    if (!selectedTask?.staleCandidate) return;
    setIsReconciling(true);
    setError(null);
    try {
      const response = await fetch(`/api/operations/tasks/${selectedTask.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorIdentity, operatorSessionId, operatorSessionStartedAt, note: reconcileNote }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok === false) throw new Error(result.error || "Reconciliation failed.");
      setOperatorIdentity("");
      setReconcileNote("");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Reconciliation failed.");
    } finally {
      setIsReconciling(false);
    }
  }

  const selectedTask = payload?.tasks.find((t) => t.id === selectedTaskId) ?? payload?.tasks[0] ?? null;
  const selectedRun: OperationalRun | null = selectedTask?.latestRunId
    ? (payload?.runs.find((r) => r.id === selectedTask.latestRunId) ?? null)
    : null;
  const selectedEvents = selectedTask
    ? [...(payload?.activity.filter((e) => e.taskId === selectedTask.id) ?? [])].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
    : [];

  // Group tasks by status for the queue
  const activeTasks = payload?.tasks.filter((t) => t.status === "running") ?? [];
  const blockedTasks = payload?.tasks.filter((t) => t.status === "blocked") ?? [];
  const failedTasks = payload?.tasks.filter((t) => t.status === "failed") ?? [];
  const otherTasks = payload?.tasks.filter((t) => !["running", "blocked", "failed"].includes(t.status)) ?? [];

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Tasks"
        title="Runtime task workspace"
        copy="Live and recent work — tasks, runs, delegations, governance, and outputs drawn from the canonical durable ledger."
      />

      {/* Metrics */}
      <div className="task-summary-grid">
        <Card>
          <div className="metric">
            <div className="metric-label">Active now</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>{payload?.summary.activeNow ?? 0}</div>
            <p className="caption">Running tasks in the current slice.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">In ledger</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>{payload?.tasks.length ?? 0}</div>
            <p className="caption">Durable ledger rows visible.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Stale</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>{payload?.summary.staleRuns ?? 0}</div>
            <p className="caption">Running rows exceeding freshness policy.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Blocked / failed</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>
              {(payload?.summary.blockedRuns ?? 0) + (payload?.summary.failedRuns ?? 0)}
            </div>
            <p className="caption">Terminal or approval-blocked work.</p>
          </div>
        </Card>
      </div>

      {/* Stale banner */}
      {!!payload?.summary.staleRuns && (
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Operator Review</div>
              <h3>Stale running rows detected</h3>
            </div>
            <StatusPill label={`${payload.summary.staleRuns} needs review`} tone="warning" />
          </div>
          <p className="caption" style={{ marginTop: 12 }}>
            Running long enough with no recent activity to justify review. Select the task and use the Reconcile action in Overview.
          </p>
        </Card>
      )}

      {/* Approval queue */}
      {approvalPayload && (approvalPayload.counts.pending > 0 || approvalPayload.counts.resolved > 0) && (
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Approval Queue</div>
              <h3>{approvalPayload.counts.pending > 0 ? "Governed requests awaiting action" : "Governed approval queue"}</h3>
            </div>
            <StatusPill
              label={approvalPayload.counts.pending > 0 ? `${approvalPayload.counts.pending} pending` : "No pending"}
              tone={approvalPayload.counts.pending > 0 ? "warning" : "neutral"}
            />
          </div>
          {approvalError && <p className="caption" style={{ marginTop: 8, color: "var(--color-danger)" }}>{approvalError}</p>}
          <div className="list" style={{ marginTop: 16 }}>
            {approvalPayload.approvals.map((approval: ApprovalQueueItem) => (
              <div key={approval.approvalId} className="list-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <StatusPill label={approval.status} tone={approvalStatusTone(approval.status)} />
                    <span className="caption">{approval.approvalType}</span>
                    {approval.governanceEnvironment && (
                      <span className="caption" style={{ opacity: 0.6 }}>{approval.governanceEnvironment}</span>
                    )}
                  </div>
                  <p style={{ fontSize: "0.82rem", margin: "0 0 4px", lineHeight: 1.4 }}>
                    {approval.promptText.slice(0, 200)}
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {approval.requestedCapabilities.length > 0 && (
                      <span className="caption" style={{ opacity: 0.7 }}>caps: {approval.requestedCapabilities.join(", ")}</span>
                    )}
                    {approval.conversationId && (
                      <span className="caption" style={{ opacity: 0.6 }}>conv: {approval.conversationId.slice(0, 8)}…</span>
                    )}
                    <span className="caption" style={{ opacity: 0.5 }}>{relativeTime(approval.requestedAt)}</span>
                  </div>
                  {approval.status !== "pending" && approval.resolvedBy && (
                    <p className="caption" style={{ marginTop: 4, opacity: 0.6 }}>
                      resolved by {approval.resolvedBy}{approval.outcomeStatus ? ` · ${approval.outcomeStatus}` : ""}
                    </p>
                  )}
                </div>
                {approval.status === "pending" && (
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
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Main workspace layout */}
      <div className="task-live-layout">
        {/* Left: task queue */}
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Task Queue</div>
              <h3>Runtime ledger</h3>
            </div>
            <StatusPill
              label={isLoading ? "Loading" : payload?.degraded ? "Degraded" : `${payload?.tasks.length ?? 0} tasks`}
              tone={isLoading ? "warning" : payload?.degraded ? "warning" : "success"}
            />
          </div>

          <div style={{ marginTop: 18 }}>
            {!payload?.tasks.length ? (
              <div className="task-empty-state">
                <h4>No durable task rows</h4>
                <p className="caption">{error ?? "The ledger is reachable but has no task rows in the current slice."}</p>
              </div>
            ) : (
              <>
                {activeTasks.length > 0 && (
                  <>
                    <div className="task-queue-group-label">Active</div>
                    <div className="task-run-list">
                      {activeTasks.map((task) => (
                        <TaskQueueRow key={task.id} task={task} selected={selectedTask?.id === task.id} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </div>
                  </>
                )}
                {blockedTasks.length > 0 && (
                  <>
                    <div className="task-queue-group-label" style={{ marginTop: activeTasks.length ? 16 : 0 }}>Blocked</div>
                    <div className="task-run-list">
                      {blockedTasks.map((task) => (
                        <TaskQueueRow key={task.id} task={task} selected={selectedTask?.id === task.id} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </div>
                  </>
                )}
                {failedTasks.length > 0 && (
                  <>
                    <div className="task-queue-group-label" style={{ marginTop: (activeTasks.length || blockedTasks.length) ? 16 : 0 }}>Failed</div>
                    <div className="task-run-list">
                      {failedTasks.map((task) => (
                        <TaskQueueRow key={task.id} task={task} selected={selectedTask?.id === task.id} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </div>
                  </>
                )}
                {otherTasks.length > 0 && (
                  <>
                    <div className="task-queue-group-label" style={{ marginTop: (activeTasks.length || blockedTasks.length || failedTasks.length) ? 16 : 0 }}>Recent</div>
                    <div className="task-run-list">
                      {otherTasks.map((task) => (
                        <TaskQueueRow key={task.id} task={task} selected={selectedTask?.id === task.id} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Right: workspace */}
        <Card>
          {selectedTask ? (
            <>
              {/* Task header */}
              <div className="task-workspace-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="kicker">{selectedTask.taskType ?? selectedTask.source}</div>
                  <h3 style={{ margin: "3px 0 0", lineHeight: 1.3 }}>{selectedTask.title}</h3>
                </div>
                <div className="task-run-pills">
                  {selectedTask.staleCandidate && <StatusPill label="stale" tone="warning" />}
                  <StatusPill
                    label={selectedTask.completionSource === "operator_reconciled" ? "reconciled" : labelForStatus(selectedTask.status)}
                    tone={selectedTask.completionSource === "operator_reconciled" ? "danger" : toneForStatus(selectedTask.status) as never}
                  />
                </div>
              </div>

              <WorkspaceTabs active={activeTab} onChange={setActiveTab} />

              {/* Tab content */}
              {activeTab === "Overview" && (
                <OverviewTab
                  task={selectedTask}
                  run={selectedRun}
                  isReconciling={isReconciling}
                  operatorIdentity={operatorIdentity}
                  operatorSessionId={operatorSessionId}
                  reconcileNote={reconcileNote}
                  reconcileError={error}
                  onIdentityChange={setOperatorIdentity}
                  onNoteChange={setReconcileNote}
                  onReconcile={reconcileSelectedTask}
                />
              )}
              {activeTab === "Activity" && <ActivityTab events={selectedEvents} />}
              {activeTab === "Delegation" && <DelegationTab context={taskContext} loading={contextLoading} />}
              {activeTab === "Governance" && <GovernanceTab context={taskContext} loading={contextLoading} />}
              {activeTab === "Outputs" && <OutputsTab task={selectedTask} />}
              {activeTab === "IDs" && <IDsTab task={selectedTask} run={selectedRun} context={taskContext} />}
            </>
          ) : (
            <div className="task-empty-state">
              <h4>No task selected</h4>
              <p className="caption">Select a task from the queue to inspect its state, activity, delegation chain, governance record, and outputs.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Source health */}
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
                <p className="caption" style={{ marginTop: 6 }}>{source.detail}</p>
              </div>
              <StatusPill
                label={source.status}
                tone={source.status === "live" ? "success" : source.status === "degraded" ? "warning" : "danger"}
              />
            </div>
          ))}
          {(payload?.errors.length ?? 0) > 0 && (
            <div className="task-errors">
              {payload?.errors.map((e) => <p key={e} className="caption">{e}</p>)}
            </div>
          )}
          {error && <div className="task-errors"><p className="caption">{error}</p></div>}
        </div>
      </Card>
    </div>
  );
}
