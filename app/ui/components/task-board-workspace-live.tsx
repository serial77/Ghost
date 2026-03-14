"use client";

import { useEffect, useState } from "react";
import type { TaskBoardLaneId, TaskBoardWorkspacePayload } from "@/lib/operations";
import { Card, StatusPill } from "@/components/ui";
import { cn } from "@/lib/utils";
import styles from "./task-board-workspace-live.module.css";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "planning", label: "Planning" },
  { id: "activity", label: "Activity" },
  { id: "deliverables", label: "Deliverables" },
  { id: "sessions", label: "Sessions" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function relativeTime(value?: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.abs(seconds) < 60 ? Math.round(seconds) : Math.round(seconds / 60),
    Math.abs(seconds) < 60 ? "second" : "minute",
  );
}

function absoluteTime(value?: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ── Workspace metric — flat, no card box ──────────────────────────────────────

function WorkspaceMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={styles.metric}>
      <div className="metric-label">{label}</div>
      <div className={styles.metricValue}>{value}</div>
      <p className="caption">{detail}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaskBoardWorkspaceLive({
  initialPayload,
  mode = "page",
  onClose,
  onMutated,
}: {
  initialPayload: TaskBoardWorkspacePayload;
  mode?: "page" | "drawer";
  onClose?: () => void;
  onMutated?: () => Promise<void> | void;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [stageValue, setStageValue] = useState<TaskBoardLaneId>(initialPayload.item?.boardStage ?? "assigned");
  const [agentValue, setAgentValue] = useState(initialPayload.item?.orchestrationOwner?.id ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const item = payload.item;
  const isDrawer = mode === "drawer";

  useEffect(() => { setPayload(initialPayload); }, [initialPayload]);

  useEffect(() => {
    setStageValue(initialPayload.item?.boardStage ?? "assigned");
    setAgentValue(initialPayload.item?.orchestrationOwner?.id ?? "");
    setSaveError(null);
  }, [initialPayload]);

  async function applyControls() {
    if (!item || !payload.controls.editable) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/operations/task-board", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orchestrationTaskId: item.id.replace(/^orch_/, ""),
          stage: stageValue,
          orchestratorAgentId: agentValue || null,
          actorId: "ghost-operator-ui",
        }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "Orchestration control update failed.");
      }
      if (onMutated) await onMutated();
      else window.location.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Orchestration control update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  // Tab content — shared between drawer and page modes
  const tabContent = item ? (
    <>
      {activeTab === "overview" ? (
        <div className={styles.tabBody}>
          <div className={styles.sectionGrid}>
            <div>
              <div className="kicker">Summary</div>
              <p className={styles.bodyText}>{item.summary}</p>
              <p className={styles.bodyMuted}>{item.description || "No extended description recorded yet."}</p>
            </div>
            <div className={styles.factGrid}>
              <div>
                <div className={styles.factLabel}>Ownership</div>
                <div className={styles.factValue}>{item.ownershipLabel}</div>
                <div className="caption">{item.ownershipDetail}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Visible stage</div>
                <div className={styles.factValue}>{item.stageLabel}</div>
                <div className="caption">{item.stageReason}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Board stage</div>
                <div className={styles.factValue}>{item.boardStageLabel ?? (item.boardStage ? item.boardStage.replace(/_/g, " ") : "None")}</div>
                <div className="caption">
                  {item.runtimeOverridesBoardStage
                    ? "Runtime truth overrides visible stage."
                    : "Board stage matches visible stage."}
                </div>
              </div>
              <div>
                <div className={styles.factLabel}>Runtime actor</div>
                <div className={styles.factValue}>{item.assignedActor?.label ?? "No runtime actor yet"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Orchestration owner</div>
                <div className={styles.factValue}>{item.orchestrationOwner?.label ?? item.orchestratorLabel ?? "Ghost"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Latest activity</div>
                <div className={styles.factValue}>{item.latestActivityTitle ?? "No activity yet"}</div>
                <div className="caption">{item.latestActivityDetail ?? ""}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Updated</div>
                <div className={styles.factValue}>{relativeTime(item.latestActivityAt ?? item.updatedAt)}</div>
                <div className="caption">{absoluteTime(item.updatedAt)}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Parent conversation</div>
                <div className={styles.factValue}>{item.parentConversationId ?? "Not linked"}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "planning" ? (
        <div className={styles.tabBody}>
          <div className={styles.planningBlock}>
            <div>
              <div className="kicker">Controls</div>
              <h3 className={styles.sectionTitle}>Orchestration metadata</h3>
            </div>
            {payload.controls.editable ? (
              <div className={styles.factGrid}>
                <div>
                  <div className={styles.factLabel}>Board stage</div>
                  <select className={styles.controlSelect} value={stageValue} onChange={(e) => setStageValue(e.target.value as TaskBoardLaneId)}>
                    {payload.controls.stageOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <div className="caption">
                    {item.runtimeOverridesBoardStage
                      ? `Board stage is ${item.boardStageLabel ?? item.boardStage ?? "unknown"} — runtime drives visible stage.`
                      : "Changes orchestration staging only."}
                  </div>
                </div>
                <div>
                  <div className={styles.factLabel}>Orchestration owner</div>
                  <select className={styles.controlSelect} value={agentValue} onChange={(e) => setAgentValue(e.target.value)}>
                    {payload.controls.agentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <button type="button" className={styles.runtimeLink} onClick={applyControls} disabled={isSaving}>
                    {isSaving ? "Saving…" : "Save controls"}
                  </button>
                  {saveError ? <div className="caption" style={{ marginTop: 6, color: "#ff8c8c" }}>{saveError}</div> : null}
                </div>
              </div>
            ) : (
              <p className="caption">This item is runtime-owned. Board controls are read-only.</p>
            )}
            {item.planningNote ? (
              <p className={styles.bodyText}>{item.planningNote}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div className={styles.tabBody}>
          <div className={styles.activityStack}>
            <div>
              <div className="kicker">Operator actions</div>
              <h3 className={styles.sectionTitle}>Orchestration activity</h3>
            </div>
            {payload.activity.length ? (
              payload.activity.map((activityItem) => (
                <div key={activityItem.id} className={styles.activityItem}>
                  <div className={styles.activityTopline}>
                    <span className={styles.activityTitle}>{activityItem.title}</span>
                    <span className="caption">{relativeTime(activityItem.timestamp)}</span>
                  </div>
                  <div className="caption">{activityItem.detail}</div>
                </div>
              ))
            ) : (
              <p className="caption">No board-side activity yet.</p>
            )}

            <div className={styles.runtimeDivider}>
              <div className="kicker">Runtime signals</div>
              <h3 className={styles.sectionTitle}>Canonical ledger slice</h3>
            </div>

            {payload.runtimeActivity.length ? (
              payload.runtimeActivity.map((event) => (
                <div key={event.id} className={styles.activityItem}>
                  <div className={styles.activityTopline}>
                    <span className={styles.activityTitle}>{event.title}</span>
                    <span className="caption">{relativeTime(event.timestamp)}</span>
                  </div>
                  <div className="caption">{event.detail}</div>
                </div>
              ))
            ) : (
              <p className="caption">No runtime activity yet for this item.</p>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "deliverables" ? (
        <div className={styles.tabBody}>
          <div className={styles.deliverablesBlock}>
            <div>
              <div className="kicker">Deliverables</div>
              <h3 className={styles.sectionTitle}>Outputs and expected artifacts</h3>
            </div>
            <div className={styles.deliverablesGrid}>
              <div>
                <div className={styles.factLabel}>Recorded artifact</div>
                <div className={styles.factValue}>{item.artifactPath ?? "No artifact yet"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Deliverables note</div>
                <div className="caption">{item.deliverablesNote ?? "No deliverables note recorded yet."}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "sessions" ? (
        <div className={styles.tabBody}>
          <div className={styles.sessionGrid}>
            <div>
              <div className="kicker">Sessions</div>
              <h3 className={styles.sectionTitle}>Runtime linkage</h3>
            </div>
            <div className={styles.factGrid}>
              <div>
                <div className={styles.factLabel}>Runtime task</div>
                <div className={styles.factValue}>{item.runtimeTaskId ?? "No runtime task yet"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Worker session</div>
                <div className={styles.factValue}>{item.workerConversationId ?? "No worker session yet"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Worker actor</div>
                <div className={styles.factValue}>{item.workerAgentLabel ?? item.assignedActor?.label ?? "Ghost only"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Runtime status</div>
                <div className={styles.factValue}>{payload.runtimeSummary?.statusLabel ?? "Not started"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Runs</div>
                <div className={styles.factValue}>{String(payload.runtimeSummary?.runCount ?? 0)}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Events</div>
                <div className={styles.factValue}>{String(payload.runtimeSummary?.eventCount ?? 0)}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Last runtime signal</div>
                <div className={styles.factValue}>
                  {payload.runtimeSummary?.lastRuntimeAt ? relativeTime(payload.runtimeSummary.lastRuntimeAt) : "No runtime session yet"}
                </div>
              </div>
              <div>
                <div className={styles.factLabel}>Delegation started</div>
                <div className={styles.factValue}>{item.delegationStartedAt ? relativeTime(item.delegationStartedAt) : "Not started"}</div>
              </div>
              <div>
                <div className={styles.factLabel}>Delegation completed</div>
                <div className={styles.factValue}>{item.delegationCompletedAt ? relativeTime(item.delegationCompletedAt) : "Not completed"}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div className={cn("screen", "shell-page", styles.page, isDrawer && styles.pageDrawer)}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div>
          <div className="eyebrow">{isDrawer ? "Task Workspace" : "Task Board · Workspace"}</div>
          <h1 className={styles.title}>{item?.title ?? "Task not found"}</h1>
          <p className={styles.subtitle}>
            {isDrawer
              ? "Orchestration context, board metadata, and recent activity."
              : "Board-side orchestration workspace. Runtime ledger inspection remains in Task Overview."}
          </p>
        </div>

        <div className={styles.actions}>
          {/* Back / Close */}
          {isDrawer && onClose ? (
            <button type="button" className={styles.actionIcon} onClick={onClose} title="Close">
              <IconClose />
            </button>
          ) : (
            <a href="/task-board" className={styles.actionIcon} title="Back to Task Board">
              <IconBack />
            </a>
          )}
          {/* Open full workspace (only visible in drawer) */}
          {isDrawer && item ? (
            <a href={`/task-board/${item.id}`} className={styles.actionIcon} title="Open full workspace">
              <IconExpand />
            </a>
          ) : null}
          {/* Runtime link */}
          {item?.runtimeHref ? (
            <a href={item.runtimeHref} className={cn(styles.actionIcon, styles.actionIconBlue)} title="Open runtime drill-down">
              <IconExternal />
            </a>
          ) : (
            <span className={styles.noRuntime}>No runtime</span>
          )}
        </div>
      </div>

      {!item ? (
        <Card>
          <p className="caption">{payload.errors[0] ?? "This board task is not available."}</p>
        </Card>
      ) : (
        <>
          {/* ── Status pills ── */}
          <div className={styles.signalRow}>
            <StatusPill label={item.ownershipLabel} tone={item.ownershipMode === "board_owned" ? "success" : item.ownershipMode === "hybrid" ? "warning" : "neutral"} />
            <StatusPill label={item.kind === "orchestration_task" ? "Ghost-first" : "Runtime-backed"} tone="success" />
            <StatusPill label={item.stageLabel} tone="warning" />
            {item.boardStageLabel ? <StatusPill label={`Board · ${item.boardStageLabel}`} tone="neutral" /> : null}
            <StatusPill label={item.statusLabel} tone="neutral" />
            {item.priorityLabel ? <StatusPill label={`${item.priorityLabel} priority`} tone="warning" /> : null}
          </div>

          {/* ── Flat metric strip — no individual cards ── */}
          <div className={styles.metricStrip}>
            <WorkspaceMetric
              label="Ownership"
              value={item.ownershipLabel}
              detail={item.ownershipDetail}
            />
            <WorkspaceMetric
              label="Runtime Actor"
              value={item.sourceMode === "hybrid" || item.sourceMode === "live" ? item.assignedActor?.label ?? "Unassigned" : "Not linked"}
              detail={item.sourceMode === "hybrid" || item.sourceMode === "live" ? "Execution actor from runtime truth." : "No runtime actor linked yet."}
            />
            <WorkspaceMetric
              label="Board Owner"
              value={item.orchestrationOwner?.label ?? item.orchestratorLabel ?? "Ghost"}
              detail="Editable orchestration ownership."
            />
            <WorkspaceMetric
              label="Runtime"
              value={item.runtimeTaskId ? "Linked" : "Pending"}
              detail={item.runtimeTaskId ? "Canonical runtime task exists." : "Exists before runtime truth starts."}
            />
          </div>

          {/* ── Main layout: tabs + optional sidebar ── */}
          <div className={styles.layout}>

            {/* Tab area — plain div in drawer (popup already has glass-panel), Card in page mode */}
            <section className={styles.main}>
              {isDrawer ? (
                <div className={styles.tabsCard}>
                  <div className={styles.tabBar}>
                    {tabs.map((tab) => (
                      <button key={tab.id} type="button"
                        className={cn(styles.tabButton, activeTab === tab.id && styles.tabButtonActive)}
                        onClick={() => setActiveTab(tab.id)}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {tabContent}
                </div>
              ) : (
                <Card className={styles.tabsCard}>
                  <div className={styles.tabBar}>
                    {tabs.map((tab) => (
                      <button key={tab.id} type="button"
                        className={cn(styles.tabButton, activeTab === tab.id && styles.tabButtonActive)}
                        onClick={() => setActiveTab(tab.id)}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {tabContent}
                </Card>
              )}
            </section>

            {/* Sidebar — hidden in drawer via CSS, shown in page mode */}
            <aside className={styles.sidebar}>
              <Card className={styles.sideCard}>
                <div className="kicker">Layer boundary</div>
                <h3 className={styles.sectionTitle}>Runtime truth is canonical</h3>
                <p className="caption">
                  This workspace edits orchestration metadata only. Runtime tasks and delegation records are never mutated here.
                </p>
                {item.runtimeHref ? (
                  <a href={item.runtimeHref} className={styles.sideLink} style={{ marginTop: 10, display: "inline-flex" }}>
                    <IconExternal /> Open runtime record
                  </a>
                ) : (
                  <p className="caption">No runtime task produced yet.</p>
                )}
              </Card>
            </aside>

          </div>
        </>
      )}
    </div>
  );
}
