import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createArtifactVersion,
  getLatestArtifactVersion,
  type DatabaseClient,
  type Json,
  type TableInsert
} from "@vibe/database";
import {
  DesignMapSchema,
  UIKitSchema,
  type BriefSchema,
  type PRDSchema,
  type TaskTreeSchema
} from "@vibe/schema";
import type { PipelineState } from "../../state";
import { resolveFigmaFileKeyFromProject } from "./figma-project-key";

type TaskNode = z.infer<typeof TaskTreeSchema>["epics"][number];

/** Matches `GapDetectionOutputSchema` gaps (avoid importing intake → circular). */
export type GapItem = {
  title: string;
  description: string;
  priority: "High" | "Med" | "Low";
  type: "NFR" | "Security" | "Scale" | "Business Logic";
};

type DesignLink = z.infer<typeof DesignMapSchema>["links"][number];

const GapAnalysisStateJsonSchema = z.object({
  gaps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        priority: z.enum(["High", "Med", "Low"]),
        type: z.string()
      })
    )
    .default([])
});

/** Appended to `stateJson.clarificationTimestamps` for chronological history (session envelope). */
export type ClarificationTimelineEvent =
  | { at: string; kind: "figma_verified"; fileKey?: string }
  | { at: string; kind: "figma_failed"; error?: string }
  | { at: string; kind: "clarifications_merged_into_brief" };

function isClarificationTimelineEvent(x: unknown): x is ClarificationTimelineEvent {
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    return false;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.at !== "string" || typeof o.kind !== "string") {
    return false;
  }
  return o.kind === "figma_verified" || o.kind === "figma_failed" || o.kind === "clarifications_merged_into_brief";
}

export type ClarificationTimelineEventInput =
  | { at?: string; kind: "figma_verified"; fileKey?: string }
  | { at?: string; kind: "figma_failed"; error?: string }
  | { at?: string; kind: "clarifications_merged_into_brief" };

export function appendClarificationTimelineEvent(
  stateJson: Record<string, unknown>,
  event: ClarificationTimelineEventInput
): Record<string, unknown> {
  const at = event.at ?? new Date().toISOString();
  const raw = stateJson.clarificationTimestamps;
  const prev = Array.isArray(raw) ? raw.filter(isClarificationTimelineEvent) : [];
  const normalized: ClarificationTimelineEvent =
    event.kind === "figma_verified"
      ? { at, kind: "figma_verified", fileKey: event.fileKey }
      : event.kind === "figma_failed"
        ? { at, kind: "figma_failed", error: event.error }
        : { at, kind: "clarifications_merged_into_brief" };
  const next: ClarificationTimelineEvent[] = [...prev, normalized];
  return { ...stateJson, clarificationTimestamps: next };
}

function normalizeGapTypeForSync(t: string): GapItem["type"] {
  if (t === "NFR" || t === "Security" || t === "Scale" || t === "Business Logic") {
    return t;
  }
  return "Business Logic";
}

async function fanOutRelationalFromPipelineStateAfterPrd(
  client: DatabaseClient,
  state: PipelineState,
  extras?: { uiKit?: z.infer<typeof UIKitSchema> }
): Promise<void> {
  const raw = state.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const sj = raw as Record<string, unknown>;
  const uiKitCandidate = extras?.uiKit ?? sj.uiKit;
  const ui = UIKitSchema.safeParse(uiKitCandidate);
  if (ui.success) {
    const k = ui.data;
    const n =
      k.colorPalette.length +
      k.typography.length +
      k.componentInventory.length +
      k.spacing.length +
      k.radii.length +
      k.effects.length;
    if (n > 0) {
      await syncPipelineEntity(client, {
        kind: "design_nodes",
        sessionId: state.sessionId,
        projectId: state.projectId,
        uiKit: k
      });
    }
  }
  const gaRaw = sj.gapAnalysis;
  if (gaRaw && typeof gaRaw === "object" && !Array.isArray(gaRaw)) {
    const parsed = GapAnalysisStateJsonSchema.safeParse(gaRaw);
    if (parsed.success) {
      const gaps: GapItem[] = parsed.data.gaps.map((g) => ({
        title: g.title,
        description: g.description,
        priority: g.priority,
        type: normalizeGapTypeForSync(g.type)
      }));
      await syncPipelineEntity(client, {
        kind: "clarifications",
        sessionId: state.sessionId,
        projectId: state.projectId,
        gaps
      });
    }
  }
}

