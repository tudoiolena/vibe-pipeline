import { z } from "zod";
import { TaskTreeSchema, type TaskNode, type TaskTree } from "@vibe/schema";

/**
 * Fixed-depth shape for Anthropic structured output.
 * Recursive `TaskNodeSchema` (z.lazy) produces JSON Schema that models often satisfy with `{}` or empty `epics`.
 */
const LlmSubtaskRowSchema = z.object({
  externalKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  specReferences: z.array(z.string().min(1)).default([])
});

const LlmTaskRowSchema = z.object({
  externalKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  specReferences: z.array(z.string().min(1)).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  subtasks: z.array(LlmSubtaskRowSchema).min(1).max(16)
});

const LlmEpicRowSchema = z.object({
  externalKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  specReferences: z.array(z.string().min(1)).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tasks: z.array(LlmTaskRowSchema).min(3).max(16)
});

export const LlmTaskGeneratorOutputSchema = z.object({
  epics: z.array(LlmEpicRowSchema).min(1).max(24)
});

export type LlmTaskGeneratorOutput = z.infer<typeof LlmTaskGeneratorOutputSchema>;

const DEFAULT_LEAF_SPEC = ["02-prd.md", "05-acceptance-criteria.md"] as const;

function toTaskTreeEpic(epic: z.infer<typeof LlmEpicRowSchema>): TaskNode {
  return {
    externalKey: epic.externalKey,
    title: epic.title,
    description: epic.description ?? null,
    hierarchyLevel: 0,
    taskType: "epic",
    status: "todo",
    priority: epic.priority,
    estimatePoints: null,
    acceptanceCriteria: epic.acceptanceCriteria,
    dependencies: [],
    specReferences: epic.specReferences.length > 0 ? epic.specReferences : ["02-prd.md", "07-implementation-plan.md"],
    metadata: {},
    children: epic.tasks.map((task) => ({
      externalKey: task.externalKey,
      title: task.title,
      description: task.description ?? null,
      hierarchyLevel: 1,
      taskType: "task" as const,
      status: "todo" as const,
      priority: task.priority,
      estimatePoints: null,
      acceptanceCriteria: task.acceptanceCriteria,
      dependencies: [],
      specReferences: task.specReferences.length > 0 ? task.specReferences : [...DEFAULT_LEAF_SPEC],
      metadata: {},
      children: task.subtasks.map((sub) => ({
        externalKey: sub.externalKey,
        title: sub.title,
        description: sub.description ?? null,
        hierarchyLevel: 2,
        taskType: "subtask" as const,
        status: "todo" as const,
        priority: "medium" as const,
        estimatePoints: null,
        acceptanceCriteria: sub.acceptanceCriteria,
        dependencies: [],
        specReferences: sub.specReferences.length > 0 ? sub.specReferences : [...DEFAULT_LEAF_SPEC],
        metadata: {},
        children: []
      }))
    }))
  };
}

/** Maps LLM flat epic→tasks→subtasks output into canonical `TaskTreeSchema` (recursive runtime shape). */
export function llmTaskGeneratorOutputToTaskTree(output: LlmTaskGeneratorOutput): TaskTree {
  const epics = output.epics.map(toTaskTreeEpic);
  return TaskTreeSchema.parse({ epics });
}

/** Compact summary so implementation planner tool schema + prompt stay small (huge JSON correlated with empty tool `input`). */
export function summarizeTaskTreeForPrompt(tree: TaskTree, maxChars = 14_000): string {
  const summary = {
    epicCount: tree.epics.length,
    epics: tree.epics.slice(0, 48).map((e) => ({
      externalKey: e.externalKey,
      title: e.title.slice(0, 220),
      tasks: e.children.slice(0, 10).map((t) => ({
        externalKey: t.externalKey,
        title: t.title.slice(0, 180),
        subtaskCount: t.children.length
      }))
    }))
  };
  let text = JSON.stringify(summary);
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}…(truncated)`;
  }
  return text;
}
