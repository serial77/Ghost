import { NextResponse } from "next/server";
import { getTaskOverviewPayload } from "@/lib/server/task-overview";

export async function GET() {
  try {
    const payload = await getTaskOverviewPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task overview query failed.";
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          activeNow: 0,
          recentRuns: 0,
          technicalRuns: 0,
          blockedRuns: 0,
          failedRuns: 0,
          staleRuns: 0,
          lastUpdatedAt: null,
        },
        tasks: [],
        runs: [],
        activity: [],
        sourceHealth: [],
        degraded: true,
        errors: [message],
      },
      { status: 500 },
    );
  }
}
