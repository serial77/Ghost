"use client";

import { useState } from "react";
import type {
  AgentDetailPayload,
  AgentRegistryPayload,
  Capability,
  FoundationWorker,
  RecentDelegation,
  RecentTask,
  RuntimeAgent,
  WorkerRuntimeStatus,
} from "@/lib/server/agent-registry";
import { Card, SectionHeader, StatusPill } from "@/components/ui";

// ---- Shared helpers ----

function statusTone(s: WorkerRuntimeStatus | "active" | "registered"): "success" | "warning" | "neutral" {
  if (s === "active") return "success";
  if (s === "registered") return "warning";
  return "neutral";
}

function statusLabel(s: WorkerRuntimeStatus | "active" | "registered"): string {
  if (s === "active") return "Active";
  if (s === "registered") return "Registered";
  return "Defined";
}

function roleLabel(r: string): string {
  return r.replace(/_/g, " ");
}

function envScopeLabel(scope: string[]): string {
  return scope.length === 5 ? "all environments" : scope.join(" · ");
}

function relativeTime(ts: string | null): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function durationLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function taskStatusTone(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "succeeded") return "success";
  if (s === "running") return "warning";
  if (s === "blocked" || s === "failed") return "danger";
  return "neutral";
}

function truncate(s: string | null, max = 200): string {
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---- Workspace tab strip ----

function WorkspaceTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
}) {
  return (
    <div className="workspace-tabs">
      {tabs.map((t) => (
        <button key={t} className={`workspace-tab${active === t ? " active" : ""}`} onClick={() => onSelect(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ---- Field row helper ----

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="workspace-field">
      <div className="workspace-field-label">{label}</div>
      <div className="workspace-field-value">{children}</div>
    </div>
  );
}

// ---- Capability pill ----

function CapPill({ capId, cap }: { capId: string; cap: Capability | undefined }) {
  const destructive = cap?.cls === "destructive";
  return (
    <span className="signal-pill" style={{ fontSize: "0.72rem", opacity: destructive ? 1 : 0.65 }}>
      <span className={`status-dot ${destructive ? "warning" : "success"}`} />
      {capId}
      {cap?.approvalRequired ? " ⚠" : ""}
    </span>
  );
}

// ---- Foundation worker workspace ----

function FoundationWorkerWorkspace({
  worker,
  capMap,
  boundAgent,
  detail,
  detailLoading,
  activeTab,
  setActiveTab,
}: {
  worker: FoundationWorker;
  capMap: Map<string, Capability>;
  boundAgent: RuntimeAgent | null;
  detail: AgentDetailPayload | null;
  detailLoading: boolean;
  activeTab: string;
  setActiveTab: (t: string) => void;
}) {
  const tabs = ["Overview", "Capabilities", "Binding", "Activity"];

  return (
    <Card>
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="kicker">{roleLabel(worker.role)}</div>
          <h3>{worker.visibilityLabel}</h3>
        </div>
        <StatusPill label={statusLabel(worker.runtimeStatus)} tone={statusTone(worker.runtimeStatus)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <WorkspaceTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === "Overview" && (
          <div>
            <Field label="Purpose">{worker.purpose}</Field>
            <Field label="Operator identity">{worker.operatorIdentity}</Field>
            <Field label="Environment scope">{envScopeLabel(worker.environmentScope)}</Field>
            <Field label="Success contract">{worker.successContract}</Field>
            <Field label="Failure contract">{worker.failureContract}</Field>
            <Field label="Foundation id">
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{worker.id}</code>
            </Field>
          </div>
        )}

        {activeTab === "Capabilities" && (
          <div>
            {worker.capabilities.length === 0 ? (
              <p className="caption" style={{ opacity: 0.45 }}>
                No capabilities defined for this worker.
              </p>
            ) : (
              worker.capabilities.map((capId) => {
                const cap = capMap.get(capId);
                return (
                  <div
                    key={capId}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <CapPill capId={capId} cap={cap} />
                    <p className="caption" style={{ margin: 0, flex: 1, opacity: 0.65, lineHeight: 1.5 }}>
                      {cap?.description ?? "—"}
                      {cap?.approvalRequired ? (
                        <span style={{ color: "var(--warning)", marginLeft: 6 }}>Requires approval.</span>
                      ) : null}
                    </p>
                  </div>
                );
              })
            )}
            <p className="caption" style={{ marginTop: 12, opacity: 0.4, fontSize: "0.7rem" }}>
              Source: ops/foundation/capabilities.json
            </p>
          </div>
        )}

        {activeTab === "Binding" && (
          <div>
            {worker.runtimeStatus === "defined" ? (
              <div>
                <p className="caption" style={{ opacity: 0.55, marginBottom: 14, lineHeight: 1.6 }}>
                  No execution identity bound. This worker role is defined in foundation policy but has no DB agent assigned yet. It will become active when an operator or runtime wires a provider/model execution identity to this role.
                </p>
                <Field label="Status">
                  <StatusPill label="Defined" tone="neutral" />
                </Field>
                <Field label="Foundation role">{roleLabel(worker.role)}</Field>
                <Field label="Env scope">{envScopeLabel(worker.environmentScope)}</Field>
                <Field label="Capabilities">
                  {worker.capabilities.length} defined — check Capabilities tab
                </Field>
              </div>
            ) : boundAgent ? (
              <div>
                <Field label="Agent key">
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{boundAgent.agentKey}</code>
                </Field>
                <Field label="Display name">{boundAgent.displayName}</Field>
                <Field label="Provider">{boundAgent.provider ?? "—"}</Field>
                <Field label="Model">{boundAgent.modelName ?? "—"}</Field>
                <Field label="Agent type">{boundAgent.agentType}</Field>
                <Field label="Tasks handled">{boundAgent.taskCount}</Field>
                <Field label="Delegations">{boundAgent.delegationCount}</Field>
                <Field label="Last active">{relativeTime(boundAgent.lastActive)}</Field>
                <Field label="DB status">
                  <StatusPill
                    label={boundAgent.runtimeStatus === "active" ? "Active" : "Registered"}
                    tone={statusTone(boundAgent.runtimeStatus)}
                  />
                </Field>
              </div>
            ) : (
              <p className="caption" style={{ opacity: 0.45 }}>
                Bound agent not found in runtime agent list.
              </p>
            )}
          </div>
        )}

        {activeTab === "Activity" && (
          <div>
            {worker.runtimeStatus === "defined" ? (
              <p className="caption" style={{ opacity: 0.45 }}>
                No activity available — this worker has no bound execution identity. Activity will appear here once an agent is wired to this role.
              </p>
            ) : detailLoading ? (
              <p className="caption" style={{ opacity: 0.45 }}>
                Loading…
              </p>
            ) : detail ? (
              <ActivityContent detail={detail} />
            ) : (
              <p className="caption" style={{ opacity: 0.45 }}>
                Activity unavailable.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Runtime agent workspace ----

function RuntimeAgentWorkspace({
  agent,
  boundWorkers,
  capMap,
  detail,
  detailLoading,
  activeTab,
  setActiveTab,
}: {
  agent: RuntimeAgent;
  boundWorkers: FoundationWorker[];
  capMap: Map<string, Capability>;
  detail: AgentDetailPayload | null;
  detailLoading: boolean;
  activeTab: string;
  setActiveTab: (t: string) => void;
}) {
  const tabs = ["Overview", "Tasks", "Delegations", "Foundation Role"];

  return (
    <Card>
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="kicker">{agent.agentType}</div>
          <h3>{agent.displayName}</h3>
        </div>
        <StatusPill
          label={statusLabel(agent.runtimeStatus)}
          tone={statusTone(agent.runtimeStatus)}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <WorkspaceTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === "Overview" && (
          <div>
            <Field label="Agent key">
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{agent.agentKey}</code>
            </Field>
            <Field label="Provider">{agent.provider ?? "—"}</Field>
            <Field label="Model">{agent.modelName ?? "—"}</Field>
            <Field label="Agent type">{agent.agentType}</Field>
            <Field label="Tasks handled">{agent.taskCount}</Field>
            <Field label="Delegations received">{agent.delegationCount}</Field>
            <Field label="Last active">{relativeTime(agent.lastActive)}</Field>
            <Field label="DB status">{agent.dbStatus}</Field>
            <Field label="Foundation role">
              {agent.boundWorkerIds.length > 0
                ? agent.boundWorkerIds.map((id) => roleLabel(id)).join(", ")
                : "None mapped"}
            </Field>
          </div>
        )}

        {activeTab === "Tasks" && (
          <div>
            {detailLoading ? (
              <p className="caption" style={{ opacity: 0.45 }}>Loading…</p>
            ) : detail?.recentTasks.length ? (
              <>
                {detail.recentTasks.map((t) => (
                  <TaskRow key={t.taskId} task={t} />
                ))}
                <p className="caption" style={{ marginTop: 10, opacity: 0.4, fontSize: "0.7rem" }}>
                  Recent 8 · ghost_app.tasks
                </p>
              </>
            ) : (
              <p className="caption" style={{ opacity: 0.45 }}>No tasks found for this agent.</p>
            )}
          </div>
        )}

        {activeTab === "Delegations" && (
          <div>
            {detailLoading ? (
              <p className="caption" style={{ opacity: 0.45 }}>Loading…</p>
            ) : detail?.recentDelegations.length ? (
              <>
                {detail.recentDelegations.map((d) => (
                  <DelegationRow key={d.delegationId} delegation={d} />
                ))}
                <p className="caption" style={{ marginTop: 10, opacity: 0.4, fontSize: "0.7rem" }}>
                  Recent 8 · ghost_app.conversation_delegations
                </p>
              </>
            ) : (
              <p className="caption" style={{ opacity: 0.45 }}>No delegations found for this agent.</p>
            )}
          </div>
        )}

        {activeTab === "Foundation Role" && (
          <div>
            {boundWorkers.length === 0 ? (
              <p className="caption" style={{ opacity: 0.45 }}>
                No foundation worker role mapped to this execution identity. This agent is registered in the DB but not linked to a foundation role definition.
              </p>
            ) : (
              boundWorkers.map((w) => (
                <div key={w.id} style={{ marginBottom: 18 }}>
                  <div className="kicker" style={{ marginBottom: 8 }}>{w.visibilityLabel}</div>
                  <Field label="Role">{roleLabel(w.role)}</Field>
                  <Field label="Purpose">{w.purpose}</Field>
                  <Field label="Env scope">{envScopeLabel(w.environmentScope)}</Field>
                  <Field label="Capabilities">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                      {w.capabilities.map((capId) => (
                        <CapPill key={capId} capId={capId} cap={capMap.get(capId)} />
                      ))}
                    </div>
                  </Field>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Shared activity content (used by foundation worker "Activity" tab) ----

function ActivityContent({ detail }: { detail: AgentDetailPayload }) {
  if (detail.errors.length > 0) {
    return (
      <p className="caption" style={{ color: "var(--warning)", opacity: 0.8 }}>
        {detail.errors[0]}
      </p>
    );
  }

  const hasTasks = detail.recentTasks.length > 0;
  const hasDelegations = detail.recentDelegations.length > 0;

  if (!hasTasks && !hasDelegations) {
    return <p className="caption" style={{ opacity: 0.45 }}>No recent activity found.</p>;
  }

  return (
    <div>
      {hasTasks && (
        <div style={{ marginBottom: 18 }}>
          <div className="kicker" style={{ marginBottom: 8, opacity: 0.65 }}>Recent tasks</div>
          {detail.recentTasks.map((t) => <TaskRow key={t.taskId} task={t} />)}
        </div>
      )}
      {hasDelegations && (
        <div>
          <div className="kicker" style={{ marginBottom: 8, opacity: 0.65 }}>Recent delegations</div>
          {detail.recentDelegations.map((d) => <DelegationRow key={d.delegationId} delegation={d} />)}
        </div>
      )}
      <p className="caption" style={{ marginTop: 10, opacity: 0.4, fontSize: "0.7rem" }}>
        Recent 8 each · ghost_app.tasks / conversation_delegations
      </p>
    </div>
  );
}

function TaskRow({ task }: { task: RecentTask }) {
  return (
    <div className="workspace-activity-row">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-soft)", lineHeight: 1.4 }}>
            {task.title}
          </p>
          <p className="caption" style={{ marginTop: 3, opacity: 0.5 }}>
            {task.executionTarget ?? task.source}
            {task.durationMs !== null ? ` · ${durationLabel(task.durationMs)}` : ""}
            {task.n8nExecutionId ? ` · #${task.n8nExecutionId}` : ""}
            {" · "}
            {relativeTime(task.updatedAt)}
          </p>
        </div>
        <StatusPill label={task.runStatus ?? task.status} tone={taskStatusTone(task.runStatus ?? task.status)} />
      </div>
    </div>
  );
}

function DelegationRow({ delegation }: { delegation: RecentDelegation }) {
  return (
    <div className="workspace-activity-row">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-soft)", lineHeight: 1.4 }}>
            {truncate(delegation.requestSummary, 120)}
          </p>
          {delegation.resultSummary && (
            <p className="caption" style={{ marginTop: 4, opacity: 0.5, lineHeight: 1.4 }}>
              {truncate(delegation.resultSummary, 160)}
            </p>
          )}
          <p className="caption" style={{ marginTop: 3, opacity: 0.4 }}>
            {delegation.workerProvider ?? "—"} · {delegation.workerModel ?? "—"}
            {" · "}
            {relativeTime(delegation.createdAt)}
          </p>
        </div>
        <StatusPill label={delegation.status} tone={taskStatusTone(delegation.status)} />
      </div>
    </div>
  );
}

// ---- Compact nav roster (used in workspace 2-col mode) ----

type Selection = { type: "foundation" | "runtime"; id: string } | null;

function NavRosterCard({
  workers,
  agents,
  selected,
  onSelectFoundation,
  onSelectRuntime,
}: {
  workers: FoundationWorker[];
  agents: RuntimeAgent[];
  selected: Selection;
  onSelectFoundation: (id: string) => void;
  onSelectRuntime: (id: string) => void;
}) {
  return (
    <Card>
      <div className="kicker" style={{ marginBottom: 10 }}>
        Workers
      </div>
      {workers.map((w) => {
        const isSelected = selected?.type === "foundation" && selected.id === w.id;
        return (
          <div
            key={w.id}
            className={`list-row agent-row-selectable${isSelected ? " agent-row-selected" : ""}`}
            style={{ marginBottom: 6, cursor: "pointer" }}
            onClick={() => onSelectFoundation(w.id)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ fontSize: "0.82rem" }}>{w.visibilityLabel}</h4>
              <p className="caption" style={{ marginTop: 2, opacity: 0.5 }}>
                {roleLabel(w.role)}
              </p>
            </div>
            <StatusPill label={statusLabel(w.runtimeStatus)} tone={statusTone(w.runtimeStatus)} />
          </div>
        );
      })}

      <div className="kicker" style={{ marginTop: 18, marginBottom: 10 }}>
        Runtime Agents
      </div>
      {agents.map((a) => {
        const isSelected = selected?.type === "runtime" && selected.id === a.agentKey;
        return (
          <div
            key={a.agentKey}
            className={`list-row agent-row-selectable${isSelected ? " agent-row-selected" : ""}`}
            style={{ marginBottom: 6, cursor: "pointer" }}
            onClick={() => onSelectRuntime(a.agentKey)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ fontSize: "0.82rem" }}>{a.displayName}</h4>
              <p className="caption" style={{ marginTop: 2, opacity: 0.5 }}>
                {a.provider ?? "—"}
              </p>
            </div>
            <StatusPill
              label={statusLabel(a.runtimeStatus)}
              tone={statusTone(a.runtimeStatus)}
            />
          </div>
        );
      })}
    </Card>
  );
}

// ---- Default 3-col panels (no selection) ----

function WorkerRosterCard({
  workers,
  selected,
  onSelect,
}: {
  workers: FoundationWorker[];
  selected: Selection;
  onSelect: (id: string) => void;
}) {
  const activeCount = workers.filter((w) => w.runtimeStatus === "active").length;
  const definedCount = workers.filter((w) => w.runtimeStatus === "defined").length;

  return (
    <Card>
      <div className="panel-header">
        <div>
          <div className="kicker">Worker Registry</div>
          <h3>Foundation roles</h3>
        </div>
        <StatusPill
          label={`${activeCount} active · ${definedCount} defined`}
          tone={activeCount > 0 ? "success" : "neutral"}
        />
      </div>
      <div className="list" style={{ marginTop: 18 }}>
        {workers.map((w) => {
          const isSelected = selected?.type === "foundation" && selected.id === w.id;
          return (
            <div
              key={w.id}
              className={`list-row agent-row-selectable${isSelected ? " agent-row-selected" : ""}`}
              style={{ alignItems: "flex-start" }}
              onClick={() => onSelect(w.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4>{w.visibilityLabel}</h4>
                <p className="caption" style={{ marginTop: 4 }}>
                  {roleLabel(w.role)}
                </p>
                <p className="caption" style={{ marginTop: 3, opacity: 0.55 }}>
                  {envScopeLabel(w.environmentScope)}
                </p>
              </div>
              <StatusPill label={statusLabel(w.runtimeStatus)} tone={statusTone(w.runtimeStatus)} />
            </div>
          );
        })}
      </div>
      <p className="caption" style={{ marginTop: 14, opacity: 0.4, fontSize: "0.7rem" }}>
        ops/foundation/workers.json · click to inspect
      </p>
    </Card>
  );
}

function CapabilityGrantsCard({
  workers,
  capMap,
  foundationVersion,
}: {
  workers: FoundationWorker[];
  capMap: Map<string, Capability>;
  foundationVersion: string;
}) {
  return (
    <Card>
      <div className="panel-header">
        <div>
          <div className="kicker">Capability Grants</div>
          <h3>Per-worker permissions</h3>
        </div>
        <StatusPill label={`${capMap.size} capabilities`} />
      </div>
      <div style={{ marginTop: 18 }}>
        {workers.map((w) => (
          <div key={w.id} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="kicker" style={{ opacity: 0.8 }}>
                {w.visibilityLabel}
              </span>
              {w.runtimeStatus === "active" && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "var(--success)",
                    display: "inline-block",
                    opacity: 0.8,
                  }}
                />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {w.capabilities.map((capId) => (
                <CapPill key={capId} capId={capId} cap={capMap.get(capId)} />
              ))}
              {w.capabilities.length === 0 && (
                <span className="caption" style={{ opacity: 0.35 }}>
                  no capabilities defined
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="caption" style={{ marginTop: 8, opacity: 0.4, fontSize: "0.7rem" }}>
        ⚠ = approval required · {foundationVersion}
      </p>
    </Card>
  );
}

function RuntimeAgentsCard({
  agents,
  selected,
  onSelect,
}: {
  agents: RuntimeAgent[];
  selected: Selection;
  onSelect: (key: string) => void;
}) {
  const activeCount = agents.filter((a) => a.runtimeStatus === "active").length;

  return (
    <Card>
      <div className="panel-header">
        <div>
          <div className="kicker">Runtime Agents</div>
          <h3>Execution identities</h3>
        </div>
        <StatusPill
          label={`${activeCount} active · ${agents.length - activeCount} registered`}
          tone={activeCount > 0 ? "success" : "neutral"}
        />
      </div>
      <div className="list" style={{ marginTop: 18 }}>
        {agents.map((a) => {
          const isSelected = selected?.type === "runtime" && selected.id === a.agentKey;
          return (
            <div
              key={a.agentKey}
              className={`list-row agent-row-selectable${isSelected ? " agent-row-selected" : ""}`}
              style={{ alignItems: "flex-start" }}
              onClick={() => onSelect(a.agentKey)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4>{a.displayName}</h4>
                <p className="caption" style={{ marginTop: 4 }}>
                  {a.provider ?? "—"} · {a.modelName ?? "—"}
                </p>
                <p className="caption" style={{ marginTop: 3 }}>
                  {a.taskCount} tasks · {a.delegationCount} delegations
                </p>
                {a.boundWorkerIds.length > 0 && (
                  <p className="caption" style={{ marginTop: 3, opacity: 0.6 }}>
                    role: {a.boundWorkerIds.map(roleLabel).join(", ")}
                  </p>
                )}
                <p className="caption" style={{ marginTop: 3, opacity: 0.45 }}>
                  last active: {relativeTime(a.lastActive)}
                </p>
              </div>
              <StatusPill
                label={statusLabel(a.runtimeStatus)}
                tone={statusTone(a.runtimeStatus)}
              />
            </div>
          );
        })}
      </div>
      <p className="caption" style={{ marginTop: 14, opacity: 0.4, fontSize: "0.7rem" }}>
        ghost_app.agents · click to inspect
      </p>
    </Card>
  );
}

// ---- Main component ----

export function AgentRegistryLive({ initialPayload }: { initialPayload: AgentRegistryPayload }) {
  const payload = initialPayload;
  const [selected, setSelected] = useState<Selection>(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [detail, setDetail] = useState<AgentDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const capMap = new Map(payload.capabilities.map((c) => [c.id, c]));

  const fetchDetail = (agentKey: string) => {
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/operations/agents/${agentKey}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AgentDetailPayload) => {
        setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  };

  const handleSelectFoundation = (workerId: string) => {
    if (selected?.type === "foundation" && selected.id === workerId) {
      setSelected(null);
      setDetail(null);
      return;
    }
    setSelected({ type: "foundation", id: workerId });
    setActiveTab("Overview");
    const worker = payload.foundationWorkers.find((w) => w.id === workerId);
    if (worker?.boundAgentKey) {
      fetchDetail(worker.boundAgentKey);
    } else {
      setDetail(null);
      setDetailLoading(false);
    }
  };

  const handleSelectRuntime = (agentKey: string) => {
    if (selected?.type === "runtime" && selected.id === agentKey) {
      setSelected(null);
      setDetail(null);
      return;
    }
    setSelected({ type: "runtime", id: agentKey });
    setActiveTab("Overview");
    fetchDetail(agentKey);
  };

  const selectedWorker =
    selected?.type === "foundation"
      ? payload.foundationWorkers.find((w) => w.id === selected.id) ?? null
      : null;

  const selectedAgent =
    selected?.type === "runtime"
      ? payload.runtimeAgents.find((a) => a.agentKey === selected.id) ?? null
      : null;

  const boundAgent = selectedWorker?.boundAgentKey
    ? payload.runtimeAgents.find((a) => a.agentKey === selectedWorker.boundAgentKey) ?? null
    : null;

  const boundWorkers = selectedAgent
    ? payload.foundationWorkers.filter((w) => selectedAgent.boundWorkerIds.includes(w.id))
    : [];

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Agent Management"
        title="Worker registry and runtime identity map."
        copy={
          selected
            ? "Select a different item to switch focus, or click the same item to return to the overview."
            : "Click any worker or runtime agent to open its workspace. Foundation workers define roles and policy; runtime agents are live execution identities."
        }
      />

      {!selected ? (
        <div className="agent-layout">
          <WorkerRosterCard
            workers={payload.foundationWorkers}
            selected={selected}
            onSelect={handleSelectFoundation}
          />
          <CapabilityGrantsCard
            workers={payload.foundationWorkers}
            capMap={capMap}
            foundationVersion={payload.foundationVersion}
          />
          <RuntimeAgentsCard
            agents={payload.runtimeAgents}
            selected={selected}
            onSelect={handleSelectRuntime}
          />
        </div>
      ) : (
        <div className="agent-layout-workspace" style={{ display: "grid", gap: 18 }}>
          <NavRosterCard
            workers={payload.foundationWorkers}
            agents={payload.runtimeAgents}
            selected={selected}
            onSelectFoundation={handleSelectFoundation}
            onSelectRuntime={handleSelectRuntime}
          />
          {selectedWorker && (
            <FoundationWorkerWorkspace
              worker={selectedWorker}
              capMap={capMap}
              boundAgent={boundAgent}
              detail={detail}
              detailLoading={detailLoading}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          )}
          {selectedAgent && (
            <RuntimeAgentWorkspace
              agent={selectedAgent}
              boundWorkers={boundWorkers}
              capMap={capMap}
              detail={detail}
              detailLoading={detailLoading}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          )}
        </div>
      )}

      {payload.errors.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {payload.errors.map((e) => (
            <p key={e} className="caption" style={{ color: "var(--warning)", marginBottom: 4 }}>
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
