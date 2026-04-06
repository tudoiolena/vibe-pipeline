import {
  createArtifactVersion,
  createClient,
  getLatestArtifactVersion,
  getLatestProjectSessionByProjectId,
  getProjectById,
  type Json
} from "@vibe/database";
import { flattenTaskTreeToRows } from "@vibe/ai/graph";
import { TaskTreeSchema } from "@vibe/schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodIssuesPayload } from "@/lib/api-zod-error";

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  taskTree: z.unknown()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const idParse = z.string().uuid().safeParse(projectId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }

  const rawBody: unknown = await request.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(zodIssuesPayload(parsedBody.error), { status: 400 });
  }

  const treeParsed = TaskTreeSchema.safeParse(parsedBody.data.taskTree);
  if (!treeParsed.success) {
    return NextResponse.json(zodIssuesPayload(treeParsed.error), { status: 400 });
  }

  const client = createClient();
  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError) {
    console.error("[PATCH /api/projects/.../task-tree] getProjectById:", projectError.message);
    return NextResponse.json({ error: `Failed to load project: ${projectError.message}` }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { data: session, error: sessionError } = await getLatestProjectSessionByProjectId(client, projectId);
  if (sessionError) {
    console.error("[PATCH /api/projects/.../task-tree] getLatestProjectSessionByProjectId:", sessionError.message);
    return NextResponse.json({ error: `Failed to load session: ${sessionError.message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "No pipeline session for this project." }, { status: 409 });
  }

  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, projectId, "tasks");
  if (latestError) {
    console.error("[PATCH /api/projects/.../task-tree] getLatestArtifactVersion:", latestError.message);
    return NextResponse.json({ error: `Failed to resolve tasks artifact version: ${latestError.message}` }, { status: 500 });
  }

  const { data: artifact, error: insertError } = await createArtifactVersion(client, {
    project_id: projectId,
    session_id: session.id,
    artifact_type: "tasks",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: treeParsed.data as unknown as Json
  });

  if (insertError || !artifact) {
    console.error("[PATCH /api/projects/.../task-tree] createArtifactVersion:", insertError?.message ?? "no row");
    return NextResponse.json(
      { error: `Failed to save task tree: ${insertError?.message ?? "unknown insert error"}` },
      { status: 500 }
    );
  }

  const rows = flattenTaskTreeToRows(treeParsed.data, projectId, session.id);
  if (rows.length > 0) {
    const { error: upsertError } = await client.from("tasks").upsert(rows, { onConflict: "project_id,external_key" });
    if (upsertError) {
      console.error("[PATCH /api/projects/.../task-tree] tasks upsert:", upsertError.message);
      return NextResponse.json(
        {
          error: `Task tree artifact saved (version ${artifact.version}) but relational sync failed: ${upsertError.message}`
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, version: artifact.version, artifactId: artifact.id });
}
