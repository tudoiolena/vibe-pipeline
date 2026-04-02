import { z } from "zod";
import { BriefSchema, DesignTaskRelationSchema, StageSchema } from "@vibe/schema";
import { extractFigmaFileKeyFromUrl, verifyFigmaDesignAccessible } from "@vibe/integrations";
import { type DatabaseClient, updateProjectSessionById } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import type { PipelineState } from "../state";
import { createPipelineNode, type PipelineNode } from "./types";
import { appendClarificationTimelineEvent, persistBriefArtifact, syncPipelineEntity } from "./shared/persistence";

const RawIntakeSourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

const GapPrioritySchema = z.enum(["High", "Med", "Low"]);
const GapTypeSchema = z.enum(["NFR", "Security", "Scale", "Business Logic"]);
const GapDetectionOutputSchema = z.object({
  gaps: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        priority: GapPrioritySchema,
        type: GapTypeSchema
      })
    )
    .default([]),
  rationale: z.array(z.string().min(1)).default([])
});

export const DesignStoryMappingLinkSchema = z.object({
  nodeId: z.string().min(1),
  taskExternalKey: z.string().min(1),
  relationType: DesignTaskRelationSchema,
  confidenceScore: z.number().min(0).max(1),
  evidence: z.record(z.unknown()).default({})
});

export const DesignTokenizationEntrySchema = z.object({
  figmaName: z.string().min(1),
  tailwindVariable: z.string().min(1),
  category: z.enum(["Colors", "Typography", "Spacing", "Effects", "Radii"]),
  value: z.string().min(1).optional(),
  source: z.string().min(1).optional()
});

export const DesignAnalysisOutputSchema = z.object({
  links: z.array(DesignStoryMappingLinkSchema).default([]),
  rationale: z.array(z.string().min(1)).default([]),
  tokenization: z.array(DesignTokenizationEntrySchema).default([])
});

const SecurityRequirementKeywords = [
  "auth",
  "authentication",
  "authorization",
  "roles",
  "permissions",
  "session",
  "security",
  "privacy",
  "encryption",
  "compliance",
  "sso",
  "mfa",
  "2fa",
  "token"
] as const;
const ScaleRequirementKeywords = [
  "scale",
  "scaling",
  "concurrency",
  "throughput",
  "latency",
  "response time",
  "performance",
  "sla",
  "availability",
  "reliability",
  "load",
  "traffic",
  "peak"
] as const;

