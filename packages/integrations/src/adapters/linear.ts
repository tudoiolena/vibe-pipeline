import { LinearClient } from "@linear/sdk";
import {
  buildLinearIssueMarkdown,
  type DesignMap,
  type TaskNode
} from "@vibe/schema";
import { requireLinearApiKey } from "../env";

export type LinearExportedIssue = {
  externalKey: string;
  issueId: string;
  url: string | null;
};

export type ExportTasksToLinearOptions = {
  designMap?: DesignMap;
};

function figmaNodeUrl(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
}

function resolveFigmaDesignUrl(task: TaskNode, designMap: DesignMap | undefined): string | null {
  const meta = task.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const explicit = (meta as { figmaUrl?: unknown }).figmaUrl;
    if (typeof explicit === "string" && /^https?:\/\//.test(explicit)) {
      return explicit;
    }
    const nodeId = (meta as { figmaNodeId?: unknown }).figmaNodeId;
    const fileKey = (meta as { figmaFileKey?: unknown }).figmaFileKey;
    if (typeof nodeId === "string" && nodeId.trim() && typeof fileKey === "string" && fileKey.trim()) {
      return figmaNodeUrl(fileKey.trim(), nodeId.trim());
    }
  }

  if (!designMap?.links.length) {
    return null;
  }
  for (const link of designMap.links) {
    if (link.taskExternalKey !== task.externalKey) {
      continue;
    }
    const node = designMap.nodes.find((n) => n.nodeId === link.nodeId);
    if (node?.figmaUrl) {
      return node.figmaUrl;
    }
  }
  return null;
}

/**
 * Creates one Linear issue per task in order using the canonical markdown body:
 * Reference, Implementation Details, Acceptance Criteria, and Spec References.
 */
export async function exportTasksToLinear(
  tasks: TaskNode[],
  teamId: string,
  options?: ExportTasksToLinearOptions
): Promise<{ issues: LinearExportedIssue[] }> {
  const designMap = options?.designMap;
  const client = new LinearClient({ apiKey: requireLinearApiKey() });
  const issues: LinearExportedIssue[] = [];

  for (const task of tasks) {
    const payload = await client.createIssue({
      teamId,
      title: task.title,
      description: buildLinearIssueMarkdown(task, {
        figmaUrl: resolveFigmaDesignUrl(task, designMap)
      })
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
