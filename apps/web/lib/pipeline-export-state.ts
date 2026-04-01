import type { PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import type { DatabaseClient } from "@vibe/database";
import { getLatestArtifactVersion } from "@vibe/database";
import { DesignMapSchema, TaskTreeSchema, type DesignMap, type TaskTree } from "@vibe/schema";

export function parseCheckpointEnvelope(stateJson: unknown): PersistedCheckpointEnvelope | null {
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }
  const candidate = stateJson as Partial<PersistedCheckpointEnvelope>;
  if (!candidate.pipelineState || !candidate.checkpoint) {
    return null;
  }
  return candidate as PersistedCheckpointEnvelope;
}

export async function resolveTaskTreeForSession(
  client: DatabaseClient,
  projectId: string,
  stateJson: unknown
): Promise<TaskTree | null> {
  const envelope = parseCheckpointEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const stateRecord = raw as Record<string, unknown>;
    const parsed = TaskTreeSchema.safeParse(stateRecord.tasks ?? stateRecord.taskTree);
    if (parsed.success) {
      return parsed.data;
    }
  }
  const { data: artifact } = await getLatestArtifactVersion(client, projectId, "tasks");
  if (artifact?.content_json) {
    const parsed = TaskTreeSchema.safeParse(artifact.content_json);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
}

export function resolveDesignMapFromSession(stateJson: unknown): DesignMap | undefined {
  const envelope = parseCheckpointEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const parsed = DesignMapSchema.safeParse((raw as Record<string, unknown>).designMap);
  return parsed.success ? parsed.data : undefined;
}

export { flattenTaskTree } from "./task-tree-utils";
