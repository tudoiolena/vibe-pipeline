import { z } from "zod";

export const PipelineStageSchema = z.enum([
  "intake",
  "analysis",
  "clarify",
  "prd",
  "tasks",
  "design_sync",
  "handoff",
  "export"
]);

export const PipelineStateSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  currentStage: PipelineStageSchema,
  stateJson: z.record(z.unknown()).default({})
});

export const PipelineStateUpdateSchema = PipelineStateSchema.partial();

export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema>;
export type PipelineStateUpdate = z.infer<typeof PipelineStateUpdateSchema>;

export type PersistedCheckpointEnvelope = {
  pipelineState: PipelineState;
  checkpoint: unknown;
  metadata?: unknown;
  parentConfig?: unknown;
  pendingWrites?: unknown;
};

