/**
 * One-off: copy brief, designMap, uiKit, and cursorRules from LangGraph checkpoint `state_json` into
 * `artifacts` rows where missing.
 *
 * Usage (from repo root, with Supabase env set as for the pipeline):
 *   pnpm --filter @vibe/ai backfill:handoff-artifacts
 *   # or: pnpm --filter @vibe/ai exec tsx src/scripts/backfill-handoff-artifacts-from-checkpoints.ts
 */
import {
  createArtifactVersion,
  createClient,
  getLatestArtifactVersion,
  listProjectSessionsForBackfill,
  type Json
} from "@vibe/database";
import { BriefSchema, DesignMapSchema, UIKitSchema } from "@vibe/schema";
import type { PersistedCheckpointEnvelope } from "../graph";
import { z } from "zod";

const CursorRulesCheckpointSchema = z
  .array(
    z.object({
      filename: z.string().min(1),
      content: z.string().min(1)
    })
  )
  .min(1);

function parseEnvelope(stateJson: unknown): PersistedCheckpointEnvelope | null {
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }
  const candidate = stateJson as Partial<PersistedCheckpointEnvelope>;
  if (!candidate.pipelineState || !candidate.checkpoint) {
    return null;
  }
  return candidate as PersistedCheckpointEnvelope;
}

function innerStateJson(stateJson: unknown): Record<string, unknown> | null {
  const env = parseEnvelope(stateJson);
  const raw = env?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function parseCursorRulesFromCheckpoint(stateJson: unknown): z.infer<typeof CursorRulesCheckpointSchema> | null {
  const inner = innerStateJson(stateJson);
  if (!inner) {
    return null;
  }
  const cursorRules = inner.cursorRules;
  const out: { filename: string; content: string }[] = [];
  if (Array.isArray(cursorRules)) {
    for (const rule of cursorRules) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        continue;
      }
      const entry = rule as Record<string, unknown>;
      const filename =
        typeof entry.filename === "string"
          ? entry.filename
          : typeof entry.path === "string"
            ? entry.path
            : typeof entry.filePath === "string"
              ? entry.filePath
              : null;
      const content = typeof entry.content === "string" ? entry.content : null;
      if (filename && content) {
        out.push({ filename, content });
      }
    }
  } else if (cursorRules && typeof cursorRules === "object" && !Array.isArray(cursorRules)) {
    for (const [filename, content] of Object.entries(cursorRules)) {
      if (typeof filename === "string" && typeof content === "string") {
        out.push({ filename, content });
      }
    }
  }
  const parsed = CursorRulesCheckpointSchema.safeParse(out);
  return parsed.success ? parsed.data : null;
}

async function main(): Promise<void> {
  const client = createClient();
  const { data: sessions, error: listError } = await listProjectSessionsForBackfill(client);
  if (listError || !sessions) {
    console.error("Failed to list sessions:", listError?.message ?? "unknown");
    process.exitCode = 1;
    return;
  }

  let briefInserted = 0;
  let designInserted = 0;
  let uiKitInserted = 0;
  let rulesInserted = 0;
  let skipped = 0;

  for (const row of sessions) {
    const inner = innerStateJson(row.state_json);
    if (!inner) {
      skipped += 1;
      continue;
    }

    const briefParsed = BriefSchema.safeParse(inner.brief);
    if (briefParsed.success) {
      const { data: latestBrief } = await getLatestArtifactVersion(client, row.project_id, "brief");
      if (!latestBrief?.content_json) {
        const nextVersion = (latestBrief?.version ?? 0) + 1;
        const { error } = await createArtifactVersion(client, {
          project_id: row.project_id,
          session_id: row.id,
          artifact_type: "brief",
          format: "json",
          version: nextVersion,
          status: "draft",
          content_json: briefParsed.data as unknown as Json
        });
        if (error) {
          console.error(`brief insert failed session=${row.id}:`, error.message);
        } else {
          briefInserted += 1;
        }
      }
    }

    const dmParsed = DesignMapSchema.safeParse(inner.designMap);
    if (dmParsed.success) {
      const { data: latestDm } = await getLatestArtifactVersion(client, row.project_id, "design_map");
      if (!latestDm?.content_json) {
        const nextVersion = (latestDm?.version ?? 0) + 1;
        const { error } = await createArtifactVersion(client, {
          project_id: row.project_id,
          session_id: row.id,
          artifact_type: "design_map",
          format: "json",
          version: nextVersion,
          status: "draft",
          content_json: dmParsed.data as unknown as Json
        });
        if (error) {
          console.error(`design_map insert failed session=${row.id}:`, error.message);
        } else {
          designInserted += 1;
        }
      }
    }

    const ukParsed = UIKitSchema.safeParse(inner.uiKit);
    if (ukParsed.success) {
      const { data: latestUk } = await getLatestArtifactVersion(client, row.project_id, "ui_kit");
      if (!latestUk?.content_json) {
        const nextVersion = (latestUk?.version ?? 0) + 1;
        const { error } = await createArtifactVersion(client, {
          project_id: row.project_id,
          session_id: row.id,
          artifact_type: "ui_kit",
          format: "json",
          version: nextVersion,
          status: "draft",
          content_json: ukParsed.data as unknown as Json
        });
        if (error) {
          console.error(`ui_kit insert failed session=${row.id}:`, error.message);
        } else {
          uiKitInserted += 1;
        }
      }
    }

    const rules = parseCursorRulesFromCheckpoint(row.state_json);
    if (rules) {
      const { data: latestCr } = await getLatestArtifactVersion(client, row.project_id, "cursor_rules");
      if (!latestCr?.content_json) {
        const nextVersion = (latestCr?.version ?? 0) + 1;
        const { error } = await createArtifactVersion(client, {
          project_id: row.project_id,
          session_id: row.id,
          artifact_type: "cursor_rules",
          format: "json",
          version: nextVersion,
          status: "draft",
          content_json: rules as unknown as Json
        });
        if (error) {
          console.error(`cursor_rules insert failed session=${row.id}:`, error.message);
        } else {
          rulesInserted += 1;
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        sessionsScanned: sessions.length,
        skippedNoEnvelope: skipped,
        briefInserted,
        design_mapInserted: designInserted,
        ui_kitInserted: uiKitInserted,
        cursor_rulesInserted: rulesInserted
      },
      null,
      2
    )
  );
}

void main();
