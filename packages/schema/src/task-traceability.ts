import type { FunctionalRequirement, TaskNode } from "./schemas";

export function getInternalSpecIdFromTask(task: TaskNode): string | null {
  const meta = task.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta) && "internalSpecId" in meta) {
    const id = (meta as { internalSpecId?: unknown }).internalSpecId;
    if (typeof id === "string" && /^VP-\d+$/.test(id)) {
      return id;
    }
  }
  const m = /^\[(VP-\d+)\]\s*/.exec(task.title.trim());
  return m?.[1] ?? null;
}

/** Removes a leading `[VP-…] ` prefix from titles for display when the id is shown separately. */
export function stripInternalSpecIdFromTitle(title: string): string {
  const stripped = title.replace(/^\[VP-\d]+\]\s+/, "").trim();
  return stripped.length > 0 ? stripped : title;
}

export function formatFunctionalRequirementsAsAcceptanceChecklist(frs: FunctionalRequirement[]): string {
  if (frs.length === 0) {
    return "";
  }
  const lines = frs.map((fr) => {
    const head = `- [ ] **${fr.id}**: ${fr.title}`;
    if (fr.details.length === 0) {
      return head;
    }
    const detailLines = fr.details.map((d) => `  - ${d}`).join("\n");
    return `${head}\n${detailLines}`;
  });
  return ["### Acceptance Criteria", "", ...lines].join("\n");
}

type BuildLinearIssueMarkdownInput = {
  figmaUrl?: string | null;
};

/**
 * Canonical Linear issue body for task exports and previews.
 */
export function buildLinearIssueMarkdown(task: TaskNode, input: BuildLinearIssueMarkdownInput = {}): string | undefined {
  const lines: string[] = [];
  const specId = getInternalSpecIdFromTask(task);
  const figmaUrl = typeof input.figmaUrl === "string" && input.figmaUrl.trim().length > 0 ? input.figmaUrl.trim() : null;

  lines.push("## Reference", "");
  if (specId) {
    lines.push(`- **Internal spec ID:** ${specId}`);
  }
  if (figmaUrl) {
    lines.push(`- **Figma:** [Open node](${figmaUrl})`);
  }
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (task.description?.trim()) {
    lines.push("", "## Implementation Details", task.description.trim());
  }

  if (task.acceptanceCriteria.length > 0) {
    lines.push("", "### Acceptance Criteria", "");
    for (const criterion of task.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  if (task.specReferences.length > 0) {
    lines.push("", "## Spec References");
    for (const reference of task.specReferences) {
      lines.push(`- ${reference}`);
    }
  }

  const body = lines.join("\n").trim();
  return body.length > 0 ? body : undefined;
}
