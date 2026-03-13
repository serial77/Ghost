import { Card, SectionHeader, StatusPill } from "@/components/ui";
import { formatNumber } from "@/lib/utils";

export function TaskOverviewPage() {
  const tasks = [
    { id: "G-501", title: "Operator UI foundation", owner: "Ghost", progress: 72, status: "active", stream: "UI / Shell" },
    { id: "G-493", title: "Memory retrieval enrichment plan", owner: "Atlas", progress: 34, status: "watch", stream: "Knowledge" },
    { id: "G-488", title: "Codex audit surface", owner: "Relay", progress: 91, status: "stable", stream: "Operations" },
    { id: "G-470", title: "Agent config editing model", owner: "Ember", progress: 18, status: "blocked", stream: "Agent Ops" },
  ] as const;

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Task Overview"
        title="Mission control for what Ghost and its agents are doing now."
        copy="This scaffold is biased toward live operational awareness rather than a static project board. It is ready to absorb deeper task telemetry, workflow execution traces, and agent-level progression signals."
      />
      <div className="task-layout">
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Active Streams</div>
              <h3>Operator task field</h3>
            </div>
            <StatusPill label="4 tracked threads" tone="success" />
          </div>
          <div className="list" style={{ marginTop: 18 }}>
            {tasks.map((task) => (
              <div key={task.id} className="list-row">
                <div>
                  <div className="kicker">{task.id}</div>
                  <h4 style={{ marginTop: 6 }}>{task.title}</h4>
                  <p className="caption" style={{ marginTop: 8 }}>
                    {task.stream} · {task.owner}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="metric-value" style={{ fontSize: "1.8rem" }}>
                    {task.progress}%
                  </div>
                  <div className="caption">{task.status}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="list">
          <Card>
            <div className="metric">
              <div className="metric-label">Tasks in motion</div>
              <div className="metric-value">{formatNumber(17)}</div>
              <p className="caption">Across chat, workflow, and delegated agent threads.</p>
            </div>
          </Card>
          <Card>
            <div className="metric">
              <div className="metric-label">Autonomous progress</div>
              <div className="metric-value">61%</div>
              <p className="caption">Share of currently open work advancing without operator interruption.</p>
            </div>
          </Card>
          <Card>
            <div className="metric">
              <div className="metric-label">Next integration seam</div>
              <div className="metric-value" style={{ fontSize: "1.4rem", lineHeight: 1.2 }}>
                Execution graph + agent event feed
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function SystemHealthPage() {
  const metrics = [
    ["CPU", "42%", "success"],
    ["GPU", "68%", "warning"],
    ["RAM", "31.4 GB", "success"],
    ["Disk", "74%", "warning"],
  ] as const;

  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="System Health"
        title="Operational status with room for real telemetry, not decorative chrome."
        copy="The current scaffold separates summary health, trend panels, and service health blocks so future Grafana-fed widgets or internal metric adapters can slot in without changing the page model."
      />
      <div className="status-cluster">
        {metrics.map(([label, value, tone]) => (
          <Card key={label}>
            <div className="metric">
              <div className="metric-label">{label}</div>
              <div className="metric-value" style={{ fontSize: "2.2rem" }}>
                {value}
              </div>
              <StatusPill label={tone === "success" ? "Nominal" : "Watch"} tone={tone} />
            </div>
          </Card>
        ))}
      </div>
      <div className="metric-grid">
        <Card className="span-7">
          <div className="panel-header">
            <div>
              <div className="kicker">Resource Trends</div>
              <h3>Compute load envelope</h3>
            </div>
            <StatusPill label="Grafana-ready slot" />
          </div>
          <div className="mini-chart" style={{ marginTop: 18 }} />
        </Card>
        <Card className="span-5">
          <div className="panel-header">
            <div>
              <div className="kicker">Critical Services</div>
              <h3>Backend block status</h3>
            </div>
            <StatusPill label="4 monitored nodes" tone="success" />
          </div>
          <div className="list" style={{ marginTop: 18 }}>
            {[
              ["ghost-n8n-main", "healthy"],
              ["ghost-n8n-worker", "healthy"],
              ["ghost-postgres", "healthy"],
              ["ghost-redis", "healthy"],
            ].map(([service, state]) => (
              <div key={service} className="list-row">
                <div>
                  <h4>{service}</h4>
                  <p className="caption" style={{ marginTop: 6 }}>
                    Container and dependency heartbeat
                  </p>
                </div>
                <StatusPill label={state} tone="success" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AgentManagementPage() {
  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Agent Management"
        title="A future control room for editing agents, their identities, and debug sessions."
        copy="This layout is intentionally tri-pane: roster, configuration, and direct debug chat. That structure supports later SOUL.md editing, runtime toggles, validation, and per-agent troubleshooting without redesigning the page."
      />
      <div className="agent-layout">
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Roster</div>
              <h3>Registered agents</h3>
            </div>
            <StatusPill label="4 profiles" />
          </div>
          <div className="list" style={{ marginTop: 18 }}>
            {["Ghost Core", "Atlas", "Relay", "Ember"].map((agent, index) => (
              <div key={agent} className="list-row">
                <div>
                  <h4>{agent}</h4>
                  <p className="caption" style={{ marginTop: 6 }}>
                    {index === 0 ? "Default operator intelligence" : "Specialized worker profile"}
                  </p>
                </div>
                <StatusPill label={index === 3 ? "draft" : "healthy"} tone={index === 3 ? "warning" : "success"} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Configuration</div>
              <h3>Identity and runtime editors</h3>
            </div>
            <StatusPill label="Scaffolded" />
          </div>
          <div className="split-grid" style={{ marginTop: 18 }}>
            {["SOUL.md", "STYLE.md", "RULES.md", "ROUTING.md"].map((file) => (
              <div key={file} className="list-row">
                <div>
                  <div className="kicker">{file}</div>
                  <p className="caption" style={{ marginTop: 8 }}>
                    Structured editor target with diff preview and validation hooks.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="panel-header">
            <div>
              <div className="kicker">Debug Session</div>
              <h3>Per-agent chat trace</h3>
            </div>
            <StatusPill label="Future live bind" tone="warning" />
          </div>
          <div className="message-list" style={{ marginTop: 18, minHeight: 360 }}>
            <article className="message assistant">
              Agent status summary prepared. Waiting for direct debug prompt.
              <div className="message-meta">atlas · simulated</div>
            </article>
            <article className="message user">
              Show current routing assumptions and pending edits.
              <div className="message-meta">operator</div>
            </article>
            <article className="message assistant">
              Routing is pinned to the phase baseline. Pending edits include stronger approval semantics and richer analytics hooks.
              <div className="message-meta">atlas · simulated</div>
            </article>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  return (
    <div className="screen shell-page">
      <SectionHeader
        eyebrow="Analytics"
        title="Usage and cost surfaces prepared for real provider and internal metrics."
        copy="This scaffold leaves clear seams for provider adapters, internal event aggregation, and budget controls. The UI already distinguishes summary KPIs, trend areas, and source-attributed detail."
      />
      <div className="analytics-grid">
        {[
          ["Sessions", "1,284", "+8.6%"],
          ["Token Spend", "$412", "-3.1%"],
          ["Agent Tasks", "302", "+12.4%"],
          ["Avg. Resolution", "6m 18s", "-11.7%"],
        ].map(([label, value, change]) => (
          <Card key={label} className="span-3">
            <div className="metric">
              <div className="metric-label">{label}</div>
              <div className="metric-value" style={{ fontSize: "2.1rem" }}>
                {value}
              </div>
              <p className="caption">{change} vs prior window</p>
            </div>
          </Card>
        ))}
        <Card className="span-8">
          <div className="panel-header">
            <div>
              <div className="kicker">Spend Trend</div>
              <h3>Provider and internal usage contour</h3>
            </div>
            <StatusPill label="Adapter-ready" />
          </div>
          <div className="mini-chart" style={{ marginTop: 18, height: 220 }} />
        </Card>
        <Card className="span-4">
          <div className="panel-header">
            <div>
              <div className="kicker">Distribution</div>
              <h3>Agent load share</h3>
            </div>
          </div>
          <div className="list" style={{ marginTop: 18 }}>
            {[
              ["Ghost Core", "46%"],
              ["Relay", "24%"],
              ["Atlas", "18%"],
              ["Ember", "12%"],
            ].map(([name, value]) => (
              <div key={name} className="list-row">
                <h4>{name}</h4>
                <div className="caption">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
