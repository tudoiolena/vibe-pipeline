import { Command } from "@langchain/langgraph";
import { getProjectSessionById, type DatabaseClient } from "@vibe/database";
import { createPipelineGraph, createSessionConfig } from "./pipeline-graph";
import type { PersistedCheckpointEnvelope } from "./state";
import { PipelineStateSchema, type PipelineState } from "./state";

export type RedraftGraphTarget = "gapDetector" | "intakeNormalizer";

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

function stripPrdAndClarificationFields(json: Record<string, unknown>): Record<string, unknown> {
  const next = { ...json };
  delete next.prd;
  delete next.prdArtifactId;
  delete next.prdArtifactVersion;
  delete next.gapAnalysis;
  delete next.needsClarification;
  delete next.clarificationFollowUp;
  delete next.route;
  delete next.redraftRequested;
  return next;
}

/**
 * From a completed PRD session, rewinds execution to gap detection or full intake normalization
 * so the user can re-enter clarification and regenerate the PRD.
 */
export async function redraftPipelineFromPrd(
  client: DatabaseClient,
  sessionId: string,
  target: RedraftGraphTarget = "gapDetector"
): Promise<void> {
  const { data: session, error } = await getProjectSessionById(client, sessionId);
  if (error) {
    throw new Error(`Failed to load session: ${error.message}`);
  }
  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  if (session.current_stage !== "prd") {
    throw new Error("Re-draft is only available when the session is in the PRD stage.");
  }

  const envelope = parseEnvelope(session.state_json);
  if (!envelope) {
    throw new Error("Session has no persisted pipeline checkpoint; cannot re-draft.");
  }

  const checkpoint = envelope.checkpoint as { id?: string };
  const checkpointId = typeof checkpoint.id === "string" ? checkpoint.id : undefined;
  if (!checkpointId) {
    throw new Error("Persisted checkpoint is missing an id; cannot re-draft.");
  }

  const parsedState = PipelineStateSchema.safeParse(envelope.pipelineState);
  if (!parsedState.success) {
    throw new Error("Invalid pipeline state in session checkpoint.");
  }

  const base = parsedState.data;
  let nextJson = stripPrdAndClarificationFields(base.stateJson as Record<string, unknown>);

  let goto: RedraftGraphTarget;
  let nextCurrentStage: PipelineState["currentStage"];

  if (target === "intakeNormalizer") {
    delete (nextJson as Record<string, unknown>).brief;
    delete (nextJson as Record<string, unknown>).briefArtifactId;
    delete (nextJson as Record<string, unknown>).briefArtifactVersion;
    goto = "intakeNormalizer";
    nextCurrentStage = "intake";
  } else {
    nextJson = { ...nextJson, redraftRequested: true };
    goto = "gapDetector";
    nextCurrentStage = "clarify";
  }

  const mergedState: PipelineState = {
    ...base,
    currentStage: nextCurrentStage,
    stateJson: nextJson
  };

  const { graph } = createPipelineGraph(client);
  const config = createSessionConfig(sessionId, checkpointId);

  await graph.invoke(
    new Command({
      update: mergedState,
      goto
    }),
    config
  );
}
