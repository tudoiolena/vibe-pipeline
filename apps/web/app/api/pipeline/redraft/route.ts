import { redraftPipelineFromPrd, type RedraftGraphTarget } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const RedraftBodySchema = z.object({
  sessionId: z.string().uuid(),
  target: z.enum(["gapDetector", "intakeNormalizer"]).optional()
});

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RedraftBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "sessionId (uuid) is required." },
      { status: 400 }
    );
  }

  const client = createClient();
  const target: RedraftGraphTarget = parsed.data.target ?? "gapDetector";

  try {
    await redraftPipelineFromPrd(client, parsed.data.sessionId, target);
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
