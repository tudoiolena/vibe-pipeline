import { createClient, getProjectSessionById, updateProjectSessionById } from "@vibe/database";
import { exportTasksToLinear, requireLinearDefaultTeamId } from "@vibe/integrations";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  flattenTaskTree,
  resolveDesignMapFromSession,
  resolveTaskTreeForSession
} from "@/lib/pipeline-export-state";

const ExportLinearBodySchema = z.object({
  sessionId: z.string().uuid(),
  selectedTaskIds: z.array(z.string().min(1)).min(1, "Select at least one task."),
  teamId: z.string().uuid().optional()
});

function workspaceUrlFromEnv(): string | null {
  const url = process.env.LINEAR_WORKSPACE_URL ?? process.env.NEXT_PUBLIC_LINEAR_WORKSPACE_URL;
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }
  return url.trim().replace(/\/$/, "");
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ExportLinearBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const { sessionId, selectedTaskIds, teamId: teamIdOverride } = parsed.data;

  let teamId: string;
  try {
    teamId = teamIdOverride ?? requireLinearDefaultTeamId();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const client = createClient();
  const { data: session, error: sessionError } = await getProjectSessionById(client, sessionId);
  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const taskTree = await resolveTaskTreeForSession(client, session.project_id, session.state_json);
  if (!taskTree || taskTree.epics.length === 0) {
    return NextResponse.json(
      { error: "No task tree found for this session. Generate or attach tasks first." },
      { status: 400 }
    );
  }

  const allTasks = flattenTaskTree(taskTree);
  const selected = new Set(selectedTaskIds);
  const filtered = allTasks.filter((t) => selected.has(t.externalKey));
  if (filtered.length === 0) {
    return NextResponse.json({ error: "No tasks matched the selected IDs." }, { status: 400 });
  }
  const tasksForExport = filtered.map((task) => ({
    ...task,
    description: task.description ?? null,
    acceptanceCriteria: [...task.acceptanceCriteria],
    specReferences: [...task.specReferences],
    dependencies: [...task.dependencies],
    children: [...task.children]
  }));

  const designMap = resolveDesignMapFromSession(session.state_json);

  try {
    const { issues } = await exportTasksToLinear(tasksForExport, teamId, { designMap });
    const prevMeta =
      session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
        ? { ...(session.metadata as Record<string, unknown>) }
        : {};
    const { error: updateError } = await updateProjectSessionById(client, sessionId, {
      metadata: {
        ...prevMeta,
        linear_export_timestamp: new Date().toISOString()
      }
    });
    if (updateError) {
      return NextResponse.json(
        { error: `Export succeeded but failed to update session: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      workspaceUrl: workspaceUrlFromEnv(),
      issues
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
