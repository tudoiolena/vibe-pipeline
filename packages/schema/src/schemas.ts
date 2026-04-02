import { z } from "zod";

export const ClarificationCategorySchema = z.enum([
  "roles",
  "nfr",
  "edge_case",
  "integration",
  "security",
  "scope",
  "data",
  "workflow"
]);

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const TaskTypeSchema = z.enum(["epic", "task", "subtask"]);

export const StageSchema = z.enum([
  "intake",
  "clarify",
  "prd",
  "tasks",
  "design_sync",
  "handoff",
  "export"
]);

export const SourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

export const BriefSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  problem: z.array(z.string().min(1)).default([]),
  goal: z.string().min(1),
  targetAudience: z.array(z.string().min(1)).default([]),
  businessValue: z.array(z.string().min(1)).default([]),
  keyUserScenarios: z.array(z.string().min(1)).default([]),
  mvpFocus: z.array(z.string().min(1)).default([]),
  sourceLinks: z.array(SourceLinkSchema).default([])
});

export const UserStorySchema = z.object({
  id: z.string().min(1),
  persona: z.string().min(1),
  intent: z.string().min(1),
  benefit: z.string().min(1),
  acceptanceHints: z.array(z.string().min(1)).default([])
});

export const AssumptionSchema = z.preprocess((raw) => {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { description: raw.trim(), mitigation: "To be validated with stakeholders." };
  }
  return raw;
}, z.object({
  description: z.string().min(1),
  mitigation: z.string().min(1)
}));

export const RiskSchema = z.preprocess((raw) => {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { description: raw.trim(), impact: "To be assessed during planning." };
  }
  return raw;
}, z.object({
  description: z.string().min(1),
  impact: z.string().min(1)
}));

export const FunctionalRequirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  details: z.array(z.string().min(1)).default([])
});

export type FunctionalRequirement = z.infer<typeof FunctionalRequirementSchema>;

export const TechStackItemSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  category: z.string().min(1)
});

export const PRDSchema = z.object({
  productOverview: z.string().min(1),
  architectureFlow: z.array(StageSchema),
  problemStatement: z.string().min(1),
  goals: z.array(z.string().min(1)).default([]),
  scopeSummary: z.array(z.string().min(1)).default([]),
  usersAndPersonas: z.array(z.string().min(1)).default([]),
  functionalRequirements: z.array(FunctionalRequirementSchema).default([]),
  nonFunctionalRequirements: z.array(z.string().min(1)).default([]),
  techStack: z.array(TechStackItemSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
  risks: z.array(RiskSchema).default([]),
  userStories: z.array(UserStorySchema).default([])
});

export const TaskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled"
]);

const BaseTaskNodeSchema = z.object({
  externalKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  hierarchyLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  taskType: TaskTypeSchema,
  status: TaskStatusSchema.default("todo"),
  priority: PrioritySchema.default("medium"),
  estimatePoints: z.number().int().nullable().default(null),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  /** Spec-kit markdown files (01–09) that apply to this task, e.g. 04-user-stories.md */
  specReferences: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({})
});

export interface TaskNode extends z.infer<typeof BaseTaskNodeSchema> {
  children: TaskNode[];
}

type TaskNodeInput = z.input<typeof BaseTaskNodeSchema> & {
  children?: TaskNodeInput[];
};

export const TaskNodeSchema: z.ZodType<TaskNode, z.ZodTypeDef, TaskNodeInput> = BaseTaskNodeSchema.extend({
  children: z.lazy((): z.ZodType<TaskNode[], z.ZodTypeDef, TaskNodeInput[]> => TaskNodeSchema.array()).default([])
});

export const TaskTreeSchema = z.object({
  epics: z
    .array(
      TaskNodeSchema.refine((task: TaskNode) => task.hierarchyLevel === 0 && task.taskType === "epic", {
        message: "Top-level nodes must be epic level 0 tasks."
      })
    )
    .default([])
});

export const DesignNodeTypeSchema = z.enum(["screen", "component", "variant", "token"]);

export const DesignNodeSchema = z.object({
  figmaFileKey: z.string().min(1),
  nodeId: z.string().min(1),
  nodeType: DesignNodeTypeSchema,
  nodeName: z.string().min(1),
  figmaUrl: z.string().url().nullable().default(null),
  rawPayload: z.record(z.unknown()).default({})
});

export const DesignTaskRelationSchema = z.enum([
  "screen_to_epic",
  "component_to_task",
  "variant_to_acceptance_criteria",
  "token_to_constraint"
]);

export const DesignMapSchema = z.object({
  nodes: z.array(DesignNodeSchema).default([]),
  links: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        taskExternalKey: z.string().min(1),
        relationType: DesignTaskRelationSchema,
        confidenceScore: z.number().min(0).max(1),
        evidence: z.record(z.unknown()).default({})
      })
    )
    .default([])
});

export const UIColorTokenSchema = z.object({
  name: z.string().min(1),
  hex: z.string().min(1),
  description: z.string().optional()
});

export const UITypographyTokenSchema = z.object({
  name: z.string().min(1),
  fontFamily: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontSize: z.union([z.string(), z.number()]).optional(),
  lineHeight: z.union([z.string(), z.number()]).optional(),
  letterSpacing: z.union([z.string(), z.number()]).optional(),
  description: z.string().optional()
});

export const UIComponentSchema = z.object({
  name: z.string().min(1),
  nodeId: z.string().optional(),
  key: z.string().optional(),
  description: z.string().optional()
});

export const UISpacingTokenSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  figmaSource: z.string().optional(),
  description: z.string().optional()
});

export const UIRadiusTokenSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  figmaSource: z.string().optional(),
  description: z.string().optional()
});

export const UIEffectTokenSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  figmaSource: z.string().optional(),
  description: z.string().optional()
});

export const UIKitFigmaExtractionSchema = z.object({
  /** Same intent as Figma MCP file reads; server-side pipeline uses the authorized REST adapter in @vibe/integrations. */
  readMethod: z.string().min(1),
  targetedPageName: z.string().optional(),
  selectionReason: z.string().optional(),
  fileKey: z.string().optional()
});

export const UIKitSchema = z.object({
  colorPalette: z.array(UIColorTokenSchema).default([]),
  typography: z.array(UITypographyTokenSchema).default([]),
  componentInventory: z.array(UIComponentSchema).default([]),
  spacing: z.array(UISpacingTokenSchema).default([]),
  radii: z.array(UIRadiusTokenSchema).default([]),
  effects: z.array(UIEffectTokenSchema).default([]),
  /** Present when layer / text samples suggest German UI copy (e.g. Anmelden, Konto). */
  detectedLocale: z.enum(["de", "en", "unknown"]).optional(),
  figmaExtraction: UIKitFigmaExtractionSchema.optional()
});