export type SyncPipelineEntityInput =
  | { kind: "tasks"; sessionId: string; projectId?: string; taskTree: z.infer<typeof TaskTreeSchema> }
  | { kind: "design_nodes"; sessionId: string; projectId?: string; uiKit: z.infer<typeof UIKitSchema> }
  | { kind: "clarifications"; sessionId: string; projectId?: string; gaps: GapItem[] };

async function resolveProjectId(client: DatabaseClient, sessionId: string): Promise<string | null> {
  const { data, error } = await client.from("project_sessions").select("project_id").eq("id", sessionId).maybeSingle();
  if (error) {
    console.error("[persistence] resolveProjectId failed:", error.message);
    return null;
  }
  return data?.project_id ?? null;
}

async function resolveProjectIdForSync(
  client: DatabaseClient,
  sessionId: string,
  projectIdHint?: string
): Promise<string | null> {
  if (projectIdHint && projectIdHint.trim().length > 0) {
    return projectIdHint;
  }
  return resolveProjectId(client, sessionId);
}


function mapGapTypeToCategory(
  gap: GapItem
): "roles" | "nfr" | "edge_case" | "integration" | "security" | "scope" | "data" | "workflow" {
  switch (gap.type) {
    case "NFR":
      return "nfr";
    case "Security":
      return "security";
    case "Scale":
      return "nfr";
    case "Business Logic":
    default:
      return "workflow";
  }
}

function mapGapPriority(priority: GapItem["priority"]): "low" | "medium" | "high" | "critical" {
  switch (priority) {
    case "High":
      return "high";
    case "Med":
      return "medium";
    case "Low":
    default:
      return "low";
  }
}

/** Stable per gap content so reruns upsert the same row (project_id, question_key). */
function gapQuestionKey(gap: GapItem): string {
  const hash = createHash("sha256")
    .update(`${gap.title}|${gap.description}|${gap.type}`)
    .digest("hex")
    .slice(0, 16);
  return `gap-${hash}`;
}

function slugTokenPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "item";
}

async function syncClarificationsInternal(
  client: DatabaseClient,
  sessionId: string,
  projectId: string,
  gaps: GapItem[]
): Promise<void> {
  const newKeys = new Set(gaps.map((gap) => gapQuestionKey(gap)));

  const { data: activeRows, error: selectErr } = await client
    .from("clarifications")
    .select("question_key")
    .eq("project_id", projectId)
    .in("status", ["pending", "open"]);
  if (selectErr) {
    console.error("[syncClarifications] select active failed:", selectErr.message);
    return;
  }
  const toResolve = (activeRows ?? [])
    .map((r) => r.question_key)
    .filter((key) => !newKeys.has(key));
  if (toResolve.length > 0) {
    const { error: resolveErr } = await client
      .from("clarifications")
      .update({ status: "resolved" })
      .eq("project_id", projectId)
      .in("question_key", toResolve);
    if (resolveErr) {
      console.error("[syncClarifications] resolve stale failed:", resolveErr.message);
    }
  }

  const rows = gaps.map((gap) => ({
    project_id: projectId,
    session_id: sessionId,
    question_key: gapQuestionKey(gap),
    question_text: `${gap.title}\n\n${gap.description}`,
    category: mapGapTypeToCategory(gap),
    priority: mapGapPriority(gap.priority),
    status: "pending" as const
  }));
  if (rows.length === 0) {
    return;
  }
  const { error } = await client.from("clarifications").upsert(rows, { onConflict: "project_id,question_key" });
  if (error) {
    console.error("[syncClarifications] upsert failed:", error.message);
  }
}

