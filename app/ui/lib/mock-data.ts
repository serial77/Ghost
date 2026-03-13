import type { AgentRecord, AnalyticStat, GhostTask, HealthMetric, NavItem } from "@/lib/types";

export const navItems: NavItem[] = [
  { href: "/", label: "Ghost Chat", shortLabel: "Chat" },
  { href: "/task-board", label: "Task Board", shortLabel: "Board" },
  { href: "/task-overview", label: "Task Overview", shortLabel: "Tasks" },
  { href: "/system-health", label: "System Health", shortLabel: "Health" },
  { href: "/agent-management", label: "Agent Management", shortLabel: "Agents" },
  { href: "/analytics", label: "Analytics", shortLabel: "Analytics" },
];

export const taskOverview: GhostTask[] = [
  { id: "G-501", title: "Operator UI foundation", phase: "Phase 5A", owner: "Ghost", progress: 72, status: "active" },
  { id: "G-488", title: "Memory retrieval enrichment planning", phase: "Phase 4B", owner: "Atlas", progress: 34, status: "watch" },
  { id: "G-477", title: "Codex worker audit trail shaping", phase: "Hardening", owner: "Relay", progress: 91, status: "stable" },
  { id: "G-463", title: "Workflow rollback drill", phase: "Operations", owner: "Ghost", progress: 18, status: "blocked" },
];

export const healthMetrics: HealthMetric[] = [
  { label: "CPU Load", value: "42%", detail: "Headroom remains stable across n8n worker spikes.", status: "success" },
  { label: "GPU Queue", value: "68%", detail: "Local inference saturation rising during batch summarization.", status: "warning" },
  { label: "RAM", value: "31.4 GB", detail: "Memory pressure is normal for the current model mix.", status: "success" },
  { label: "Thermals", value: "74C", detail: "Sustained but inside operating envelope.", status: "warning" },
];

export const agents: AgentRecord[] = [
  { id: "ghost-core", name: "Ghost Core", specialty: "routing / operator chat", state: "healthy", lastEvent: "Handled production cutover briefing 4m ago" },
  { id: "atlas", name: "Atlas", specialty: "infrastructure reasoning", state: "idle", lastEvent: "Awaiting task assignment" },
  { id: "relay", name: "Relay", specialty: "workflow mutation + deploy paths", state: "healthy", lastEvent: "Published backup artifact 19m ago" },
  { id: "ember", name: "Ember", specialty: "UI and visual systems", state: "draft", lastEvent: "Configuration pending SOUL.md tuning" },
];

export const analytics: AnalyticStat[] = [
  { label: "Total Sessions", value: "1,284", change: "+8.6%" },
  { label: "Token Spend", value: "$412", change: "-3.1%" },
  { label: "Codex Tasks", value: "302", change: "+12.4%" },
  { label: "Avg. Resolution", value: "6m 18s", change: "-11.7%" },
];
