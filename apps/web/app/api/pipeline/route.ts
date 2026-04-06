import { randomUUID } from "node:crypto";
import { createPipelineGraph, createSessionConfig, pipelineDebug } from "@vibe/ai/graph";
import { createClient, createProject, createProjectSession, updateProjectSessionById, type Json } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseIntakeFormFieldsForSession, toSlug, DeadlineDateSchema } from "@/lib/pipeline-intake-payload";

export const maxDuration = 300;

const SourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

const PipelineRequestSchema = z
  .object({
    projectName: z.string().optional(),
    clientName: z.string().optional(),
    businessGoal: z.string().optional(),
    targetUsers: z.string().optional(),
    constraints: z.string().optional(),
    rawBrief: z.string().optional(),
    figmaUrl: z.string().trim().optional(),
    repoUrl: z.string().trim().optional(),
    /** One URL per line; merged with `references` when both sent (array wins for duplicates). */
    referencesText: z.string().optional(),
    references: z.array(SourceLinkSchema).optional(),
    deadline: z.union([DeadlineDateSchema, z.literal("")]).optional()
  })
  .superRefine((data, ctx) => {
    const brief = (data.rawBrief ?? "").trim();
    if (brief.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide rawBrief (non-empty).",
        path: ["rawBrief"]
      });
    }
  });

export async function POST(request: Request) {
  const requestJson: unknown = await request.json().catch(() => null);
  const parsedBody = PipelineRequestSchema.safeParse(requestJson);

  if (!parsedBody.success) {
    const msg = parsedBody.error.issues[0]?.message ?? "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const body = parsedBody.data;
  const parsedIntake = parseIntakeFormFieldsForSession({
    rawBrief: body.rawBrief ?? "",
    projectName: body.projectName,
    clientName: body.clientName,
    businessGoal: body.businessGoal,
    targetUsers: body.targetUsers,
    constraints: body.constraints,
    figmaUrl: body.figmaUrl,
    repoUrl: body.repoUrl,
    referencesText: body.referencesText,
    references: body.references,
    deadline: body.deadline
  });
  if (!parsedIntake.ok) {
    return NextResponse.json({ error: parsedIntake.error }, { status: 400 });
  }

  const {
    effectiveBrief,
    sessionStateSlice: sessionStateJson,
    projectUpdate,
    sourceFigmaUrl,
    sourceLinks
  } = parsedIntake;
  const projectName = typeof sessionStateJson.intakeProjectName === "string" ? sessionStateJson.intakeProjectName : "";

  const client = createClient();

  const slugBase = toSlug(projectName + "-" + effectiveBrief.slice(0, 24));
  const { data: project, error: projectError } = await createProject(client, {
    slug: `${slugBase}-${Date.now()}`,
    name: projectUpdate.name ?? projectName,
    description: projectUpdate.description ?? effectiveBrief,
    status: "intake",
    source_figma_url: sourceFigmaUrl,
    source_repo_url: projectUpdate.source_repo_url ?? null,
    source_links: sourceLinks as unknown as Json,
    client_name: projectUpdate.client_name ?? null,
    business_goal: projectUpdate.business_goal ?? null,
    target_users: projectUpdate.target_users ?? null,
    constraints: projectUpdate.constraints ?? null,
    raw_brief: effectiveBrief,
    deadline: projectUpdate.deadline ?? null
  });

  if (projectError || !project) {
    return NextResponse.json(
      { error: `Failed to create project: ${projectError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  const { data: session, error: sessionError } = await createProjectSession(client, {
    id: randomUUID(),
    project_id: project.id,
    current_stage: "intake",
    graph_status: "idle",
    state_json: sessionStateJson as Json
  });

  if (sessionError || !session) {
    return NextResponse.json(
      { error: `Failed to create session: ${sessionError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  try {
    await updateProjectSessionById(client, session.id, {
      current_stage: "intake",
      graph_status: "running",
      last_error: null
    });

    const { graph } = createPipelineGraph(client);
    const sessionConfig = createSessionConfig(session.id);
    pipelineDebug("pipeline POST invoke start", { sessionId: session.id, projectId: project.id });
    await graph.invoke(
      {
        projectId: project.id,
        sessionId: session.id,
        currentStage: "intake",
        stateJson: sessionStateJson
      },
      sessionConfig
    );
    pipelineDebug("pipeline POST invoke OK", { sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pipelineDebug("pipeline POST invoke failed", { sessionId: session.id, message });
    await updateProjectSessionById(client, session.id, {
      graph_status: "failed",
      last_error: { message }
    });
    return NextResponse.json({ error: `Pipeline run failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ sessionId: session.id });
}
