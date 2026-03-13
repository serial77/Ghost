import { NextRequest, NextResponse } from "next/server";
import { getGhostBackendUrl } from "@/lib/chat";

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const useMock = searchParams.get("mock") === "1" || process.env.GHOST_ENABLE_CHAT_MOCKS === "true";

  const payload = await request.json();

  if (useMock) {
    return NextResponse.json({
      conversation_id: payload.conversation_id || crypto.randomUUID(),
      reply: `Mock Ghost reply: ${payload.message}`,
      provider_used: "mock",
      model_used: "ghost-ui-mock",
      task_class: "chat",
    });
  }

  const upstream = await fetch(getGhostBackendUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ghost-Entry-Point": "ghost-ui-proxy",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await upstream.text();

  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    },
  });
}
