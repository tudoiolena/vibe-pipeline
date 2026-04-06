import { z } from "zod";
import { BriefSchema, PRDSchema, TechStackItemSchema, UIKitSchema } from "@vibe/schema";
import { getFigmaFileMetadata } from "@vibe/integrations";
import { type DatabaseClient } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import { createPipelineNode, type PipelineNode } from "./types";
import { readBriefFromState, PrdRecoveryFieldsSchema } from "./intake";
import { resolveFigmaFileKeyFromProject } from "./shared/figma-project-key";
import { persistPrdArtifact, persistUIKitArtifact } from "./shared/persistence";
import { deriveUIKitFromFigmaMetadata } from "./shared/figma-utils";

function prdMissingCriticalFields(prd: z.infer<typeof PRDSchema>): boolean {
  return prd.productOverview.trim().length === 0 || prd.architectureFlow.length === 0;
}

/** Structured output often drops optional-looking arrays; spec export needs these lists populated. */
function prdHandoffListsIncomplete(prd: z.infer<typeof PRDSchema>): boolean {
  return (
    prd.techStack.length === 0 ||
    prd.assumptions.length === 0 ||
    prd.risks.length === 0 ||
    prd.scopeSummary.length === 0
  );
}

const PrdHandoffAssumptionSchema = z.object({
  description: z.string().min(1),
  mitigation: z.string().min(1)
});
const PrdHandoffRiskSchema = z.object({
  description: z.string().min(1),
  impact: z.string().min(1)
});
const PrdHandoffSectionsSchema = z.object({
  techStack: z.array(TechStackItemSchema).min(1),
  assumptions: z.array(PrdHandoffAssumptionSchema).min(3),
  risks: z.array(PrdHandoffRiskSchema).min(3),
  scopeSummary: z.array(z.string().min(1)).min(1)
});

async function fillPrdHandoffLists(
  brief: z.infer<typeof BriefSchema>,
  draft: z.infer<typeof PRDSchema>
): Promise<z.infer<typeof PrdHandoffSectionsSchema>> {
  const fillModel = getAnthropicIntelligenceModel().withStructuredOutput(PrdHandoffSectionsSchema);
  const raw = await fillModel.invoke(
    [
      "You are PrdSectionFill. The PRD draft has empty techStack, assumptions, risks, and/or scopeSummary arrays.",
      "Output product-specific values grounded ONLY in the brief and the draft PRD (overview, goals, stories, functional requirements).",
      "",
      "- techStack: at least 3 items; distinct categories (e.g. frontend, backend, data, payments). Field `color` is a short UI role label (e.g. primary, accent) — not invented hex.",
      "- assumptions: at least 3 entries with description and mitigation.",
      "- risks: at least 3 entries with description and impact.",
      "- scopeSummary: at least 2 MVP scope bullets (in/out or boundaries).",
      "",
      "Brief JSON:",
      JSON.stringify(brief, null, 2),
      "",
      "PRD draft JSON:",
      JSON.stringify(draft, null, 2)
    ].join("\n")
  );
  return PrdHandoffSectionsSchema.parse(raw);
}

function readFigmaLinkVerified(stateJson: Record<string, unknown>): boolean {
  return stateJson.figmaLinkVerified === true;
}

async function recoverPrdOverviewAndFlow(
  brief: z.infer<typeof BriefSchema>,
  invalidOrPartialDraftJson: string
): Promise<z.infer<typeof PrdRecoveryFieldsSchema>> {
  const recoveryModel = getAnthropicIntelligenceModel().withStructuredOutput(PrdRecoveryFieldsSchema);
  return recoveryModel.invoke(
    ["You are PrdRecovery.", "Brief JSON:", JSON.stringify(brief, null, 2), "Invalid draft:", invalidOrPartialDraftJson].join("\n")
  );
}