async function syncDesignNodesInternal(
  client: DatabaseClient,
  projectId: string,
  uiKit: z.infer<typeof UIKitSchema>
): Promise<void> {
  const figmaFileKey = uiKit.figmaExtraction?.fileKey?.trim() || "__uikit_tokens__";
  const rows: TableInsert<"design_nodes">[] = [];

  uiKit.colorPalette.forEach((token, index) => {
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: `token:color:${slugTokenPart(token.name)}-${index}`,
      node_type: "token",
      node_name: token.name,
      figma_url: null,
      origin: "figma",
      raw_payload: { kind: "color", hex: token.hex, description: token.description ?? null } as unknown as Json
    });
  });

  uiKit.typography.forEach((token, index) => {
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: `token:typography:${slugTokenPart(token.name)}-${index}`,
      node_type: "token",
      node_name: token.name,
      figma_url: null,
      origin: "figma",
      raw_payload: {
        kind: "typography",
        fontFamily: token.fontFamily ?? null,
        fontWeight: token.fontWeight ?? null,
        fontSize: token.fontSize ?? null,
        lineHeight: token.lineHeight ?? null,
        letterSpacing: token.letterSpacing ?? null,
        description: token.description ?? null
      } as unknown as Json
    });
  });

  uiKit.componentInventory.forEach((comp, index) => {
    const nodeId = comp.nodeId?.trim() || `component:${slugTokenPart(comp.name)}-${index}`;
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: nodeId,
      node_type: "component",
      node_name: comp.name,
      figma_url: null,
      origin: "figma",
      raw_payload: {
        kind: "component",
        key: comp.key ?? null,
        description: comp.description ?? null
      } as unknown as Json
    });
  });

  uiKit.spacing.forEach((token, index) => {
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: `token:spacing:${slugTokenPart(token.name)}-${index}`,
      node_type: "token",
      node_name: token.name,
      figma_url: null,
      origin: "figma",
      raw_payload: {
        kind: "spacing",
        value: token.value,
        figmaSource: token.figmaSource ?? null,
        description: token.description ?? null
      } as unknown as Json
    });
  });

  uiKit.radii.forEach((token, index) => {
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: `token:radius:${slugTokenPart(token.name)}-${index}`,
      node_type: "token",
      node_name: token.name,
      figma_url: null,
      origin: "figma",
      raw_payload: {
        kind: "radius",
        value: token.value,
        figmaSource: token.figmaSource ?? null,
        description: token.description ?? null
      } as unknown as Json
    });
  });

  uiKit.effects.forEach((token, index) => {
    rows.push({
      project_id: projectId,
      figma_file_key: figmaFileKey,
      node_id: `token:effect:${slugTokenPart(token.name)}-${index}`,
      node_type: "token",
      node_name: token.name,
      figma_url: null,
      origin: "figma",
      raw_payload: {
        kind: "effect",
        value: token.value,
        figmaSource: token.figmaSource ?? null,
        description: token.description ?? null
      } as unknown as Json
    });
  });

  if (rows.length === 0) {
    return;
  }
  const { error } = await client.from("design_nodes").upsert(rows, {
    onConflict: "project_id,figma_file_key,node_id"
  });
  if (error) {
    console.error("[syncDesignNodes] upsert failed:", error.message);
  }
}

function readTaskUuid(node: TaskNode): string {
  const m = node.metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const u = (m as Record<string, unknown>).uuid;
    if (typeof u === "string" && /^[0-9a-f-]{36}$/i.test(u)) {
      return u;
    }
  }
  return randomUUID();
}

function collectTaskInserts(
  nodes: TaskNode[],
  parentUuid: string | null,
  projectId: string,
  sessionId: string,
  out: TableInsert<"tasks">[]
): void {
  for (const node of nodes) {
    const id = readTaskUuid(node);
    out.push({
      id,
      project_id: projectId,
      session_id: sessionId,
      parent_task_id: parentUuid,
      hierarchy_level: node.hierarchyLevel,
      task_type: node.taskType,
      external_key: node.externalKey,
      title: node.title,
      description: node.description,
      status: node.status,
      priority: node.priority,
      estimate_points: node.estimatePoints,
      acceptance_criteria: node.acceptanceCriteria as unknown as Json,
      dependencies: node.dependencies as unknown as Json,
      metadata: node.metadata as unknown as Json
    });
    collectTaskInserts(node.children, id, projectId, sessionId, out);
  }
}

/** Depth-first flatten of `taskTree` into task rows (`external_key` is the stable business id, e.g. TS-1). */
export function flattenTaskTreeToRows(
  taskTree: z.infer<typeof TaskTreeSchema>,
  projectId: string,
  sessionId: string
): TableInsert<"tasks">[] {
  const rows: TableInsert<"tasks">[] = [];
  collectTaskInserts(taskTree.epics, null, projectId, sessionId, rows);
  return rows;
}

async function syncTasksInternal(
  client: DatabaseClient,
  sessionId: string,
  projectId: string,
  taskTree: z.infer<typeof TaskTreeSchema>
): Promise<void> {
  const rows = flattenTaskTreeToRows(taskTree, projectId, sessionId);
  if (rows.length === 0) {
    return;
  }
  const { error } = await client.from("tasks").upsert(rows, { onConflict: "project_id,external_key" });
  if (error) {
    console.error("[syncTasks] upsert failed:", error.message);
  }
}

