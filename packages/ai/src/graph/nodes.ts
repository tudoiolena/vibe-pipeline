import { z } from "zod";
import {
  getFigmaFileMetadata,
  mapFigmaFileToDesignMap,
  type FigmaFileComponent,
  type FigmaFileMetadata,
  type FigmaFileNode,
  type FigmaFileStyle
} from "@vibe/integrations";
import {
  BriefSchema,
  DesignMapSchema,
  DesignTaskRelationSchema,
  PRDSchema,
  StageSchema,
  TaskTreeSchema,
  UIKitSchema
} from "@vibe/schema";
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

const DesignStoryMappingLinkSchema = z.object({
  nodeId: z.string().min(1),
  taskExternalKey: z.string().min(1),
  relationType: DesignTaskRelationSchema,
  confidenceScore: z.number().min(0).max(1),
  evidence: z.record(z.unknown()).default({})
});

const DesignAnalysisOutputSchema = z.object({
  links: z.array(DesignStoryMappingLinkSchema).default([]),
  rationale: z.array(z.string().min(1)).default([])
});

const CursorRuleFileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1)
});

const STANDARD_CURSOR_RULE_FILENAMES = [
  "001-project-context.mdc",
  "002-architecture.mdc",
  "003-task-execution.mdc",
  "004-design-system.mdc",
  "005-output-format.mdc"
] as const;

type StandardCursorRuleFilename = (typeof STANDARD_CURSOR_RULE_FILENAMES)[number];

const ImplementationPlannerOutputSchema = z.object({
  cursorRules: z.array(CursorRuleFileSchema).min(1)
});

/** Minimal patch when the main PRD LLM omits or invalidates critical fields. */
const PrdRecoveryFieldsSchema = z.object({
  productOverview: z.string().min(1),
  architectureFlow: z.array(StageSchema).min(1)
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

async function persistTasksArtifact(
  client: DatabaseClient,
  state: PipelineState,
  taskTree: z.infer<typeof TaskTreeSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "tasks");
  if (latestError) {
    throw new Error(`Failed to resolve latest tasks artifact version: ${latestError.message}`);
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "tasks",
    format: "json",
    version: nextVersion,
    status: "draft",
    content_json: taskTree as unknown as Json
  });

  if (createError || !artifact) {
    throw new Error(`Failed to persist tasks artifact: ${createError?.message ?? "unknown insert error"}`);
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
    techStack: [
      {
        name: "To be proposed based on constraints and team preferences",
        color: "#64748b",
        category: "TBD"
      }
    ],
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

function parseFigmaFileMetadataFromState(stateJson: Record<string, unknown>): FigmaFileMetadata | null {
  const raw = stateJson.figmaFileMetadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const fileKeyFromState =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0
      ? stateJson.figmaFileKey.trim()
      : null;
  const fileKeyFromMeta =
    typeof record.fileKey === "string" && record.fileKey.trim().length > 0 ? record.fileKey.trim() : null;
  const fileKey = fileKeyFromState ?? fileKeyFromMeta;
  if (!fileKey) {
    return null;
  }
  const fileName = typeof record.fileName === "string" ? record.fileName : "";
  const document = record.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return null;
  }
  const rawStyles = Array.isArray(record.styles) ? record.styles : [];
  const styles: FigmaFileStyle[] = rawStyles
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : "Unnamed style",
      key: typeof entry.key === "string" ? entry.key : undefined,
      nodeId: typeof entry.nodeId === "string" ? entry.nodeId : typeof entry.node_id === "string" ? entry.node_id : undefined,
      styleType:
        typeof entry.styleType === "string" ? entry.styleType : typeof entry.style_type === "string" ? entry.style_type : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      hex: typeof entry.hex === "string" ? entry.hex : undefined,
      rawPayload: entry
    }));
  const rawComponents = Array.isArray(record.components) ? record.components : [];
  const components: FigmaFileComponent[] = rawComponents
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : "Unnamed component",
      key: typeof entry.key === "string" ? entry.key : undefined,
      nodeId: typeof entry.nodeId === "string" ? entry.nodeId : typeof entry.node_id === "string" ? entry.node_id : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      rawPayload: entry
    }));
  return {
    fileKey,
    fileName,
    document: document as FigmaFileNode,
    styles,
    components
  };
}

