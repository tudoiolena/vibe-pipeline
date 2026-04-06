import type { DatabaseClient } from "@vibe/database";
import { buildProjectSpecPack, withCursorHandoffDoc } from "@/lib/project-spec-files";
import { cursorRuleZipPath, loadProjectHandoffData, type ProjectHandoffData } from "@/lib/project-handoff-data";
import { specPackToZipEntries } from "@/lib/handoff-zip";

export type FullHandoffFileMapResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; error: string; status: 400 | 404 | 500 };

export function buildFullHandoffFileMapFromData(data: ProjectHandoffData): FullHandoffFileMapResult {
  if (!data.projectExists) {
    return { ok: false, error: "Project not found.", status: 404 };
  }
  if (!data.prd) {
    return { ok: false, error: data.prdLoadError ?? "No valid PRD artifact.", status: 400 };
  }

  const specFiles = withCursorHandoffDoc(
    buildProjectSpecPack({
      prd: data.prd,
      uiKit: data.uiKit ?? undefined,
      brief: data.brief ?? undefined,
      designMap: data.designMap,
      taskTree: data.taskTree ?? undefined
    })
  );
  const merged: Record<string, string> = { ...specPackToZipEntries(specFiles) };

  merged["artifacts/prd.json"] = JSON.stringify(data.rawPrdFromDb ?? data.prd, null, 2);
  if (data.rawTasksFromDb != null) {
    merged["artifacts/tasks.json"] = JSON.stringify(data.rawTasksFromDb, null, 2);
  } else {
    merged["artifacts/TASKS_README.txt"] =
      data.taskTreeLoadError != null ? `${data.taskTreeLoadError}\n` : "No tasks artifact.\n";
  }

  if (data.cursorRules.length > 0) {
    for (const rule of data.cursorRules) {
      merged[cursorRuleZipPath(rule.filename)] = rule.content;
    }
  } else {
    merged[".cursor/rules/README.txt"] =
      data.cursorRulesLoadError != null
        ? `${data.cursorRulesLoadError}\n`
        : "No cursor_rules artifact.\n";
  }

  return { ok: true, files: merged };
}

export async function buildFullHandoffFileMap(
  client: DatabaseClient,
  projectId: string
): Promise<FullHandoffFileMapResult> {
  const data = await loadProjectHandoffData(client, projectId);
  return buildFullHandoffFileMapFromData(data);
}
