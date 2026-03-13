import { NextResponse } from "next/server";
import { createTaskBoardTask, getTaskBoardPayload, updateOrchestrationTaskControls } from "@/lib/server/task-board";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getTaskBoardPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task board query failed.";
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          totalCards: 0,
          activeAgents: 0,
          tasksInQueue: 0,
          tasksInProgress: 0,
          reviewNeeded: 0,
          resolved: 0,
          lastUpdatedAt: null,
        },
        agents: [],
        lanes: [],
        feed: [],
        controls: {
          stageOptions: [],
          agentOptions: [],
        },
        degraded: true,
        errors: [message],
        mappingMode: "live_plus_orchestration",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      priorityLabel?: string | null;
      suggestedRoute?: string | null;
      suggestedModel?: string | null;
      planningNote?: string | null;
    };

    const created = await createTaskBoardTask({
      title: body.title ?? "",
      description: body.description ?? "",
      priorityLabel: body.priorityLabel ?? null,
      suggestedRoute: body.suggestedRoute ?? null,
      suggestedModel: body.suggestedModel ?? null,
      planningNote: body.planningNote ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        ...created,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task board task creation failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      orchestrationTaskId?: string;
      stage?: "planning" | "assigned" | "in_progress" | "review" | "done" | null;
      orchestratorAgentId?: string | null;
      actorId?: string | null;
    };

    const result = await updateOrchestrationTaskControls({
      orchestrationTaskId: body.orchestrationTaskId ?? "",
      stage: body.stage ?? null,
      orchestratorAgentId: body.orchestratorAgentId ?? null,
      actorId: body.actorId ?? "ghost-operator-ui",
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task board update failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}
