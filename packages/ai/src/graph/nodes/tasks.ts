import { z } from "zod";
import { PRDSchema, TaskTreeSchema, UIKitSchema } from "@vibe/schema";
import { type DatabaseClient } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import { createPipelineNode, type PipelineNode } from "./types";
import { persistTasksArtifact } from "./shared/persistence";

const CursorRuleFileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1)
});

const REQUIRED_CURSOR_RULE_FILENAMES = [
  "tech-stack.mdc",
  "design-tokens.mdc",
  "architecture.mdc",
  "business-logic.mdc"
] as const;

const ImplementationPlannerModelOutputSchema = z.object({
  cursorRules: z.array(CursorRuleFileSchema).min(4).max(6)
});

type TaskNode = z.infer<typeof TaskTreeSchema>["epics"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTaskUuid(metadata: Record<string, unknown>): string {
  for (const key of ["uuid", "taskUuid", "linearTaskUuid"] as const) {
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
    metadata: { ...metadata, uuid, linearTaskUuid: uuid },
    children: node.children.map(withTaskNodeUuids)
  };
}

/** Ensures every epic, task, and subtask has stable `linearTaskUuid` (and `uuid`) in metadata. */
export function ensureTaskTreeUuids(taskTree: z.infer<typeof TaskTreeSchema>): z.infer<typeof TaskTreeSchema> {
  return TaskTreeSchema.parse({ epics: taskTree.epics.map(withTaskNodeUuids) });
}

export const ensureTaskUuids = ensureTaskTreeUuids;

function readUIKitFromState(stateJson: Record<string, unknown>): z.infer<typeof UIKitSchema> {
  const parsed = UIKitSchema.safeParse(stateJson.uiKit);
  return parsed.success ? parsed.data : UIKitSchema.parse({});
}

function normalizeRuleFilename(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}

function assertRequiredCursorRuleFiles(rules: z.infer<typeof CursorRuleFileSchema>[]): void {
  const names = new Set(rules.map((r) => normalizeRuleFilename(r.filename)));
  for (const required of REQUIRED_CURSOR_RULE_FILENAMES) {
    if (!names.has(required)) {
      throw new Error(
        `Implementation planner: missing required Cursor rule file "${required}". Got: ${rules.map((r) => r.filename).join(", ")}`
      );
    }
  }
}

export function createTaskGeneratorNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("taskGenerator", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    const uiKit = readUIKitFromState(stateJson);
    const hasFigmaUIKit = uiKit.colorPalette.length > 0 || uiKit.typography.length > 0 || uiKit.componentInventory.length > 0;

    const model = getAnthropicIntelligenceModel().withStructuredOutput(TaskTreeSchema);
    const output = await model.invoke(
      [
        "You are a Senior Technical Lead (TaskGenerator).",
        "Analyze the PRD and (when present) UI Kit JSON to produce a complete, project-specific implementation backlog.",
        "",
        "### TRACEABILITY",
        "Every epic, task, and subtask MUST set specReferences to the spec-kit files that apply, typically including:",
        "- 02-prd.md",
        "- 04-user-stories.md (when tied to stories)",
        "- 05-acceptance-criteria.md",
        "- 08-implementation-plan.md",
        "Use at least 02-prd.md and 05-acceptance-criteria.md on every leaf that has acceptance criteria.",
        "",
        "### DECOMPOSITION",
        "1. One epic per major feature/theme from functional requirements and user stories.",
        "2. Stack-specific work: if the PRD names Shopify, Supabase, Remix, etc., include concrete tasks (e.g. schema/RLS, theme sections, loaders).",
        "3. Ordering: foundations → core product → integrations → polish/SEO as appropriate.",
        "4. Each epic: at least 3–5 children covering setup, implementation, and validation.",
        "",
        "### PROJECT DATA",
        `productOverview: ${prd.productOverview}`,
        `goals: ${JSON.stringify(prd.goals)}`,
        `techStack: ${JSON.stringify(prd.techStack)}`,
        `functionalRequirements: ${JSON.stringify(prd.functionalRequirements)}`,
        `userStories: ${JSON.stringify(prd.userStories)}`,
        hasFigmaUIKit ? `uiKit (Figma-derived): ${JSON.stringify(uiKit)}` : "uiKit: not provided — do not invent design tokens in task titles.",
        "",
        "Do not emit empty epics. Every title and description must be grounded in this PRD."
      ].join("\n")
    );

    const parsed = TaskTreeSchema.safeParse(output);
    if (!parsed.success) {
      throw new Error(`Task generator: LLM output failed TaskTree schema validation: ${JSON.stringify(parsed.error.flatten())}`);
    }
    if (parsed.data.epics.length === 0) {
      throw new Error("Task generator: LLM returned an empty task tree (epics must be non-empty).");
    }

    const taskTree = ensureTaskTreeUuids(parsed.data);
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

export function createImplementationPlannerNode(): PipelineNode {
  return createPipelineNode("implementationPlanner", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    const uiKit = readUIKitFromState(stateJson);
    const parsedTasks = TaskTreeSchema.safeParse(stateJson.tasks ?? stateJson.taskTree);
    if (!parsedTasks.success || parsedTasks.data.epics.length === 0) {
      throw new Error("ImplementationPlanner requires non-empty state.tasks before generating cursor rules.");
    }

    const model = getAnthropicIntelligenceModel().withStructuredOutput(ImplementationPlannerModelOutputSchema);
    const output = await model.invoke(
      [
        "You are a Senior Implementation Architect.",
        "Generate exactly 4–6 Cursor rule files (.mdc) as structured output.",
        "",
        "### REQUIRED FILENAMES (exact spelling)",
        "1. tech-stack.mdc — coding standards for the stack named in the PRD (e.g. Shopify Liquid, Supabase + RLS, Remix loaders, React Server Components).",
        "2. design-tokens.mdc — map real color hex and font families from the UI Kit JSON to Tailwind / CSS variable instructions; if UI Kit is empty, document a neutral shadcn/Tailwind approach without fake Figma values.",
        "3. architecture.mdc — enforce Feature-Sliced Design (FSD): layers shared/features/entities/widgets/app (or equivalent), public API per slice, no cross-import violations.",
        "4. business-logic.mdc — hard constraints from the PRD (policies, compliance, checkout rules, age gates, etc.).",
        "Optional 5th–6th files: e.g. testing.mdc or observability.mdc if clearly valuable for THIS project.",
        "",
        "### CONTENT",
        "Each file: high-density Markdown with bullets, do/don't, and concrete examples. No filler.",
        "",
        "### PROJECT DATA",
        `PRD overview: ${prd.productOverview}`,
        `Tech stack: ${JSON.stringify(prd.techStack)}`,
        `Architecture flow: ${prd.architectureFlow.join(" -> ")}`,
        `Goals: ${prd.goals.join("; ")}`,
        `Functional requirements (for business-logic.mdc): ${JSON.stringify(prd.functionalRequirements)}`,
        `Assumptions: ${JSON.stringify(prd.assumptions)}`,
        `Risks: ${JSON.stringify(prd.risks)}`,
        `UI Kit JSON: ${JSON.stringify(uiKit)}`,
        `Task tree (for traceability): ${JSON.stringify(parsedTasks.data)}`
      ].join("\n")
    );

    const parsedOutput = ImplementationPlannerModelOutputSchema.safeParse(output);
    if (!parsedOutput.success) {
      throw new Error(
        `Implementation planner: LLM output failed schema validation: ${JSON.stringify(parsedOutput.error.flatten())}`
      );
    }
    assertRequiredCursorRuleFiles(parsedOutput.data.cursorRules);

    return {
      currentStage: "handoff",
      stateJson: { ...state.stateJson, cursorRules: parsedOutput.data.cursorRules, workflowStatus: "handoff_prepared" }
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
    return { currentStage: "export", stateJson: { ...state.stateJson, tasks: parsedTasks.data, workflowStatus: "completed" } };
  });
}
