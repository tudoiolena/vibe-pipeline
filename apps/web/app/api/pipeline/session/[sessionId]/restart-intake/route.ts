import { restartPipelineIntakeWithNewText } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  intakeText: z.string().min(1, "intakeText is required.")
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const idParse = z.string().uuid().safeParse(sessionId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const client = createClient();

  try {
    await restartPipelineIntakeWithNewText(
      client,
      idParse.data,
      parsed.data.projectId,
      parsed.data.intakeText.trim()
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectSessionById(client, idParse.data, {
      graph_status: "failed",
      last_error: { message }
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