/**
 * Master entry for relational sync (tasks, design_nodes, clarifications).
 * Uses `project_id` + `session_id` on child tables; resolves `project_id` from the session when omitted.
 * Tasks: `ON CONFLICT (project_id, external_key)` (column `external_key` in DB).
 */
export async function syncPipelineEntity(client: DatabaseClient, input: SyncPipelineEntityInput): Promise<void> {
  try {
    const projectId = await resolveProjectIdForSync(client, input.sessionId, input.projectId);
    if (!projectId) {
      return;
    }
    switch (input.kind) {
      case "tasks":
        await syncTasksInternal(client, input.sessionId, projectId, input.taskTree);
        return;
      case "design_nodes":
        await syncDesignNodesInternal(client, projectId, input.uiKit);
        return;
      case "clarifications":
        await syncClarificationsInternal(client, input.sessionId, projectId, input.gaps);
        return;
    }
  } catch (err) {
    console.error("[syncPipelineEntity] unexpected error:", err instanceof Error ? err.message : String(err));
  }
}

export async function syncClarifications(
  client: DatabaseClient,
  sessionId: string,
  gaps: GapItem[],
  projectId?: string
): Promise<void> {
  return syncPipelineEntity(client, { kind: "clarifications", sessionId, projectId, gaps });
}

export async function syncDesignNodes(
  client: DatabaseClient,
  sessionId: string,
  uiKit: z.infer<typeof UIKitSchema>,
  projectId?: string
): Promise<void> {
  return syncPipelineEntity(client, { kind: "design_nodes", sessionId, projectId, uiKit });
}

export async function syncTasks(
  client: DatabaseClient,
  sessionId: string,
  taskTree: z.infer<typeof TaskTreeSchema>,
  projectId?: string
): Promise<void> {
  return syncPipelineEntity(client, { kind: "tasks", sessionId, projectId, taskTree });
}

export async function syncDesignTaskLinks(client: DatabaseClient, sessionId: string, links: DesignLink[]): Promise<void> {
  try {
    const projectId = await resolveProjectId(client, sessionId);
    if (!projectId) {
      if (links.length > 0) {
        console.error("[syncDesignTaskLinks] missing project_id on session; skipping link sync");
      }
      return;
    }
    const figmaFileKey = await resolveFigmaFileKeyFromProject(client, projectId);
    if (!figmaFileKey) {
      if (links.length > 0) {
        console.error("[syncDesignTaskLinks] missing Figma file key on project (source_figma_url); skipping link sync");
      }
      return;
    }
    const fk = figmaFileKey;

    const { data: taskRows, error: tasksError } = await client
      .from("tasks")
      .select("id, external_key, metadata, hierarchy_level, title")
      .eq("project_id", projectId)
      .eq("session_id", sessionId);
    if (tasksError) {
      console.error("[syncDesignTaskLinks] tasks select failed:", tasksError.message);
      return;
    }

    const taskIdByStory = new Map<string, string>();
    const taskIdByExternalKey = new Map<string, string>();
    const sorted = [...(taskRows ?? [])].sort((a, b) => a.hierarchy_level - b.hierarchy_level);
    for (const t of sorted) {
      taskIdByExternalKey.set(t.external_key, t.id);
      const meta = t.metadata as Record<string, unknown> | null;
      if (meta && typeof meta.sourceStory === "string" && !taskIdByStory.has(meta.sourceStory)) {
        taskIdByStory.set(meta.sourceStory, t.id);
      }
    }
    for (const t of sorted) {
      const m = typeof t.title === "string" ? /\b(US-[0-9]+)\b/i.exec(t.title) : null;
      if (m && !taskIdByStory.has(m[1])) {
        taskIdByStory.set(m[1], t.id);
      }
    }

    for (const link of links) {
      const taskId = taskIdByStory.get(link.taskExternalKey) ?? taskIdByExternalKey.get(link.taskExternalKey);
      if (!taskId) {
        console.error(
          "[syncDesignTaskLinks] skip link: no task for key",
          link.taskExternalKey,
          "nodeId",
          link.nodeId
        );
        continue;
      }

      const { data: nodeRow, error: nodeErr } = await client
        .from("design_nodes")
        .upsert(
          {
            project_id: projectId,
            figma_file_key: fk,
            node_id: link.nodeId,
            node_type: "screen",
            node_name: link.nodeId,
            figma_url: null,
            origin: "synthetic",
            raw_payload: { synthetic: true, fromDesignTaskLink: true } as unknown as Json
          },
          { onConflict: "project_id,figma_file_key,node_id" }
        )
        .select("id")
        .single();

      if (nodeErr || !nodeRow) {
        console.error("[syncDesignTaskLinks] design_node upsert failed:", nodeErr?.message ?? "no row");
        continue;
      }

      const { error: linkErr } = await client.from("design_task_links").upsert(
        {
          project_id: projectId,
          design_node_id: nodeRow.id,
          task_id: taskId,
          relation_type: link.relationType,
          confidence_score: link.confidenceScore,
          implementation_status: "not_started" as const,
          evidence: link.evidence as unknown as Json
        },
        { onConflict: "project_id,design_node_id,task_id,relation_type" }
      );
      if (linkErr) {
        console.error("[syncDesignTaskLinks] link upsert failed:", linkErr.message);
      }
    }
  } catch (err) {
    console.error("[syncDesignTaskLinks] unexpected error:", err instanceof Error ? err.message : String(err));
  }
}

