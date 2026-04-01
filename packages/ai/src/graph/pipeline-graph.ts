import type { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import type { DatabaseClient } from "@vibe/database";
import { SupabaseSessionCheckpointer } from "./checkpointer";
import {
  createApplyClarificationNode,
  createGapDetectorNode,
  createIntakeNormalizerNode,
  createNeedsClarificationNode,
  createPrdDesignerNode
} from "./nodes";
import { PipelineStateSchema, type PipelineState } from "./state";

export const PIPELINE_CHECKPOINT_NAMESPACE = "pipeline";

export function createPipelineGraph(client: DatabaseClient) {
  const checkpointer = new SupabaseSessionCheckpointer(client);
  const intakeNormalizerNode = createIntakeNormalizerNode(client);
  const gapDetectorNode = createGapDetectorNode();
  const needsClarificationNode = createNeedsClarificationNode(client);
  const applyClarificationNode = createApplyClarificationNode();
  const prdDesignerNode = createPrdDesignerNode(client);

  const graph = new StateGraph(PipelineStateSchema)
    .addNode("intakeNormalizer", intakeNormalizerNode)
    .addNode("gapDetector", gapDetectorNode)
    .addNode("needsClarification", needsClarificationNode)
    .addNode("applyClarification", applyClarificationNode)
    .addNode("prdDesigner", prdDesignerNode)
    .addEdge(START, "intakeNormalizer")
    .addEdge("intakeNormalizer", "gapDetector")
    .addConditionalEdges("gapDetector", (state: PipelineState) => {
      const stateJson = state.stateJson as Record<string, unknown>;
      const needsClarification = stateJson.needsClarification === true;
      return needsClarification ? "needsClarification" : "prdDesigner";
    })
    .addEdge("needsClarification", END)
    .addEdge("applyClarification", "gapDetector")
    .addEdge("prdDesigner", END)
    .compile({
      checkpointer,
      name: "vibe-pipeline-core",
      description:
        "Intake normalization, gap detection, PRD generation (PrdDesigner), and clarification loop with Supabase checkpoint persistence."
    });

  return {
    graph,
    checkpointer
  };
}

export function createSessionConfig(sessionId: string, checkpointId?: string): RunnableConfig {
  return {
    configurable: {
      thread_id: sessionId,
      checkpoint_ns: PIPELINE_CHECKPOINT_NAMESPACE,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {})
    }
  };
}

