import { NextResponse } from "next/server";
import { getAgentRegistryPayload } from "@/lib/server/agent-registry";

export async function GET() {
  try {
    const payload = await getAgentRegistryPayload();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent registry query failed.";
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), foundationWorkers: [], runtimeAgents: [], capabilities: [], errors: [message] },
      { status: 500 },
    );
  }
}
