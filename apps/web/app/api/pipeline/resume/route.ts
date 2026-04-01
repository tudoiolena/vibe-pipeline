import { resumePipelineWithClarification } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

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

  try {
    await resumePipelineWithClarification(client, parsed.data.sessionId, parsed.data.userInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectSessionById(client, parsed.data.sessionId, {
      graph_status: "failed",
      last_error: { message }
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
