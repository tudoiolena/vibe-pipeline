import { restartPipelineIntakeWithNewText } from "@vibe/ai/graph";
import { createClient, updateProjectSessionById } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DeadlineDateSchema, parseIntakeFormFieldsForSession } from "@/lib/pipeline-intake-payload";

const SourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

const BodySchema = z
  .object({
    projectId: z.string().uuid(),
    intakeText: z.string().min(1, "intakeText is required."),
    /** Omit to leave `projects.source_figma_url` unchanged; null or "" clears it. */
    figmaUrl: z.union([z.string(), z.literal(""), z.null()]).optional(),
    projectName: z.string().optional(),
    clientName: z.string().optional(),
    businessGoal: z.string().optional(),
    targetUsers: z.string().optional(),
    constraints: z.string().optional(),
    repoUrl: z.string().trim().optional(),
    referencesText: z.string().optional(),
    references: z.array(SourceLinkSchema).optional(),
    deadline: z.union([DeadlineDateSchema, z.literal("")]).optional()
  })
  .strict();

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

  const b = parsed.data;
  const applyFigma = b.figmaUrl !== undefined;
  const figmaForParser =
    b.figmaUrl === null || b.figmaUrl === ""
      ? ""
      : typeof b.figmaUrl === "string"
        ? b.figmaUrl
        : undefined;

  const parsedIntake = parseIntakeFormFieldsForSession({
    rawBrief: b.intakeText,
    projectName: b.projectName,
    clientName: b.clientName,
    businessGoal: b.businessGoal,
    targetUsers: b.targetUsers,
    constraints: b.constraints,
    figmaUrl: figmaForParser,
    applyFigmaToProject: applyFigma,
    repoUrl: b.repoUrl,
    referencesText: b.referencesText,
    references: b.references,
    deadline: b.deadline
  });

  if (!parsedIntake.ok) {
    return NextResponse.json({ error: parsedIntake.error }, { status: 400 });
  }

  const { sessionStateSlice, projectUpdate } = parsedIntake;
  const projectRowPatch = { ...projectUpdate };
  if (!applyFigma) {
    delete projectRowPatch.source_figma_url;
  }

  const client = createClient();

  try {
    await restartPipelineIntakeWithNewText(client, idParse.data, b.projectId, b.intakeText.trim(), {
      intakeStateSlice: sessionStateSlice,
      projectRowPatch
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
