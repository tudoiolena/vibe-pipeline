import type { z } from "zod";
import { PRDSchema, TaskTreeSchema, type TaskNode } from "./schemas";

const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  clarify: "Clarify",
  prd: "PRD",
  tasks: "Tasks",
  design_sync: "Design sync",
  handoff: "Handoff",
  export: "Export",
  analysis: "Analysis"
};

function bulletBlock(items: string[]): string {
  if (items.length === 0) {
    return "_None._\n";
  }
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function techStackBulletBlock(items: z.infer<typeof PRDSchema>["techStack"]): string {
  if (items.length === 0) {
    return "_None._\n";
  }
  return items.map((item) => `- ${item.name} (${item.category}, ${item.color})`).join("\n") + "\n";
}

/**
 * Renders a PRD in the numbered section style used by `project-spec/02-prd.md`.
 */
export function serializePrdToMarkdown(prdData: z.infer<typeof PRDSchema>): string {
  const prd = PRDSchema.parse(prdData);

  const flowStages = prd.architectureFlow
    .map((stage) => {
      const label = STAGE_LABELS[stage] ?? stage;
      return `- **${label}** (\`${stage}\`)`;
    })
    .join("\n");

  const userStories =
    prd.userStories.length === 0
      ? "_None listed._\n"
      : prd.userStories
          .map((us) => {
            const hints =
              us.acceptanceHints.length > 0
                ? `\n  - _Acceptance hints:_ ${us.acceptanceHints.map((h) => `\n    - ${h}`).join("")}`
                : "";
            return `- **${us.id}** — As a **${us.asA}**, I want **${us.iWant}**, so that ${us.soThat}.${hints}`;
          })
          .join("\n") + "\n";

  const functional =
    prd.functionalRequirements.length === 0
      ? "_None listed._\n"
      : prd.functionalRequirements
          .map((fr) => {
            const details =
              fr.details.length > 0 ? `\n${fr.details.map((d) => `  - ${d}`).join("\n")}` : "";
            return `### ${fr.id}: ${fr.title}${details}`;
          })
          .join("\n\n") + "\n";

  const parts: string[] = [
    "# 02. Product Requirements Document (PRD)\n",
    "## 1) Product Overview\n",
    `${prd.productOverview.trim()}\n\n`,
    "## 2) Core Architecture Flow (Mandatory)\n",
    "The pipeline stages for this product:\n\n",
    flowStages + "\n\n",
    "## 3) Problem Statement\n",
    `${prd.problemStatement.trim()}\n\n`,
    "## 4) Goals and Success Outcomes\n",
    bulletBlock(prd.goals),
    "\n",
    "## 5) Scope Summary\n",
    bulletBlock(prd.scopeSummary),
    "\n",
    "## 6) Users and Personas\n",
    bulletBlock(prd.usersAndPersonas),
    "\n",
    "## 7) User Stories\n",
    userStories,
    "\n",
    "## 8) Functional Requirements\n\n",
    functional,
    "\n",
    "## 9) Non-Functional Requirements\n",
    bulletBlock(prd.nonFunctionalRequirements),
    "\n",
    "## 10) Tech Stack\n",
    techStackBulletBlock(prd.techStack),
    "\n",
    "## 11) Assumptions\n",
    bulletBlock(prd.assumptions),
    "\n",
    "## 12) Risks\n",
    bulletBlock(prd.risks)
  ];

  return parts.join("").trim() + "\n";
}

function taskHeadingPrefix(level: number): string {
  if (level <= 0) {
    return "##";
  }
  if (level === 1) {
    return "###";
  }
  return "####";
}

function serializeTaskNode(task: TaskNode, level: number): string {
  const head = `${taskHeadingPrefix(level)} ${task.externalKey} — ${task.title}\n`;
  const lines: string[] = [head];

  if (task.description?.trim()) {
    lines.push(`- **Description:** ${task.description.trim()}\n`);
  }
  lines.push(`- **Type:** ${task.taskType} (level ${task.hierarchyLevel})\n`);
  lines.push(`- **Status:** ${task.status}\n`);
  lines.push(`- **Priority:** ${task.priority}\n`);
  if (task.estimatePoints != null) {
    lines.push(`- **Estimate (points):** ${task.estimatePoints}\n`);
  }
  if (task.dependencies.length > 0) {
    lines.push(`- **Dependencies:** ${task.dependencies.join(", ")}\n`);
  } else {
    lines.push("- **Dependencies:** None\n");
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push("- **Acceptance criteria:**\n");
    for (const ac of task.acceptanceCriteria) {
      lines.push(`  - ${ac}\n`);
    }
  } else {
    lines.push("- **Acceptance criteria:** _None._\n");
  }

  const body = lines.join("") + "\n";
  const childParts = task.children.map((c) => serializeTaskNode(c, level + 1));
  return body + childParts.join("\n");
}

/**
 * Renders a task tree in the style of `project-spec/10-tasks.md` (hierarchical headings and bullet fields).
 */
export function serializeTasksToMarkdown(tasksData: z.infer<typeof TaskTreeSchema>): string {
  const tree = TaskTreeSchema.parse(tasksData);

  const intro = [
    "# 10. Task Breakdown (Dependency-Ordered)\n",
    "\n",
    "Generated from the structured task tree (epics, tasks, and subtasks).\n",
    "\n",
    "---\n\n"
  ].join("");

  const blocks = tree.epics.map((epic) => serializeTaskNode(epic, 0));
  return (intro + blocks.join("\n")).trim() + "\n";
}
