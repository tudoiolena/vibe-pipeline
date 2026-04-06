import { z } from "zod";
import { BriefSchema, DesignTaskRelationSchema, StageSchema } from "@vibe/schema";
import { verifyFigmaDesignAccessible } from "@vibe/integrations";
import { type DatabaseClient, updateProjectSessionById } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import type { PipelineState } from "../state";
import { createPipelineNode, type PipelineNode } from "./types";
import { appendClarificationTimelineEvent, persistBriefArtifact, syncPipelineEntity } from "./shared/persistence";
import { projectHasStoredFigmaSource, resolveFigmaFileKeyFromProject } from "./shared/figma-project-key";

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

/** CamelCase keys written by POST /api/pipeline from the structured intake form. */
export type StructuredIntakeFromState = {
  projectName?: string;
  clientName?: string;
  businessGoal?: string;
  targetUsers?: string;
  constraints?: string;
  /** YYYY-MM-DD when provided by the form. */
  deadline?: string;
  repoUrl?: string;
};

function readStringField(stateJson: Record<string, unknown>, key: string): string | undefined {
  const v = stateJson[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function readStructuredIntakeFromState(state: PipelineState): StructuredIntakeFromState {
  const j = state.stateJson as Record<string, unknown>;
  const out: StructuredIntakeFromState = {};
  const projectName = readStringField(j, "intakeProjectName");
  const clientName = readStringField(j, "intakeClientName");
  const businessGoal = readStringField(j, "intakeBusinessGoal");
  const targetUsers = readStringField(j, "intakeTargetUsers");
  const constraints = readStringField(j, "intakeConstraints");
  const deadline = readStringField(j, "intakeDeadline");
  const repoUrl = readStringField(j, "intakeRepoUrl");
  if (projectName) {
    out.projectName = projectName;
  }
  if (clientName) {
    out.clientName = clientName;
  }
  if (businessGoal) {
    out.businessGoal = businessGoal;
  }
  if (targetUsers) {
    out.targetUsers = targetUsers;
  }
  if (constraints) {
    out.constraints = constraints;
  }
  if (deadline) {
    out.deadline = deadline;
  }
  if (repoUrl) {
    out.repoUrl = repoUrl;
  }
  return out;
}

function parseLinkArray(candidate: unknown): z.infer<typeof RawIntakeSourceLinkSchema>[] {
  const parsed = z.array(RawIntakeSourceLinkSchema).safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

function dedupeSourceLinksByUrl(
  links: z.infer<typeof RawIntakeSourceLinkSchema>[]
): z.infer<typeof RawIntakeSourceLinkSchema>[] {
  const seen = new Set<string>();
  const out: z.infer<typeof RawIntakeSourceLinkSchema>[] = [];
  for (const link of links) {
    const key = link.url.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(link);
  }
  return out;
}

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
  const fromLegacy = parseLinkArray(stateJson.sourceLinks);
  const fromIntake = parseLinkArray(stateJson.intakeSourceLinks);
  return dedupeSourceLinksByUrl([...fromLegacy, ...fromIntake]);
}

/**
 * Fallback brief: `summary` is always the full raw narrative. Structured fields only enrich
 * name, goal, audience, optional metadata — they never replace the raw brief text in `summary`.
 */
function buildFallbackBrief(
  rawIntakeText: string,
  sourceLinks: z.infer<typeof RawIntakeSourceLinkSchema>[],
  structured?: StructuredIntakeFromState
): z.infer<typeof BriefSchema> {
  const normalizedName = rawIntakeText
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .trim();
  const derivedName = normalizedName.length > 0 ? normalizedName : "Untitled Product";
  const name = structured?.projectName?.trim() || derivedName;
  const defaultGoal = "Clarify the request and shape it into an implementation-ready product plan.";
  const goal = structured?.businessGoal?.trim() || defaultGoal;

  let targetAudience: string[];
  if (structured?.targetUsers?.trim()) {
    const lines = structured.targetUsers
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    targetAudience = lines.length > 0 ? lines : ["TBD"];
  } else {
    targetAudience = ["TBD"];
  }

  return {
    name,
    summary: rawIntakeText,
    problem: [rawIntakeText],
    goal,
    targetAudience,
    businessValue: ["TBD"],
    keyUserScenarios: ["Define core user journey from intake brief."],
    mvpFocus: ["Capture a minimal, validated scope before PRD drafting."],
    sourceLinks,
    ...(structured?.clientName?.trim() ? { clientName: structured.clientName.trim() } : {}),
    ...(structured?.constraints?.trim() ? { constraints: structured.constraints.trim() } : {}),
    ...(structured?.deadline?.trim() ? { deadline: structured.deadline.trim() } : {}),
    ...(structured?.businessGoal?.trim() ? { businessGoal: structured.businessGoal.trim() } : {})
  };
}

function mergeLlmBriefWithStructuredIntake(
  brief: z.infer<typeof BriefSchema>,
  structured: StructuredIntakeFromState,
  mergedIntakeSourceLinks: z.infer<typeof RawIntakeSourceLinkSchema>[]
): z.infer<typeof BriefSchema> {
  const next: z.infer<typeof BriefSchema> = { ...brief };
  if (structured.projectName?.trim()) {
    next.name = structured.projectName.trim();
  }
  if (structured.clientName?.trim()) {
    next.clientName = structured.clientName.trim();
  }
  if (structured.constraints?.trim()) {
    next.constraints = structured.constraints.trim();
  }
  if (structured.deadline?.trim()) {
    next.deadline = structured.deadline.trim();
  }
  if (structured.businessGoal?.trim()) {
    next.businessGoal = structured.businessGoal.trim();
    next.goal = structured.businessGoal.trim();
  }
  if (structured.targetUsers?.trim()) {
    const lines = structured.targetUsers
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      next.targetAudience = lines;
    }
  }

  const extras: z.infer<typeof RawIntakeSourceLinkSchema>[] = [...mergedIntakeSourceLinks];
  if (structured.repoUrl?.trim()) {
    extras.push({
      label: "Repository",
      url: structured.repoUrl.trim(),
      type: "repository"
    });
  }
  next.sourceLinks = dedupeSourceLinksByUrl([...next.sourceLinks, ...extras]);

  return BriefSchema.parse(next);
}

function briefText(brief: z.infer<typeof BriefSchema>): string {
  return [
    brief.name,
    brief.summary,
    brief.goal,
    brief.clientName ?? "",
    brief.constraints ?? "",
    brief.deadline ?? "",
    brief.businessGoal ?? "",
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
    return buildFallbackBrief(raw, readRawSourceLinks(state), readStructuredIntakeFromState(state));
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
    const structured = readStructuredIntakeFromState(state);
    const structuredBlock =
      Object.keys(structured).length > 0
        ? [
            "### Structured intake (authoritative)",
            "These fields were provided explicitly on the intake form. Your output MUST align with them — do not contradict or drop them.",
            "Set optional Brief fields clientName, constraints, deadline, businessGoal when the structured data provides them.",
            "Use `businessGoal` for the intake business-goal text; set `goal` to the same value when business goal is provided, otherwise infer goal from the raw brief.",
            "When `targetUsers` is provided (may be multiline), split into `targetAudience` array entries (one per non-empty line).",
            "When `projectName` is provided, `name` must match it exactly.",
            JSON.stringify(structured, null, 2),
            ""
          ].join("\n")
        : "";

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
          "`summary` must retain the substance of the raw intake narrative (you may tighten wording but do not replace it with unrelated content).",
          "Populate `problem`, `businessValue`, `keyUserScenarios`, and `mvpFocus` with substantive bullets whenever the raw text implies them — do not leave generic placeholders if the narrative already describes KPIs, personas, journeys, or MVP scope.",
          "",
          structuredBlock,
          "Raw Intake:",
          rawIntakeText,
          "Provided Source Links (merged from session):",
          JSON.stringify(sourceLinks, null, 2)
        ].join("\n")
      );
      const parsed = BriefSchema.parse(briefOutput);
      brief = mergeLlmBriefWithStructuredIntake(parsed, structured, sourceLinks);
      brief = normalizePrimaryFigmaSourceLink(brief, rawIntakeText, sourceLinks);
    } catch (error) {
      console.warn(`[intakeNormalizer] Falling back to deterministic normalization: ${String(error)}`);
      brief = normalizePrimaryFigmaSourceLink(
        buildFallbackBrief(rawIntakeText, sourceLinks, structured),
        rawIntakeText,
        sourceLinks
      );
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

function readPriorFigmaVerification(stateJson: Record<string, unknown>, resolvedKey: string | null): { verified: boolean } {
  if (!resolvedKey) {
    return { verified: false };
  }
  const priorKey = typeof stateJson.figmaFileKey === "string" ? stateJson.figmaFileKey.trim() : "";
  if (priorKey !== resolvedKey) {
    return { verified: false };
  }
  return { verified: stateJson.figmaLinkVerified === true };
}

function isFigmaRateLimitError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  const m = message.toLowerCase();
  return message.includes("429") || m.includes("too many requests") || m.includes("rate limit");
}

