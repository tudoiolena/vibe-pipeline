import { Command } from "@langchain/langgraph";
import { getProjectSessionById, updateProjectById, type DatabaseClient } from "@vibe/database";
import { createPipelineGraph, createSessionConfig } from "./pipeline-graph";
import type { PersistedCheckpointEnvelope } from "./state";
import { PipelineStateSchema, type PipelineState } from "./state";

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

/** Clears normalized brief, gaps, PRD, and clarification fields so intake can run again from raw text. */
function stripForIntakeRestart(json: Record<string, unknown>): Record<string, unknown> {
  const next = { ...json };
  delete next.prd;
  delete next.prdArtifactId;
  delete next.prdArtifactVersion;
  delete next.gapAnalysis;
  delete next.needsClarification;
  delete next.clarificationFollowUp;
  delete next.lastUserClarification;
  delete next.clarificationRounds;
  delete next.route;
  delete next.redraftRequested;
  delete next.brief;
  delete next.briefArtifactId;
  delete next.briefArtifactVersion;
  delete next.workflowStatus;
  delete next._sessionHistoryMeta;
  return next;
}

/**
 * When the session is at the intake stage, replaces the raw intake text and re-runs normalization
 * and gap detection from `intakeNormalizer` (same path as initial pipeline start).
 */
export async function restartPipelineIntakeWithNewText(
  client: DatabaseClient,
  sessionId: string,
  projectId: string,
  rawIntakeText: string,
  options?: { figmaFileKey?: string | null }
): Promise<void> {
  const trimmed = rawIntakeText.trim();
  if (trimmed.length === 0) {
    throw new Error("Intake text must not be empty.");
  }

  const { data: session, error } = await getProjectSessionById(client, sessionId);
  if (error) {
    throw new Error(`Failed to load session: ${error.message}`);
  }
  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  if (session.project_id !== projectId) {
    throw new Error("Session does not belong to this project.");
  }
  if (session.current_stage !== "intake") {
    throw new Error("Intake revision is only available when the session stage is intake.");
  }

  const envelope = parseEnvelope(session.state_json);
  if (!envelope) {
    throw new Error("Session has no persisted pipeline checkpoint; cannot restart intake yet.");
  }

  const checkpoint = envelope.checkpoint as { id?: string };
  const checkpointId = typeof checkpoint.id === "string" ? checkpoint.id : undefined;
  if (!checkpointId) {
    throw new Error("Persisted checkpoint is missing an id; cannot restart intake.");
  }

  const parsedState = PipelineStateSchema.safeParse(envelope.pipelineState);
  if (!parsedState.success) {
    throw new Error("Invalid pipeline state in session checkpoint.");
  }

  const base = parsedState.data;
  const nextJson = stripForIntakeRestart(base.stateJson as Record<string, unknown>);
  const priorRaw =
    typeof (base.stateJson as Record<string, unknown>).rawIntakeText === "string"
      ? String((base.stateJson as Record<string, unknown>).rawIntakeText).trim()
      : "";

  const stateJsonPayload: Record<string, unknown> = {
    ...nextJson,
    rawIntakeText: trimmed,
    _sessionHistoryMeta: {
      is_brief_update: true,
      previous_brief: priorRaw,
      new_brief: trimmed
    }
  };

  if (options?.figmaFileKey !== undefined) {
    const fk = options.figmaFileKey;
    if (fk === null || fk === "") {
      delete stateJsonPayload.figmaFileKey;
    } else {
      stateJsonPayload.figmaFileKey = fk.trim();
    }
  }

  const mergedState: PipelineState = {
    ...base,
    currentStage: "intake",
    stateJson: stateJsonPayload
  };

  const { error: projectError } = await updateProjectById(client, projectId, {
    description: trimmed,
    updated_at: new Date().toISOString()
  });
  if (projectError) {
    throw new Error(`Failed to update project: ${projectError.message}`);
  }

  const { graph } = createPipelineGraph(client);
  const config = createSessionConfig(sessionId, checkpointId);

  await graph.invoke(
    new Command({
      update: mergedState,
      goto: "intakeNormalizer"
    }),
    config
  );
}
