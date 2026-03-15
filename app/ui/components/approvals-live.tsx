"use client";

import { useState } from "react";
import type { ApprovalQueuePayload, ApprovalQueueItem } from "@/lib/server/approval-queue";
import type { ApprovalEnrichment, GovernanceAuditTrail, GovernanceEvent, ActionEvent } from "@/lib/server/approval-workspace";
import { Card, SectionHeader, StatusPill } from "@/components/ui";

// ---- Helpers ----

function approvalStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function capTone(cls: string): "warning" | "success" {
  return cls === "destructive" ? "warning" : "success";
}

function relativeTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function eventTypeTone(type: string): string {
  if (type.startsWith("governance.")) return "governance";
  if (type.startsWith("approval.")) return "governance";
  if (type.startsWith("outcome.")) return "outcome";
  return "";
}

function humanEventType(type: string): string {
  const labels: Record<string, string> = {
    "governance.transitioned": "State transitioned",
    "governance.allowed": "Execution allowed",
    "governance.denied": "Execution denied",
    "governance.retry_enqueued": "Retry enqueued",
    "governance.retry_dispatched": "Retry dispatched",
    "approval.resolved": "Approval resolved",
    "request.received": "Request received",
    "runtime.completed": "Runtime completed",
    "runtime.started": "Runtime started",
    "delegation.created": "Delegation created",
    "outcome.recorded": "Outcome recorded",
    "artifact.published": "Artifact published",
  };
  return labels[type] ?? type;
}

function truncate(s: string | null, max = 180): string {
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---- WorkspaceTabs (reuse workspace-tab CSS from agent management) ----

function WorkspaceTabs({ tabs, active, onSelect }: { tabs: string[]; active: string; onSelect: (t: string) => void }) {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="workspace-field">
      <div className="workspace-field-label">{label}</div>
      <div className="workspace-field-value">{children}</div>
    </div>
  );
}

// ---- Approval queue panel ----