/** If we ever verified this file in-session, don't let a transient 429 flip design-truth off. */
function timelineHadFigmaVerifiedForKey(stateJson: Record<string, unknown>, fileKey: string): boolean {
  const raw = stateJson.clarificationTimestamps;
  if (!Array.isArray(raw)) {
    return false;
  }
  const k = fileKey.trim();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const o = entry as Record<string, unknown>;
    if (o.kind !== "figma_verified") {
      continue;
    }
    const fk = typeof o.fileKey === "string" ? o.fileKey.trim() : "";
    if (fk === k) {
      return true;
    }
  }
  return false;
}

export function createGapDetectorNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("gapDetector", async (state) => {
    const brief = readBriefFromState(state);
    const priorJson = state.stateJson as Record<string, unknown>;
    const figmaKey = await resolveFigmaFileKeyFromProject(client, state.projectId);
    const priorFigma = readPriorFigmaVerification(priorJson, figmaKey);
    let figmaLinkVerified = false;
    let figmaVerificationError: string | undefined;
    if (figmaKey) {
      if (priorFigma.verified) {
        figmaLinkVerified = true;
        console.log("[figma] gapDetector: skipping Figma API verify (same file key already verified in session)", {
          fileKey: figmaKey
        });
      } else {
        console.log("[figma] gapDetector: verifying design accessible", { fileKey: figmaKey });
        try {
          const verification = await verifyFigmaDesignAccessible(figmaKey);
          figmaLinkVerified = verification.ok;
          figmaVerificationError = verification.error;
          if (
            !figmaLinkVerified &&
            isFigmaRateLimitError(figmaVerificationError) &&
            timelineHadFigmaVerifiedForKey(priorJson, figmaKey)
          ) {
            figmaLinkVerified = true;
            figmaVerificationError = undefined;
            console.log("[figma] gapDetector: 429 but session timeline has figma_verified; keeping design-truth", {
              fileKey: figmaKey
            });
          } else {
            console.log("[figma] gapDetector: verification result", { ok: figmaLinkVerified, error: figmaVerificationError });
          }
        } catch (error) {
          figmaVerificationError = error instanceof Error ? error.message : String(error);
          figmaLinkVerified = false;
          console.log("[figma] gapDetector: verification threw", { error: figmaVerificationError });
        }
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
        "IMPORTANT: If this project has a stored Figma design URL (see Figma validation section: a resolved file key means one is configured), do NOT output a gap about missing Figma/design specifications.",
        "If Figma validation above is SUCCESS, do NOT output gaps for Missing Design Specifications or Brand Guidelines.",
        "",
        figmaValidationSection,
        "Brief JSON:",
        JSON.stringify(brief, null, 2)
      ].join("\n"));
      gapAnalysis = ensureConstitutionGapCoverage(brief, GapDetectionOutputSchema.parse(gapAnalysisOutput), {
        figmaDesignTruthAvailable: figmaLinkVerified
      });
      gapAnalysis = removeInvalidMissingFigmaGap(
        gapAnalysis,
        await projectHasStoredFigmaSource(client, state.projectId)
      );
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
      gapAnalysis = removeInvalidMissingFigmaGap(
        gapAnalysis,
        await projectHasStoredFigmaSource(client, state.projectId)
      );
      gapAnalysis = applyFigmaDesignTruthToGaps(gapAnalysis, figmaLinkVerified);
    }
    await syncPipelineEntity(client, {
      kind: "clarifications",
      sessionId: state.sessionId,
      projectId: state.projectId,
      gaps: gapAnalysis.gaps
    });
    const stateJson = state.stateJson as Record<string, unknown>;
    const redraftRequested = stateJson.redraftRequested === true;
    const hasHighPriorityGaps = gapAnalysis.gaps.some((gap) => gap.priority === "High");
    let needsClarification = hasHighPriorityGaps || redraftRequested;
    const skipClarificationGate =
      process.env.VIBE_TEST_PIPELINE_SKIP_CLARIFICATION === "1" ||
      process.env.VIBE_TEST_PIPELINE_SKIP_CLARIFICATION === "true";
    const bypassApplied = skipClarificationGate && hasHighPriorityGaps && !redraftRequested;
    if (bypassApplied) {
      console.warn(
        "[gapDetector] VIBE_TEST_PIPELINE_SKIP_CLARIFICATION: proceeding to PRD despite High gaps (local/test only). Gaps are still stored in state."
      );
      needsClarification = false;
    }
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
    if (figmaKey) {
      nextStateJson.figmaFileKey = figmaKey;
    } else {
      delete nextStateJson.figmaFileKey;
    }
    if (figmaLinkVerified) {
      delete nextStateJson.figmaVerificationError;
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
    let mergedBrief: z.infer<typeof BriefSchema>;
    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(BriefSchema);
      const mergedOutput = await model.invoke(
        [
          "You are BriefClarificationMerger.",
          "Merge the user's latest clarification into the structured brief. Return a complete brief that satisfies the schema.",
          "",
          "Rules:",
          "- Preserve existing correct content (name, goal, sourceLinks, clientName, deadline, businessGoal) unless the clarification explicitly overrides.",
          "- `problem`, `targetAudience`, `businessValue`, `keyUserScenarios`, and `mvpFocus` MUST be JSON arrays of strings (one bullet per element). Never use a single string for those keys.",
          "- Append the raw clarification to `summary` under a heading 'User clarifications' if that exact text is not already in the summary.",
          "- Populate `businessValue` with KPIs, revenue targets, acquisition metrics, ROAS, CAC, conversion, AOV, etc. when the clarification mentions them. Merge with existing bullets; do not drop prior items unless contradicted.",
          "- Populate `keyUserScenarios` with named user journeys / personas / flows. Merge with existing.",
          "- Populate `mvpFocus` with phased scope, must-haves, integrations, digital vs physical, poster sizes, etc. Merge with existing.",
          "- If `problem` is empty or only echoes the goal, derive a concrete problem statement from the brief + clarification; otherwise merge new facets.",
          "- Put security, GDPR, retention, DR, backups, monitoring, testing strategy, and third-party integration constraints into `constraints` (append paragraphs or bullet-style lines).",
          "- Replace placeholder-only arrays (e.g. a single 'TBD') when the clarification supplies real content.",
          "- Do not invent URLs, client names, or legal claims not implied by the inputs.",
          "",
          "Current brief JSON:",
          JSON.stringify(brief, null, 2),
          "",
          "User clarification:",
          text
        ].join("\n")
      );
      mergedBrief = BriefSchema.parse(mergedOutput);
      mergedBrief = normalizePrimaryFigmaSourceLink(mergedBrief, `${brief.summary}\n${text}`, brief.sourceLinks);
    } catch (error) {
      console.warn(`[applyClarification] Structured merge failed; appending to summary only: ${String(error)}`);
      mergedBrief = normalizePrimaryFigmaSourceLink(
        { ...brief, summary: `${brief.summary}\n\nUser clarification:\n${text}` },
        `${brief.summary}\n${text}`,
        brief.sourceLinks
      );
    }
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
