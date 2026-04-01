import { withLangGraph } from "@langchain/langgraph/zod";
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

function isStateJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shallow merge so concurrent node updates to `stateJson` (e.g. `workflowStatus`) combine; right-hand keys win on overlap. */
function mergeStateJson(left: unknown, right: unknown): Record<string, unknown> {
  return {
    ...(isStateJsonRecord(left) ? left : {}),
    ...(isStateJsonRecord(right) ? right : {})
  };
}

const currentStageWithReducer = withLangGraph(PipelineStageSchema, {
  reducer: { fn: (_a: string, b: string) => b, schema: PipelineStageSchema }
});

const stateJsonWithReducer = withLangGraph(z.record(z.unknown()), {
  reducer: { fn: mergeStateJson, schema: z.record(z.unknown()) },
  default: () => ({})
});

export const PipelineStateSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  /** Last-write-wins reducer avoids INVALID_CONCURRENT_GRAPH_UPDATE when multiple updates touch stage. */
  currentStage: currentStageWithReducer as z.ZodType<z.infer<typeof PipelineStageSchema>>,
  /**
   * Shallow-merge reducer: concurrent partial `stateJson` updates (including `workflowStatus`) merge safely.
   */
  stateJson: stateJsonWithReducer as z.ZodType<Record<string, unknown>>
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
