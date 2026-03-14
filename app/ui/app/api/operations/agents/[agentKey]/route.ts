import { NextResponse } from "next/server";
import { getAgentDetailPayload } from "@/lib/server/agent-registry";

export async function GET(_req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const { agentKey } = await params;
  try {
    const payload = await getAgentDetailPayload(agentKey);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent detail query failed.";
    return NextResponse.json(
      { agentKey, recentTasks: [], recentDelegations: [], errors: [message] },
      { status: 500 },
    );
  }
}
