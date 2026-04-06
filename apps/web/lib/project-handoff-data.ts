import type { DatabaseClient } from "@vibe/database";
import { getLatestArtifactVersion, getProjectById } from "@vibe/database";
import {
  resolveBriefForSession,
  resolveCursorRulesForSession,
  resolveDesignMapForSession,
  resolveTaskTreeForSession,
  resolveUIKitForSession,
  type CursorRuleFile
} from "@/lib/pipeline-export-state";
import { PRDSchema, type Brief, type DesignMap, type PRD, type TaskTree, type UIKit } from "@vibe/schema";

export type { CursorRuleFile };

export type ProjectHandoffData = {
  projectExists: boolean;
  prd: PRD | null;
  prdLoadError: string | null;
  rawPrdFromDb: unknown | null;
  taskTree: TaskTree | null;
  taskTreeLoadError: string | null;
  rawTasksFromDb: unknown | null;
  brief: Brief | null;
  briefLoadError: string | null;
  /** Latest `brief` artifact `content_json` when present (for JSON export). */
  rawBriefFromDb: unknown | null;
  designMap: DesignMap | undefined;
  designMapLoadError: string | null;
  rawDesignMapFromDb: unknown | null;
  uiKit: UIKit | null;
  uiKitLoadError: string | null;
  rawUiKitFromDb: unknown | null;
  cursorRules: CursorRuleFile[];
  cursorRulesLoadError: string | null;
  /** Latest `cursor_rules` artifact `content_json` when present (for JSON export). */
  rawCursorRulesFromDb: unknown | null;
};

/**
 * Loads handoff data from Supabase artifacts (strict for PRD, tasks, brief, design map, UI kit, cursor rules).
 */
export async function loadProjectHandoffData(client: DatabaseClient, projectId: string): Promise<ProjectHandoffData> {
  const empty: ProjectHandoffData = {
    projectExists: false,
    prd: null,
    prdLoadError: null,
    rawPrdFromDb: null,
    taskTree: null,
    taskTreeLoadError: null,
    rawTasksFromDb: null,
    brief: null,
    briefLoadError: null,
    rawBriefFromDb: null,
    designMap: undefined,
    designMapLoadError: null,
    rawDesignMapFromDb: null,
    uiKit: null,
    uiKitLoadError: null,
    rawUiKitFromDb: null,
    cursorRules: [],
    cursorRulesLoadError: null,
    rawCursorRulesFromDb: null
  };

  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError || !project) {
    return { ...empty, projectExists: false };
  }

  let prd: PRD | null = null;
  let prdLoadError: string | null = null;
  let rawPrdFromDb: unknown | null = null;
  const { data: prdArtifact, error: prdArtifactError } = await getLatestArtifactVersion(client, projectId, "prd");
  if (prdArtifactError) {
    prdLoadError = `Failed to load PRD artifact: ${prdArtifactError.message}`;
  } else if (prdArtifact?.content_json != null) {
    rawPrdFromDb = prdArtifact.content_json;
    const parsed = PRDSchema.safeParse(prdArtifact.content_json);
    if (parsed.success) {
      prd = parsed.data;
    } else {
      prdLoadError = `Latest PRD artifact failed validation: ${parsed.error.message}`;
    }
  }

  const resolvedTasks = await resolveTaskTreeForSession(client, projectId);
  let rawTasksFromDb: unknown | null = null;
  const { data: tasksArtifact } = await getLatestArtifactVersion(client, projectId, "tasks");
  if (tasksArtifact?.content_json != null) {
    rawTasksFromDb = tasksArtifact.content_json;
  }

  const resolvedBrief = await resolveBriefForSession(client, projectId);
  let rawBriefFromDb: unknown | null = null;
  const { data: briefArtifact } = await getLatestArtifactVersion(client, projectId, "brief");
  if (briefArtifact?.content_json != null) {
    rawBriefFromDb = briefArtifact.content_json;
  }
  const resolvedDesign = await resolveDesignMapForSession(client, projectId);
  const resolvedUi = await resolveUIKitForSession(client, projectId);
  const resolvedCursor = await resolveCursorRulesForSession(client, projectId);
  let rawCursorRulesFromDb: unknown | null = null;
  const { data: cursorRulesArtifact } = await getLatestArtifactVersion(client, projectId, "cursor_rules");
  if (cursorRulesArtifact?.content_json != null) {
    rawCursorRulesFromDb = cursorRulesArtifact.content_json;
  }
  let rawDesignMapFromDb: unknown | null = null;
  const { data: designMapArtifact } = await getLatestArtifactVersion(client, projectId, "design_map");
  if (designMapArtifact?.content_json != null) {
    rawDesignMapFromDb = designMapArtifact.content_json;
  }
  let rawUiKitFromDb: unknown | null = null;
  const { data: uiKitArtifact } = await getLatestArtifactVersion(client, projectId, "ui_kit");
  if (uiKitArtifact?.content_json != null) {
    rawUiKitFromDb = uiKitArtifact.content_json;
  }

  return {
    projectExists: true,
    prd,
    prdLoadError,
    rawPrdFromDb,
    taskTree: resolvedTasks.taskTree,
    taskTreeLoadError: resolvedTasks.loadError,
    rawTasksFromDb,
    brief: resolvedBrief.brief,
    briefLoadError: resolvedBrief.loadError,
    rawBriefFromDb,
    designMap: resolvedDesign.designMap,
    designMapLoadError: resolvedDesign.loadError,
    rawDesignMapFromDb,
    uiKit: resolvedUi.uiKit,
    uiKitLoadError: resolvedUi.loadError,
    rawUiKitFromDb,
    cursorRules: resolvedCursor.cursorRules,
    cursorRulesLoadError: resolvedCursor.loadError,
    rawCursorRulesFromDb
  };
}

/** Strip path junk for zip entries under `.cursor/rules/`. */
export function cursorRuleZipPath(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? filename;
  const safe = base.replace(/\.\./g, "_").replace(/^\/+/, "");
  return `.cursor/rules/${safe}`;
}
