"use client";

import type { AgentRegistryPayload, FoundationWorker, RuntimeAgent, WorkerRuntimeStatus } from "@/lib/server/agent-registry";
import { Card, SectionHeader, StatusPill } from "@/components/ui";

function workerStatusTone(s: WorkerRuntimeStatus): "success" | "warning" | "neutral" {
  if (s === "active") return "success";
  if (s === "registered") return "warning";
  return "neutral";
}

function workerStatusLabel(s: WorkerRuntimeStatus): string {
  if (s === "active") return "Active";
  if (s === "registered") return "Registered";
  return "Defined";
}

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function envScopeLabel(scope: string[]): string {
  if (scope.length === 5) return "all environments";
  return scope.join(" · ");
}

function relativeTime(ts: string | null): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const h = Math.floor(diffMs / 3600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function WorkerRosterCard({ workers }: { workers: FoundationWorker[] }) {
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
        {workers.map((w) => (
          <div key={w.id} className="list-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4>{w.visibilityLabel}</h4>
              <p className="caption" style={{ marginTop: 4 }}>
                {roleLabel(w.role)}
              </p>
              <p className="caption" style={{ marginTop: 3, opacity: 0.55 }}>
                {envScopeLabel(w.environmentScope)}
              </p>
            </div>
            <StatusPill label={workerStatusLabel(w.runtimeStatus)} tone={workerStatusTone(w.runtimeStatus)} />
          </div>
        ))}
      </div>

      <p className="caption" style={{ marginTop: 16, opacity: 0.45, fontSize: "0.7rem" }}>
        ops/foundation/workers.json
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
  capMap: Map<string, { cls: "non_destructive" | "destructive"; approvalRequired: boolean }>;
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
                    backgroundColor: "var(--color-success, #5aff9e)",
                    display: "inline-block",
                    opacity: 0.8,
                  }}
                />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {w.capabilities.map((capId) => {
                const cap = capMap.get(capId);
                const destructive = cap?.cls === "destructive";
                return (
                  <span
                    key={capId}
                    className="signal-pill"
                    style={{ fontSize: "0.7rem", opacity: destructive ? 1 : 0.65 }}
                  >
                    <span className={`status-dot ${destructive ? "warning" : "success"}`} />
                    {capId}
                    {cap?.approvalRequired ? " ⚠" : ""}
                  </span>
                );
              })}
              {w.capabilities.length === 0 && (
                <span className="caption" style={{ opacity: 0.35 }}>
                  no capabilities defined
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="caption" style={{ marginTop: 8, opacity: 0.45, fontSize: "0.7rem" }}>
        ⚠ = approval required · ops/foundation/capabilities.json · {foundationVersion}
      </p>
    </Card>
  );
}

function RuntimeAgentsCard({ agents }: { agents: RuntimeAgent[] }) {
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
        {agents.map((agent) => (
          <div key={agent.agentKey} className="list-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4>{agent.displayName}</h4>
              <p className="caption" style={{ marginTop: 4 }}>
                {agent.provider ?? "—"} · {agent.modelName ?? "—"}
              </p>
              <p className="caption" style={{ marginTop: 3 }}>
                {agent.taskCount} tasks · {agent.delegationCount} delegations
              </p>
              {agent.boundWorkerIds.length > 0 && (
                <p className="caption" style={{ marginTop: 3, opacity: 0.6 }}>
                  role: {agent.boundWorkerIds.map((id) => roleLabel(id)).join(", ")}
                </p>
              )}
              <p className="caption" style={{ marginTop: 3, opacity: 0.45 }}>
                last active: {relativeTime(agent.lastActive)}
              </p>
            </div>
            <StatusPill
              label={agent.runtimeStatus === "active" ? "Active" : "Registered"}
              tone={agent.runtimeStatus === "active" ? "success" : "warning"}
            />
          </div>
        ))}
      </div>

      <p className="caption" style={{ marginTop: 16, opacity: 0.45, fontSize: "0.7rem" }}>
        ghost_app.agents · live DB query
      </p>
    </Card>
  );
}

export function AgentRegistryLive({ initialPayload }: { initialPayload: AgentRegistryPayload }) {
  const payload = initialPayload;

  const capMap = new Map(
    payload.capabilities.map((c) => [c.id, { cls: c.cls, approvalRequired: c.approvalRequired }]),
  );

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Agent Management"
        title="Worker registry and runtime identity map."
        copy="Foundation workers define roles, capability grants, and environment scope. Runtime agents are the execution identities active in the live dispatch layer. Two distinct registers, one operator surface."
      />

      <div className="agent-layout">
        <WorkerRosterCard workers={payload.foundationWorkers} />
        <CapabilityGrantsCard
          workers={payload.foundationWorkers}
          capMap={capMap}
          foundationVersion={payload.foundationVersion}
        />
        <RuntimeAgentsCard agents={payload.runtimeAgents} />
      </div>

      {payload.errors.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {payload.errors.map((e) => (
            <p key={e} className="caption" style={{ color: "var(--color-warning, #f5a623)", marginBottom: 4 }}>
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
