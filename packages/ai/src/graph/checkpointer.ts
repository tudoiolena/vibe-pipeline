import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite
} from "@langchain/langgraph-checkpoint";
import {
  getProjectSessionById,
  insertLanggraphCheckpoint,
  updateProjectSessionById,
  type DatabaseClient,
  type Json
} from "@vibe/database";
import { PipelineStateSchema, type PersistedCheckpointEnvelope } from "./state";

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function getThreadId(config: RunnableConfig): string {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error('Missing required RunnableConfig configurable field: "thread_id".');
  }
  return threadId;
}

function getLastNodeFromMetadata(metadata: CheckpointMetadata): string | null {
  const writes = (metadata as { writes?: unknown }).writes;
  if (!writes || typeof writes !== "object" || Array.isArray(writes)) {
    return null;
  }

  const nodeNames = Object.keys(writes);
  return nodeNames.length > 0 ? nodeNames[0] : null;
}

function resolveGraphStatus(stateJson: Record<string, unknown>): "running" | "interrupted_for_input" {
  const workflowStatus = stateJson.workflowStatus;
  return workflowStatus === "awaiting_user_clarification" ? "interrupted_for_input" : "running";
}

function checkpointTimestampIso(checkpoint: Checkpoint): string | null {
  const raw = checkpoint.ts;
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function parseEnvelope(stateJson: Json): PersistedCheckpointEnvelope | null {
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }

  const envelope = stateJson as Partial<PersistedCheckpointEnvelope>;
  if (!envelope.checkpoint || !envelope.pipelineState) {
    return null;
  }
  return envelope as PersistedCheckpointEnvelope;
}

export class SupabaseSessionCheckpointer extends BaseCheckpointSaver {
  constructor(private readonly client: DatabaseClient) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const sessionId = getThreadId(config);
    const { data: session, error } = await getProjectSessionById(this.client, sessionId);

    if (error) {
      throw new Error(`Failed to load project session ${sessionId}: ${error.message}`);
    }
    if (!session) {
      return undefined;
    }

    const envelope = parseEnvelope(session.state_json);
    if (!envelope) {
      return undefined;
    }

    const checkpoint = envelope.checkpoint as Checkpoint;
    const requestedCheckpointId = config.configurable?.checkpoint_id;
    if (requestedCheckpointId && checkpoint.id !== requestedCheckpointId) {
      return undefined;
    }

    const tupleConfig: RunnableConfig = {
      configurable: {
        thread_id: session.id,
        checkpoint_ns: config.configurable?.checkpoint_ns ?? "",
        checkpoint_id: checkpoint.id
      }
    };

    return {
      config: tupleConfig,
      checkpoint,
      metadata: envelope.metadata as CheckpointMetadata | undefined,
      parentConfig: envelope.parentConfig as RunnableConfig | undefined,
      pendingWrites: envelope.pendingWrites as CheckpointPendingWrite[] | undefined
    };
  }

  async *list(config: RunnableConfig, _options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const tuple = await this.getTuple(config);
    if (tuple) {
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: ChannelVersions
  ): Promise<RunnableConfig> {
    const sessionId = getThreadId(config);
    const { data: session, error } = await getProjectSessionById(this.client, sessionId);

    if (error) {
      throw new Error(`Failed to load project session ${sessionId}: ${error.message}`);
    }
    if (!session) {
      throw new Error(`Project session ${sessionId} was not found.`);
    }

    const parsedPipelineState = PipelineStateSchema.safeParse(checkpoint.channel_values);
    const pipelineState = parsedPipelineState.success
      ? parsedPipelineState.data
      : PipelineStateSchema.parse({
          projectId: session.project_id,
          sessionId: session.id,
          currentStage: session.current_stage,
          stateJson: {}
        });

    const previousEnvelope = parseEnvelope(session.state_json);
    const envelope: PersistedCheckpointEnvelope = {
      pipelineState,
      checkpoint,
      metadata,
      parentConfig: {
        configurable: {
          thread_id: session.id,
          checkpoint_ns: config.configurable?.checkpoint_ns ?? "",
          checkpoint_id: config.configurable?.checkpoint_id
        }
      },
      pendingWrites: previousEnvelope?.pendingWrites ?? []
    };

    const lastNode = getLastNodeFromMetadata(metadata);
    const nextGraphStatus = resolveGraphStatus(pipelineState.stateJson as Record<string, unknown>);
    const { error: updateError } = await updateProjectSessionById(this.client, sessionId, {
      current_stage: pipelineState.currentStage,
      graph_status: nextGraphStatus,
      last_node: lastNode,
      state_json: toJson(envelope)
    });

    if (updateError) {
      throw new Error(`Failed to persist checkpoint for session ${sessionId}: ${updateError.message}`);
    }

    const { error: historyError } = await insertLanggraphCheckpoint(this.client, {
      session_id: sessionId,
      checkpoint_id: checkpoint.id,
      checkpoint_ts: checkpointTimestampIso(checkpoint),
      pipeline_state_json: toJson(pipelineState)
    });
    if (historyError) {
      console.warn(
        `[SupabaseSessionCheckpointer] Failed to append langgraph_checkpoints row: ${historyError.message}`
      );
    }

    return {
      configurable: {
        thread_id: sessionId,
        checkpoint_ns: config.configurable?.checkpoint_ns ?? "",
        checkpoint_id: checkpoint.id
      }
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const sessionId = getThreadId(config);
    const { data: session, error } = await getProjectSessionById(this.client, sessionId);

    if (error) {
      throw new Error(`Failed to load project session ${sessionId}: ${error.message}`);
    }
    if (!session) {
      throw new Error(`Project session ${sessionId} was not found.`);
    }

    const envelope = parseEnvelope(session.state_json);
    if (!envelope) {
      return;
    }

    const pendingWrites = (envelope.pendingWrites as CheckpointPendingWrite[] | undefined) ?? [];
    const nextWrites: CheckpointPendingWrite[] = [
      ...pendingWrites,
      ...writes.map((write) => [taskId, ...write] as CheckpointPendingWrite)
    ];

    const { error: updateError } = await updateProjectSessionById(this.client, sessionId, {
      state_json: toJson({
        ...envelope,
        pendingWrites: nextWrites
      })
    });

    if (updateError) {
      throw new Error(`Failed to persist pending writes for session ${sessionId}: ${updateError.message}`);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const { error } = await updateProjectSessionById(this.client, threadId, {
      graph_status: "idle",
      last_node: null,
      state_json: {}
    });

    if (error) {
      throw new Error(`Failed to clear checkpoints for session ${threadId}: ${error.message}`);
    }
  }
}

