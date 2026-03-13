export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  meta?: string;
}

export interface ChatReply {
  conversationId: string;
  reply: string;
  providerUsed?: string;
  modelUsed?: string;
  taskClass?: string;
  approvalRequired?: boolean;
}

export interface NavItem {
  href: "/" | "/task-board" | "/task-overview" | "/system-health" | "/agent-management" | "/analytics";
  label: string;
  shortLabel: string;
}

export interface GhostTask {
  id: string;
  title: string;
  phase: string;
  owner: string;
  progress: number;
  status: "stable" | "active" | "watch" | "blocked";
}

export interface HealthMetric {
  label: string;
  value: string;
  detail: string;
  status: "success" | "warning" | "danger";
}

export interface AgentRecord {
  id: string;
  name: string;
  specialty: string;
  state: string;
  lastEvent: string;
}

export interface AnalyticStat {
  label: string;
  value: string;
  change: string;
}
