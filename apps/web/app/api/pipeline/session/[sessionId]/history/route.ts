import {
  createClient,
  getProjectSessionById,
  listLanggraphCheckpointsBySessionId,
  type Json
} from "@vibe/database";
import { NextResponse } from "next/server";
import { z } from "zod";

const GapSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(["High", "Med", "Low"]),
  type: z.string()
});

type HistoryItemType = "USER_INPUT" | "ANALYSIS_RESULT" | "MILESTONE" | "BRIEF_UPDATE";

type HistoryEntry = {
  checkpointId: string;
  timestamp: string;
  type: HistoryItemType;
  milestoneLabel: string | null;
  userClarification: string | null;
  previousBrief: string | null;
  newBrief: string | null;
  gapCount: number;
  /** Gap count after the previous grouped history item (null = no prior gap snapshot). */
  gapCountBefore: number | null;
  hasGapAnalysis: boolean;
  gaps: z.infer<typeof GapSchema>[];
};

type RawRow = {
  checkpoint_id: string;
  checkpoint_ts: string | null;
  created_at: string;
  pipeline_state_json: Json;
};

const BURST_MS = 2000;

function rowTimeMs(row: RawRow): number {
  const iso = row.checkpoint_ts ?? row.created_at;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function gapAnalysisFromPipelineStateJson(pipelineStateJson: Json): {
  hasGapAnalysis: boolean;
  gaps: z.infer<typeof GapSchema>[];
} {
  if (!pipelineStateJson || typeof pipelineStateJson !== "object" || Array.isArray(pipelineStateJson)) {
    return { hasGapAnalysis: false, gaps: [] };
  }
  const stateJson = (pipelineStateJson as { stateJson?: unknown }).stateJson;
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return { hasGapAnalysis: false, gaps: [] };
  }
  const gapAnalysis = (stateJson as { gapAnalysis?: unknown }).gapAnalysis;
  if (!gapAnalysis || typeof gapAnalysis !== "object" || Array.isArray(gapAnalysis)) {
    return { hasGapAnalysis: false, gaps: [] };
  }
  const parsed = z
    .object({
      gaps: z.array(GapSchema).default([])
    })
    .safeParse(gapAnalysis);
  if (!parsed.success) {
    return { hasGapAnalysis: true, gaps: [] };
  }
  return { hasGapAnalysis: true, gaps: parsed.data.gaps };
}

function firstNonEmptyStringField(rec: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) {
        return t;
      }
    }
  }
  return null;
}

function userClarificationFromPipelineStateJson(pipelineStateJson: Json): string | null {
  if (!pipelineStateJson || typeof pipelineStateJson !== "object" || Array.isArray(pipelineStateJson)) {
    return null;
  }
  const stateJson = (pipelineStateJson as { stateJson?: unknown }).stateJson;
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }
  const rec = stateJson as Record<string, unknown>;
  return firstNonEmptyStringField(rec, [
    "clarificationInput",
    "userClarification",
    "lastUserClarification",
    "clarificationFollowUp"
  ]);
}

const BriefUpdateMetaSchema = z.object({
  is_brief_update: z.literal(true),
  previous_brief: z.string(),
  new_brief: z.string()
});

/** Brief pivot: only after intake normalizer so a single checkpoint records the change. */
function briefUpdateFromPipelineStateJson(pipelineStateJson: Json): z.infer<typeof BriefUpdateMetaSchema> | null {
  if (!pipelineStateJson || typeof pipelineStateJson !== "object" || Array.isArray(pipelineStateJson)) {
    return null;
  }
  const stateJson = (pipelineStateJson as { stateJson?: unknown }).stateJson;
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return null;
  }
  const rec = stateJson as Record<string, unknown>;
  if (rec.workflowStatus !== "brief_normalized") {
    return null;
  }
  const parsed = BriefUpdateMetaSchema.safeParse(rec._sessionHistoryMeta);
  return parsed.success ? parsed.data : null;
}

function isBriefUpdateRow(row: RawRow): boolean {
  return briefUpdateFromPipelineStateJson(row.pipeline_state_json) !== null;
}

function milestoneFromLatestState(pipelineStateJson: Json): { is: boolean; label: string | null } {
  if (!pipelineStateJson || typeof pipelineStateJson !== "object" || Array.isArray(pipelineStateJson)) {
    return { is: false, label: null };
  }
  const stateJson = (pipelineStateJson as { stateJson?: unknown }).stateJson;
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    return { is: false, label: null };
  }
  const rec = stateJson as Record<string, unknown>;
  if (rec.prd !== undefined && rec.prd !== null && typeof rec.prd === "object") {
    return { is: true, label: "PRD generated" };
  }
  if (rec.route === "prd_designed") {
    return { is: true, label: "PRD generated" };
  }
  if (rec.workflowStatus === "prd_generated") {
    return { is: true, label: "PRD generated" };
  }
  return { is: false, label: null };
}

