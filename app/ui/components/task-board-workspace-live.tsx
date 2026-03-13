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
  }).format(new Date(value));
}

function WorkspaceMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <div className={styles.metric}>
        <div className="metric-label">{label}</div>
        <div className={styles.metricValue}>{value}</div>
        <p className="caption">{detail}</p>
      </div>
    </Card>
  );
}

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

  useEffect(() => {
    setPayload(initialPayload);
  }, [initialPayload]);

  useEffect(() => {
    setStageValue(initialPayload.item?.boardStage ?? "assigned");
    setAgentValue(initialPayload.item?.orchestrationOwner?.id ?? "");
    setSaveError(null);
  }, [initialPayload]);

  async function applyControls() {
    if (!item || !payload.controls.editable) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/operations/task-board", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
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

      if (onMutated) {
        await onMutated();
      } else {
        window.location.reload();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Orchestration control update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={cn("screen", "shell-page", styles.page, isDrawer && styles.pageDrawer)}>
      <div className={styles.topBar}>
        <div>
          <div className="eyebrow">{isDrawer ? "Board Workspace" : "Task Board Workspace"}</div>
          <h1 className={styles.title}>{item?.title ?? "Task not found"}</h1>
          <p className={styles.subtitle}>
            {isDrawer
              ? "Inspect orchestration context, adjust board metadata, and review recent task activity without leaving the board."
              : "Board-side orchestration workspace. Runtime ledger inspection remains in Task Overview."}
          </p>
        </div>
        <div className={styles.actions}>
          {isDrawer && onClose ? (
            <button type="button" className={styles.backLink} onClick={onClose}>
              Close drawer
            </button>
          ) : (
            <a href="/task-board" className={styles.backLink}>
              Back to Task Board
            </a>
          )}
          {item ? (
            <a href={`/task-board/${item.id}`} className={styles.backLink}>
              Open full workspace
            </a>
          ) : null}
          {item?.runtimeHref ? (
            <a href={item.runtimeHref} className={styles.runtimeLink}>
              Open runtime drill-down
            </a>
          ) : (
            <StatusPill label="No runtime task yet" tone="warning" />
          )}
        </div>
      </div>

      {!item ? (
        <Card>
          <p className="caption">{payload.errors[0] ?? "This board task is not available."}</p>
        </Card>
      ) : (
        <>
          <div className={styles.signalRow}>
            <StatusPill label={item.ownershipLabel} tone={item.ownershipMode === "board_owned" ? "success" : item.ownershipMode === "hybrid" ? "warning" : "neutral"} />
            <StatusPill label={item.kind === "orchestration_task" ? "Ghost-first orchestration" : "Runtime-backed board item"} tone="success" />
            <StatusPill label={`Visible stage · ${item.stageLabel}`} tone="warning" />
            {item.boardStageLabel ? <StatusPill label={`Board stage · ${item.boardStageLabel}`} tone="neutral" /> : null}
            <StatusPill label={item.statusLabel} tone="neutral" />
            {item.priorityLabel ? <StatusPill label={`${item.priorityLabel} priority`} tone="warning" /> : null}
          </div>

          <div className={styles.metricStrip}>
            <WorkspaceMetric
              label="Ownership"
              value={item.ownershipLabel}
              detail={item.ownershipDetail}
            />
            <WorkspaceMetric
              label="Runtime Actor"
              value={item.sourceMode === "hybrid" || item.sourceMode === "live" ? item.assignedActor?.label ?? "Unassigned" : "Not linked"}
              detail={
                item.sourceMode === "hybrid" || item.sourceMode === "live"
                  ? "Visible execution actor from canonical runtime truth."
                  : "No runtime actor exists until Ghost creates linked runtime work."
              }
            />
            <WorkspaceMetric
              label="Board Owner"
              value={item.orchestrationOwner?.label ?? item.orchestratorLabel ?? "Ghost"}
              detail="Editable orchestration ownership for board-side task handling."
            />
            <WorkspaceMetric
              label="Runtime"
              value={item.runtimeTaskId ? "Linked" : "Pending"}
              detail={item.runtimeTaskId ? "A canonical runtime task exists for deeper audit." : "This workspace exists before runtime truth starts."}
            />
          </div>

          <div className={styles.layout}>
            <section className={styles.main}>
              <Card className={styles.tabsCard}>
                <div className={styles.tabBar}>
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn(styles.tabButton, activeTab === tab.id && styles.tabButtonActive)}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === "overview" ? (
                  <div className={styles.tabBody}>
                    <div className={styles.sectionGrid}>
                      <div>
                        <div className="kicker">Summary</div>
                        <h3 className={styles.sectionTitle}>Orchestration overview</h3>
                        <p className={styles.bodyText}>{item.summary}</p>
                        <p className={styles.bodyMuted}>{item.description || "No extended description is recorded yet."}</p>
                      </div>
                      <div className={styles.factGrid}>
                        <div>
                          <div className={styles.factLabel}>Ownership semantics</div>
                          <div className={styles.factValue}>{item.ownershipLabel}</div>
                          <div className="caption">{item.ownershipDetail}</div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Visible stage</div>
                          <div className={styles.factValue}>{item.stageLabel}</div>
                          <div className="caption">{item.stageReason}</div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Stored board stage</div>
                          <div className={styles.factValue}>{item.boardStageLabel ?? (item.boardStage ? item.boardStage.replace(/_/g, " ") : "None")}</div>
                          <div className="caption">
                            {item.runtimeOverridesBoardStage
                              ? "Runtime truth currently overrides the visible stage. The stored board stage remains orchestration-only."
                              : "The board stage currently matches the visible stage for this item."}
                          </div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Runtime actor</div>
                          <div className={styles.factValue}>{item.assignedActor?.label ?? "No runtime actor yet"}</div>
                          <div className="caption">
                            {item.sourceMode === "hybrid" || item.sourceMode === "live"
                              ? "Canonical execution actor."
                              : "Runtime assignment has not been created yet."}
                          </div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Orchestration owner</div>
                          <div className={styles.factValue}>{item.orchestrationOwner?.label ?? item.orchestratorLabel ?? "Ghost"}</div>
                          <div className="caption">Board-side owner for orchestration decisions and metadata changes.</div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Latest activity</div>
                          <div className={styles.factValue}>{item.latestActivityTitle ?? "No activity yet"}</div>
                          <div className="caption">{item.latestActivityDetail ?? "Ghost will add runtime evidence later if execution begins."}</div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Updated</div>
                          <div className={styles.factValue}>{relativeTime(item.latestActivityAt ?? item.updatedAt)}</div>
                          <div className="caption">{absoluteTime(item.updatedAt)}</div>
                        </div>
                        <div>
                          <div className={styles.factLabel}>Parent conversation</div>
                          <div className={styles.factValue}>{item.parentConversationId ?? "Not linked"}</div>
                          <div className="caption">Pinned-owner conversation flow remains unchanged.</div>
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
                            <select
                              className={styles.controlSelect}
                              value={stageValue}
                              onChange={(event) => setStageValue(event.target.value as TaskBoardLaneId)}
                            >
                              {payload.controls.stageOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <div className="caption">
                              {item.runtimeOverridesBoardStage
                                ? `Stored board stage is ${item.boardStageLabel ?? item.boardStage ?? "unknown"}, but linked runtime truth still drives the visible stage.`
                                : "This changes orchestration staging only."}
                            </div>
                          </div>
                          <div>
                            <div className={styles.factLabel}>Orchestration owner</div>
                            <select className={styles.controlSelect} value={agentValue} onChange={(event) => setAgentValue(event.target.value)}>
                              {payload.controls.agentOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <div className="caption">This updates orchestration ownership only. Worker runtime records remain untouched.</div>
                          </div>
                          <div>
                            <div className={styles.factLabel}>Apply controls</div>
                            <button type="button" className={styles.runtimeLink} onClick={applyControls} disabled={isSaving}>
                              {isSaving ? "Saving…" : "Save orchestration controls"}
                            </button>
                            <div className="caption">
                              PATCH requests are limited to orchestration board metadata. Runtime truth, worker runs, and delegation execution stay canonical and unchanged.
                            </div>
                            {saveError ? <div className="caption">{saveError}</div> : null}
                          </div>
                        </div>
                      ) : (
                        <p className="caption">This item is runtime-owned. Board controls are read-only here.</p>
                      )}
                      <p className={styles.bodyText}>
                        {item.planningNote ?? "No explicit planning note has been recorded yet. Ghost main orchestrator will still take first orchestration ownership."}
                      </p>
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
                              <strong>{activityItem.title}</strong>
                              <span className="caption">{relativeTime(activityItem.timestamp)}</span>
                            </div>
                            <div className="caption">{activityItem.detail}</div>
                          </div>
                        ))
                      ) : (
                        <p className="caption">No board-side activity is visible yet.</p>
                      )}

                      <div className={styles.runtimeDivider}>
                        <div className="kicker">Runtime signals</div>
                        <h3 className={styles.sectionTitle}>Canonical ledger slice</h3>
                      </div>

                      {payload.runtimeActivity.length ? (
                        payload.runtimeActivity.map((event) => (
                          <div key={event.id} className={styles.activityItem}>
                            <div className={styles.activityTopline}>
                              <strong>{event.title}</strong>
                              <span className="caption">{relativeTime(event.timestamp)}</span>
                            </div>
                            <div className="caption">{event.detail}</div>
                          </div>
                        ))
                      ) : (
                        <p className="caption">No runtime activity exists yet for this workspace item.</p>
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
                          <div className="caption">
                            {item.deliverablesNote ?? "No board-side deliverables note is recorded yet."}
                          </div>
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
              </Card>
            </section>

            <aside className={styles.sidebar}>
              <Card className={styles.sideCard}>
                <div className="kicker">Layer boundary</div>
                <h3 className={styles.sectionTitle}>Runtime truth remains canonical</h3>
                <p className="caption">
                  This workspace edits orchestration metadata only. Runtime tasks, worker execution, and delegation records are inspected here but never mutated from this drawer.
                </p>
                {item.runtimeHref ? (
                  <a href={item.runtimeHref} className={styles.sideLink}>
                    Open canonical runtime record
                  </a>
                ) : (
                  <p className="caption">Ghost has not yet produced a runtime task for this work item.</p>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