export function createPrdDesignerNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("prdDesigner", async (state) => {
    const brief = readBriefFromState(state);
    const stateJson = state.stateJson as Record<string, unknown>;
    const figmaKey = await resolveFigmaFileKeyFromProject(client, state.projectId);
    const figmaVerified = readFigmaLinkVerified(stateJson);

    let figmaUiKitBlock = "";
    let persistedUIKit: z.infer<typeof UIKitSchema> | undefined;

    if (figmaKey && figmaVerified) {
      try {
        console.log("[figma] prdDesigner: getFigmaFileMetadata + deriveUIKit", { fileKey: figmaKey });
        const metadata = await getFigmaFileMetadata(figmaKey);
        console.log("[figma] prdDesigner: raw metadata summary", {
          fileKey: metadata.fileKey,
          fileName: metadata.fileName,
          styleCount: metadata.styles.length,
          componentCount: metadata.components.length,
          uiKitExtraction: metadata.uiKitExtraction ?? null,
          frameAnalysis: metadata.frameAnalysis
        });
        const kit = deriveUIKitFromFigmaMetadata(metadata);
        console.log("[figma] prdDesigner: UIKit for PRD prompt", {
          colorCount: kit.colorPalette.length,
          typographyCount: kit.typography.length,
          componentCount: kit.componentInventory.length,
          figmaExtraction: kit.figmaExtraction
        });
        persistedUIKit = kit;
        figmaUiKitBlock = [
          "### Figma-derived UI Kit (authoritative)",
          "This file was verified reachable in an earlier pipeline step. Use the JSON below as design truth.",
          "- Ground functionalRequirements titles and details in named components, frames, and tokens you can justify from componentInventory, colorPalette, and typography.",
          "- techStack entries must name real font families and color roles when they appear below (no placeholder category like TBD for values present in this JSON).",
          "",
          JSON.stringify(kit, null, 2)
        ].join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`PRD designer: Figma file was verified but could not be read for UI kit extraction: ${message}`);
      }
    } else if (figmaKey && !figmaVerified) {
      figmaUiKitBlock = [
        "### Figma",
        "A Figma URL or file key appeared in the brief, but the file was not verified as accessible. Do NOT invent hex codes, font families, or component names from Figma.",
        "Describe UI requirements in product terms and recommend a conventional stack (e.g. React, Tailwind, shadcn/ui) without claiming measured tokens from a file you did not read."
      ].join("\n");
      console.log("[figma] prdDesigner: file key present but not verified — no UI kit block");
    } else {
      console.log("[figma] prdDesigner: no file key — no-Figma mode");
      figmaUiKitBlock = [
        "### No Figma design file",
        "Generate requirements for a clean, modern UI using conventional patterns (e.g. React with Tailwind CSS and shadcn/ui-style components).",
        "Do not invent specific design tokens (exact hex, px, or font files). Describe visual intent at the product level (hierarchy, density, accessibility)."
      ].join("\n");
    }

    const summaryLine = brief.summary.trim();
    const model = getAnthropicIntelligenceModel().withStructuredOutput(PRDSchema);
    const prdOutput = await model.invoke(
      [
        "You are a Senior Product Manager (PrdDesigner).",
        "Transform the Brief into a comprehensive, implementation-ready PRD.",
        "",
        "### PRODUCT CONTEXT (non-negotiable)",
        `The product is defined by brief.summary and the rest of the brief. Every goal, user story, functional requirement, and risk must be specific to THIS domain — not a generic template.`,
        `brief.summary (anchor): ${summaryLine}`,
        "",
        "### PLATFORM & STACK",
        "Infer platforms and integrations from the brief (e.g. Shopify, Supabase, Remix, Stripe). techStack must list concrete technologies with meaningful categories (frontend, backend, commerce, data, etc.) — never use a single vague TBD row.",
        "functionalRequirements must reflect the same business domain as the brief.",
        "",
        "### MANDATORY SHAPE",
        "1. USER STORIES: At least 5–8 detailed user stories; ids like US-1, US-2, …",
        "2. ASSUMPTIONS & RISKS: At least 3–5 each, specific to this product.",
        "3. FUNCTIONAL REQUIREMENTS: Core features explicit; when UI Kit JSON is provided above, tie FRs to observed components/tokens.",
        "4. architectureFlow: use pipeline stages as appropriate: intake, clarify, prd, tasks, design_sync, handoff, export.",
        "",
        figmaUiKitBlock,
        "",
        "Brief JSON:",
        JSON.stringify(brief, null, 2)
      ].join("\n")
    );

    const firstParsed = PRDSchema.safeParse(prdOutput);
    if (!firstParsed.success) {
      const issues = firstParsed.error.flatten();
      throw new Error(`PRD designer: LLM output failed PRD schema validation: ${JSON.stringify(issues)}`);
    }

    let prd: z.infer<typeof PRDSchema>;
    if (!prdMissingCriticalFields(firstParsed.data)) {
      prd = firstParsed.data;
    } else {
      const recovery = await recoverPrdOverviewAndFlow(brief, JSON.stringify(firstParsed.data));
      const merged = {
        ...firstParsed.data,
        productOverview: recovery.productOverview,
        architectureFlow: recovery.architectureFlow
      };
      const recovered = PRDSchema.safeParse(merged);
      if (!recovered.success) {
        throw new Error(
          `PRD designer: recovery merge failed PRD schema validation: ${JSON.stringify(recovered.error.flatten())}`
        );
      }
      prd = recovered.data;
    }

    if (prdHandoffListsIncomplete(prd)) {
      const fill = await fillPrdHandoffLists(brief, prd);
      const merged = {
        ...prd,
        techStack: prd.techStack.length > 0 ? prd.techStack : fill.techStack,
        assumptions: prd.assumptions.length > 0 ? prd.assumptions : fill.assumptions,
        risks: prd.risks.length > 0 ? prd.risks : fill.risks,
        scopeSummary: prd.scopeSummary.length > 0 ? prd.scopeSummary : fill.scopeSummary
      };
      const reparsed = PRDSchema.safeParse(merged);
      if (!reparsed.success) {
        throw new Error(
          `PRD designer: handoff section fill merge failed validation: ${JSON.stringify(reparsed.error.flatten())}`
        );
      }
      prd = reparsed.data;
    }

    const persisted = await persistPrdArtifact(
      client,
      state,
      prd,
      persistedUIKit ? { uiKit: persistedUIKit } : undefined
    );
    if (persistedUIKit) {
      await persistUIKitArtifact(client, state, persistedUIKit);
    }
    return {
      currentStage: "prd",
      stateJson: {
        ...state.stateJson,
        prd,
        prdArtifactId: persisted.id,
        prdArtifactVersion: persisted.version,
        ...(persistedUIKit ? { uiKit: persistedUIKit } : {}),
        route: "prd_designed",
        workflowStatus: "prd_generated"
      }
    };
  });
}