function sameUserClarification(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    return false;
  }
  return a.trim() === b.trim();
}

function shouldGroupWithPrevious(prev: RawRow, curr: RawRow): boolean {
  if (isBriefUpdateRow(prev) || isBriefUpdateRow(curr)) {
    return false;
  }
  const dt = Math.abs(rowTimeMs(curr) - rowTimeMs(prev));
  if (dt <= BURST_MS) {
    return true;
  }
  const uPrev = userClarificationFromPipelineStateJson(prev.pipeline_state_json);
  const uCurr = userClarificationFromPipelineStateJson(curr.pipeline_state_json);
  return sameUserClarification(uPrev, uCurr);
}

function groupCheckpointsChronological(sortedAsc: RawRow[]): RawRow[][] {
  if (sortedAsc.length === 0) {
    return [];
  }
  const groups: RawRow[][] = [[sortedAsc[0]]];
  for (let i = 1; i < sortedAsc.length; i++) {
    const curr = sortedAsc[i];
    const lastGroup = groups[groups.length - 1];
    const prev = lastGroup[lastGroup.length - 1];
    if (shouldGroupWithPrevious(prev, curr)) {
      lastGroup.push(curr);
    } else {
      groups.push([curr]);
    }
  }
  return groups;
}

/** Last non-null user clarification text within the group (chronological order). */
function userClarificationForGroup(group: RawRow[]): string | null {
  let last: string | null = null;
  for (const row of group) {
    const u = userClarificationFromPipelineStateJson(row.pipeline_state_json);
    if (u) {
      last = u;
    }
  }
  return last;
}

function mergedEntryFromGroup(group: RawRow[]): HistoryEntry {
  const latest = group[group.length - 1];
  const pipelineStateJson = latest.pipeline_state_json;

  const briefRow = group.find((row) => isBriefUpdateRow(row));
  if (briefRow) {
    const meta = briefUpdateFromPipelineStateJson(briefRow.pipeline_state_json)!;
    return {
      checkpointId: briefRow.checkpoint_id,
      timestamp: briefRow.checkpoint_ts ?? briefRow.created_at,
      type: "BRIEF_UPDATE",
      milestoneLabel: null,
      userClarification: null,
      previousBrief: meta.previous_brief.length > 0 ? meta.previous_brief : null,
      newBrief: meta.new_brief.length > 0 ? meta.new_brief : null,
      gapCount: 0,
      gapCountBefore: null,
      hasGapAnalysis: false,
      gaps: []
    };
  }

  const { hasGapAnalysis, gaps } = gapAnalysisFromPipelineStateJson(pipelineStateJson);
  const milestone = milestoneFromLatestState(pipelineStateJson);
  const userInGroup = userClarificationForGroup(group);

  let type: HistoryItemType;
  let milestoneLabel: string | null = null;
  if (milestone.is) {
    type = "MILESTONE";
    milestoneLabel = milestone.label;
  } else if (userInGroup) {
    type = "USER_INPUT";
  } else {
    type = "ANALYSIS_RESULT";
  }

  return {
    checkpointId: latest.checkpoint_id,
    timestamp: latest.checkpoint_ts ?? latest.created_at,
    type,
    milestoneLabel,
    userClarification: milestone.is ? null : userInGroup,
    previousBrief: null,
    newBrief: null,
    gapCount: gaps.length,
    gapCountBefore: null,
    hasGapAnalysis,
    gaps
  };
}

function assignGapCountBefore(entriesChrono: HistoryEntry[]): void {
  let prevGapCount: number | null = null;
  for (const e of entriesChrono) {
    e.gapCountBefore = prevGapCount;
    if (e.hasGapAnalysis) {
      prevGapCount = e.gapCount;
    }
  }
}

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const idParse = z.string().uuid().safeParse(sessionId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  const client = createClient();
  const { data: session, error: sessionError } = await getProjectSessionById(client, idParse.data);

  if (sessionError) {
    return NextResponse.json({ error: `Failed to load session: ${sessionError.message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const { data: rows, error: listError } = await listLanggraphCheckpointsBySessionId(client, idParse.data);

  if (listError) {
    return NextResponse.json({ error: `Failed to load checkpoint history: ${listError.message}` }, { status: 500 });
  }

  const rawRows: RawRow[] = (rows ?? []) as RawRow[];
  const sortedAsc = [...rawRows].sort((a, b) => rowTimeMs(a) - rowTimeMs(b));
  const groups = groupCheckpointsChronological(sortedAsc);
  const mergedChrono: HistoryEntry[] = groups.map(mergedEntryFromGroup);
  assignGapCountBefore(mergedChrono);
  const newestFirst = [...mergedChrono].reverse();

  return NextResponse.json(newestFirst);
}
