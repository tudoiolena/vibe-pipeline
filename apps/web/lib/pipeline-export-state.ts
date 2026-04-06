import type { DatabaseClient } from "@vibe/database";
import { getLatestArtifactVersion } from "@vibe/database";
import {
  BriefSchema,
  DesignMapSchema,
  TaskTreeSchema,
  UIKitSchema,
  type Brief,
  type DesignMap,
  type TaskTree,
  type UIKit
} from "@vibe/schema";
import { z } from "zod";

export type ResolveTaskTreeResult = {
  taskTree: TaskTree | null;
  /** Set when the latest tasks artifact exists but is invalid, or the DB read fails. */
  loadError: string | null;
};

/** Latest `tasks` artifact only. */
export async function resolveTaskTreeForSession(
  client: DatabaseClient,
  projectId: string
): Promise<ResolveTaskTreeResult> {
  const { data: artifact, error: artifactError } = await getLatestArtifactVersion(client, projectId, "tasks");
  if (artifactError) {
    return { taskTree: null, loadError: `Failed to load tasks artifact: ${artifactError.message}` };
  }
  if (!artifact?.content_json) {
    return { taskTree: null, loadError: null };
  }
  const parsed = TaskTreeSchema.safeParse(artifact.content_json);
  if (!parsed.success) {
    return {
      taskTree: null,
      loadError: `Latest tasks artifact failed validation: ${parsed.error.message}`
    };
  }
  return { taskTree: parsed.data, loadError: null };
}

export type ResolveBriefResult = {
  brief: Brief | null;
  /** Set when the latest brief artifact exists but is invalid, or the DB read fails. */
  loadError: string | null;
};

/** Latest `brief` artifact only. */
export async function resolveBriefForSession(
  client: DatabaseClient,
  projectId: string
): Promise<ResolveBriefResult> {
  const { data: artifact, error: artifactError } = await getLatestArtifactVersion(client, projectId, "brief");
  if (artifactError) {
    return { brief: null, loadError: `Failed to load brief artifact: ${artifactError.message}` };
  }
  if (artifact?.content_json == null) {
    return { brief: null, loadError: null };
  }
  const parsed = BriefSchema.safeParse(artifact.content_json);
  if (!parsed.success) {
    return {
      brief: null,
      loadError: `Latest brief artifact failed validation: ${parsed.error.message}`
    };
  }
  return { brief: parsed.data, loadError: null };
}

export type ResolveDesignMapResult = {
  designMap: DesignMap | undefined;
  loadError: string | null;
};

/** Latest `design_map` artifact only. */
export async function resolveDesignMapForSession(
  client: DatabaseClient,
  projectId: string
): Promise<ResolveDesignMapResult> {
  const { data: artifact, error: artifactError } = await getLatestArtifactVersion(client, projectId, "design_map");
  if (artifactError) {
    return { designMap: undefined, loadError: `Failed to load design_map artifact: ${artifactError.message}` };
  }
  if (artifact?.content_json == null) {
    return { designMap: undefined, loadError: null };
  }
  const parsed = DesignMapSchema.safeParse(artifact.content_json);
  if (!parsed.success) {
    return {
      designMap: undefined,
      loadError: `Latest design_map artifact failed validation: ${parsed.error.message}`
    };
  }
  return { designMap: parsed.data, loadError: null };
}

export type ResolveUIKitResult = {
  uiKit: UIKit | null;
  loadError: string | null;
};

/** Latest `ui_kit` artifact only. */
export async function resolveUIKitForSession(
  client: DatabaseClient,
  projectId: string
): Promise<ResolveUIKitResult> {
  const { data: artifact, error: artifactError } = await getLatestArtifactVersion(client, projectId, "ui_kit");
  if (artifactError) {
    return { uiKit: null, loadError: `Failed to load ui_kit artifact: ${artifactError.message}` };
  }
  if (artifact?.content_json == null) {
    return { uiKit: null, loadError: null };
  }
  const parsed = UIKitSchema.safeParse(artifact.content_json);
  if (!parsed.success) {
    return {
      uiKit: null,
      loadError: `Latest ui_kit artifact failed validation: ${parsed.error.message}`
    };
  }
  return { uiKit: parsed.data, loadError: null };
}

export type CursorRuleFile = {
  filename: string;
  content: string;
};

const CursorRulesArtifactSchema = z
  .array(
    z.object({
      filename: z.string().min(1),
      content: z.string().min(1)
    })
  )
  .min(1);

export type ResolveCursorRulesResult = {
  cursorRules: CursorRuleFile[];
  loadError: string | null;
};

/** Latest `cursor_rules` artifact only. */
export async function resolveCursorRulesForSession(
  client: DatabaseClient,
  projectId: string
): Promise<ResolveCursorRulesResult> {
  const { data: artifact, error: artifactError } = await getLatestArtifactVersion(client, projectId, "cursor_rules");
  if (artifactError) {
    return { cursorRules: [], loadError: `Failed to load cursor_rules artifact: ${artifactError.message}` };
  }
  if (artifact?.content_json == null) {
    return { cursorRules: [], loadError: null };
  }
  const parsed = CursorRulesArtifactSchema.safeParse(artifact.content_json);
  if (!parsed.success) {
    return {
      cursorRules: [],
      loadError: `Latest cursor_rules artifact failed validation: ${parsed.error.message}`
    };
  }
  return { cursorRules: parsed.data, loadError: null };
}

export { flattenTaskTree } from "./task-tree-utils";
