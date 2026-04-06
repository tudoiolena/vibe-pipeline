import { z } from "zod";
import { mapFigmaFileToDesignMap } from "@vibe/integrations";
import { DesignMapSchema, PRDSchema } from "@vibe/schema";
import type { DatabaseClient } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import { createPipelineNode, type PipelineNode } from "./types";
import { DesignAnalysisOutputSchema } from "./intake";
import {
  persistDesignMapArtifact,
  persistUIKitArtifact,
  syncDesignTaskLinks,
  syncPipelineEntity
} from "./shared/persistence";
import {
  buildConstitutionFallbackUIKit,
  deriveUIKitFromFigmaMetadata,
  resolveFigmaMetadataForDesignAnalysis
} from "./shared/figma-utils";

export function createDesignAnalysisNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("designAnalysis", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd ?? stateJson);
    let metadata;
    try {
      console.log("[figma] designAnalysis: resolving metadata", {
        hasEmbeddedMetadata: Boolean(stateJson.figmaFileMetadata),
        figmaFileKey: typeof stateJson.figmaFileKey === "string" ? stateJson.figmaFileKey : null
      });
      metadata = await resolveFigmaMetadataForDesignAnalysis(stateJson);
      console.log("[figma] designAnalysis: metadata ready", {
        fileKey: metadata.fileKey,
        fileName: metadata.fileName,
        styleCount: metadata.styles.length,
        componentCount: metadata.components.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[figma] designAnalysis: metadata resolution failed", { message });
      const emptyMap = DesignMapSchema.parse({ nodes: [], links: [] });
      const fallbackKit = buildConstitutionFallbackUIKit();
      await persistDesignMapArtifact(client, state, emptyMap);
      await persistUIKitArtifact(client, state, fallbackKit);
      return {
        currentStage: "design_sync",
        stateJson: {
          ...state.stateJson,
          designMap: emptyMap,
          uiKit: fallbackKit,
          designAnalysisError: message,
          workflowStatus: "design_analysis_failed"
        }
      };
    }
    const baseMap = mapFigmaFileToDesignMap(metadata);
    const uiKit = deriveUIKitFromFigmaMetadata(metadata);
    console.log("[figma] designAnalysis: designMap + uiKit counts", {
      designMapNodeCount: baseMap.nodes.length,
      uiKitColors: uiKit.colorPalette.length,
      uiKitTypography: uiKit.typography.length,
      uiKitComponents: uiKit.componentInventory.length
    });
    const nodeIds = new Set(baseMap.nodes.map((n) => n.nodeId));
    const storyIds = new Set(prd.userStories.map((s) => s.id));
    const screens = baseMap.nodes.filter((n) => n.nodeType === "screen");
    const components = baseMap.nodes.filter((n) => n.nodeType === "component" || n.nodeType === "variant");
    let analysis: z.infer<typeof DesignAnalysisOutputSchema>;
    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(DesignAnalysisOutputSchema);
      const output = await model.invoke(
        [
          "You are DesignAnalysis.",
          "Figma screens:",
          JSON.stringify(screens.map((n) => ({ nodeId: n.nodeId, nodeName: n.nodeName })), null, 2),
          "Components:",
          JSON.stringify(components.map((n) => ({ nodeId: n.nodeId, nodeName: n.nodeName })), null, 2),
          "PRD user stories:",
          JSON.stringify(prd.userStories, null, 2)
        ].join("\n")
      );
      analysis = DesignAnalysisOutputSchema.parse(output);
    } catch {
      analysis = { links: [], rationale: ["LLM invocation unavailable; no design-to-story links generated."], tokenization: [] };
    }
    const filteredLinks = analysis.links.filter((link) => nodeIds.has(link.nodeId) && storyIds.has(link.taskExternalKey));
    console.log("[figma] designAnalysis: full designMap JSON", JSON.stringify(baseMap, null, 2));
    console.log("[figma] designAnalysis: full uiKit JSON", JSON.stringify(uiKit, null, 2));
    await syncPipelineEntity(client, {
      kind: "design_nodes",
      sessionId: state.sessionId,
      projectId: state.projectId,
      uiKit
    });
    await syncDesignTaskLinks(client, state.sessionId, filteredLinks);
    const finalDesignMap = DesignMapSchema.parse({ nodes: baseMap.nodes, links: filteredLinks });
    await persistDesignMapArtifact(client, state, finalDesignMap);
    await persistUIKitArtifact(client, state, uiKit);
    return {
      currentStage: "design_sync",
      stateJson: {
        ...state.stateJson,
        designMap: finalDesignMap,
        uiKit,
        designAnalysisRationale: analysis.rationale,
        designTokenization: analysis.tokenization,
        workflowStatus: "design_analyzed"
      }
    };
  });
}