export async function persistBriefArtifact(
  client: DatabaseClient,
  state: PipelineState,
  brief: z.infer<typeof BriefSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "brief");
  if (latestError) {
    throw new Error(`Failed to resolve latest brief artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "brief",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: brief
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist brief artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  return { id: artifact.id, version: artifact.version };
}

export async function persistPrdArtifact(
  client: DatabaseClient,
  state: PipelineState,
  prd: z.infer<typeof PRDSchema>,
  /** PRD node holds UI kit in a local variable until return; pass here so fan-out can sync `design_nodes`. */
  relationalExtras?: { uiKit?: z.infer<typeof UIKitSchema> }
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "prd");
  if (latestError) {
    throw new Error(`Failed to resolve latest PRD artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "prd",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: prd as unknown as Json
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist PRD artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  await fanOutRelationalFromPipelineStateAfterPrd(client, state, relationalExtras);
  return { id: artifact.id, version: artifact.version };
}

export async function persistTasksArtifact(
  client: DatabaseClient,
  state: PipelineState,
  taskTree: z.infer<typeof TaskTreeSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "tasks");
  if (latestError) {
    throw new Error(`Failed to resolve latest tasks artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "tasks",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: taskTree as unknown as Json
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist tasks artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  await syncPipelineEntity(client, {
    kind: "tasks",
    sessionId: state.sessionId,
    projectId: state.projectId,
    taskTree
  });
  return { id: artifact.id, version: artifact.version };
}

export async function persistDesignMapArtifact(
  client: DatabaseClient,
  state: PipelineState,
  designMap: z.infer<typeof DesignMapSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "design_map");
  if (latestError) {
    throw new Error(`Failed to resolve latest design_map artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "design_map",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: designMap as unknown as Json
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist design_map artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  return { id: artifact.id, version: artifact.version };
}

export async function persistUIKitArtifact(
  client: DatabaseClient,
  state: PipelineState,
  uiKit: z.infer<typeof UIKitSchema>
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "ui_kit");
  if (latestError) {
    throw new Error(`Failed to resolve latest ui_kit artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "ui_kit",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: uiKit as unknown as Json
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist ui_kit artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  return { id: artifact.id, version: artifact.version };
}

export type CursorRuleArtifactFile = { filename: string; content: string };

export async function persistCursorRulesArtifact(
  client: DatabaseClient,
  state: PipelineState,
  cursorRules: CursorRuleArtifactFile[]
): Promise<{ id: string; version: number }> {
  const { data: latest, error: latestError } = await getLatestArtifactVersion(client, state.projectId, "cursor_rules");
  if (latestError) {
    throw new Error(`Failed to resolve latest cursor_rules artifact version: ${latestError.message}`);
  }
  const { data: artifact, error: createError } = await createArtifactVersion(client, {
    project_id: state.projectId,
    session_id: state.sessionId,
    artifact_type: "cursor_rules",
    format: "json",
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    content_json: cursorRules as unknown as Json
  });
  if (createError || !artifact) {
    throw new Error(`Failed to persist cursor_rules artifact: ${createError?.message ?? "unknown insert error"}`);
  }
  return { id: artifact.id, version: artifact.version };
}
