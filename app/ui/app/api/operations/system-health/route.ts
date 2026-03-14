import { NextResponse } from "next/server";
import { getSystemHealthPayload } from "@/lib/server/system-health";

export async function GET() {
  try {
    const payload = await getSystemHealthPayload();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "System health check failed.";
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), degraded: true, services: [], workflow: null, runtime: null, errors: [message] },
      { status: 500 },
    );
  }
}
