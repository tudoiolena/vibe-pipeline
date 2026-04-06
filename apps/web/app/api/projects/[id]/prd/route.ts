import {
  createArtifactVersion,
  createClient,
  getLatestArtifactVersion,
  getLatestProjectSessionByProjectId,
  getProjectById,
  type Json
} from "@vibe/database";
import { PRDSchema } from "@vibe/schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodIssuesPayload } from "@/lib/api-zod-error";

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  prd: z.unknown()
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

  const prdParsed = PRDSchema.safeParse(parsedBody.data.prd);
  if (!prdParsed.success) {
    return NextResponse.json(zodIssuesPayload(prdParsed.error), { status: 400 });
  }

  const client = createClient();
  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError) {
    console.error("[PATCH /api/projects/.../prd] getProjectById:", projectError.message);
    return NextResponse.json({ error: `Failed to load project: ${projectError.message}` }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { data: session, error: sessionError } = await getLatestProjectSessionByProjectId(client, projectId);
  if (sessionError) {
    console.error("[PATCH /api/projects/.../prd] getLatestProjectSessionByProjectId:", sessionError.message);
    return NextResponse.json({ error: `Failed to load session: ${sessionError.message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "No pipeline session for this project." }, { status: 409 });
  }

  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, projectId, "prd");
  if (latestError) {
    console.error("[PATCH /api/projects/.../prd] getLatestArtifactVersion:", latestError.message);
    return NextResponse.json({ error: `Failed to resolve PRD artifact version: ${latestError.message}` }, { status: 500 });
  }

  const { data: artifact, error: insertError } = await createArtifactVersion(client, {
    project_id: projectId,
    session_id: session.id,
    artifact_type: "prd",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: prdParsed.data as unknown as Json
  });

  if (insertError || !artifact) {
    const msg = `Failed to save PRD: ${insertError?.message ?? "unknown insert error"}`;
    console.error("[PATCH /api/projects/.../prd] createArtifactVersion:", insertError?.message ?? "no row");
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, version: artifact.version, artifactId: artifact.id });
}
