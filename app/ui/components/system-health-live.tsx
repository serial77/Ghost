"use client";

import { useEffect, useState } from "react";
import type { ServiceCheck, SystemHealthPayload, WorkflowStatus, RuntimeSummary } from "@/lib/server/system-health";
import { Card, SectionHeader, StatusPill } from "@/components/ui";

const pollingIntervalMs = 30_000;

function statusTone(status: ServiceCheck["status"]): "success" | "warning" | "danger" {
  if (status === "ok") return "success";
  if (status === "degraded") return "warning";
  return "danger";
}

function latencyLabel(ms: number | null) {
  if (ms === null) return null;
  if (ms < 50) return `${ms}ms`;
  if (ms < 500) return `${ms}ms`;
  return `${ms}ms ⚠`;
}

export function SystemHealthLive({ initialPayload }: { initialPayload: SystemHealthPayload }) {
  const [payload, setPayload] = useState<SystemHealthPayload>(initialPayload);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/operations/system-health", { cache: "no-store" });
        if (res.ok) setPayload((await res.json()) as SystemHealthPayload);
      } catch {
        // non-fatal: keep showing last known state
      }
    }

    const interval = window.setInterval(poll, pollingIntervalMs);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const wf: WorkflowStatus | null = payload.workflow;
  const rt: RuntimeSummary = payload.runtime;
  const overallTone = payload.degraded ? "danger" : "success";
  const overallLabel = payload.degraded ? "Degraded" : "All systems nominal";

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="System Health"
        title="Live Ghost runtime status."
        copy="Service reachability, active workflow state, and runtime activity — backed by live DB and n8n checks. Refreshes every 30 seconds."
      />

      <div className="task-summary-grid">
        <Card>
          <div className="metric">
            <div className="metric-label">Overall</div>
            <div className="metric-value" style={{ fontSize: "1.4rem", marginBottom: 8 }}>
              {payload.degraded ? "Degraded" : "Healthy"}
            </div>
            <StatusPill label={overallLabel} tone={overallTone} />
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Active tasks</div>
            <div className="metric-value" style={{ fontSize: "2.4rem" }}>{rt.activeTasks}</div>
            <p className="caption">Running in task ledger right now.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Stale tasks</div>
            <div className="metric-value" style={{ fontSize: "2.4rem", color: rt.staleTasks > 0 ? "var(--color-warning)" : undefined }}>{rt.staleTasks}</div>
            <p className="caption">Running &gt;30 min with no recent activity.</p>
          </div>
        </Card>
        <Card>
          <div className="metric">
            <div className="metric-label">Approvals pending</div>
            <div className="metric-value" style={{ fontSize: "2.4rem", color: rt.approvalsPending > 0 ? "var(--color-warning)" : undefined }}>{rt.approvalsPending}</div>
            <p className="caption">Awaiting operator action in approval queue.</p>
          </div>
        </Card>
      </div>

      <div className="metric-grid">
        <Card className="span-5">
          <div className="panel-header">
            <div>
              <div className="kicker">Services</div>
              <h3>Backend block status</h3>
            </div>
            <StatusPill
              label={`${payload.services.filter((s) => s.status === "ok").length}/${payload.services.length} ok`}
              tone={overallTone}
            />
          </div>
          <div className="list" style={{ marginTop: 18 }}>
            {payload.services.map((svc: ServiceCheck) => (
              <div key={svc.id} className="list-row">
                <div>
                  <h4>{svc.label}</h4>
                  <p className="caption" style={{ marginTop: 4 }}>
                    {svc.detail}
                    {svc.latencyMs !== null ? <span style={{ opacity: 0.5 }}> · {latencyLabel(svc.latencyMs)}</span> : null}
                  </p>
                </div>
                <StatusPill label={svc.status} tone={statusTone(svc.status)} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="span-7">
          <div className="panel-header">
            <div>
              <div className="kicker">Runtime Workflow</div>
              <h3>{wf ? wf.name : "Unknown"}</h3>
            </div>
            {wf ? (
              <StatusPill
                label={wf.active && wf.webhookRegistered ? "active" : wf.active ? "no webhook" : "inactive"}
                tone={wf.active && wf.webhookRegistered ? "success" : "danger"}
              />
            ) : (
              <StatusPill label="unavailable" tone="danger" />
            )}
          </div>
          {wf ? (
            <div className="task-detail-grid" style={{ marginTop: 18 }}>
              <div>
                <div className="metric-label">Workflow ID</div>
                <p className="caption task-detail-code">{wf.id}</p>
              </div>
              <div>
                <div className="metric-label">Active</div>
                <p className="caption">{wf.active ? "Yes" : "No"}</p>
              </div>
              <div>
                <div className="metric-label">Webhook Path</div>
                <p className="caption task-detail-code">POST /webhook/{wf.webhookPath || "—"}</p>
              </div>
              <div>
                <div className="metric-label">Webhook Registered</div>
                <p className="caption">{wf.webhookRegistered ? "Yes" : "No"}</p>
              </div>
              <div>
                <div className="metric-label">Executions (24h)</div>
                <p className="caption">{rt.recentExecutions} tasks started</p>
              </div>
              <div>
                <div className="metric-label">Last checked</div>
                <p className="caption">{new Date(payload.generatedAt).toLocaleTimeString()}</p>
              </div>
            </div>
          ) : (
            <p className="caption" style={{ marginTop: 18 }}>Workflow state unavailable — ghost_core query failed.</p>
          )}
          {payload.errors.length > 0 ? (
            <div className="task-errors" style={{ marginTop: 12 }}>
              {payload.errors.map((e) => <p key={e} className="caption">{e}</p>)}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
