interface RuntimeEventShape {
  eventType: string;
  payload: Record<string, unknown> | null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function boolValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function compactSpaces(value: string | null | undefined) {
  return value ? value.trim().replace(/\s+/g, " ") : null;
}

function normalizedEventType(value: string | null | undefined) {
  const raw = compactSpaces(value);
  return raw ? raw.toLowerCase() : null;
}

export function normalizeExecutionTarget(value: string | null | undefined) {
  const raw = compactSpaces(value);
  if (!raw) {
    return null;
  }

  const normalized = raw
    .replace(/^https?:\/\/[^/]+\/?/i, "")
    .replace(/^\/+/, "")
    .replace(/^webhook\//i, "");

  return normalized || raw;
}

export function normalizeWorkflowName(value: string | null | undefined) {
  return compactSpaces(value);
}

export function normalizeProviderName(value: string | null | undefined) {
  const raw = compactSpaces(value);
  if (!raw) {
    return null;
  }

  const key = raw.toLowerCase();
  if (key === "openai_api" || key === "openai") {
    return "OpenAI API";
  }

  if (key === "ollama") {
    return "Ollama";
  }

  if (key === "codex_oauth_worker" || key === "codex") {
    return "Codex Worker";
  }

  return raw;
}

export function normalizeModelName(value: string | null | undefined) {
  return compactSpaces(value);
}

export function deriveApprovalRequired(
  outputPayload: Record<string, unknown> | null | undefined,
  runEvents: RuntimeEventShape[],
) {
  const payloadFlag = boolValue(outputPayload?.approval_required);
  if (payloadFlag === true) {
    return true;
  }

  return runEvents.some((event) => normalizedEventType(event.eventType) === "approval_required");
}

export function deriveArtifactPath(
  outputPayload: Record<string, unknown> | null | undefined,
  runEvents: RuntimeEventShape[],
) {
  const payloadPath = stringValue(outputPayload?.artifact_path);
  if (payloadPath) {
    return payloadPath;
  }

  for (const event of runEvents) {
    const eventType = normalizedEventType(event.eventType);
    if (!eventType || !eventType.includes("artifact")) {
      continue;
    }

    const explicitPath = stringValue(event.payload?.artifact_path);
    if (explicitPath) {
      return explicitPath;
    }

    const detailPath = stringValue(event.payload?.detail);
    if (detailPath && detailPath.includes("/")) {
      return detailPath;
    }
  }

  return null;
}
