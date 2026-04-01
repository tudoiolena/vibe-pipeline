import {
  createClient,
  getProjectSessionById,
  updateProjectSessionById
} from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const JumpBodySchema = z.object({
  stage: z.enum(["intake", "analysis", "clarify", "prd"]),
  projectId: z.string().uuid()
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const idParse = z.string().uuid().safeParse(sessionId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = JumpBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must include projectId (uuid) and stage (intake | analysis | clarify | prd)." },
      { status: 400 }
    );
  }

  const { stage, projectId } = parsed.data;
  const client = createClient();

  const { data: session, error: loadError } = await getProjectSessionById(client, idParse.data);
  if (loadError) {
    return NextResponse.json({ error: `Failed to load session: ${loadError.message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.project_id !== projectId) {
    return NextResponse.json({ error: "Session does not belong to this project." }, { status: 403 });
  }

  const { data: updated, error: updateError } = await updateProjectSessionById(client, session.id, {
    current_stage: stage,
    updated_at: new Date().toISOString()
  });

  if (updateError) {
    return NextResponse.json({ error: `Failed to update session: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    sessionId: updated!.id,
    currentStage: updated!.current_stage
  });
}
