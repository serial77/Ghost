"use client";

const SESSION_ID_KEY = "ghost-operator-session-id";
const SESSION_STARTED_AT_KEY = "ghost-operator-session-started-at";

export interface ClientOperatorSession {
  operatorSessionId: string;
  operatorSessionStartedAt: string;
}

function createSession() {
  return {
    operatorSessionId: globalThis.crypto?.randomUUID?.() ?? `ghost-operator-${Date.now()}`,
    operatorSessionStartedAt: new Date().toISOString(),
  };
}

export function getOrCreateOperatorSession(): ClientOperatorSession {
  if (typeof window === "undefined") {
    return createSession();
  }

  const existingId = window.sessionStorage.getItem(SESSION_ID_KEY);
  const existingStartedAt = window.sessionStorage.getItem(SESSION_STARTED_AT_KEY);
  if (existingId && existingStartedAt) {
    return {
      operatorSessionId: existingId,
      operatorSessionStartedAt: existingStartedAt,
    };
  }

  const next = createSession();
  window.sessionStorage.setItem(SESSION_ID_KEY, next.operatorSessionId);
  window.sessionStorage.setItem(SESSION_STARTED_AT_KEY, next.operatorSessionStartedAt);
  return next;
}
