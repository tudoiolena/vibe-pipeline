import { LinearClient } from "@linear/sdk";
import type { DesignMap, TaskNode } from "@vibe/schema";
import { requireLinearApiKey } from "../env";

export type LinearExportedIssue = {
  externalKey: string;
  issueId: string;
  url: string | null;
};

function resolveFigmaDesignUrl(externalKey: string, designMap: DesignMap | undefined): string | null {
  if (!designMap?.links.length) {
    return null;
  }
  for (const link of designMap.links) {
    if (link.taskExternalKey !== externalKey) {
      continue;
    }
    const node = designMap.nodes.find((n) => n.nodeId === link.nodeId);
    if (node?.figmaUrl) {
      return node.figmaUrl;
    }
  }
  return null;
}

function buildIssueDescription(task: TaskNode, designMap: DesignMap | undefined): string | undefined {
  const parts: string[] = [];
  if (task.description?.trim()) {
    parts.push(task.description.trim());
  }
  const figmaUrl = resolveFigmaDesignUrl(task.externalKey, designMap);
  if (figmaUrl) {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push("## Design Reference", `[Figma](${figmaUrl})`);
  }
  const body = parts.join("\n").trim();
  return body.length > 0 ? body : undefined;
}

/**
 * Creates one Linear issue per task in order. Appends a Design Reference link when
 * {@link DesignMap} links resolve to a node with a Figma URL for that task's {@link TaskNode.externalKey}.
 */
export async function exportTasksToLinear(
  tasks: TaskNode[],
  teamId: string,
  designMap?: DesignMap
): Promise<{ issues: LinearExportedIssue[] }> {
  const client = new LinearClient({ apiKey: requireLinearApiKey() });
  const issues: LinearExportedIssue[] = [];

  for (const task of tasks) {
    const payload = await client.createIssue({
      teamId,
      title: task.title,
      description: buildIssueDescription(task, designMap)
    });

    if (!payload.success) {
      throw new Error(`Linear rejected issue create for task ${task.externalKey}.`);
    }

    const issuePromise = payload.issue;
    if (!issuePromise) {
      throw new Error(`Linear returned no issue for task ${task.externalKey}.`);
    }

    const issue = await issuePromise;
    issues.push({
      externalKey: task.externalKey,
      issueId: issue.id,
      url: issue.url ?? null
    });
  }

  return { issues };
}
