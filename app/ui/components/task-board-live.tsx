"use client";

import { useEffect, useState } from "react";
import type {
  TaskBoardAgent,
  TaskBoardCard,
  TaskBoardFeedItem,
  TaskBoardLane,
  TaskBoardLaneId,
  TaskBoardPayload,
  TaskBoardWorkspaceControlOption,
  TaskBoardWorkspacePayload,
} from "@/lib/operations";
import { Card, StatusPill } from "@/components/ui";
import { TaskBoardWorkspaceLive } from "@/components/task-board-workspace-live";
import { cn } from "@/lib/utils";
import styles from "./task-board-live.module.css";

const pollingIntervalMs = 15_000;

function relativeTime(value?: string | null) {
  if (!value) return "–";
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.abs(seconds) < 60 ? Math.round(seconds) : Math.round(seconds / 60),
    Math.abs(seconds) < 60 ? "second" : "minute",
  );
}

function cardTone(card: TaskBoardCard): "success" | "warning" | "danger" | "neutral" {
  if (card.completionSource === "operator_reconciled" || card.status === "failed") return "danger";
  if (card.approvalRequired || card.staleCandidate || card.status === "blocked" || card.status === "attention") return "warning";
  if (card.status === "succeeded") return "success";
  return "neutral";
}

function agentTone(agent: TaskBoardAgent): "success" | "warning" | "neutral" {
  if (agent.status === "working") return "success";
  if (agent.status === "standby") return "neutral";
  return "warning";
}

function ownershipTone(card: TaskBoardCard): "success" | "warning" | "neutral" {
  if (card.ownershipMode === "board_owned") return "success";
  if (card.ownershipMode === "hybrid") return "warning";
  return "neutral";
}

function laneClass(lane: TaskBoardLane) {
  if (lane.id === "planning") return styles.lanePlanning;
  if (lane.id === "inbox") return styles.laneInbox;
  if (lane.id === "assigned") return styles.laneAssigned;
  if (lane.id === "in_progress") return styles.laneProgress;
  if (lane.id === "testing") return styles.laneTesting;
  if (lane.id === "review") return styles.laneReview;
  return styles.laneDone;
}


function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "neutral" }) {
  const cls = {
    success: styles.statusDotSuccess,
    warning: styles.statusDotWarning,
    danger: styles.statusDotDanger,
    neutral: styles.statusDotNeutral,
  }[tone];
  return <span className={cn(styles.statusDot, cls)} aria-hidden="true" />;
}

function shouldIgnoreCardOpen(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("a, button, select, option, input, textarea, label"));
}

// ── Feed section ──────────────────────────────────────────────────────────────

function FeedSection({ title, items }: { title: string; items: TaskBoardFeedItem[] }) {
  return (
    <section className={styles.feedSection}>
      <div className={styles.feedSectionTitle}>{title}</div>
      <div className={styles.feedList}>
        {items.length
          ? items.map((item) => <FeedItem key={item.id} item={item} />)
          : <div className={styles.emptyPanel}>No items.</div>}
      </div>
    </section>
  );
}

// ── Inline control panel ──────────────────────────────────────────────────────

