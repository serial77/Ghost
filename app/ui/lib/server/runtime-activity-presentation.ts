import type { OperationalEventType, OperationalRunStatus } from "@/lib/operations";
import {
  normalizeExecutionTarget,
  normalizeModelName,
  normalizeProviderName,
  normalizeWorkflowName,
} from "@/lib/server/runtime-presentation-normalizer";

interface RuntimeActivityPresentationInput {
  eventType: string;
  toolName: string | null;
  status: OperationalRunStatus;
  payload: Record<string, unknown> | null;
}

interface RuntimeActivityPresentation {
  type: OperationalEventType;
  title: string;
  detail: string;
}

export const CANONICAL_EVENT_TITLES = {
  taskCreated: "Task created",
  dispatchStarted: "Runtime dispatch started",
  dispatchCompleted: "Runtime dispatch completed",
  dispatchFailed: "Runtime dispatch failed",
  replyRecorded: "Reply recorded",
  approvalRequired: "Approval required",
  artifactRecorded: "Artifact recorded",
  operatorReconciled: "Operator reconciled the task",
  runtimeCompleted: "Runtime completion recorded",
  runtimeFailed: "Runtime completion recorded as failed",
} as const;

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function payloadValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : null;
}

function objectValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toEventType(eventType: string): OperationalEventType {
  if (eventType === "approval_required") return "approval_required";
  if (eventType === "operator_reconciled") return "operator_reconciled";
  if (eventType.includes("artifact")) return "artifact_emitted";
  if (eventType.includes("started")) return "execution_started";
  if (eventType.includes("completed") || eventType.includes("recorded") || eventType.includes("finished")) return "execution_finished";
  return "assistant_reply";
}

function summaryOrDetail(payload: Record<string, unknown> | null | undefined) {
  return (
    payloadValue(payload, "summary") ||
    payloadValue(payload, "title") ||
    payloadValue(payload, "detail") ||
    payloadValue(payload, "note") ||
    payloadValue(payload, "artifact_path") ||
    payloadValue(payload, "target_webhook") ||
    payloadValue(payload, "error")
  );
}

function routeLabel(payload: Record<string, unknown> | null | undefined) {
  const provider = normalizeProviderName(payloadValue(payload, "provider_used"));
  const model = normalizeModelName(payloadValue(payload, "model_used"));
  if (provider && model) {
    return `${provider} · ${model}`;
  }

  return provider || model || null;
}

function dispatchDetail(payload: Record<string, unknown> | null | undefined) {
  const target = normalizeExecutionTarget(payloadValue(payload, "target_webhook"));
  const explicitDetail = payloadValue(payload, "detail");
  const entrypoint = explicitDetail?.match(/^Entrypoint:\s*(.+)$/i)?.[1]?.trim() || null;
  const route = routeLabel(payload);

  if (entrypoint && target) {
    return `${entrypoint} via ${target}`;
  }

  if (entrypoint && route) {
    return `${entrypoint} with ${route}`;
  }

  if (entrypoint) {
    return entrypoint;
  }

  if (target && route) {
    return `${target} with ${route}`;
  }

  if (target) {
    return target;
  }

  if (route) {
    return route;
  }

  return explicitDetail || "Runtime dispatch activity recorded.";
}

function replyDetail(payload: Record<string, unknown> | null | undefined) {
  const summary = payloadValue(payload, "summary");
  if (summary) {
    return summary;
  }

  const title = payloadValue(payload, "title");
  if (title) {
    return title;
  }

  return payloadValue(payload, "detail") || "Assistant reply recorded.";
}

function artifactDetail(payload: Record<string, unknown> | null | undefined) {
  const artifactPath = payloadValue(payload, "artifact_path");
  if (artifactPath) {
    return artifactPath;
  }

  return payloadValue(payload, "detail") || "Artifact output recorded.";
}

function approvalDetail(payload: Record<string, unknown> | null | undefined) {
  return payloadValue(payload, "detail") || "Approval is required before this work can continue.";
}

function operatorReconciledDetail(payload: Record<string, unknown> | null | undefined) {
  const note = payloadValue(payload, "note");
  if (note) {
    return note;
  }

  const detail = payloadValue(payload, "detail");
  if (detail) {
    return detail;
  }

  const terminalStatus = payloadValue(payload, "terminal_status");
  if (terminalStatus) {
    return `Operator marked this task as ${terminalStatus}. Runtime did not confirm the terminal state.`;
  }

  return "Operator reconciled this task after runtime left it unresolved.";
}

function fallbackTitle(eventType: string) {
  const text = eventType.replace(/_/g, " ").trim();
  if (!text) {
    return "Runtime activity recorded";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fallbackDetail(payload: Record<string, unknown> | null | undefined) {
  return summaryOrDetail(payload) || "No event detail recorded.";
}

export function formatRuntimeActivityPresentation(input: RuntimeActivityPresentationInput): RuntimeActivityPresentation {
  const type = toEventType(input.eventType);
  const payload = input.payload;

  if (type === "execution_started") {
    return {
      type,
      title: CANONICAL_EVENT_TITLES.dispatchStarted,
      detail: dispatchDetail(payload),
    };
  }

  if (type === "execution_finished") {
    if (input.eventType.includes("reply")) {
      return {
        type,
        title: CANONICAL_EVENT_TITLES.replyRecorded,
        detail: replyDetail(payload),
      };
    }

    if (input.eventType.includes("dispatch") || input.toolName === "ghost-runtime") {
      return {
        type,
        title: input.status === "failed" ? CANONICAL_EVENT_TITLES.dispatchFailed : CANONICAL_EVENT_TITLES.dispatchCompleted,
        detail: dispatchDetail(payload),
      };
    }

    return {
      type,
      title: input.status === "failed" ? CANONICAL_EVENT_TITLES.runtimeFailed : CANONICAL_EVENT_TITLES.runtimeCompleted,
      detail: fallbackDetail(payload),
    };
  }

  if (type === "approval_required") {
    return {
      type,
      title: CANONICAL_EVENT_TITLES.approvalRequired,
      detail: approvalDetail(payload),
    };
  }

  if (type === "artifact_emitted") {
    return {
      type,
      title: CANONICAL_EVENT_TITLES.artifactRecorded,
      detail: artifactDetail(payload),
    };
  }

  if (type === "operator_reconciled") {
    const identity = payloadValue(payload, "operator_identity") || payloadValue(payload, "reconciled_by");
    return {
      type,
      title: identity ? `Operator reconciled as ${identity}` : CANONICAL_EVENT_TITLES.operatorReconciled,
      detail: operatorReconciledDetail(payload),
    };
  }

  if (input.eventType === "task_created") {
    return {
      type,
      title: CANONICAL_EVENT_TITLES.taskCreated,
      detail: replyDetail(payload),
    };
  }

  const workflow = normalizeWorkflowName(payloadValue(payload, "workflow_name"));
  const route = routeLabel(payload);
  const target = normalizeExecutionTarget(payloadValue(payload, "target_webhook"));
  const fallbackBits = [workflow, route, target].filter(Boolean);

  return {
    type,
    title: fallbackTitle(input.eventType),
    detail: fallbackDetail(payload) || fallbackBits.join(" · ") || "No event detail recorded.",
  };
}
