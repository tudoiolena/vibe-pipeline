import { z } from "zod";
import { BriefSchema, PRDSchema } from "@vibe/schema";
import {
  createArtifactVersion,
  getLatestArtifactVersion,
  type DatabaseClient,
  type Json,
  updateProjectSessionById
} from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../llm/anthropic";
import { PipelineStateSchema, type PipelineState, PipelineStateUpdateSchema, type PipelineStateUpdate } from "./state";

export type PipelineNode = (state: PipelineState) => PipelineStateUpdate | Promise<PipelineStateUpdate>;

/**
 * Wraps node handlers with strict input/output validation so graph nodes only
 * read valid state and return valid partial updates.
 */
export function createPipelineNode(name: string, handler: PipelineNode): PipelineNode {
  return async (state) => {
    const parsedState = PipelineStateSchema.parse(state);
    const rawUpdate = await handler(parsedState);
    const parsedUpdate = PipelineStateUpdateSchema.parse(rawUpdate);

    // Ensure nodes always return a plain object update for LangGraph merge semantics.
    return z.record(z.unknown()).parse(parsedUpdate) as PipelineStateUpdate;
  };
}

const RawIntakeSourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

const GapPrioritySchema = z.enum(["High", "Med", "Low"]);
const GapTypeSchema = z.enum(["NFR", "Security", "Scale", "Business Logic"]);

const RequirementGapSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: GapPrioritySchema,
  type: GapTypeSchema
});

