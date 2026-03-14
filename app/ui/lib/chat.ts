import type { ChatReply } from "@/lib/types";

const defaultBackendUrl = "http://127.0.0.1:5678/webhook/ghost-runtime";

interface ChatRequestInput {
  conversationId?: string;
  message: string;
}

function getApiUrl() {
  return process.env.NEXT_PUBLIC_GHOST_ENABLE_CHAT_MOCKS === "true" ? "/api/chat?mock=1" : "/api/chat";
}

export async function sendGhostMessage(input: ChatRequestInput): Promise<ChatReply> {
  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_id: input.conversationId,
      message: input.message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ghost chat failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    conversation_id?: string;
    reply?: string;
    provider_used?: string;
    model_used?: string;
    task_class?: string;
    approval_required?: boolean;
  };

  return {
    conversationId: payload.conversation_id ?? crypto.randomUUID(),
    reply: payload.reply ?? "Ghost returned an empty reply.",
    providerUsed: payload.provider_used,
    modelUsed: payload.model_used,
    taskClass: payload.task_class,
    approvalRequired: payload.approval_required,
  };
}

export function getGhostBackendUrl() {
  return process.env.GHOST_BACKEND_URL || process.env.NEXT_PUBLIC_GHOST_BACKEND_URL || defaultBackendUrl;
}
