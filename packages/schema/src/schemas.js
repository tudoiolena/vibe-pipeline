"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesignMapSchema = exports.DesignTaskRelationSchema = exports.DesignNodeSchema = exports.DesignNodeTypeSchema = exports.TaskTreeSchema = exports.TaskNodeSchema = exports.TaskStatusSchema = exports.PRDSchema = exports.TechStackItemSchema = exports.FunctionalRequirementSchema = exports.UserStorySchema = exports.BriefSchema = exports.SourceLinkSchema = exports.StageSchema = exports.TaskTypeSchema = exports.PrioritySchema = exports.ClarificationCategorySchema = void 0;
var zod_1 = require("zod");
exports.ClarificationCategorySchema = zod_1.z.enum([
    "roles",
    "nfr",
    "edge_case",
    "integration",
    "security",
    "scope",
    "data",
    "workflow"
]);
exports.PrioritySchema = zod_1.z.enum(["low", "medium", "high", "critical"]);
exports.TaskTypeSchema = zod_1.z.enum(["epic", "task", "subtask"]);
exports.StageSchema = zod_1.z.enum([
    "intake",
    "clarify",
    "prd",
    "tasks",
    "design_sync",
    "handoff",
    "export"
]);
exports.SourceLinkSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
    type: zod_1.z.string().min(1).optional()
});
exports.BriefSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    problem: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    goal: zod_1.z.string().min(1),
    targetAudience: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    businessValue: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    keyUserScenarios: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    mvpFocus: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    sourceLinks: zod_1.z.array(exports.SourceLinkSchema).default([])
});
exports.UserStorySchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    asA: zod_1.z.string().min(1),
    iWant: zod_1.z.string().min(1),
    soThat: zod_1.z.string().min(1),
    acceptanceHints: zod_1.z.array(zod_1.z.string().min(1)).default([])
});
exports.FunctionalRequirementSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    details: zod_1.z.array(zod_1.z.string().min(1)).default([])
});
exports.TechStackItemSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    color: zod_1.z.string().min(1),
    category: zod_1.z.string().min(1)
});
exports.PRDSchema = zod_1.z.object({
    productOverview: zod_1.z.string().min(1),
    architectureFlow: zod_1.z.array(exports.StageSchema),
    problemStatement: zod_1.z.string().min(1),
    goals: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    scopeSummary: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    usersAndPersonas: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    functionalRequirements: zod_1.z.array(exports.FunctionalRequirementSchema).default([]),
    nonFunctionalRequirements: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    techStack: zod_1.z.array(exports.TechStackItemSchema).default([]),
    assumptions: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    risks: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    userStories: zod_1.z.array(exports.UserStorySchema).default([])
});
exports.TaskStatusSchema = zod_1.z.enum([
    "todo",
    "in_progress",
    "blocked",
    "review",
    "done",
    "cancelled"
]);
var BaseTaskNodeSchema = zod_1.z.object({
    externalKey: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().nullable().default(null),
    hierarchyLevel: zod_1.z.union([zod_1.z.literal(0), zod_1.z.literal(1), zod_1.z.literal(2)]),
    taskType: exports.TaskTypeSchema,
    status: exports.TaskStatusSchema.default("todo"),
    priority: exports.PrioritySchema.default("medium"),
    estimatePoints: zod_1.z.number().int().nullable().default(null),
    acceptanceCriteria: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    dependencies: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    metadata: zod_1.z.record(zod_1.z.unknown()).default({})
});
exports.TaskNodeSchema = BaseTaskNodeSchema.extend({
    children: zod_1.z.lazy(function () { return exports.TaskNodeSchema.array(); }).default([])
});
exports.TaskTreeSchema = zod_1.z.object({
    epics: zod_1.z
        .array(exports.TaskNodeSchema.refine(function (task) { return task.hierarchyLevel === 0 && task.taskType === "epic"; }, {
        message: "Top-level nodes must be epic level 0 tasks."
    }))
        .default([])
});
exports.DesignNodeTypeSchema = zod_1.z.enum(["screen", "component", "variant", "token"]);
exports.DesignNodeSchema = zod_1.z.object({
    figmaFileKey: zod_1.z.string().min(1),
    nodeId: zod_1.z.string().min(1),
    nodeType: exports.DesignNodeTypeSchema,
    nodeName: zod_1.z.string().min(1),
    figmaUrl: zod_1.z.string().url().nullable().default(null),
    rawPayload: zod_1.z.record(zod_1.z.unknown()).default({})
});
exports.DesignTaskRelationSchema = zod_1.z.enum([
    "screen_to_epic",
    "component_to_task",
    "variant_to_acceptance_criteria",
    "token_to_constraint"
]);
exports.DesignMapSchema = zod_1.z.object({
    nodes: zod_1.z.array(exports.DesignNodeSchema).default([]),
    links: zod_1.z
        .array(zod_1.z.object({
        nodeId: zod_1.z.string().min(1),
        taskExternalKey: zod_1.z.string().min(1),
        relationType: exports.DesignTaskRelationSchema,
        confidenceScore: zod_1.z.number().min(0).max(1),
        evidence: zod_1.z.record(zod_1.z.unknown()).default({})
    }))
        .default([])
});