async function resolveFigmaMetadataForDesignAnalysis(stateJson: Record<string, unknown>): Promise<FigmaFileMetadata> {
  const embedded = parseFigmaFileMetadataFromState(stateJson);
  if (embedded) {
    return embedded;
  }
  const key =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0
      ? stateJson.figmaFileKey.trim()
      : null;
  if (!key) {
    throw new Error('designAnalysis requires stateJson.figmaFileKey or embedded figmaFileMetadata.');
  }
  return getFigmaFileMetadata(key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toHexComponent(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

function rgbRecordToHex(color: Record<string, unknown>, alpha?: unknown): string | null {
  const r = color.r;
  const g = color.g;
  const b = color.b;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return null;
  }
  const rr = toHexComponent(r <= 1 ? r * 255 : r);
  const gg = toHexComponent(g <= 1 ? g * 255 : g);
  const bb = toHexComponent(b <= 1 ? b * 255 : b);
  if (typeof alpha === "number" && alpha >= 0 && alpha < 1) {
    return `#${rr}${gg}${bb}${toHexComponent(alpha * 255)}`;
  }
  return `#${rr}${gg}${bb}`;
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function extractStyleHex(style: FigmaFileStyle): string | null {
  if (style.hex) {
    const direct = normalizeHex(style.hex);
    if (direct) {
      return direct;
    }
  }

  const raw = asRecord(style.rawPayload);
  if (!raw) {
    return null;
  }

  const directCandidate = [raw.hex, raw.color, raw.value].find((entry) => typeof entry === "string");
  if (typeof directCandidate === "string") {
    const normalized = normalizeHex(directCandidate);
    if (normalized) {
      return normalized;
    }
  }

  const color = asRecord(raw.color);
  if (color) {
    const fromColor = rgbRecordToHex(color, raw.opacity);
    if (fromColor) {
      return fromColor;
    }
  }

  const paints = Array.isArray(raw.paints) ? raw.paints : Array.isArray(raw.fills) ? raw.fills : [];
  for (const paint of paints) {
    const paintRecord = asRecord(paint);
    if (!paintRecord) {
      continue;
    }
    const paintColor = asRecord(paintRecord.color);
    if (!paintColor) {
      continue;
    }
    const parsed = rgbRecordToHex(paintColor, paintRecord.opacity);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function isTypographyStyle(style: FigmaFileStyle): boolean {
  const type = (style.styleType ?? "").toLowerCase();
  if (type.includes("text") || type.includes("typography")) {
    return true;
  }
  const lowerName = style.name.toLowerCase();
  return (
    lowerName.includes("heading") ||
    lowerName.includes("title") ||
    lowerName.includes("body") ||
    lowerName.includes("caption") ||
    lowerName.includes("label")
  );
}

function readTypographyDetails(style: FigmaFileStyle): {
  fontFamily?: string;
  fontWeight?: string | number;
  fontSize?: string | number;
  lineHeight?: string | number;
  letterSpacing?: string | number;
} {
  const raw = asRecord(style.rawPayload);
  if (!raw) {
    return {};
  }
  const styleData = asRecord(raw.style) ?? raw;
  const fontFamily = typeof styleData.fontFamily === "string" ? styleData.fontFamily : undefined;
  const fontWeight =
    typeof styleData.fontWeight === "string" || typeof styleData.fontWeight === "number"
      ? styleData.fontWeight
      : undefined;
  const fontSize = typeof styleData.fontSize === "number" || typeof styleData.fontSize === "string" ? styleData.fontSize : undefined;
  const lineHeight =
    typeof styleData.lineHeightPx === "number"
      ? styleData.lineHeightPx
      : typeof styleData.lineHeight === "number" || typeof styleData.lineHeight === "string"
        ? styleData.lineHeight
        : undefined;
  const letterSpacing =
    typeof styleData.letterSpacing === "number" || typeof styleData.letterSpacing === "string"
      ? styleData.letterSpacing
      : undefined;
  return { fontFamily, fontWeight, fontSize, lineHeight, letterSpacing };
}

function deriveUIKitFromFigmaMetadata(metadata: FigmaFileMetadata): z.infer<typeof UIKitSchema> {
  const colorPalette = metadata.styles
    .map((style) => ({ style, hex: extractStyleHex(style) }))
    .filter((entry) => Boolean(entry.hex) && !isTypographyStyle(entry.style))
    .map((entry) => ({
      name: entry.style.name,
      hex: entry.hex!,
      description: entry.style.description
    }));

  const typography = metadata.styles
    .filter((style) => isTypographyStyle(style))
    .map((style) => ({
      name: style.name,
      ...readTypographyDetails(style),
      description: style.description
    }));

  const dedupedComponents = new Map<string, z.infer<typeof UIKitSchema>["componentInventory"][number]>();
  const componentCandidates: FigmaFileComponent[] = [...metadata.components];

  const walkDocument = (node: FigmaFileNode): void => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      componentCandidates.push({
        name: node.name,
        nodeId: node.id,
        rawPayload: { nodeType: node.type }
      });
    }
    for (const child of node.children ?? []) {
      walkDocument(child);
    }
  };
  walkDocument(metadata.document);
  for (const component of componentCandidates) {
    const key = component.name.trim();
    if (!key || dedupedComponents.has(key)) {
      continue;
    }
    dedupedComponents.set(key, {
      name: component.name,
      key: component.key,
      nodeId: component.nodeId,
      description: component.description
    });
  }

  return UIKitSchema.parse({
    colorPalette,
    typography,
    componentInventory: Array.from(dedupedComponents.values())
  });
}

function readUIKitFromState(stateJson: Record<string, unknown>): z.infer<typeof UIKitSchema> {
  const parsed = UIKitSchema.safeParse(stateJson.uiKit);
  return parsed.success ? parsed.data : UIKitSchema.parse({});
}

function readBriefFromState(state: PipelineState): z.infer<typeof BriefSchema> {
  const stateJson = state.stateJson as Record<string, unknown>;
  const parsed = BriefSchema.safeParse(stateJson.brief);
  if (parsed.success) {
    return parsed.data;
  }

  const raw = peekRawIntakeText(state);
  if (raw) {
    console.warn(
      "[readBriefFromState] stateJson.brief missing or invalid; falling back to raw intake text for a synthetic brief."
    );
    return buildFallbackBrief(raw, readRawSourceLinks(state));
  }

  throw new Error(
    "Pipeline node requires stateJson.brief or raw intake text (rawIntakeText, intakeText, rawBrief, inputText)."
  );
}

function prdMissingCriticalFields(prd: z.infer<typeof PRDSchema>): boolean {
  return prd.productOverview.trim().length === 0 || prd.architectureFlow.length === 0;
}

async function recoverPrdOverviewAndFlow(
  brief: z.infer<typeof BriefSchema>,
  invalidOrPartialDraftJson: string
): Promise<z.infer<typeof PrdRecoveryFieldsSchema>> {
  const recoveryModel = getAnthropicIntelligenceModel().withStructuredOutput(PrdRecoveryFieldsSchema);
  return recoveryModel.invoke(
    [
      "You are PrdRecovery. The main PRD draft failed schema validation or omitted required fields.",
      "Return ONLY:",
      "- productOverview: 2–4 short paragraphs (executive summary) grounded in the brief.",
      "- architectureFlow: ordered non-empty array of stages chosen from:",
      '  "intake", "clarify", "prd", "tasks", "design_sync", "handoff", "export"',
      "  Prefer the full default pipeline order unless the brief clearly implies a shorter flow.",
      "",
      "Brief JSON:",
      JSON.stringify(brief, null, 2),
      "",
      "Invalid or partial draft (for context only; do not copy mistakes):",
      invalidOrPartialDraftJson
    ].join("\n")
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (needsClarification) {
      // Remove stale downstream outputs while waiting for fresh clarification.
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

export function createApplyClarificationNode(client: DatabaseClient): PipelineNode {
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
    const persisted = await persistBriefArtifact(client, state, mergedBrief);

    const nextStateJson: Record<string, unknown> = { ...stateJson };
    const priorRounds = nextStateJson.clarificationRounds;
    const clarificationRounds = [
      ...(Array.isArray(priorRounds)
        ? priorRounds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : []),
      text
    ];
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

    return {
      currentStage: "clarify",
      stateJson: {
        ...nextStateJson,
        brief: mergedBrief,
        briefArtifactId: persisted.id,
        briefArtifactVersion: persisted.version,
        workflowStatus: "brief_normalized",
        lastUserClarification: text,
        clarificationRounds
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
          "- techStack: array of objects with { name, color, category }.",
          "- For each selected technology, assign a single brand-appropriate color hex (e.g. #61DAFB for React).",
          "- category should be concise and consistent (e.g. frontend, backend, database, infra, tooling, integration).",
          "- userStories: stable IDs (US-1, US-2, …), realistic asA/iWant/soThat; optional acceptanceHints.",
          "- assumptions and risks: honest, brief bullets.",
          "",
          "Brief JSON:",
          JSON.stringify(brief, null, 2)
        ].join("\n")
      );

      const firstParsed = PRDSchema.safeParse(prdOutput);
      let merged: z.infer<typeof PRDSchema> | null = null;

      if (firstParsed.success && !prdMissingCriticalFields(firstParsed.data)) {
        merged = firstParsed.data;
      } else if (firstParsed.success && prdMissingCriticalFields(firstParsed.data)) {
        console.warn("[prdDesigner] PRD missing productOverview or architectureFlow; running recovery prompt.");
        const recovery = await recoverPrdOverviewAndFlow(brief, JSON.stringify(firstParsed.data));
        merged = PRDSchema.parse({
          ...firstParsed.data,
          productOverview: recovery.productOverview,
          architectureFlow: recovery.architectureFlow
        });
      } else {
        console.warn("[prdDesigner] PRD failed Zod validation; running recovery prompt before fallback.");
        const recovery = await recoverPrdOverviewAndFlow(
          brief,
          typeof prdOutput === "object" ? JSON.stringify(prdOutput) : String(prdOutput)
        );
        const base = buildFallbackPrd(brief);
        merged = PRDSchema.parse({
          ...base,
          productOverview: recovery.productOverview,
          architectureFlow: recovery.architectureFlow
        });
      }

      prd = merged;
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

function formatInternalSpecId(n: number): string {
  return `VP-${String(n).padStart(4, "0")}`;
}

function buildFallbackTaskTree(prd: z.infer<typeof PRDSchema>): z.infer<typeof TaskTreeSchema> {
  let vpSeq = 0;
  const nextVp = (): string => {
    vpSeq += 1;
    return formatInternalSpecId(vpSeq);
  };

  if (prd.userStories.length === 0 && prd.functionalRequirements.length === 0) {
    const epicVp = nextVp();
    const taskVp = nextVp();
    return TaskTreeSchema.parse({
      epics: [
        {
          externalKey: "EPIC-1",
          title: `[${epicVp}] Initial delivery planning`,
          description: "Define implementation tasks from the approved PRD scope.",
          hierarchyLevel: 0,
          taskType: "epic",
          status: "todo",
          priority: "high",
          estimatePoints: null,
          acceptanceCriteria: ["Project backlog created and reviewed with stakeholders."],
          dependencies: [],
          specReferences: ["02-prd.md", "08-implementation-plan.md"],
          metadata: { source: "fallback_task_generator", internalSpecId: epicVp },
          children: [
            {
              externalKey: "TASK-1",
              title: `[${taskVp}] Create initial implementation backlog`,
              description: "Break down approved scope into delivery tasks.",
              hierarchyLevel: 1,
              taskType: "task",
              status: "todo",
              priority: "medium",
              estimatePoints: 3,
              acceptanceCriteria: ["At least one concrete implementation task is defined."],
              dependencies: [],
              specReferences: ["02-prd.md", "05-acceptance-criteria.md", "08-implementation-plan.md"],
              metadata: { source: "fallback_task_generator", internalSpecId: taskVp },
              children: []
            }
          ]
        }
      ]
    });
  }

  const seedStories =
    prd.userStories.length > 0
      ? prd.userStories
      : prd.functionalRequirements.map((fr, index) => ({
          id: `US-FR-${index + 1}`,
          asA: "stakeholder",
          iWant: fr.title,
          soThat: fr.details[0] ?? "the requirement is delivered",
          acceptanceHints: fr.details
        }));

  const epics = seedStories.map((story, index) => {
    const fr = prd.functionalRequirements[index];
    const epicKey = `EPIC-${index + 1}`;
    const taskKey = `TASK-${index + 1}`;
    const subtaskKey = `SUB-${index + 1}`;
    const epicVp = nextVp();
    const taskVp = nextVp();
    const subVp = nextVp();
    const epicSpecRefs = ["02-prd.md", "04-user-stories.md", "08-implementation-plan.md"];
    const taskSpecRefs = fr
      ? ["04-user-stories.md", "05-acceptance-criteria.md", "08-implementation-plan.md"]
      : ["04-user-stories.md", "08-implementation-plan.md"];
    const subSpecRefs = taskSpecRefs;
    const epicTitleBase = story.id ? `${story.id} delivery` : `Epic ${index + 1}`;
    const taskTitleBase = fr?.title ?? `Implement ${story.iWant}`;
    return {
      externalKey: epicKey,
      title: `[${epicVp}] ${epicTitleBase}`,
      description: story.iWant,
      hierarchyLevel: 0 as const,
      taskType: "epic" as const,
      status: "todo" as const,
      priority: "high" as const,
      estimatePoints: null,
      acceptanceCriteria: story.acceptanceHints,
      dependencies: [],
      specReferences: epicSpecRefs,
      metadata: { source: "fallback_task_generator", internalSpecId: epicVp, sourceStory: story.id },
      children: [
        {
          externalKey: taskKey,
          title: `[${taskVp}] ${taskTitleBase}`,
          description: fr?.details.join("\n") ?? story.soThat,
          hierarchyLevel: 1 as const,
          taskType: "task" as const,
          status: "todo" as const,
          priority: "medium" as const,
          estimatePoints: 3,
          acceptanceCriteria: story.acceptanceHints,
          dependencies: [],
          specReferences: taskSpecRefs,
          metadata: {
            sourceStory: story.id,
            internalSpecId: taskVp,
            ...(fr?.id ? { functionalRequirementIds: [fr.id] } : {})
          },
          children: [
            {
              externalKey: subtaskKey,
              title: `[${subVp}] Validation and QA`,
              description: `Validate acceptance for ${story.id}`,
              hierarchyLevel: 2 as const,
              taskType: "subtask" as const,
              status: "todo" as const,
              priority: "medium" as const,
              estimatePoints: 1,
              acceptanceCriteria: story.acceptanceHints.length > 0 ? story.acceptanceHints : ["Acceptance validated"],
              dependencies: [],
              specReferences: subSpecRefs,
              metadata: { internalSpecId: subVp },
              children: []
            }
          ]
        }
      ]
    };
  });
  return TaskTreeSchema.parse({ epics });
}

type TaskNode = z.infer<typeof TaskTreeSchema>["epics"][number];

function toTaskUuid(metadata: Record<string, unknown>): string {
  const candidateKeys = ["uuid", "taskUuid", "linearTaskUuid"] as const;
  for (const key of candidateKeys) {
    const value = metadata[key];
    if (typeof value === "string") {
      const parsed = z.string().uuid().safeParse(value);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return crypto.randomUUID();
}

function withTaskNodeUuids(node: TaskNode): TaskNode {
  const metadata = isRecord(node.metadata) ? { ...node.metadata } : {};
  const uuid = toTaskUuid(metadata);
  return {
    ...node,
    metadata: {
      ...metadata,
      uuid,
      linearTaskUuid: uuid
    },
    children: node.children.map(withTaskNodeUuids)
  };
}

function ensureTaskTreeUuids(taskTree: z.infer<typeof TaskTreeSchema>): z.infer<typeof TaskTreeSchema> {
  return TaskTreeSchema.parse({
    epics: taskTree.epics.map(withTaskNodeUuids)
  });
}

export function createTaskGeneratorNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("taskGenerator", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    let taskTree: z.infer<typeof TaskTreeSchema>;

    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(TaskTreeSchema);
      const output = await model.invoke(
        [
          "You are TaskGenerator.",
          "Generate a full dependency-aware TaskTree JSON object from these PRD fields only:",
          "- prd.userStories",
          "- prd.functionalRequirements",
          "",
          "Task schema requirements:",
          '- Top level nodes MUST be epics (hierarchyLevel 0, taskType "epic").',
          '- Each epic should include tasks (hierarchyLevel 1, taskType "task").',
          '- Tasks can include subtasks (hierarchyLevel 2, taskType "subtask").',
          "- Use stable external keys (EPIC-1, TASK-1, SUB-1 style).",
          '- Every task node must include a UUID in metadata.uuid (v4 format) so tasks are ready for Linear export.',
          "- Include acceptanceCriteria and dependencies where relevant.",
          "",
          "Internal spec IDs and titles:",
          '- Assign every node a unique internalSpecId in metadata using the pattern VP- plus exactly four digits (e.g. VP-0001, VP-0002). Numbers must be unique across the whole tree.',
          "- Prepend the bracketed id to every title, e.g. title: \"[VP-0003] Implement password reset flow\" (same id as metadata.internalSpecId).",
          "",
          "Spec-kit references (field specReferences on each node):",
          "- For each node, set specReferences to an array of relevant spec-kit Markdown filenames, chosen only from this closed list:",
          "  01-clarifications.md, 02-prd.md, 03-scope.md, 04-user-stories.md, 05-acceptance-criteria.md,",
          "  06-ui-kit.md, 07-design-map.md, 08-implementation-plan.md, 09-test-plan.md",
          "- Include a file only when that spec document would genuinely help implement or verify that node; omit files that do not apply.",
          "",
          "Traceability metadata:",
          "- Store source user story ids and functional requirement ids in metadata when applicable (e.g. metadata.functionalRequirementIds as string[]).",
          "",
          "Return a complete TaskTree with at least one epic.",
          "",
          "PRD userStories JSON:",
          JSON.stringify(prd.userStories, null, 2),
          "",
          "PRD functionalRequirements JSON:",
          JSON.stringify(prd.functionalRequirements, null, 2)
        ].join("\n")
      );
      taskTree = TaskTreeSchema.parse(output);
    } catch (error) {
      console.warn(`[taskGenerator] Falling back to deterministic task tree: ${String(error)}`);
      taskTree = buildFallbackTaskTree(prd);
    }

    if (taskTree.epics.length === 0) {
      console.warn("[taskGenerator] Model returned empty epic list; falling back to deterministic task tree.");
      taskTree = buildFallbackTaskTree(prd);
    }
    taskTree = ensureTaskTreeUuids(taskTree);

    const persisted = await persistTasksArtifact(client, state, taskTree);

    return {
      currentStage: "tasks",
      stateJson: {
        ...state.stateJson,
        tasks: taskTree,
        taskTree,
        tasksArtifactId: persisted.id,
        tasksArtifactVersion: persisted.version,
        workflowStatus: "tasks_generated"
      }
    };
  });
}

export function createDesignAnalysisNode(): PipelineNode {
  return createPipelineNode("designAnalysis", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    // Prefer the nested `stateJson.prd` written by PrdDesigner.
    const prd = PRDSchema.parse(stateJson.prd ?? stateJson);

    let metadata: FigmaFileMetadata;
    try {
      metadata = await resolveFigmaMetadataForDesignAnalysis(stateJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[designAnalysis] Could not load Figma metadata: ${message}`);
      const emptyMap = DesignMapSchema.parse({ nodes: [], links: [] });
      const emptyUIKit = UIKitSchema.parse({});
      return {
        currentStage: "design_sync",
        stateJson: {
          ...state.stateJson,
          designMap: emptyMap,
          uiKit: emptyUIKit,
          designAnalysisError: message,
          workflowStatus: "design_analysis_failed"
        }
      };
    }

    const baseMap = mapFigmaFileToDesignMap(metadata);
    const uiKit = deriveUIKitFromFigmaMetadata(metadata);
    const nodeIds = new Set(baseMap.nodes.map((n) => n.nodeId));
    const storyIds = new Set(prd.userStories.map((s) => s.id));

    const screens = baseMap.nodes.filter((n) => n.nodeType === "screen");
    const components = baseMap.nodes.filter((n) => n.nodeType === "component" || n.nodeType === "variant");

    let analysis: z.infer<typeof DesignAnalysisOutputSchema>;

    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(DesignAnalysisOutputSchema);
      const output = await model.invoke(
        [
          "You are DesignAnalysis. Map Figma screens (top-level frames) to PRD user stories.",
          "",
          "Rules:",
          '- Prefer links where nodeType is "screen" and taskExternalKey is a user story id (e.g. US-1).',
          '- Use relationType "screen_to_epic" for a screen frame that primarily implements a user story (treat the story as the planning anchor even if the schema name says epic).',
          '- Use "component_to_task" only when a design component clearly backs a specific story and no screen is a better match.',
          '- confidenceScore: 0–1 based on naming and intent overlap.',
          '- evidence: short structured notes (e.g. matched keywords, frame name).',
          "- Omit links if uncertain; do not invent node or story ids.",
          "",
          "Figma screens (id, name):",
          JSON.stringify(
            screens.map((n) => ({ nodeId: n.nodeId, nodeName: n.nodeName })),
            null,
            2
          ),
          "",
          "Figma components / variants (id, name, type) — use only if needed:",
          JSON.stringify(
            components.map((n) => ({ nodeId: n.nodeId, nodeName: n.nodeName, nodeType: n.nodeType })),
            null,
            2
          ),
          "",
          "PRD user stories:",
          JSON.stringify(prd.userStories, null, 2)
        ].join("\n")
      );
      analysis = DesignAnalysisOutputSchema.parse(output);
    } catch (error) {
      console.warn(`[designAnalysis] Falling back to links without LLM: ${String(error)}`);
      analysis = { links: [], rationale: ["LLM invocation unavailable; no design-to-story links generated."] };
    }

    const filteredLinks = analysis.links.filter(
      (link) => nodeIds.has(link.nodeId) && storyIds.has(link.taskExternalKey)
    );

    const designMap = DesignMapSchema.parse({
      nodes: baseMap.nodes,
      links: filteredLinks
    });

    return {
      currentStage: "design_sync",
      stateJson: {
        ...state.stateJson,
        designMap,
        uiKit,
        designAnalysisRationale: analysis.rationale,
        workflowStatus: "design_analyzed"
      }
    };
  });
}

function buildFallbackCursorRules(
  prd: z.infer<typeof PRDSchema>,
  uiKit: z.infer<typeof UIKitSchema>
): z.infer<typeof CursorRuleFileSchema>[] {
  const architectureFlow = prd.architectureFlow.join(" -> ");
  const colorLines =
    uiKit.colorPalette.length > 0
      ? uiKit.colorPalette.map((token) => `- ${token.name}: ${token.hex}`)
      : ["- No color tokens were extracted from Figma."];
  const typographyLines =
    uiKit.typography.length > 0
      ? uiKit.typography.map((token) => {
          const details = [
            token.fontFamily ? `fontFamily=${token.fontFamily}` : null,
            token.fontWeight !== undefined ? `fontWeight=${token.fontWeight}` : null,
            token.fontSize !== undefined ? `fontSize=${token.fontSize}` : null,
            token.lineHeight !== undefined ? `lineHeight=${token.lineHeight}` : null
          ]
            .filter(Boolean)
            .join(", ");
          return `- ${token.name}${details ? ` (${details})` : ""}`;
        })
      : ["- No typography tokens were extracted from Figma."];
  const componentLines =
    uiKit.componentInventory.length > 0
      ? uiKit.componentInventory.map((component) => `- ${component.name}`)
      : ["- No reusable components were extracted from Figma."];

  return [
    {
      filename: "001-project-context.mdc",
      content: [
        "# Project Context Rule",
        "",
        "## Purpose",
        "Keep implementation aligned with approved project artifacts, PRD scope, and acceptance criteria.",
        "",
        "## Source of Truth",
        "- `project-spec/00-brief.md`",
        "- `project-spec/02-prd.md`",
        "- `project-spec/03-scope.md`",
        "- `project-spec/04-user-stories.md`",
        "- `project-spec/05-acceptance-criteria.md`",
        "- `project-spec/09-done-definition.md`",
        "",
        "## Objectives",
        ...prd.goals.map((goal) => `- ${goal}`),
        "",
        "## Scope Guardrails",
        ...prd.scopeSummary.map((scope) => `- ${scope}`),
        "",
        "## Constraints",
        `- Problem statement: ${prd.problemStatement}`,
        "- Keep implementation aligned with PRD scope and avoid scope creep."
      ].join("\n")
    },
    {
      filename: "002-architecture.mdc",
      content: [
        "# Architecture",
        "",
        "## Pipeline Flow",
        `- ${architectureFlow}`,
        "",
        "## Guardrails",
        "- Prefer additive and reversible migrations.",
        "- Preserve backward compatibility across APIs and schemas.",
        "- Add explicit error handling and observable failure paths."
      ].join("\n")
    },
    {
      filename: "003-task-execution.mdc",
      content: [
        "# Task Execution Rule",
        "",
        "## Execution Order",
        "1. Setup + DB + Intake",
        "2. Clarifications + PRD",
        "3. Task breakdown",
        "4. Design sync",
        "5. Handoff artifacts + rules",
        "6. Linear export + polish",
        "",
        "## Task Handling",
        "- Work task-first from `project-spec/10-tasks.json`.",
        "- Preserve dependencies before starting downstream tasks.",
        "- Keep acceptance criteria visible during implementation.",
        "- Update task status only when acceptance criteria are met.",
        "",
        "## Completion Standard",
        "- A task is complete only after behavior, persistence, schema validation, and test impact are covered."
      ].join("\n")
    },
    {
      filename: "004-design-system.mdc",
      content: [
        "# Design System Rule",
        "",
        "## Objective",
        "Implement UI using Figma-extracted design tokens and component inventory without renaming or approximation.",
        "",
        "## Color Palette (Exact Values)",
        ...colorLines,
        "",
        "## Typography",
        ...typographyLines,
        "",
        "## Component Inventory",
        ...componentLines,
        "",
        "## Enforcement",
        "- Use exact token/component names from this file in UI code, docs, and PR descriptions.",
        "- Do not substitute or approximate color hex values.",
        "- If a needed token/component is missing, add a TODO instead of inventing a new name/value."
      ].join("\n")
    },
    {
      filename: "005-output-format.mdc",
      content: [
        "# Output Format Rule",
        "",
        "## Artifact Standards",
        "- Generate structured artifacts in Markdown or JSON only.",
        "- Keep sections deterministic and stable across regenerations.",
        "- Include version, status, and traceable references where relevant.",
        "",
        "## Handoff Package Standard",
        "- `project-spec/00-brief.md`",
        "- `project-spec/01-clarifications.md`",
        "- `project-spec/02-prd.md`",
        "- `project-spec/03-scope.md`",
        "- `project-spec/04-user-stories.md`",
        "- `project-spec/05-acceptance-criteria.md`",
        "- `project-spec/06-ui-kit.md`",
        "- `project-spec/07-design-map.md`",
        "- `project-spec/08-implementation-plan.md`",
        "- `project-spec/09-test-plan.md`",
        "",
        "## Cursor Rules",
        "- `.cursor/rules/001-project-context.mdc`",
        "- `.cursor/rules/002-architecture.mdc`",
        "- `.cursor/rules/003-task-execution.mdc`",
        "- `.cursor/rules/004-design-system.mdc`",
        "- `.cursor/rules/005-output-format.mdc`"
      ].join("\n")
    }
  ];
}

function normalizeCursorRules(
  cursorRules: z.infer<typeof CursorRuleFileSchema>[],
  prd: z.infer<typeof PRDSchema>,
  uiKit: z.infer<typeof UIKitSchema>
): z.infer<typeof CursorRuleFileSchema>[] {
  const fallbackByFilename = new Map(
    buildFallbackCursorRules(prd, uiKit).map((rule) => [rule.filename, rule] as const)
  );
  const incomingByFilename = new Map(
    cursorRules
      .filter((rule): rule is { filename: string; content: string } => rule.content.trim().length > 0)
      .map((rule) => [rule.filename, rule] as const)
  );

  return STANDARD_CURSOR_RULE_FILENAMES.map((filename) => incomingByFilename.get(filename) ?? fallbackByFilename.get(filename)!);
}

export function createImplementationPlannerNode(): PipelineNode {
  return createPipelineNode("implementationPlanner", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    const uiKit = readUIKitFromState(stateJson);

    const parsedTasks = TaskTreeSchema.safeParse(stateJson.tasks ?? stateJson.taskTree);
    if (!parsedTasks.success || parsedTasks.data.epics.length === 0) {
      throw new Error("ImplementationPlanner requires non-empty state.tasks before generating cursor rules.");
    }

    let cursorRules: z.infer<typeof CursorRuleFileSchema>[];
    try {
      const model = getAnthropicIntelligenceModel().withStructuredOutput(ImplementationPlannerOutputSchema);
      const output = await model.invoke(
        [
          "You are ImplementationPlanner.",
          "Generate an array of Cursor rule files (.mdc) for this project.",
          "Return only cursorRules with shape: { filename, content }[].",
          "",
          "Guidelines:",
          "- Output exactly 5 files with these filenames and no extras:",
          '  "001-project-context.mdc", "002-architecture.mdc", "003-task-execution.mdc", "004-design-system.mdc", "005-output-format.mdc".',
          "- Follow spec-kit style for .mdc rules (headings, concise constraints, deterministic language).",
          "- Keep rules actionable and aligned to PRD scope, architecture flow, task execution, design system constraints, and output format.",
          "- The 004-design-system.mdc rule MUST use exact color hex codes and exact component names from uiKit.",
          "- Do not normalize, infer, rename, or approximate uiKit tokens/components.",
          "",
          "PRD JSON:",
          JSON.stringify(prd, null, 2),
          "",
          "TaskTree JSON:",
          JSON.stringify(parsedTasks.data, null, 2),
          "",
          "uiKit JSON (Figma-extracted source of truth for design-system rule):",
          JSON.stringify(uiKit, null, 2)
        ].join("\n")
      );
      cursorRules = normalizeCursorRules(ImplementationPlannerOutputSchema.parse(output).cursorRules, prd, uiKit);
    } catch (error) {
      console.warn(`[implementationPlanner] Falling back to deterministic cursor rules: ${String(error)}`);
      cursorRules = buildFallbackCursorRules(prd, uiKit);
    }

    return {
      currentStage: "handoff",
      stateJson: {
        ...state.stateJson,
        cursorRules,
        workflowStatus: "handoff_prepared"
      }
    };
  });
}

export function createHandoffCompletionNode(): PipelineNode {
  return createPipelineNode("handoffCompletion", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const parsedTasks = TaskTreeSchema.safeParse(stateJson.tasks ?? stateJson.taskTree);
    if (!parsedTasks.success || parsedTasks.data.epics.length === 0) {
      throw new Error("Cannot mark session completed: missing or invalid state.tasks TaskTree.");
    }

    return {
      currentStage: "export",
      stateJson: {
        ...state.stateJson,
        tasks: parsedTasks.data,
        workflowStatus: "completed"
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

