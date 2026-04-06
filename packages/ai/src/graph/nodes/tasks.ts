import { z } from "zod";
import { PRDSchema, TaskTreeSchema, UIKitSchema } from "@vibe/schema";
import { type DatabaseClient } from "@vibe/database";
import { getAnthropicIntelligenceModel } from "../../llm/anthropic";
import { invokeAnthropicStructuredJson } from "../../llm/invoke-structured-json";
import { createPipelineNode, type PipelineNode } from "./types";
import { persistCursorRulesArtifact, persistTasksArtifact } from "./shared/persistence";
import {
  llmTaskGeneratorOutputToTaskTree,
  summarizeTaskTreeForPrompt,
  LlmTaskGeneratorOutputSchema
} from "./task-generator-llm-output";

const CursorRuleFileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1)
});

/** ТЗ §9 — exact handoff filenames for customer repos (lowercase basenames). */
const REQUIRED_CURSOR_RULE_FILENAMES = [
  "001-project-context.mdc",
  "002-architecture.mdc",
  "003-task-execution.mdc",
  "004-design-sync.mdc",
  "005-output-format.mdc"
] as const;

const HandoffCursorRuleFilenameSchema = z.enum([
  "001-project-context.mdc",
  "002-architecture.mdc",
  "003-task-execution.mdc",
  "004-design-sync.mdc",
  "005-output-format.mdc"
]);

