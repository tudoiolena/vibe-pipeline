import { createClient } from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildFullHandoffFileMapFromData } from "@/lib/full-handoff-file-map";
import { buildProjectSpecPack, withCursorHandoffDoc } from "@/lib/project-spec-files";
import { cursorRuleZipPath, loadProjectHandoffData } from "@/lib/project-handoff-data";
import { specPackToZipEntries, zipRecord } from "@/lib/handoff-zip";

const FormatSchema = z.enum(["spec-pack-zip", "cursor-rules-zip", "full-handoff-zip", "artifacts-json"]);

type RouteContext = { params: Promise<{ id: string }> };

function zipResponse(body: Uint8Array, downloadName: string): Response {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${downloadName.replace(/"/g, "")}"`
    }
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const idParse = z.string().uuid().safeParse(projectId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }

  const url = new URL(request.url);
  const formatParse = FormatSchema.safeParse(url.searchParams.get("format") ?? "spec-pack-zip");
  if (!formatParse.success) {
    return NextResponse.json(
      {
        error: "Invalid format.",
        allowed: FormatSchema.options
      },
      { status: 400 }
    );
  }
  const format = formatParse.data;

  const client = createClient();

  try {
    const data = await loadProjectHandoffData(client, projectId);

    if (!data.projectExists) {
      console.error("[GET export/handoff] project not found:", projectId);
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (format === "artifacts-json") {
      const issues: string[] = [];
      if (data.prdLoadError) {
        issues.push(`prd: ${data.prdLoadError}`);
      }
      if (data.taskTreeLoadError) {
        issues.push(`tasks: ${data.taskTreeLoadError}`);
      }
      if (data.rawPrdFromDb == null) {
        issues.push("prd: no PRD artifact row or empty content_json");
      }
      if (data.rawTasksFromDb == null) {
        issues.push("tasks: no tasks artifact row or empty content_json");
      }
      if (data.briefLoadError) {
        issues.push(`brief: ${data.briefLoadError}`);
      } else if (data.rawBriefFromDb == null) {
        issues.push("brief: no brief artifact row or empty content_json");
      }
      if (data.cursorRulesLoadError) {
        issues.push(`cursorRules: ${data.cursorRulesLoadError}`);
      } else if (data.rawCursorRulesFromDb == null) {
        issues.push("cursorRules: no cursor_rules artifact row or empty content_json");
      }
      if (data.designMapLoadError) {
        issues.push(`designMap: ${data.designMapLoadError}`);
      }
      if (data.uiKitLoadError) {
        issues.push(`uiKit: ${data.uiKitLoadError}`);
      }
      if (data.rawDesignMapFromDb == null) {
        issues.push("designMap: no design_map artifact row or empty content_json");
      }
      if (data.rawUiKitFromDb == null) {
        issues.push("uiKit: no ui_kit artifact row or empty content_json");
      }
      return NextResponse.json(
        {
          projectId,
          prd: data.rawPrdFromDb,
          taskTree: data.rawTasksFromDb,
          brief: data.rawBriefFromDb,
          designMap: data.rawDesignMapFromDb,
          uiKit: data.rawUiKitFromDb,
          cursorRules: data.rawCursorRulesFromDb,
          issues
        },
        { status: 200 }
      );
    }

    if (format === "spec-pack-zip") {
      if (!data.prd) {
        const msg = data.prdLoadError ?? "No valid PRD artifact.";
        console.error("[GET export/handoff] spec-pack-zip blocked:", msg);
        return NextResponse.json({ error: msg }, { status: 400 });
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
      const entries = specPackToZipEntries(specFiles);
      if (Object.keys(entries).length === 0) {
        console.error("[GET export/handoff] spec-pack-zip produced zero entries");
        return NextResponse.json({ error: "Spec pack resolved to zero files (invalid filenames?)." }, { status: 500 });
      }
      const zipped = zipRecord(entries);
      return zipResponse(zipped, `project-${projectId.slice(0, 8)}-project-spec.zip`);
    }

    if (format === "cursor-rules-zip") {
      if (data.cursorRules.length === 0) {
        const msg = data.cursorRulesLoadError ?? "No valid cursor_rules artifact.";
        console.error("[GET export/handoff] cursor-rules-zip blocked:", msg);
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const entries: Record<string, string> = {};
      for (const rule of data.cursorRules) {
        entries[cursorRuleZipPath(rule.filename)] = rule.content;
      }
      const zipped = zipRecord(entries);
      return zipResponse(zipped, `project-${projectId.slice(0, 8)}-cursor-rules.zip`);
    }

    // full-handoff-zip
    const fullMap = buildFullHandoffFileMapFromData(data);
    if (!fullMap.ok) {
      const msg = fullMap.error;
      console.error("[GET export/handoff] full-handoff-zip blocked:", msg);
      return NextResponse.json({ error: msg }, { status: fullMap.status });
    }

    const zipped = zipRecord(fullMap.files);
    return zipResponse(zipped, `project-${projectId.slice(0, 8)}-full-handoff.zip`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET export/handoff] unexpected:", err);
    return NextResponse.json({ error: `Export failed: ${message}` }, { status: 500 });
  }
}
