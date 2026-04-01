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
  asA: z.string().min(1),
  iWant: z.string().min(1),
  soThat: z.string().min(1),
  acceptanceHints: z.array(z.string().min(1)).default([])
});

export const FunctionalRequirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  details: z.array(z.string().min(1)).default([])
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
  techStack: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
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
