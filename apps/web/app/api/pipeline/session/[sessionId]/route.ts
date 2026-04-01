import { type PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import { createClient, getProjectSessionById } from "@vibe/database";
import { BriefSchema, PRDSchema } from "@vibe/schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPipelineStageLabel } from "@/lib/pipeline-stage-labels";

const GapSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(["High", "Med", "Low"]),
  type: z.string()
});

const GapAnalysisSchema = z.object({
  gaps: z.array(GapSchema).default([]),
  rationale: z.array(z.string()).optional()
});

function parseEnvelope(stateJson: unknown): PersistedCheckpointEnvelope | null {
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }
  const candidate = stateJson as Partial<PersistedCheckpointEnvelope>;
  if (!candidate.pipelineState || !candidate.checkpoint) {
    return null;
  }
  return candidate as PersistedCheckpointEnvelope;
}

function buildHydratedIntake(stateJson: Record<string, unknown>): {
  intakeText: string;
  figmaDesignUrl?: string;
} {
  const briefParsed = BriefSchema.safeParse(stateJson.brief);
  let intakeText = "";
  if (briefParsed.success) {
    intakeText = briefParsed.data.summary.trim();
  }
  if (!intakeText) {
    for (const key of ["rawIntakeText", "intakeText", "rawBrief", "inputText"] as const) {
      const v = stateJson[key];
      if (typeof v === "string" && v.trim().length > 0) {
        intakeText = v.trim();
        break;
      }
    }
  }

  const figmaKey =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0
      ? stateJson.figmaFileKey.trim()
      : null;

  const figmaDesignUrl = figmaKey ? `https://www.figma.com/design/${encodeURIComponent(figmaKey)}/file` : undefined;

  return { intakeText, ...(figmaDesignUrl ? { figmaDesignUrl } : {}) };
}

function clarificationRoundsFromStateJson(stateJson: Record<string, unknown>): string[] {
  const rounds = stateJson.clarificationRounds;
  if (Array.isArray(rounds)) {
    const fromState = rounds.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (fromState.length > 0) {
      return fromState;
    }
  }
  const brief = stateJson.brief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    return [];
  }
  const summary = (brief as { summary?: unknown }).summary;
  if (typeof summary !== "string" || !summary.includes("User clarification:\n")) {
    return [];
  }
  return summary
    .split(/\n\nUser clarification:\n/)
    .slice(1)
    .map((block) => block.trim())
    .filter(Boolean);
}

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const idParse = z.string().uuid().safeParse(sessionId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  const client = createClient();
  const { data: session, error } = await getProjectSessionById(client, idParse.data);

  if (error) {
    return NextResponse.json({ error: `Failed to load session: ${error.message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const envelope = parseEnvelope(session.state_json);
  const stateJson = (envelope?.pipelineState.stateJson ?? {}) as Record<string, unknown>;
  const gapAnalysisRaw = stateJson.gapAnalysis;
  const parsedGaps = GapAnalysisSchema.safeParse(gapAnalysisRaw);
  const gaps = parsedGaps.success ? parsedGaps.data.gaps : [];

  const needsClarification = stateJson.needsClarification === true;

  const hydratedIntake = buildHydratedIntake(stateJson);

  const figmaFileKey =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0
      ? stateJson.figmaFileKey.trim()
      : null;

  const workflowStatus = typeof stateJson.workflowStatus === "string" ? stateJson.workflowStatus : null;
  const hasPrd = PRDSchema.safeParse(stateJson.prd).success;
  const clarificationRounds = clarificationRoundsFromStateJson(stateJson);

  return NextResponse.json({
    sessionId: session.id,
    projectId: session.project_id,
    currentStage: session.current_stage,
    stageLabel: getPipelineStageLabel(session.current_stage),
    graphStatus: session.graph_status,
    gaps,
    needsClarification,
    hydratedIntake,
    figmaFileKey,
    workflowStatus,
    hasPrd,
    clarificationRounds,
    sessionUpdatedAt: session.updated_at
  });
}
