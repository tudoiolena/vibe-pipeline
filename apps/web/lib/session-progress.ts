import type { PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import type { ProjectSessionRow } from "@vibe/database";

export const SESSION_STEPPER_STEPS = ["Intake", "Analysis", "Clarification", "PRD"] as const;

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
 * Maps pipeline session state to the four-step product flow shown in the session stepper.
 */
export function getSessionStepperActiveIndex(session: ProjectSessionRow): number {
  const stage = session.current_stage;
  if (stage === "prd") {
    return 3;
  }
  if (stage === "clarify") {
    return 2;
  }
  if (stage === "analysis") {
    return 1;
  }
  if (stage === "intake") {
    const envelope = parseEnvelope(session.state_json);
    const stateJson = envelope?.pipelineState?.stateJson as Record<string, unknown> | undefined;
    const workflowStatus = stateJson?.workflowStatus;
    if (workflowStatus === "brief_normalized" || workflowStatus === "ready_for_prd") {
      return 1;
    }
    return 0;
  }
  return 0;
}
