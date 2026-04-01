import { Command } from "@langchain/langgraph";
import { getProjectSessionById, type DatabaseClient } from "@vibe/database";
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

/**
 * Continues the pipeline after the user submits clarification: merges follow-up text into state,
 * re-runs gap detection from `applyClarification` → `gapDetector`.
 */
export async function resumePipelineWithClarification(
  client: DatabaseClient,
  sessionId: string,
  clarificationFollowUp: string
): Promise<void> {
  const trimmed = clarificationFollowUp.trim();
  if (trimmed.length === 0) {
    throw new Error("Clarification text must not be empty.");
  }

  const { data: session, error } = await getProjectSessionById(client, sessionId);
  if (error) {
    throw new Error(`Failed to load session: ${error.message}`);
  }
  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  if (session.graph_status !== "interrupted_for_input") {
    throw new Error(
      `Session is not waiting for clarification (graph_status=${session.graph_status}).`
    );
  }

  const envelope = parseEnvelope(session.state_json);
  if (!envelope) {
    throw new Error("Session has no persisted pipeline checkpoint; cannot resume.");
  }

  const checkpoint = envelope.checkpoint as { id?: string };
  const checkpointId = typeof checkpoint.id === "string" ? checkpoint.id : undefined;
  if (!checkpointId) {
    throw new Error("Persisted checkpoint is missing an id; cannot resume.");
  }

  const parsedState = PipelineStateSchema.safeParse(envelope.pipelineState);
  if (!parsedState.success) {
    throw new Error("Invalid pipeline state in session checkpoint.");
  }

  const base = parsedState.data;
  const priorJson = base.stateJson as Record<string, unknown>;
  const mergedState: PipelineState = {
    ...base,
    currentStage: "clarify",
    stateJson: {
      ...priorJson,
      clarificationFollowUp: trimmed
    }
  };

  const { graph } = createPipelineGraph(client);
  const config = createSessionConfig(sessionId, checkpointId);

  await graph.invoke(
    new Command({
      update: mergedState,
      goto: "applyClarification"
    }),
    config
  );
}
