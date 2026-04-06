import type { RunnableConfig } from "@langchain/core/runnables";
import { END, START, StateGraph } from "@langchain/langgraph";
import type { DatabaseClient } from "@vibe/database";
import { SupabaseSessionCheckpointer } from "./checkpointer";
import {
  createApplyClarificationNode,
  createDesignAnalysisNode,
  createGapDetectorNode,
  createImplementationPlannerNode,
  createIntakeNormalizerNode,
  createNeedsClarificationNode,
  createPrdDesignerNode,
  createTaskGeneratorNode
} from "./nodes";
import { PipelineStateSchema, type PipelineState } from "./state";

export const PIPELINE_CHECKPOINT_NAMESPACE = "pipeline";

export function createPipelineGraph(client: DatabaseClient) {
  const checkpointer = new SupabaseSessionCheckpointer(client);
  const intakeNormalizerNode = createIntakeNormalizerNode(client);
  const gapDetectorNode = createGapDetectorNode(client);
  const needsClarificationNode = createNeedsClarificationNode(client);
  const applyClarificationNode = createApplyClarificationNode(client);
  const prdDesignerNode = createPrdDesignerNode(client);
  const taskGeneratorNode = createTaskGeneratorNode(client);
  const implementationPlannerNode = createImplementationPlannerNode(client);
  const designAnalysisNode = createDesignAnalysisNode(client);

  const graph = new StateGraph(PipelineStateSchema)
    .addNode("intakeNormalizer", intakeNormalizerNode)
    .addNode("gapDetector", gapDetectorNode)
    .addNode("needsClarification", needsClarificationNode)
    .addNode("applyClarification", applyClarificationNode)
    .addNode("prdDesigner", prdDesignerNode)
    .addNode("taskGenerator", taskGeneratorNode)
    .addNode("implementationPlanner", implementationPlannerNode)
    .addNode("designAnalysis", designAnalysisNode)
    .addEdge(START, "intakeNormalizer")
    .addEdge("intakeNormalizer", "gapDetector")
    .addConditionalEdges("gapDetector", (state: PipelineState) => {
      const stateJson = state.stateJson as Record<string, unknown>;
      const needsClarification = stateJson.needsClarification === true;
      return needsClarification ? "needsClarification" : "prdDesigner";
    })
    .addEdge("needsClarification", END)
    .addEdge("applyClarification", "gapDetector")
    .addEdge("prdDesigner", "taskGenerator")
    .addConditionalEdges("taskGenerator", (state: PipelineState) => {
      const stateJson = state.stateJson as Record<string, unknown>;
      const key = stateJson.figmaFileKey;
      const hasFigmaFileKey = typeof key === "string" && key.trim().length > 0;
      return hasFigmaFileKey ? "designAnalysis" : "implementationPlanner";
    })
    .addEdge("designAnalysis", "implementationPlanner")
    .addEdge("implementationPlanner", END)
    .compile({
      checkpointer,
      name: "vibe-pipeline-core",
      description:
        "Intake normalization, clarification loop, PRD generation, task generation, implementation handoff generation, and optional Figma design analysis."
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

