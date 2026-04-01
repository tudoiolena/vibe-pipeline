import { restartPipelineIntakeWithNewText } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  intakeText: z.string().min(1, "intakeText is required."),
  /** Omit to leave Figma unchanged; send null or "" to clear `figmaFileKey` on the session. */
  figmaFileKey: z.union([z.string().min(1), z.literal(""), z.null()]).optional()
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
    const body = parsed.data;
    const figmaOpt = body.figmaFileKey;
    await restartPipelineIntakeWithNewText(client, idParse.data, body.projectId, body.intakeText.trim(), {
      figmaFileKey:
        figmaOpt === undefined ? undefined : figmaOpt === null || figmaOpt === "" ? null : figmaOpt.trim()
    });
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
