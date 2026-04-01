import { type PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import { createClient, getProjectSessionById } from "@vibe/database";
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

  return NextResponse.json({
    sessionId: session.id,
    projectId: session.project_id,
    currentStage: session.current_stage,
    stageLabel: getPipelineStageLabel(session.current_stage),
    graphStatus: session.graph_status,
    gaps,
    needsClarification
  });
}