function peekRawIntakeText(state: PipelineState): string | null {
  const stateJson = state.stateJson as Record<string, unknown>;
  const rawCandidates = [stateJson.rawIntakeText, stateJson.intakeText, stateJson.rawBrief, stateJson.inputText];
  for (const candidate of rawCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function readRawIntakeText(state: PipelineState): string {
  const trimmed = peekRawIntakeText(state);
  if (trimmed) {
    return trimmed;
  }
  throw new Error(
    "IntakeNormalizer requires raw intake text in stateJson.rawIntakeText (or intakeText/rawBrief/inputText)."
  );
}

function readRawSourceLinks(state: PipelineState): z.infer<typeof RawIntakeSourceLinkSchema>[] {
  const stateJson = state.stateJson as Record<string, unknown>;
  const candidate = stateJson.sourceLinks ?? stateJson.intakeSourceLinks;
  const parsed = z.array(RawIntakeSourceLinkSchema).safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

function buildFallbackBrief(
  rawIntakeText: string,
  sourceLinks: z.infer<typeof RawIntakeSourceLinkSchema>[]
): z.infer<typeof BriefSchema> {
  const normalizedName = rawIntakeText
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .trim();
  return {
    name: normalizedName.length > 0 ? normalizedName : "Untitled Product",
    summary: rawIntakeText,
    problem: [rawIntakeText],
    goal: "Clarify the request and shape it into an implementation-ready product plan.",
    targetAudience: ["TBD"],
    businessValue: ["TBD"],
    keyUserScenarios: ["Define core user journey from intake brief."],
    mvpFocus: ["Capture a minimal, validated scope before PRD drafting."],
    sourceLinks
  };
}

function briefText(brief: z.infer<typeof BriefSchema>): string {
  return [
    brief.name,
    brief.summary,
    brief.goal,
    ...brief.problem,
    ...brief.targetAudience,
    ...brief.businessValue,
    ...brief.keyUserScenarios,
    ...brief.mvpFocus
  ]
    .join(" ")
    .toLowerCase();
}

function includesKeyword(haystack: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function hasFigmaUrlInSourceLinks(sourceLinks: z.infer<typeof BriefSchema>["sourceLinks"]): boolean {
  return sourceLinks.some((link) => {
    const url = link.url.trim().toLowerCase();
    return url.includes("figma.com");
  });
}

function hasProvidedFigmaDesign(state: PipelineState, brief: z.infer<typeof BriefSchema>): boolean {
  const stateJson = state.stateJson as Record<string, unknown>;
  const figmaFileKey =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0 ? stateJson.figmaFileKey.trim() : null;
  return Boolean(figmaFileKey) || hasFigmaUrlInSourceLinks(brief.sourceLinks);
}

/** Resolves Figma file key from session or first figma.com source link (authorized REST / MCP-equivalent reads). */
export function resolveFigmaFileKeyForPipeline(state: PipelineState, brief: z.infer<typeof BriefSchema>): string | null {
  const stateJson = state.stateJson as Record<string, unknown>;
  const fromState =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0 ? stateJson.figmaFileKey.trim() : null;
  if (fromState) {
    console.log("[figma] resolveFigmaFileKeyForPipeline", { source: "stateJson.figmaFileKey", fileKey: fromState });
    return fromState;
  }
  const figmaLink = brief.sourceLinks.find((link) => link.url.toLowerCase().includes("figma.com"));
  if (!figmaLink) {
    return null;
  }
  const extracted = extractFigmaFileKeyFromUrl(figmaLink.url);
  console.log("[figma] resolveFigmaFileKeyForPipeline", {
    source: "brief.sourceLinks",
    fileKey: extracted,
    urlPreview: figmaLink.url.slice(0, 120),
    parseOk: Boolean(extracted)
  });
  return extracted;
}

function normalizePrimaryFigmaSourceLink(
  brief: z.infer<typeof BriefSchema>,
  rawIntakeText: string,
  fallbackSourceLinks: z.infer<typeof RawIntakeSourceLinkSchema>[]
): z.infer<typeof BriefSchema> {
  const mergedLinks = [...brief.sourceLinks];
  const figmaLinks = mergedLinks.filter((link) => link.url.toLowerCase().includes("figma.com"));
  const rawTextFigmaMatch = rawIntakeText.match(/https?:\/\/(?:www\.)?figma\.com\/[^\s)]+/i);
  if (figmaLinks.length === 0 && rawTextFigmaMatch) {
    mergedLinks.push({ label: "Primary Figma Design", url: rawTextFigmaMatch[0], type: "design" });
  }
  if (figmaLinks.length === 0 && !rawTextFigmaMatch) {
    const fallbackFigma = fallbackSourceLinks.find((link) => link.url.toLowerCase().includes("figma.com"));
    if (fallbackFigma) {
      mergedLinks.push({ ...fallbackFigma, label: "Primary Figma Design", type: fallbackFigma.type ?? "design" });
    }
  }
  let relabeled = false;
  const normalizedLinks = mergedLinks.map((link) => {
    if (relabeled || !link.url.toLowerCase().includes("figma.com")) {
      return link;
    }
    relabeled = true;
    return { ...link, label: "Primary Figma Design", type: link.type ?? "design" };
  });
  return { ...brief, sourceLinks: normalizedLinks };
}

function removeInvalidMissingFigmaGap(
  analysis: z.infer<typeof GapDetectionOutputSchema>,
  figmaProvided: boolean
): z.infer<typeof GapDetectionOutputSchema> {
  if (!figmaProvided) {
    return analysis;
  }
  const gaps = analysis.gaps.filter((gap) => {
    const title = gap.title.toLowerCase();
    const description = gap.description.toLowerCase();
    return !(title.includes("missing figma") || (title.includes("figma") && description.includes("missing")));
  });
  return { ...analysis, gaps };
}

const RESOLVED_DESIGN_GAP_TITLE = /missing design spec|design specifications|brand guidelines/i;

function applyFigmaDesignTruthToGaps(
  analysis: z.infer<typeof GapDetectionOutputSchema>,
  figmaReadOk: boolean
): z.infer<typeof GapDetectionOutputSchema> {
  if (!figmaReadOk) {
    return analysis;
  }
  const gaps = analysis.gaps.filter((gap) => {
    const title = gap.title;
    if (RESOLVED_DESIGN_GAP_TITLE.test(title)) {
      return false;
    }
    const tl = title.toLowerCase();
    return !tl.includes("brand guideline") && !tl.includes("missing design specification");
  });
  const downgraded = gaps.map((gap) => {
    const lower = `${gap.title} ${gap.description}`.toLowerCase();
    const speculativeDesignHigh =
      gap.priority === "High" &&
      gap.type === "NFR" &&
      (lower.includes("missing design") || lower.includes("design spec") || lower.includes("brand guideline"));
    if (speculativeDesignHigh) {
      return { ...gap, priority: "Med" as const };
    }
    return gap;
  });
  return {
    gaps: downgraded,
    rationale: [
      ...analysis.rationale,
      "Figma file validated via authorized read (constitution VI / MCP-equivalent); missing design-spec and brand-guideline gaps treated as resolved."
    ]
  };
}

function ensureConstitutionGapCoverage(
  brief: z.infer<typeof BriefSchema>,
  analysis: z.infer<typeof GapDetectionOutputSchema>,
  options?: { figmaDesignTruthAvailable?: boolean }
): z.infer<typeof GapDetectionOutputSchema> {
  const normalized = { gaps: [...analysis.gaps], rationale: [...analysis.rationale] };
  const lowerText = briefText(brief);
  const lowRiskMarketingSurface =
    lowerText.includes("landing page") || lowerText.includes("landing") || lowerText.includes("visit card");
  const defaultPriority: z.infer<typeof GapPrioritySchema> = lowRiskMarketingSurface ? "Low" : "High";
  if (!includesKeyword(lowerText, SecurityRequirementKeywords) && !normalized.gaps.some((gap) => gap.type === "Security")) {
    normalized.gaps.push({
      title: "Security baseline is unspecified",
      description:
        "Authentication/authorization, data protection, and secret handling requirements are missing. Define baseline security controls before architecture decisions.",
      priority: defaultPriority,
      type: "Security"
    });
    normalized.rationale.push(
      lowRiskMarketingSurface
        ? "Defaulted security requirement priority to Low for landing-page/visit-card scope."
        : "Constitutional requirement: explicit security constraints are required before PRD progression."
    );
  }
  if (!includesKeyword(lowerText, ScaleRequirementKeywords) && !normalized.gaps.some((gap) => gap.type === "Scale")) {
    normalized.gaps.push({
      title: "Scale expectations are undefined",
      description:
        "Expected traffic, peak concurrency, and performance targets are missing. Define scale constraints to size architecture and infrastructure correctly.",
      priority: defaultPriority,
      type: "Scale"
    });
    normalized.rationale.push(
      lowRiskMarketingSurface
        ? "Defaulted scale requirement priority to Low for landing-page/visit-card scope."
        : "Constitutional requirement: explicit scalability/performance expectations are required before PRD progression."
    );
  }
  if (options?.figmaDesignTruthAvailable) {
    normalized.rationale.push(
      "Figma design truth available: constitution VI — do not block on High-priority speculative design gaps; security/scale baselines above still apply."
    );
  }
  return normalized;
}

export function readBriefFromState(state: PipelineState): z.infer<typeof BriefSchema> {
  const stateJson = state.stateJson as Record<string, unknown>;
  const parsed = BriefSchema.safeParse(stateJson.brief);
  if (parsed.success) {
    return parsed.data;
  }
  const raw = peekRawIntakeText(state);
  if (raw) {
    console.warn("[readBriefFromState] stateJson.brief invalid; falling back to synthetic brief.");
    return buildFallbackBrief(raw, readRawSourceLinks(state));
  }
  throw new Error(
    "Pipeline node requires stateJson.brief or raw intake text (rawIntakeText, intakeText, rawBrief, inputText)."
  );
}

export const PrdRecoveryFieldsSchema = z.object({
  productOverview: z.string().min(1),
  architectureFlow: z.array(StageSchema).min(1)
});

export function createIntakeNormalizerNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("intakeNormalizer", async (state) => {
    const rawIntakeText = readRawIntakeText(state);
    const sourceLinks = readRawSourceLinks(state);
    let brief: z.infer<typeof BriefSchema>;
    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(BriefSchema);
      const briefOutput = await model.invoke(
        [
          "You are IntakeNormalizer.",
          "Transform the raw intake text into a valid brief.",
          "CRITICAL: Detect Figma URLs both in the intake text and in provided source links.",
          "If any Figma URL exists, include it in sourceLinks and set its label exactly to: 'Primary Figma Design'.",
          "Do not drop existing non-Figma source links.",
          "",
          "Raw Intake:",
          rawIntakeText,
          "Provided Source Links:",
          JSON.stringify(sourceLinks, null, 2)
        ].join("\n")
      );
      brief = normalizePrimaryFigmaSourceLink(BriefSchema.parse(briefOutput), rawIntakeText, sourceLinks);
    } catch (error) {
      console.warn(`[intakeNormalizer] Falling back to deterministic normalization: ${String(error)}`);
      brief = normalizePrimaryFigmaSourceLink(buildFallbackBrief(rawIntakeText, sourceLinks), rawIntakeText, sourceLinks);
    }
    const persisted = await persistBriefArtifact(client, state, brief);
    return {
      currentStage: "intake",
      stateJson: {
        ...state.stateJson,
        brief,
        briefArtifactId: persisted.id,
        briefArtifactVersion: persisted.version,
        workflowStatus: "brief_normalized"
      }
    };
  });
}

export function createGapDetectorNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("gapDetector", async (state) => {
    const brief = readBriefFromState(state);
    const figmaKey = resolveFigmaFileKeyForPipeline(state, brief);
    let figmaLinkVerified = false;
    let figmaVerificationError: string | undefined;
    if (figmaKey) {
      console.log("[figma] gapDetector: verifying design accessible", { fileKey: figmaKey });
      try {
        const verification = await verifyFigmaDesignAccessible(figmaKey);
        figmaLinkVerified = verification.ok;
        figmaVerificationError = verification.error;
        console.log("[figma] gapDetector: verification result", { ok: figmaLinkVerified, error: figmaVerificationError });
      } catch (error) {
        figmaVerificationError = error instanceof Error ? error.message : String(error);
        figmaLinkVerified = false;
        console.log("[figma] gapDetector: verification threw", { error: figmaVerificationError });
      }
    }
    let gapAnalysis: z.infer<typeof GapDetectionOutputSchema>;
    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(GapDetectionOutputSchema);
      const figmaValidationSection = figmaKey
        ? [
            "## Figma link validation (authorized design-truth read, constitution VI)",
            `Resolved file key: ${figmaKey}`,
            figmaLinkVerified
              ? "Result: SUCCESS — file is reachable; treat Missing Design Specifications and Brand Guidelines as satisfied."
              : `Result: FAILED — ${figmaVerificationError ?? "unknown error"}. You may emit a Med/Low gap about fixing the link or token access.`,
            ""
          ].join("\n")
        : "No Figma file key could be resolved from the brief or session.\n\n";
      const gapAnalysisOutput = await model.invoke([
        "You are GapDetector.",
        "Check the Brief for missing info.",
        "IMPORTANT: If sourceLinks has any figma.com URL, do NOT output a gap about missing Figma/design specifications.",
        "If Figma validation above is SUCCESS, do NOT output gaps for Missing Design Specifications or Brand Guidelines.",
        "",
        figmaValidationSection,
        "Brief JSON:",
        JSON.stringify(brief, null, 2)
      ].join("\n"));
      gapAnalysis = ensureConstitutionGapCoverage(brief, GapDetectionOutputSchema.parse(gapAnalysisOutput), {
        figmaDesignTruthAvailable: figmaLinkVerified
      });
      gapAnalysis = removeInvalidMissingFigmaGap(gapAnalysis, hasProvidedFigmaDesign(state, brief));
      gapAnalysis = applyFigmaDesignTruthToGaps(gapAnalysis, figmaLinkVerified);
    } catch (error) {
      console.warn(`[gapDetector] Falling back to deterministic gap analysis: ${String(error)}`);
      gapAnalysis = ensureConstitutionGapCoverage(
        brief,
        {
          gaps: [],
          rationale: ["Fallback gap analysis used because external model invocation was unavailable."]
        },
        { figmaDesignTruthAvailable: figmaLinkVerified }
      );
      gapAnalysis = removeInvalidMissingFigmaGap(gapAnalysis, hasProvidedFigmaDesign(state, brief));
      gapAnalysis = applyFigmaDesignTruthToGaps(gapAnalysis, figmaLinkVerified);
    }
    console.log("[gapDetector] figmaKey:", figmaKey);
    console.log("[gapDetector] figmaLinkVerified:", figmaLinkVerified);
    await syncPipelineEntity(client, {
      kind: "clarifications",
      sessionId: state.sessionId,
      projectId: state.projectId,
      gaps: gapAnalysis.gaps
    });
    const stateJson = state.stateJson as Record<string, unknown>;
    const redraftRequested = stateJson.redraftRequested === true;
    const hasHighPriorityGaps = gapAnalysis.gaps.some((gap) => gap.priority === "High");
    const needsClarification = hasHighPriorityGaps || redraftRequested;
    const nextStateJson: Record<string, unknown> = { ...state.stateJson };
    if (redraftRequested) {
      delete nextStateJson.redraftRequested;
    }
    delete nextStateJson.lastUserClarification;
    delete nextStateJson._sessionHistoryMeta;
    if (needsClarification) {
      delete nextStateJson.prd;
      delete nextStateJson.prdArtifactId;
      delete nextStateJson.prdArtifactVersion;
      delete nextStateJson.tasks;
      delete nextStateJson.taskTree;
      delete nextStateJson.tasksArtifactId;
      delete nextStateJson.tasksArtifactVersion;
      delete nextStateJson.designMap;
      delete nextStateJson.uiKit;
      delete nextStateJson.cursorRules;
      delete nextStateJson.route;
    }
    if (
      figmaKey &&
      (typeof nextStateJson.figmaFileKey !== "string" || String(nextStateJson.figmaFileKey).trim().length === 0)
    ) {
      nextStateJson.figmaFileKey = figmaKey;
    }
    let withTimestamps: Record<string, unknown> = nextStateJson;
    if (figmaKey) {
      if (figmaLinkVerified) {
        withTimestamps = appendClarificationTimelineEvent(withTimestamps, { kind: "figma_verified", fileKey: figmaKey });
      } else {
        withTimestamps = appendClarificationTimelineEvent(withTimestamps, {
          kind: "figma_failed",
          error: figmaVerificationError ?? "Could not validate the Figma file."
        });
      }
    }
    return {
      currentStage: needsClarification ? "clarify" : "prd",
      stateJson: {
        ...withTimestamps,
        gapAnalysis,
        needsClarification,
        figmaLinkVerified,
        ...(figmaVerificationError && !figmaLinkVerified ? { figmaVerificationError } : {}),
        workflowStatus: needsClarification ? "awaiting_user_clarification" : "ready_for_prd"
      }
    };
  });
}

