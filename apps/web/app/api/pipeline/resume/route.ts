import { pipelineDebug, resumePipelineWithClarification } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Allow long clarification → PRD → tasks → handoff runs on Vercel (requires compatible plan). */
export const maxDuration = 300;

const ResumeBodySchema = z.object({
  sessionId: z.string().uuid(),
  userInput: z.string().min(1, "userInput is required.")
});

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ResumeBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const client = createClient();

  pipelineDebug("resume POST", {
    sessionId: parsed.data.sessionId,
    inputChars: parsed.data.userInput.length
  });

  try {
    await resumePipelineWithClarification(client, parsed.data.sessionId, parsed.data.userInput);
    pipelineDebug("resume OK", { sessionId: parsed.data.sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pipelineDebug("resume error", { sessionId: parsed.data.sessionId, message });
    const isWrongPhase = message.startsWith("Session is not waiting for clarification");
    if (!isWrongPhase) {
      await updateProjectSessionById(client, parsed.data.sessionId, {
        graph_status: "failed",
        last_error: { message }
      });
    }
    const status = isWrongPhase ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