function ApprovalQueuePanel({
  approvals,
  counts,
  selectedId,
  onSelect,
}: {
  approvals: ApprovalQueueItem[];
  counts: { pending: number; resolved: number; total: number };
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  return (
    <Card>
      <div className="panel-header">
        <div>
          <div className="kicker">Approval Queue</div>
          <h3>Governed decisions</h3>
        </div>
        <StatusPill
          label={counts.pending > 0 ? `${counts.pending} pending` : `${counts.total} total`}
          tone={counts.pending > 0 ? "warning" : "neutral"}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        {/* Pending section */}
        <div className="approval-queue-section-label">
          {counts.pending > 0 ? `Needs attention (${counts.pending})` : "Pending (none)"}
        </div>
        {pending.length === 0 ? (
          <p className="caption" style={{ opacity: 0.4, marginBottom: 10 }}>
            No approvals awaiting operator action.
          </p>
        ) : (
          pending.map((a) => <ApprovalQueueRow key={a.approvalId} approval={a} selectedId={selectedId} onSelect={onSelect} />)
        )}

        <div className="approval-queue-divider" />

        {/* Resolved section */}
        <div className="approval-queue-section-label">Resolved ({counts.resolved})</div>
        {resolved.length === 0 ? (
          <p className="caption" style={{ opacity: 0.4 }}>
            No resolved approvals.
          </p>
        ) : (
          resolved.map((a) => <ApprovalQueueRow key={a.approvalId} approval={a} selectedId={selectedId} onSelect={onSelect} />)
        )}
      </div>

      <p className="caption" style={{ marginTop: 14, opacity: 0.4, fontSize: "0.7rem" }}>
        ghost_app.approvals · click to inspect
      </p>
    </Card>
  );
}

function ApprovalQueueRow({
  approval,
  selectedId,
  onSelect,
}: {
  approval: ApprovalQueueItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isSelected = selectedId === approval.approvalId;
  const isPending = approval.status === "pending";

  return (
    <div
      className={`list-row approval-queue-row${isSelected ? " approval-queue-row-selected" : ""}`}
      style={{ alignItems: "flex-start", marginBottom: 7 }}
      onClick={() => onSelect(approval.approvalId)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {approval.requestedCapabilities.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {approval.requestedCapabilities.map((cap) => (
              <span key={cap} className="signal-pill" style={{ fontSize: "0.68rem" }}>
                <span className="status-dot warning" />
                {cap}
              </span>
            ))}
          </div>
        )}
        <p className="caption" style={{ opacity: 0.65, marginTop: 0 }}>
          {approval.governanceEnvironment ?? "—"} · {approval.approvalType}
        </p>
        <p className="caption" style={{ marginTop: 3, opacity: 0.45 }}>
          {isPending ? `requested ${relativeTime(approval.requestedAt)}` : `resolved ${relativeTime(approval.respondedAt)}`}
        </p>
      </div>
      <StatusPill label={approval.status} tone={approvalStatusTone(approval.status)} />
    </div>
  );
}

// ---- Audit trail panel (right panel, no selection) ----

function AuditTrailPanel({ audit }: { audit: GovernanceAuditTrail }) {
  return (
    <Card>
      <div className="panel-header">
        <div>
          <div className="kicker">Governance Audit Trail</div>
          <h3>Recent governed events</h3>
        </div>
        <StatusPill label={`${audit.events.length} events`} />
      </div>

      <div style={{ marginTop: 18 }}>
        {audit.events.length === 0 && (
          <p className="caption" style={{ opacity: 0.45 }}>
            No governed events found. Governance events appear here when approvals, delegations, or policy decisions are recorded.
          </p>
        )}
        {audit.events.map((e) => (
          <AuditEventRow key={e.actionId} event={e} />
        ))}
        {audit.errors.length > 0 && (
          <p className="caption" style={{ color: "var(--warning)", marginTop: 10 }}>{audit.errors[0]}</p>
        )}
      </div>

      <p className="caption" style={{ marginTop: 12, opacity: 0.4, fontSize: "0.7rem" }}>
        ghost_app.ghost_action_history · governance + delegation + outcome events
      </p>
    </Card>
  );
}

function AuditEventRow({ event }: { event: GovernanceEvent }) {
  const cls = eventTypeTone(event.eventType);
  return (
    <div className={`audit-event-row ${cls}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="event-type-badge">{humanEventType(event.eventType)}</span>
          <p style={{ margin: "3px 0 0", fontSize: "0.8rem", color: "var(--text-soft)", lineHeight: 1.45 }}>
            {truncate(event.summary, 150)}
          </p>
          {event.outcomeStatus && event.outcomeStatus !== "not_applicable" && (
            <p className="caption" style={{ marginTop: 3, opacity: 0.55 }}>
              outcome: {event.outcomeStatus}
            </p>
          )}
          <p className="caption" style={{ marginTop: 3, opacity: 0.4 }}>
            {event.sourceSurface} · {relativeTime(event.occurredAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Approval workspace (right panel when something selected) ----

function ApprovalWorkspace({
  approval,
  enrichment,
  enrichmentLoading,
  activeTab,
  setActiveTab,
}: {
  approval: ApprovalQueueItem;
  enrichment: ApprovalEnrichment | null;
  enrichmentLoading: boolean;
  activeTab: string;
  setActiveTab: (t: string) => void;
}) {
  const tabs = ["Overview", "Request", "Follow-through", "IDs"];
  const isPending = approval.status === "pending";

  return (
    <Card>
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="kicker">{approval.approvalType}</div>
          <h3>Approval detail</h3>
        </div>
        <StatusPill label={approval.status} tone={approvalStatusTone(approval.status)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <WorkspaceTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        {activeTab === "Overview" && (
          <div>
            <Field label="Status">
              <StatusPill label={approval.status} tone={approvalStatusTone(approval.status)} />
              {approval.outcomeStatus ? (
                <span className="caption" style={{ marginLeft: 8, opacity: 0.6 }}>→ {approval.outcomeStatus}</span>
              ) : null}
            </Field>
            <Field label="Type">{approval.approvalType}</Field>
            <Field label="Environment">{approval.governanceEnvironment ?? "—"}</Field>
            <Field label="Capabilities">
              {approval.requestedCapabilities.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {approval.requestedCapabilities.map((cap) => (
                    <span key={cap} className="signal-pill" style={{ fontSize: "0.72rem" }}>
                      <span className="status-dot warning" />
                      {cap}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ opacity: 0.4 }}>none listed</span>
              )}
            </Field>
            <Field label="Requested">{shortTs(approval.requestedAt)}</Field>
            {!isPending && (
              <>
                <Field label="Responded">{shortTs(approval.respondedAt)}</Field>
                <Field label="Resolved by">{approval.resolvedBy ?? "—"}</Field>
                {approval.responseText && (
                  <Field label="Response note">{approval.responseText}</Field>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "Request" && (
          <div>
            {enrichmentLoading && <p className="caption" style={{ opacity: 0.45 }}>Loading…</p>}
            {!enrichmentLoading && (
              <>
                {/* Requesting worker */}
                {enrichment?.workerDisplayName ? (
                  <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                    <div className="kicker" style={{ marginBottom: 6 }}>Requesting worker</div>
                    <Field label="Agent">{enrichment.workerDisplayName} ({enrichment.workerAgentKey ?? "—"})</Field>
                    <Field label="Provider">{enrichment.workerProvider ?? "—"}</Field>
                    <Field label="Model">{enrichment.workerModel ?? "—"}</Field>
                    {enrichment.delegationStatus && (
                      <Field label="Delegation status">{enrichment.delegationStatus}</Field>
                    )}
                  </div>
                ) : (
                  !enrichmentLoading && (
                    <p className="caption" style={{ opacity: 0.45, marginBottom: 14 }}>
                      Requesting worker not traceable — no delegation linkage found.
                    </p>
                  )
                )}

                {/* Capability details */}
                {enrichment && enrichment.capabilityDetails.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="kicker" style={{ marginBottom: 8 }}>Requested capabilities</div>
                    {enrichment.capabilityDetails.map((cap) => (
                      <div key={cap.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                        <span className="signal-pill" style={{ fontSize: "0.72rem", flexShrink: 0 }}>
                          <span className={`status-dot ${capTone(cap.cls)}`} />
                          {cap.id}
                        </span>
                        <p className="caption" style={{ margin: 0, flex: 1, opacity: 0.6, lineHeight: 1.5 }}>
                          {cap.description ?? "—"}
                          {cap.cls === "destructive" && <span style={{ color: "var(--warning)", marginLeft: 6 }}>Requires approval.</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Delegation request summary */}
                {enrichment?.delegationRequestSummary ? (
                  <div>
                    <div className="kicker" style={{ marginBottom: 8 }}>Delegation request</div>
                    <p style={{ margin: 0, fontSize: "0.83rem", color: "var(--text-soft)", lineHeight: 1.6 }}>
                      {enrichment.delegationRequestSummary}
                    </p>
                  </div>
                ) : null}

                {/* Prompt text fallback */}
                <div style={{ marginTop: 16 }}>
                  <div className="kicker" style={{ marginBottom: 8 }}>Approval prompt</div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-dim)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                    {approval.promptText}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "Follow-through" && (
          <div>
            {enrichmentLoading && <p className="caption" style={{ opacity: 0.45 }}>Loading…</p>}
            {!enrichmentLoading && enrichment && (
              <>
                {/* Follow-through record */}
                {enrichment.followThrough ? (
                  <div style={{ marginBottom: 18, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "rgba(111,230,179,0.025)", border: "1px solid rgba(111,230,179,0.08)" }}>
                    <div className="kicker" style={{ marginBottom: 8, color: "var(--success)" }}>
                      Follow-through record
                    </div>
                    <Field label="ID">
                      <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                        {enrichment.followThrough.followThroughId}
                      </code>
                    </Field>
                    <Field label="Execution state">{enrichment.followThrough.executionState}</Field>
                    <Field label="Type">{enrichment.followThrough.followThroughType}</Field>
                    {enrichment.followThrough.workerLabel && (
                      <Field label="Worker">{enrichment.followThrough.workerLabel}</Field>
                    )}
                    <Field label="Outcome">{enrichment.followThrough.outcomeStatus ?? "—"}</Field>
                    {enrichment.followThrough.retryDispatchedAt && (
                      <Field label="Retry dispatched">{shortTs(enrichment.followThrough.retryDispatchedAt)}</Field>
                    )}
                    {enrichment.followThrough.retryN8nExecutionId && (
                      <Field label="Retry execution">#{enrichment.followThrough.retryN8nExecutionId}</Field>
                    )}
                    {enrichment.followThrough.retryReplySummary && (
                      <div style={{ marginTop: 12 }}>
                        <div className="kicker" style={{ marginBottom: 6 }}>Worker reply</div>
                        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-dim)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                          {truncate(enrichment.followThrough.retryReplySummary, 600)}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="caption" style={{ opacity: 0.45, marginBottom: 16 }}>
                    {approval.status === "rejected"
                      ? "No follow-through recorded — approval was rejected."
                      : "No follow-through record found for this approval."}
                  </p>
                )}

                {/* Action history events */}
                {enrichment.actionEvents.length > 0 ? (
                  <div>
                    <div className="kicker" style={{ marginBottom: 8 }}>Governance event chain</div>
                    {enrichment.actionEvents.map((e) => (
                      <ActionEventRow key={e.actionId} event={e} />
                    ))}
                  </div>
                ) : (
                  <p className="caption" style={{ opacity: 0.45 }}>
                    No action history linked to this approval.
                  </p>
                )}
              </>
            )}
            {!enrichmentLoading && !enrichment && (
              <p className="caption" style={{ opacity: 0.45 }}>Follow-through data unavailable.</p>
            )}
          </div>
        )}

        {activeTab === "IDs" && (
          <div>
            <p className="caption" style={{ opacity: 0.55, marginBottom: 14 }}>
              Reference IDs for operator debugging and cross-system lookup.
            </p>
            <Field label="Approval ID">
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{approval.approvalId}</code>
            </Field>
            <Field label="Conversation ID">
              {approval.conversationId ? (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{approval.conversationId}</code>
              ) : <span style={{ opacity: 0.4 }}>—</span>}
            </Field>
            <Field label="Delegation ID">
              {approval.delegationId ? (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{approval.delegationId}</code>
              ) : <span style={{ opacity: 0.4 }}>—</span>}
            </Field>
            <Field label="Runtime task ID">
              {approval.runtimeTaskId ? (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{approval.runtimeTaskId}</code>
              ) : <span style={{ opacity: 0.4 }}>—</span>}
            </Field>
            <Field label="Orchestration task ID">
              {approval.orchestrationTaskId ? (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{approval.orchestrationTaskId}</code>
              ) : <span style={{ opacity: 0.4 }}>—</span>}
            </Field>
            <Field label="n8n execution ID">
              {approval.n8nExecutionId ? (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>#{approval.n8nExecutionId}</code>
              ) : <span style={{ opacity: 0.4 }}>—</span>}
            </Field>
            <Field label="Source path">{approval.sourcePath ?? "—"}</Field>
          </div>
        )}
      </div>
    </Card>
  );
}

function ActionEventRow({ event }: { event: ActionEvent }) {
  const cls = eventTypeTone(event.eventType);
  return (
    <div className={`audit-event-row ${cls}`}>
      <span className="event-type-badge">{humanEventType(event.eventType)}</span>
      <p style={{ margin: "3px 0 2px", fontSize: "0.8rem", color: "var(--text-soft)", lineHeight: 1.45 }}>
        {event.summary}
      </p>
      {event.outcomeStatus && event.outcomeStatus !== "not_applicable" && (
        <p className="caption" style={{ marginTop: 2, opacity: 0.55 }}>outcome: {event.outcomeStatus}</p>
      )}
      <p className="caption" style={{ marginTop: 2, opacity: 0.4 }}>
        {event.sourceSurface} · {shortTs(event.occurredAt)}
      </p>
    </div>
  );
}

// ---- Main component ----

export function ApprovalsLive({
  initialPayload,
  initialAudit,
}: {
  initialPayload: ApprovalQueuePayload;
  initialAudit: GovernanceAuditTrail;
}) {
  const payload = initialPayload;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [enrichment, setEnrichment] = useState<ApprovalEnrichment | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);

  const handleSelect = (approvalId: string) => {
    if (selectedId === approvalId) {
      setSelectedId(null);
      setEnrichment(null);
      return;
    }
    setSelectedId(approvalId);
    setActiveTab("Overview");
    setEnrichment(null);
    setEnrichmentLoading(true);
    fetch(`/api/operations/approvals/${approvalId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApprovalEnrichment) => {
        setEnrichment(d);
        setEnrichmentLoading(false);
      })
      .catch(() => setEnrichmentLoading(false));
  };

  const selectedApproval = payload.approvals.find((a) => a.approvalId === selectedId) ?? null;

  const headerCopy = payload.counts.pending > 0
    ? `${payload.counts.pending} approval${payload.counts.pending !== 1 ? "s" : ""} awaiting operator action. Click any item to inspect the governed context.`
    : "No approvals pending. Click any resolved approval to trace the governed decision and follow-through.";

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Governed Approvals"
        title="Approval queue and governance audit trail."
        copy={headerCopy}
      />

      <div className="approvals-layout">
        <ApprovalQueuePanel
          approvals={payload.approvals}
          counts={payload.counts}
          selectedId={selectedId}
          onSelect={handleSelect}
        />

        {selectedApproval ? (
          <ApprovalWorkspace
            approval={selectedApproval}
            enrichment={enrichment}
            enrichmentLoading={enrichmentLoading}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        ) : (
          <AuditTrailPanel audit={initialAudit} />
        )}
      </div>

      {payload.errors.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {payload.errors.map((e) => (
            <p key={e} className="caption" style={{ color: "var(--warning)" }}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