export function createApplyClarificationNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("applyClarification", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const text = typeof stateJson.clarificationFollowUp === "string" ? stateJson.clarificationFollowUp.trim() : "";
    if (!text) {
      throw new Error("applyClarification requires a non-empty stateJson.clarificationFollowUp string.");
    }
    const brief = readBriefFromState(state);
    const mergedBrief = { ...brief, summary: `${brief.summary}\n\nUser clarification:\n${text}` };
    const persisted = await persistBriefArtifact(client, state, mergedBrief);
    const nextStateJson: Record<string, unknown> = { ...stateJson };
    delete nextStateJson.clarificationFollowUp;
    delete nextStateJson.gapAnalysis;
    delete nextStateJson.needsClarification;
    delete nextStateJson.prd;
    delete nextStateJson.prdArtifactId;
    delete nextStateJson.prdArtifactVersion;
    delete nextStateJson.tasks;
    delete nextStateJson.taskTree;
    delete nextStateJson.tasksArtifactId;
    delete nextStateJson.tasksArtifactVersion;
    delete nextStateJson.designMap;
    delete nextStateJson.uiKit;
    delete nextStateJson.cursorRules;
    delete nextStateJson.route;
    const mergedState: Record<string, unknown> = {
      ...nextStateJson,
      brief: mergedBrief,
      briefArtifactId: persisted.id,
      briefArtifactVersion: persisted.version,
      workflowStatus: "brief_normalized",
      lastUserClarification: text,
      clarificationRounds: [
        ...((Array.isArray(stateJson.clarificationRounds) ? stateJson.clarificationRounds : []).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        )),
        text
      ]
    };
    return {
      currentStage: "clarify",
      stateJson: appendClarificationTimelineEvent(mergedState, { kind: "clarifications_merged_into_brief" })
    };
  });
}

export function createNeedsClarificationNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("needsClarification", async (state) => {
    const { error } = await updateProjectSessionById(client, state.sessionId, { graph_status: "interrupted_for_input" });
    if (error) {
      throw new Error(`Failed to mark session as interrupted_for_input: ${error.message}`);
    }
    return {
      currentStage: "clarify",
      stateJson: { ...state.stateJson, route: "needs_clarification", workflowStatus: "awaiting_user_clarification" }
    };
  });
}