/** Fixed enum filenames + min content length — avoids empty Anthropic tool `input` from vague open strings. */
const ImplementationPlannerLlmOutputSchema = z.object({
  cursorRules: z
    .array(
      z.object({
        filename: HandoffCursorRuleFilenameSchema,
        content: z.string().min(40)
      })
    )
    .length(5)
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

/** Basename, lowercased; strips `.cursor/rules/`, `rules/`, and leading `@` or path junk. */
function normalizeRuleFilename(name: string): string {
  let n = name.trim().replace(/^@/, "");
  n = n.replace(/\\/g, "/");
  const parts = n.split("/").filter(Boolean);
  n = parts.length > 0 ? parts[parts.length - 1]! : n;
  n = n.replace(/^\.cursor\/rules\//i, "");
  return n.toLowerCase();
}

/** Validates five rules, dedupes by normalized name, persists canonical ТЗ §9 filenames in order. */
function normalizeAndOrderCursorRules(rules: z.infer<typeof CursorRuleFileSchema>[]): z.infer<typeof CursorRuleFileSchema>[] {
  if (rules.length !== REQUIRED_CURSOR_RULE_FILENAMES.length) {
    throw new Error(
      `Implementation planner: expected exactly ${REQUIRED_CURSOR_RULE_FILENAMES.length} cursor rules, got ${rules.length}.`
    );
  }
  const byKey = new Map<string, z.infer<typeof CursorRuleFileSchema>>();
  for (const r of rules) {
    const key = normalizeRuleFilename(r.filename);
    if (!key.endsWith(".mdc")) {
      throw new Error(`Implementation planner: rule filename must end with .mdc: "${r.filename}"`);
    }
    if (byKey.has(key)) {
      throw new Error(`Implementation planner: duplicate rule after normalize: "${key}"`);
    }
    byKey.set(key, r);
  }
  return REQUIRED_CURSOR_RULE_FILENAMES.map((req) => {
    const hit = byKey.get(req);
    if (!hit?.content.trim()) {
      throw new Error(
        `Implementation planner: missing or empty rule "${req}". Got: ${rules.map((x) => x.filename).join(", ")}`
      );
    }
    return { filename: req, content: hit.content };
  });
}

export function createTaskGeneratorNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("taskGenerator", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    const uiKit = readUIKitFromState(stateJson);
    const hasFigmaUIKit = uiKit.colorPalette.length > 0 || uiKit.typography.length > 0 || uiKit.componentInventory.length > 0;

    const taskPromptBody = [
      "You are a Senior Technical Lead (TaskGenerator).",
      "Return a JSON object with root key `epics` (non-empty array).",
      "Each epic has: externalKey, title, optional description, acceptanceCriteria (string array), specReferences (string array), priority (low|medium|high|critical), and `tasks` (at least 3).",
      "Each task has: externalKey, title, optional description, acceptanceCriteria, specReferences, priority, and `subtasks` (at least 1).",
      "Each subtask has: externalKey, title, optional description, acceptanceCriteria, specReferences.",
      "Do not use a recursive `children` field — only epic.tasks[].subtasks[].",
      "",
      "### TRACEABILITY",
      "Set specReferences on epics/tasks/subtasks where applicable, typically including 02-prd.md, 05-acceptance-criteria.md, 07-implementation-plan.md.",
      "",
      "### DECOMPOSITION",
      "1. One epic per major feature/theme from functional requirements and user stories.",
      "2. Stack-specific work when the PRD names concrete tech (Shopify, Supabase, Remix, etc.).",
      "3. Ordering: foundations → core product → integrations → polish as appropriate.",
      "",
      "### PROJECT DATA",
      `productOverview: ${prd.productOverview}`,
      `goals: ${JSON.stringify(prd.goals)}`,
      `techStack: ${JSON.stringify(prd.techStack)}`,
      `functionalRequirements: ${JSON.stringify(prd.functionalRequirements)}`,
      `userStories: ${JSON.stringify(prd.userStories)}`,
      hasFigmaUIKit ? `uiKit (Figma-derived): ${JSON.stringify(uiKit)}` : "uiKit: not provided — do not invent design tokens in task titles.",
      "",
      "Ground every title in this PRD. externalKey values must be unique across the whole backlog."
    ].join("\n");

    const llmOut = await invokeAnthropicStructuredJson(
      getAnthropicIntelligenceModel(),
      taskPromptBody,
      LlmTaskGeneratorOutputSchema
    );
    const taskTree = ensureTaskTreeUuids(llmTaskGeneratorOutputToTaskTree(llmOut));
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

export function createImplementationPlannerNode(client: DatabaseClient): PipelineNode {
  return createPipelineNode("implementationPlanner", async (state) => {
    const stateJson = state.stateJson as Record<string, unknown>;
    const prd = PRDSchema.parse(stateJson.prd);
    const uiKit = readUIKitFromState(stateJson);
    const parsedTasks = TaskTreeSchema.safeParse(stateJson.tasks ?? stateJson.taskTree);
    if (!parsedTasks.success || parsedTasks.data.epics.length === 0) {
      throw new Error("ImplementationPlanner requires non-empty state.tasks before generating cursor rules.");
    }

    const taskSummary = summarizeTaskTreeForPrompt(parsedTasks.data);
    const plannerPrompt = [
      "You are a Senior Implementation Architect.",
      "Return JSON: { \"cursorRules\": [ ... exactly 5 objects ... ] }.",
      "Each object: { \"filename\": <one of the five names below>, \"content\": <markdown string, min 40 chars> }.",
      "Use each filename exactly once, in this order: 001-project-context.mdc, 002-architecture.mdc, 003-task-execution.mdc, 004-design-sync.mdc, 005-output-format.mdc.",
      "Each `content` must be substantive markdown (bullets, do/don't, examples).",
      "",
      "### ROLE OF EACH FILE",
      "1. 001 — `project-spec/` is source of truth; forbid inventing scope outside artifacts.",
      "2. 002 — Stack/architecture from PRD; FSD-style boundaries if applicable; Cursor workflow note.",
      "3. 003 — Task-first from 10-tasks.json; trace to acceptance criteria and PRD constraints.",
      "4. 004 — UI kit / Figma tokens vs neutral Tailwind baseline when kit empty.",
      "5. 005 — Commits, doc updates, spec file naming, handoff JSON vs markdown.",
      "",
      "### PROJECT DATA",
      `PRD overview: ${prd.productOverview}`,
      `Tech stack: ${JSON.stringify(prd.techStack)}`,
      `Architecture flow: ${prd.architectureFlow.join(" -> ")}`,
      `Goals: ${prd.goals.join("; ")}`,
      `Functional requirements (summary): ${JSON.stringify(prd.functionalRequirements)}`,
      `Assumptions: ${JSON.stringify(prd.assumptions)}`,
      `Risks: ${JSON.stringify(prd.risks)}`,
      `UI Kit (trimmed): ${JSON.stringify(uiKit).slice(0, 6000)}`,
      `Task tree summary (compact): ${taskSummary}`
    ].join("\n");

    const plannerOut = await invokeAnthropicStructuredJson(
      getAnthropicIntelligenceModel(),
      plannerPrompt,
      ImplementationPlannerLlmOutputSchema
    );
    const cursorRules = normalizeAndOrderCursorRules(plannerOut.cursorRules);
    const persisted = await persistCursorRulesArtifact(client, state, cursorRules);

    return {
      currentStage: "handoff",
      stateJson: {
        ...state.stateJson,
        cursorRules,
        cursorRulesArtifactId: persisted.id,
        cursorRulesArtifactVersion: persisted.version,
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
    return { currentStage: "export", stateJson: { ...state.stateJson, tasks: parsedTasks.data, workflowStatus: "completed" } };
  });
}