const GapDetectionOutputSchema = z.object({
  gaps: z.array(RequirementGapSchema).default([]),
  rationale: z.array(z.string().min(1)).default([])
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

function readRawIntakeText(state: PipelineState): string {
  const stateJson = state.stateJson as Record<string, unknown>;
  const rawCandidates = [
    stateJson.rawIntakeText,
    stateJson.intakeText,
    stateJson.rawBrief,
    stateJson.inputText
  ];

  for (const candidate of rawCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  throw new Error(
    "IntakeNormalizer requires raw intake text in stateJson.rawIntakeText (or intakeText/rawBrief/inputText)."
  );
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

  const projectName = normalizedName.length > 0 ? normalizedName : "Untitled Product";

  return {
    name: projectName,
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

function readRawSourceLinks(state: PipelineState): z.infer<typeof RawIntakeSourceLinkSchema>[] {
  const stateJson = state.stateJson as Record<string, unknown>;
  const candidate = stateJson.sourceLinks ?? stateJson.intakeSourceLinks;
  const parsed = z.array(RawIntakeSourceLinkSchema).safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

async function persistBriefArtifact(
  client: DatabaseClient,
  state: PipelineState,
  brief: z.infer<typeof BriefSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "brief");
  if (latestError) {
    throw new Error(`Failed to resolve latest brief artifact version: ${latestError.message}`);
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "brief",
    format: "json",
    version: nextVersion,
    status: "draft",
    content_json: brief
  });

  if (createError || !artifact) {
    throw new Error(`Failed to persist brief artifact: ${createError?.message ?? "unknown insert error"}`);
  }

  return {
    id: artifact.id,
    version: artifact.version
  };
}

async function persistPrdArtifact(
  client: DatabaseClient,
  state: PipelineState,
  prd: z.infer<typeof PRDSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "prd");
  if (latestError) {
    throw new Error(`Failed to resolve latest PRD artifact version: ${latestError.message}`);
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "prd",
    format: "json",
    version: nextVersion,
    status: "draft",
    content_json: prd as unknown as Json
  });

  if (createError || !artifact) {
    throw new Error(`Failed to persist PRD artifact: ${createError?.message ?? "unknown insert error"}`);
  }

  return {
    id: artifact.id,
    version: artifact.version
  };
}

function buildFallbackPrd(brief: z.infer<typeof BriefSchema>): z.infer<typeof PRDSchema> {
  const audience = brief.targetAudience[0] ?? "primary user";
  return PRDSchema.parse({
    productOverview: brief.summary,
    architectureFlow: ["intake", "clarify", "prd", "tasks", "design_sync", "handoff", "export"],
    problemStatement: brief.problem.length > 0 ? brief.problem.join("\n\n") : brief.summary,
    goals: [brief.goal, ...brief.businessValue],
    scopeSummary: brief.mvpFocus,
    usersAndPersonas: brief.targetAudience,
    functionalRequirements: brief.keyUserScenarios.map((scenario, index) => ({
      id: `FR-${index + 1}`,
      title: `Key scenario ${index + 1}`,
      details: [scenario]
    })),
    nonFunctionalRequirements: [
      "Performance, security, and scale targets to be finalized with engineering after brief validation."
    ],
    techStack: ["To be proposed based on constraints and team preferences."],
    assumptions: [],
    risks: ["Requirements may be incomplete until clarification pass is finished."],
    userStories: brief.keyUserScenarios.map((scenario, index) => ({
      id: `US-${index + 1}`,
      asA: audience,
      iWant: scenario,
      soThat: `we make progress toward: ${brief.goal}`,
      acceptanceHints: []
    }))
  });
}

function readBriefFromState(state: PipelineState): z.infer<typeof BriefSchema> {
  const stateJson = state.stateJson as Record<string, unknown>;
  const parsed = BriefSchema.safeParse(stateJson.brief);
  if (!parsed.success) {
    throw new Error("GapDetector requires a normalized brief in stateJson.brief.");
  }
  return parsed.data;
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

function ensureConstitutionGapCoverage(
  brief: z.infer<typeof BriefSchema>,
  analysis: z.infer<typeof GapDetectionOutputSchema>
): z.infer<typeof GapDetectionOutputSchema> {
  const normalized: z.infer<typeof GapDetectionOutputSchema> = {
    gaps: [...analysis.gaps],
    rationale: [...analysis.rationale]
  };
  const lowerText = briefText(brief);
  const hasSecurityCoverage = includesKeyword(lowerText, SecurityRequirementKeywords);
  const hasScaleCoverage = includesKeyword(lowerText, ScaleRequirementKeywords);

  if (!hasSecurityCoverage && !normalized.gaps.some((gap) => gap.type === "Security")) {
    normalized.gaps.push({
      title: "Security baseline is unspecified",
      description:
        "Authentication/authorization, data protection, and secret handling requirements are missing. Define baseline security controls before architecture decisions.",
      priority: "High",
      type: "Security"
    });
    normalized.rationale.push(
      "Constitutional requirement: explicit security constraints are required before PRD progression."
    );
  }

  if (!hasScaleCoverage && !normalized.gaps.some((gap) => gap.type === "Scale")) {
    normalized.gaps.push({
      title: "Scale expectations are undefined",
      description:
        "Expected traffic, peak concurrency, and performance targets are missing. Define scale constraints to size architecture and infrastructure correctly.",
      priority: "High",
      type: "Scale"
    });
    normalized.rationale.push(
      "Constitutional requirement: explicit scalability/performance expectations are required before PRD progression."
    );
  }

  return normalized;
}

export function createIntakeNormalizerNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("intakeNormalizer", async (state) => {
    const rawIntakeText = readRawIntakeText(state);
    const sourceLinks = readRawSourceLinks(state);
    let brief: z.infer<typeof BriefSchema>;

    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(BriefSchema);
      const sourceLinksInput =
        sourceLinks.length > 0
          ? JSON.stringify(sourceLinks, null, 2)
          : "[]";
      const briefOutput = await model.invoke(
        [
          "You are IntakeNormalizer for a software planning pipeline.",
          "Transform the raw intake text into a valid brief object using this schema:",
          "- name: product/project name",
          "- summary: concise 1-3 sentence summary",
          "- problem: concrete pain points",
          "- goal: primary product goal",
          "- targetAudience: user segments",
          "- businessValue: measurable business outcomes",
          "- keyUserScenarios: key workflows",
          "- mvpFocus: must-have scope only",
          "- sourceLinks: normalize links if provided",
          "",
          "Rules:",
          "- Do not invent specific integrations, metrics, or constraints unless clearly implied.",
          "- Keep fields concise and implementation-oriented.",
          "- Return only information grounded in provided intake.",
          "",
          "Raw Intake:",
          rawIntakeText,
          "",
          "Provided Source Links JSON:",
          sourceLinksInput
        ].join("\n")
      );
      brief = BriefSchema.parse(briefOutput);
    } catch (error) {
      // Allow local validation runs to proceed even when external model access is unavailable.
      console.warn(`[intakeNormalizer] Falling back to deterministic normalization: ${String(error)}`);
      brief = buildFallbackBrief(rawIntakeText, sourceLinks);
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

export function createGapDetectorNode(): PipelineNode {
  return createPipelineNode("gapDetector", async (state) => {
    const brief = readBriefFromState(state);
    let gapAnalysis: z.infer<typeof GapDetectionOutputSchema>;

    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(GapDetectionOutputSchema);
      const gapAnalysisOutput = await model.invoke(
        [
          "You are GapDetector for software requirements quality.",
          "Analyze this brief and identify missing technical requirements.",
          "",
          "Focus categories:",
          '- "NFR": performance, reliability, observability, scalability, accessibility, compliance',
          '- "Security": authn/authz, data protection, secrets, threat boundaries',
          '- "Scale": explicit load expectations, concurrency targets, throughput, latency/SLA constraints',
          '- "Business Logic": rules, workflows, edge cases, integration assumptions',
          "",
          "Constitution requirements:",
          '- Security and Scale requirements are mandatory categories. If either is missing or under-specified, emit a "High" priority gap.',
          "",
          "Priority rubric:",
          '- "High": blocks architecture decisions, creates material delivery/security risk',
          '- "Med": important but can proceed with bounded assumptions',
          '- "Low": useful refinement that does not block PRD drafting',
          "",
          "Return only unresolved gaps. If the brief is complete enough, return an empty gaps array.",
          "",
          "Brief JSON:",
          JSON.stringify(brief, null, 2)
        ].join("\n")
      );

      gapAnalysis = ensureConstitutionGapCoverage(brief, GapDetectionOutputSchema.parse(gapAnalysisOutput));
    } catch (error) {
      // Keep graph behavior deterministic when model calls are unavailable.
      console.warn(`[gapDetector] Falling back to deterministic gap analysis: ${String(error)}`);
      gapAnalysis = ensureConstitutionGapCoverage(brief, {
        gaps: [],
        rationale: [
          "Fallback gap analysis used because external model invocation was unavailable."
        ]
      });
    }

    // PrdDesigner runs only when no High-priority gaps remain (Med/Low still allow PRD drafting).
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

    return {
      currentStage: needsClarification ? "clarify" : "prd",
      stateJson: {
        ...nextStateJson,
        gapAnalysis,
        needsClarification,
        workflowStatus: needsClarification ? "awaiting_user_clarification" : "ready_for_prd"
      }
    };
  });
}

export function createApplyClarificationNode(): PipelineNode {
  return createPipelineNode("applyClarification", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const text =
      typeof stateJson.clarificationFollowUp === "string" ? stateJson.clarificationFollowUp.trim() : "";
    if (text.length === 0) {
      throw new Error("applyClarification requires a non-empty stateJson.clarificationFollowUp string.");
    }

    const brief = readBriefFromState(state);
    const mergedBrief = {
      ...brief,
      summary: `${brief.summary}\n\nUser clarification:\n${text}`
    };

    const nextStateJson: Record<string, unknown> = { ...stateJson };
    delete nextStateJson.clarificationFollowUp;
    delete nextStateJson.gapAnalysis;
    delete nextStateJson.needsClarification;

    return {
      currentStage: "clarify",
      stateJson: {
        ...nextStateJson,
        brief: mergedBrief,
        workflowStatus: "brief_normalized",
        lastUserClarification: text
      }
    };
  });
}

export function createPrdDesignerNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("prdDesigner", async (state) => {
    const brief = readBriefFromState(state);
    let prd: z.infer<typeof PRDSchema>;

    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(PRDSchema);
      const prdOutput = await model.invoke(
        [
          "You are PrdDesigner. Produce a complete product requirements document (PRD) from the finalized brief below.",
          "",
          "Fill every required field. Use clear, professional language.",
          "",
          "Guidelines:",
          "- productOverview: executive summary of the product (2–4 short paragraphs max).",
          "- architectureFlow: ordered pipeline stages this product uses; prefer:",
          '  ["intake","clarify","prd","tasks","design_sync","handoff","export"] unless the brief implies a different flow.',
          "- problemStatement: crisp problem framing grounded in the brief.",
          "- goals, scopeSummary, usersAndPersonas: concrete bullets.",
          "- functionalRequirements: stable IDs (FR-1, FR-2, …), titles, and detail bullets.",
          "- nonFunctionalRequirements: measurable where possible (performance, security, reliability, compliance).",
          "- techStack: recommended languages, frameworks, data stores, infra, and key integrations (as concise bullets).",
          "- userStories: stable IDs (US-1, US-2, …), realistic asA/iWant/soThat; optional acceptanceHints.",
          "- assumptions and risks: honest, brief bullets.",
          "",
          "Brief JSON:",
          JSON.stringify(brief, null, 2)
        ].join("\n")
      );
      prd = PRDSchema.parse(prdOutput);
    } catch (error) {
      console.warn(`[prdDesigner] Falling back to template PRD: ${String(error)}`);
      prd = buildFallbackPrd(brief);
    }

    const persisted = await persistPrdArtifact(client, state, prd);

    return {
      currentStage: "prd",
      stateJson: {
        ...state.stateJson,
        prd,
        prdArtifactId: persisted.id,
        prdArtifactVersion: persisted.version,
        route: "prd_designed",
        workflowStatus: "prd_generated"
      }
    };
  });
}

export function createNeedsClarificationNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("needsClarification", async (state) => {
    const { error } = await updateProjectSessionById(client, state.sessionId, {
      graph_status: "interrupted_for_input"
    });

    if (error) {
      throw new Error(`Failed to mark session as interrupted_for_input: ${error.message}`);
    }

    return {
      currentStage: "clarify",
      stateJson: {
        ...state.stateJson,
        route: "needs_clarification",
        workflowStatus: "awaiting_user_clarification"
      }
    };
  });
}