function InlineControlPanel({
  card,
  stageOptions,
  agentOptions,
  onApply,
}: {
  card: TaskBoardCard;
  stageOptions: TaskBoardWorkspaceControlOption[];
  agentOptions: TaskBoardWorkspaceControlOption[];
  onApply: (input: { card: TaskBoardCard; stage: TaskBoardLaneId; orchestratorAgentId: string }) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [stageValue, setStageValue] = useState<TaskBoardLaneId>(card.boardStage ?? "assigned");
  const [agentValue, setAgentValue] = useState(card.orchestrationOwner?.id ?? card.assignedActor?.id ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStageValue(card.boardStage ?? "assigned");
    setAgentValue(card.orchestrationOwner?.id ?? card.assignedActor?.id ?? "");
  }, [card.boardStage, card.orchestrationOwner?.id, card.assignedActor?.id]);

  async function handleApply() {
    setIsSaving(true);
    setError(null);
    try {
      await onApply({ card, stage: stageValue, orchestratorAgentId: agentValue });
      setIsOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Board update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  if (card.sourceMode === "live") return null;

  return (
    <div className={styles.inlineControls} onClick={(event) => event.stopPropagation()}>
      <button type="button" className={styles.inlineToggle} onClick={() => setIsOpen((v) => !v)}>
        {isOpen ? "Hide controls" : "Adjust orchestration"}
      </button>
      <div className="caption">
        {card.sourceMode === "hybrid"
          ? `Runtime owns the visible stage. Stored board stage is ${card.boardStageLabel ?? card.boardStage ?? "unrecorded"}.`
          : "These controls update board-stage and orchestration ownership only."}
      </div>

      {isOpen ? (
        <div className={styles.inlinePanel}>
          <label className={styles.inlineField}>
            <span className={styles.inlineLabel}>Board stage</span>
            <select className={styles.inlineSelect} value={stageValue} onChange={(e) => setStageValue(e.target.value as TaskBoardLaneId)}>
              {stageOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className={styles.inlineField}>
            <span className={styles.inlineLabel}>Owner</span>
            <select className={styles.inlineSelect} value={agentValue} onChange={(e) => setAgentValue(e.target.value)}>
              {agentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" className={styles.inlineApply} onClick={handleApply} disabled={isSaving}>
            {isSaving ? "Saving…" : "Apply"}
          </button>
          {error ? <div className={styles.inlineError}>{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Metric tile ───────────────────────────────────────────────────────────────

function MetricTile({ label, value, detail, tone = "neutral" }: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={styles.metricTile}>
      <div className={styles.metricHeader}>
        <StatusDot tone={tone} />
        <span className={styles.metricLabel}>{label}</span>
      </div>
      <div className={styles.metricValue}>{value}</div>
      <p className="caption">{detail}</p>
    </div>
  );
}

// ── Agent rail item ───────────────────────────────────────────────────────────

function AgentRailItem({ agent }: { agent: TaskBoardAgent }) {
  const initials = agent.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const tone = agentTone(agent);

  return (
    <div className={styles.agentItem}>
      <div className={styles.agentBadge}>{initials || "G"}</div>
      <div className={styles.agentBody}>
        <div className={styles.agentTopline}>
          <strong className={styles.agentName}>{agent.label}</strong>
          <StatusDot tone={tone} />
        </div>
        <div className={styles.agentStatus}>{agent.status}</div>
        <div className={styles.agentTask}>{agent.currentTaskTitle ?? "No active task"}</div>
      </div>
    </div>
  );
}

// ── Mission card ──────────────────────────────────────────────────────────────

function MissionCard({
  card,
  stageOptions,
  agentOptions,
  onApply,
  onOpen,
}: {
  card: TaskBoardCard;
  stageOptions: TaskBoardWorkspaceControlOption[];
  agentOptions: TaskBoardWorkspaceControlOption[];
  onApply: (input: { card: TaskBoardCard; stage: TaskBoardLaneId; orchestratorAgentId: string }) => Promise<void>;
  onOpen: (card: TaskBoardCard) => void;
}) {
  const tone = cardTone(card);
  const owner = card.orchestrationOwner?.label ?? card.assignedActor?.label ?? "Ghost";
  const ownerTone = ownershipTone(card);
  const cardToneClass: Record<ReturnType<typeof cardTone>, string> = {
    success: styles.cardToneSuccess,
    warning: styles.cardToneWarning,
    danger: styles.cardToneDanger,
    neutral: styles.cardToneNeutral,
  };

  return (
    <article
      className={cn(styles.card, cardToneClass[tone])}
      role="button"
      tabIndex={0}
      onClick={(event) => { if (!shouldIgnoreCardOpen(event.target)) onOpen(card); }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !shouldIgnoreCardOpen(event.target)) {
          event.preventDefault();
          onOpen(card);
        }
      }}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderInner}>
          <StatusDot tone={tone} />
          <h3 className={styles.cardTitle}>{card.title}</h3>
        </div>
        {card.priorityLabel ? <span className={styles.cardPriority}>{card.priorityLabel}</span> : null}
      </div>

      <p className={styles.cardSummary}>{card.summary}</p>

      <div className={styles.cardMeta}>
        <StatusDot tone={ownerTone} />
        <span>{owner}</span>
        {card.latestActivityTitle ? (
          <span className={styles.cardMetaDim}>· {card.latestActivityTitle}</span>
        ) : null}
      </div>

      <div className={styles.cardFooter} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.cardLinkButton} onClick={() => onOpen(card)}>
          Open
        </button>
        <div className={styles.cardLinks}>
          <a href={card.detailHref} className={styles.cardLink}>Deep link</a>
          {card.runtimeHref ? (
            <a href={card.runtimeHref} className={styles.cardLinkMuted}>Runtime</a>
          ) : null}
        </div>
      </div>

      <InlineControlPanel card={card} stageOptions={stageOptions} agentOptions={agentOptions} onApply={onApply} />
    </article>
  );
}

// ── Feed item ─────────────────────────────────────────────────────────────────

function FeedItem({ item }: { item: TaskBoardFeedItem }) {
  const tone = (item.tone ?? "neutral") as "success" | "warning" | "danger" | "neutral";
  const feedToneClass: Record<typeof tone, string> = {
    success: styles.feedItemSuccess,
    warning: styles.feedItemWarning,
    danger:  styles.feedItemDanger,
    neutral: styles.feedItemNeutral,
  };
  return (
    <div className={cn(styles.feedItem, feedToneClass[tone])}>
      <StatusDot tone={tone} />
      <span className={styles.feedTitle}>{item.title}</span>
      {item.href ? <a href={item.href} className={styles.feedLink}>↗</a> : null}
      <time className={styles.feedTime}>{relativeTime(item.timestamp)}</time>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaskBoardLive({ initialPayload }: { initialPayload: TaskBoardPayload }) {
  const [payload, setPayload] = useState<TaskBoardPayload>(initialPayload);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priorityLabel, setPriorityLabel] = useState("normal");
  const [suggestedRoute, setSuggestedRoute] = useState("");
  const [suggestedModel, setSuggestedModel] = useState("");
  const [planningNote, setPlanningNote] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [drawerPayload, setDrawerPayload] = useState<TaskBoardWorkspacePayload | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  async function load(options?: { keepDrawer?: boolean }) {
    setIsLoading(true);
    try {
      const response = await fetch("/api/operations/task-board", { cache: "no-store" });
      const nextPayload = (await response.json()) as TaskBoardPayload;
      setPayload(nextPayload);
      if ((options?.keepDrawer ?? true) && selectedItemId) {
        await loadWorkspace(selectedItemId);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadWorkspace(itemId: string) {
    setSelectedItemId(itemId);
    setDrawerLoading(true);
    setDrawerError(null);
    try {
      const response = await fetch(`/api/operations/task-board/${itemId}`, { cache: "no-store" });
      const nextPayload = (await response.json()) as TaskBoardWorkspacePayload;
      if (!response.ok || nextPayload.item === null) {
        throw new Error(nextPayload.errors[0] || "Board workspace load failed.");
      }
      setDrawerPayload(nextPayload);
    } catch (error) {
      setDrawerPayload(null);
      setDrawerError(error instanceof Error ? error.message : "Board workspace load failed.");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function applyInlineControls(input: { card: TaskBoardCard; stage: TaskBoardLaneId; orchestratorAgentId: string }) {
    const response = await fetch("/api/operations/task-board", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orchestrationTaskId: input.card.id.replace(/^orch_/, ""),
        stage: input.stage,
        orchestratorAgentId: input.orchestratorAgentId || null,
        actorId: "ghost-operator-ui",
      }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || "Board update failed.");
    }
    await load({ keepDrawer: true });
  }

  async function createTask() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/operations/task-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, priorityLabel, suggestedRoute, suggestedModel, planningNote }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; workspaceHref?: string };
      if (!response.ok || result.ok === false || !result.workspaceHref) {
        throw new Error(result.error || "Task creation failed.");
      }
      const itemId = result.workspaceHref.split("/").at(-1);
      setIsCreateOpen(false);
      setTitle(""); setDescription(""); setPriorityLabel("normal");
      setSuggestedRoute(""); setSuggestedModel(""); setPlanningNote("");
      await load({ keepDrawer: false });
      if (itemId) await loadWorkspace(itemId);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Task creation failed.");
    } finally {
      setIsCreating(false);
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => { void load({ keepDrawer: true }); }, pollingIntervalMs);
    return () => window.clearInterval(interval);
  }, [selectedItemId]);

  const operatorFeed = payload.feed.filter((item) => item.group === "operator_actions");
  const runtimeFeed = payload.feed.filter((item) => item.group === "runtime_signals");

  return (
    <div className={cn("screen", "shell-page", styles.page)}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topBarTitle}>
          <h1 className={styles.title}>Mission Control</h1>
        </div>
        <div className={styles.topBarSignals}>
          <div className={styles.boardStatus}>
            <StatusDot tone={isLoading ? "warning" : "success"} />
            <span className={styles.boardStatusLabel}>
              {isLoading ? "Refreshing" : `${payload.summary.totalCards} cards`}
            </span>
          </div>
          <button type="button" className={styles.newTaskButton} onClick={() => setIsCreateOpen(true)}>
            + New task
          </button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className={styles.summaryStrip}>
        <MetricTile label="Active Agents" value={payload.summary.activeAgents} detail="Currently carrying active work." tone="success" />
        <MetricTile label="Queue" value={payload.summary.tasksInQueue} detail="Planning, inbox, and assigned." tone="neutral" />
        <MetricTile label="In Flight" value={payload.summary.tasksInProgress} detail="Execution and testing posture." tone="warning" />
        <MetricTile label="Review" value={payload.summary.reviewNeeded} detail="Approval or handoff needed." tone="warning" />
        <MetricTile label="Resolved" value={payload.summary.resolved} detail="Terminal tasks confirmed." tone="success" />
      </div>

      {/* ── Three-column layout ── */}
      <div className={cn(styles.layout, selectedItemId && styles.layoutWithDrawer)}>

        {/* Agent rail */}
        <aside className={styles.agentRail}>
          <div className={cn("glass-panel", styles.sidePanel)}>
            <div className={styles.panelHeader}>
              <div className="kicker">Agents</div>
              <span className={styles.panelCount}>{payload.agents.length}</span>
            </div>
            <div className={styles.agentList}>
              {payload.agents.length ? (
                payload.agents.map((agent) => <AgentRailItem key={`${agent.id}:${agent.sourceMode}`} agent={agent} />)
              ) : (
                <div className={styles.emptyPanel}>No agents visible.</div>
              )}
            </div>
          </div>
        </aside>

        {/* Queue section */}
        <section className={styles.queueSection}>
          <div className={styles.queueShell}>
            <div className={styles.laneScroller}>
              {payload.lanes.map((lane) => (
                <section
                  key={lane.id}
                  className={cn(styles.lane, laneClass(lane))}
                >
                  <header className={styles.laneHeader}>
                    <div>
                      <h4 className={styles.laneTitle}>{lane.title}</h4>
                      <p className={styles.laneDescription}>{lane.description}</p>
                    </div>
                    <div className={styles.laneCount}>{lane.count}</div>
                  </header>

                  {lane.cards.length ? (
                    <div className={styles.cardList}>
                      {lane.cards.map((card) => (
                        <MissionCard
                          key={card.id}
                          card={card}
                          stageOptions={payload.controls.stageOptions}
                          agentOptions={payload.controls.agentOptions}
                          onApply={applyInlineControls}
                          onOpen={() => void loadWorkspace(card.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className={styles.laneEmpty}>
                      <div>
                        <strong>No cards</strong>
                        <p className="caption" style={{ marginTop: 8 }}>
                          Ghost will place tasks here as orchestration posture evolves.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        </section>

        {/* Feed rail */}
        <aside className={styles.feedRail}>
          <div className={cn("glass-panel", styles.sidePanel)}>
            <div className={styles.panelHeader}>
              <div className="kicker">Live Feed</div>
              <span className={styles.panelCount}>{payload.feed.length}</span>
            </div>
            <div className={styles.feedGrouped}>
              <FeedSection title="Operator actions" items={operatorFeed} />
              <FeedSection title="Runtime signals" items={runtimeFeed} />
            </div>
          </div>
        </aside>

        {/* Drawer rail */}
        {selectedItemId ? (
          <aside className={styles.drawerRail}>
            <Card className={styles.drawerShell}>
              {drawerLoading ? <div className={styles.drawerState}>Loading board workspace…</div> : null}
              {!drawerLoading && drawerError ? <div className={styles.drawerState}>{drawerError}</div> : null}
              {!drawerLoading && !drawerError && drawerPayload ? (
                <TaskBoardWorkspaceLive
                  initialPayload={drawerPayload}
                  mode="drawer"
                  onClose={() => {
                    setSelectedItemId(null);
                    setDrawerPayload(null);
                    setDrawerError(null);
                  }}
                  onMutated={async () => {
                    if (!selectedItemId) return;
                    await load({ keepDrawer: false });
                    await loadWorkspace(selectedItemId);
                  }}
                />
              ) : null}
            </Card>
          </aside>
        ) : null}
      </div>

      {/* ── Create task modal ── */}
      {isCreateOpen ? (
        <div className={styles.createOverlay}>
          <div className={styles.createBackdrop} onClick={() => setIsCreateOpen(false)} />
          <Card className={styles.createPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className="kicker">New board task</div>
                <h3>Create orchestration work</h3>
              </div>
              <StatusPill label="Ghost-first" tone="warning" />
            </div>

            <div className={styles.formGrid}>
              <label className={styles.formField}>
                <span className={styles.formLabel}>Title</span>
                <input className={styles.formInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Audit deployment rollback notes" />
              </label>
              <label className={styles.formField}>
                <span className={styles.formLabel}>Priority</span>
                <select className={styles.formInput} value={priorityLabel} onChange={(e) => setPriorityLabel(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className={cn(styles.formField, styles.formFieldFull)}>
                <span className={styles.formLabel}>Description</span>
                <textarea className={styles.formTextarea} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the work Ghost should shape and route." />
              </label>
              <label className={styles.formField}>
                <span className={styles.formLabel}>Suggested route</span>
                <input className={styles.formInput} value={suggestedRoute} onChange={(e) => setSuggestedRoute(e.target.value)} placeholder="codex" />
              </label>
              <label className={styles.formField}>
                <span className={styles.formLabel}>Suggested model</span>
                <input className={styles.formInput} value={suggestedModel} onChange={(e) => setSuggestedModel(e.target.value)} placeholder="gpt-5-codex" />
              </label>
              <label className={cn(styles.formField, styles.formFieldFull)}>
                <span className={styles.formLabel}>Planning note</span>
                <textarea className={styles.formTextarea} value={planningNote} onChange={(e) => setPlanningNote(e.target.value)} placeholder="Optional intent, guardrails, or context for Ghost." />
              </label>
            </div>

            {createError ? <div className={styles.formError}>{createError}</div> : null}

            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setIsCreateOpen(false)}>Cancel</button>
              <button type="button" className={styles.primaryButton} onClick={() => void createTask()} disabled={isCreating}>
                {isCreating ? "Creating…" : "Create task"}
              </button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
