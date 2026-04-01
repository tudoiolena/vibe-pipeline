import { randomUUID } from "node:crypto";
import { createPipelineGraph, createSessionConfig } from "@vibe/ai/graph";
import { createClient, createProject, createProjectSession, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const PipelineRequestSchema = z.object({
  intakeText: z.string().min(1)
});

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);

  return normalized.length > 0 ? normalized : "project";
}

function toProjectName(value: string): string {
  const tokens = value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  if (tokens.length === 0) {
    return "Untitled Project";
  }

  return tokens.map((token) => token.slice(0, 1).toUpperCase() + token.slice(1)).join(" ");
}

export async function POST(request: Request) {
  const requestJson: unknown = await request.json().catch(() => null);
  const parsedBody = PipelineRequestSchema.safeParse(requestJson);

  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body. intakeText is required." }, { status: 400 });
  }

  const intakeText = parsedBody.data.intakeText.trim();
  const client = createClient();

  const slugBase = toSlug(intakeText);
  const { data: project, error: projectError } = await createProject(client, {
    slug: `${slugBase}-${Date.now()}`,
    name: toProjectName(intakeText),
    description: intakeText,
    status: "intake"
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
    state_json: {}
  });

  if (sessionError || !session) {
    return NextResponse.json(
      { error: `Failed to create session: ${sessionError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  try {
    const { graph } = createPipelineGraph(client);
    const sessionConfig = createSessionConfig(session.id);
    await graph.invoke(
      {
        projectId: project.id,
        sessionId: session.id,
        currentStage: "intake",
        stateJson: {
          rawIntakeText: intakeText
        }
      },
      sessionConfig
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectSessionById(client, session.id, {
      graph_status: "failed",
      last_error: { message }
    });
    return NextResponse.json({ error: `Pipeline run failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ sessionId: session.id });
}
