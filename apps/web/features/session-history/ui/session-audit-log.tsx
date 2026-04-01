"use client";

import { FileEdit, Sparkles, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GapItem } from "@/features/gap-viewer/model/gap-session-state.schema";
import { useSessionHistoryVersion } from "../context/session-history-refresh-context";
import {
  SessionHistoryPayloadSchema,
  SessionHistoryResponseSchema,
  type SessionHistoryEntry
} from "../model/session-history.schema";

type SessionAuditLogProps = {
  sessionId: string;
  embedded?: boolean;
};

const PARAGRAPH_PREVIEW_MAX = 3;

type TimelineSegment =
  | { kind: "milestone"; entry: SessionHistoryEntry }
  | { kind: "brief_update"; entry: SessionHistoryEntry }
  | {
      kind: "turn";
      user: SessionHistoryEntry | null;
      analysis: SessionHistoryEntry | null;
    };

function priorityBadgeVariant(priority: GapItem["priority"]) {
  switch (priority) {
    case "High":
      return "priorityHigh" as const;
    case "Med":
      return "priorityMed" as const;
    case "Low":
      return "priorityLow" as const;
    default:
      return "secondary" as const;
  }
}

function sameGapTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function resolvedGapsSinceSnapshot(snapshot: SessionHistoryEntry | null, current: SessionHistoryEntry): GapItem[] {
  if (!snapshot?.hasGapAnalysis || !current.hasGapAnalysis) {
    return [];
  }
  return snapshot.gaps.filter(
    (p) => !current.gaps.some((c) => sameGapTitle(c.title, p.title))
  );
}

function formatEntryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function splitParagraphs(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blocks.length > 0) {
    return blocks;
  }
  return text.trim() ? [text.trim()] : [];
}

function buildTimelineSegments(chrono: SessionHistoryEntry[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  let i = 0;
  while (i < chrono.length) {
    const e = chrono[i];
    if (e.type === "MILESTONE") {
      out.push({ kind: "milestone", entry: e });
      i++;
      continue;
    }
    if (e.type === "BRIEF_UPDATE") {
      out.push({ kind: "brief_update", entry: e });
      i++;
      continue;
    }
    if (e.type === "USER_INPUT") {
      const next = chrono[i + 1];
      if (next?.type === "ANALYSIS_RESULT") {
        out.push({ kind: "turn", user: e, analysis: next });
        i += 2;
        continue;
      }
      const userPart = e.userClarification ? e : null;
      const analysisPart = e.hasGapAnalysis ? e : null;
      out.push({ kind: "turn", user: userPart, analysis: analysisPart });
      i++;
      continue;
    }
    if (e.type === "ANALYSIS_RESULT") {
      out.push({ kind: "turn", user: null, analysis: e });
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function gapDeltaBadge(entry: SessionHistoryEntry): ReactNode {
  if (!entry.hasGapAnalysis) {
    return null;
  }
  const from = entry.gapCountBefore;
  const to = entry.gapCount;
  if (from === null) {
    return (
      <Badge variant="secondary" className="text-[10px] font-semibold tabular-nums">
        Open gaps: {to}
      </Badge>
    );
  }
  const delta = to - from;
  if (delta === 0) {
    return (
      <Badge variant="outline" className="text-[10px] font-semibold tabular-nums text-muted-foreground">
        Gaps unchanged ({to})
      </Badge>
    );
  }
  const abs = Math.abs(delta);
  const label = `${delta > 0 ? "+" : ""}${delta} gap${abs === 1 ? "" : "s"}`;
  if (delta < 0) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/45 bg-emerald-500/10 text-[10px] font-semibold tabular-nums text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100"
      >
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-600/45 bg-red-500/10 text-[10px] font-semibold tabular-nums text-red-900 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100"
    >
      {label}
    </Badge>
  );
}

function UserMessageBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  const needsToggle = paragraphs.length > PARAGRAPH_PREVIEW_MAX;
  const visibleParagraphs = expanded || !needsToggle ? paragraphs : paragraphs.slice(0, PARAGRAPH_PREVIEW_MAX);

  return (
    <div className="flex justify-end gap-2">
      <div
        className={cn(
          "max-w-[min(100%,28rem)] rounded-2xl rounded-tr-md bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm ring-1 ring-primary/10"
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">You</p>
        <div className="mt-1.5 space-y-2">
          {visibleParagraphs.map((p, i) => (
            <p key={i} className={cn(i > 0 && "mt-2")}>
              {p}
            </p>
          ))}
        </div>
        {needsToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-auto px-0 py-1 text-xs font-normal text-primary hover:bg-transparent"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
      </div>
      <div
        className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20"
        aria-hidden
      >
        <User className="size-4" strokeWidth={2} />
      </div>
    </div>
  );
}

function ResolvedGapsNestedList({ entryKey, resolvedGaps }: { entryKey: string; resolvedGaps: GapItem[] }) {
  if (resolvedGaps.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 space-y-2 border-t border-border/60 pt-3 text-sm">
      {resolvedGaps.map((gap, gi) => (
        <li key={`${entryKey}-resolved-${gi}-${gap.title}`} className="list-none">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{gap.title}</span>
            <Badge variant={priorityBadgeVariant(gap.priority)} className="text-[10px]">
              {gap.priority}
            </Badge>
            <span className="text-xs text-muted-foreground">{gap.type}</span>
          </div>
          {gap.description ? (
            <ul className="mt-1.5 list-disc pl-4 text-xs leading-relaxed text-muted-foreground marker:text-muted-foreground/70">
              <li className="pl-0.5">{gap.description}</li>
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AiResponseBubble({
  entry,
  resolvedGaps
}: {
  entry: SessionHistoryEntry;
  resolvedGaps: GapItem[];
}) {
  const deltaBadge = gapDeltaBadge(entry);
  const summaryLine =
    entry.gapCountBefore !== null && entry.hasGapAnalysis ? (
      <p className="text-xs text-muted-foreground">
        Open gaps: <span className="font-medium tabular-nums text-foreground">{entry.gapCountBefore}</span>
        <span className="mx-1 text-muted-foreground/60">→</span>
        <span className="font-medium tabular-nums text-foreground">{entry.gapCount}</span>
      </p>
    ) : entry.hasGapAnalysis ? (
      <p className="text-xs text-muted-foreground">
        Tracking <span className="font-medium tabular-nums text-foreground">{entry.gapCount}</span> open gap
        {entry.gapCount === 1 ? "" : "s"}
      </p>
    ) : null;

  return (
    <div className="flex justify-start gap-2">
      <div
        className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border"
        aria-hidden
      >
        <Sparkles className="size-4" strokeWidth={2} />
      </div>
      <div
        className={cn(
          "max-w-[min(100%,32rem)] rounded-2xl rounded-tl-md bg-muted/50 px-4 py-3 text-sm shadow-sm ring-1 ring-border/60 dark:bg-muted/25"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Assistant</p>
          {deltaBadge}
        </div>
        <time className="mt-1 block text-[11px] font-medium tabular-nums text-muted-foreground">
          {formatEntryTime(entry.timestamp)}
        </time>
        {summaryLine ? <div className="mt-2">{summaryLine}</div> : null}
        <ResolvedGapsNestedList entryKey={entry.checkpointId} resolvedGaps={resolvedGaps} />
      </div>
    </div>
  );
}

function BriefUpdateBlock({ entry }: { entry: SessionHistoryEntry }) {
  const beforeText = entry.previousBrief?.trim() ? entry.previousBrief : "—";
  const afterText = entry.newBrief?.trim() ? entry.newBrief : "—";

  return (
    <div
      className="relative my-5 overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.07] to-transparent px-4 py-4 shadow-sm dark:border-violet-400/20 dark:from-violet-500/[0.12]"
      role="status"
      aria-label="Brief updated"
    >
      <div className="flex gap-3">
        <div
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/25 dark:bg-violet-500/20 dark:text-violet-200 dark:ring-violet-400/30"
          aria-hidden
        >
          <FileEdit className="size-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700/90 dark:text-violet-200/90">
              Significant change
            </p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">Initial brief updated</p>
            <time className="mt-1 block text-[11px] font-medium tabular-nums text-muted-foreground">
              {formatEntryTime(entry.timestamp)}
            </time>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="rounded-lg border border-border/80 bg-background/60 px-3 py-2.5 dark:bg-background/40">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Before</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
                {beforeText}
              </p>
            </div>
            <div className="rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2.5 ring-1 ring-primary/10 dark:bg-primary/[0.08]">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">After</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">{afterText}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneDivider({ entry }: { entry: SessionHistoryEntry }) {
  const label = entry.milestoneLabel ?? "Milestone";
  return (
    <div className="my-6 flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span
        className={cn(
          "shrink-0 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-center text-xs font-semibold text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-50"
        )}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function ClarificationRoundsSummary({ rounds }: { rounds: string[] }) {
  if (rounds.length === 0) {
    return null;
  }
  return (
    <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Clarifications submitted ({rounds.length})
      </p>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-foreground">
        {rounds.map((text, i) => (
          <li key={i} className="pl-1">
            <div className="whitespace-pre-wrap">{text}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SessionAuditLog({ sessionId, embedded = false }: SessionAuditLogProps) {
  const historyVersion = useSessionHistoryVersion();
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [clarificationRounds, setClarificationRounds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/pipeline/session/${sessionId}/history`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to load history (${res.status})`);
      }
      const json: unknown = await res.json();
      const wrapped = SessionHistoryPayloadSchema.safeParse(json);
      if (wrapped.success) {
        setEntries(wrapped.data.entries);
        setClarificationRounds(wrapped.data.clarificationRounds);
        return;
      }
      const legacy = SessionHistoryResponseSchema.safeParse(json);
      if (!legacy.success) {
        throw new Error("Unexpected history response shape.");
      }
      setEntries(legacy.data);
      setClarificationRounds([]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load history.");
      setEntries([]);
      setClarificationRounds([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, historyVersion]);

  const resolvedByCheckpointId = useMemo(() => {
    const chronological = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const map = new Map<string, GapItem[]>();
    let last: SessionHistoryEntry | null = null;
    for (const e of chronological) {
      map.set(e.checkpointId, resolvedGapsSinceSnapshot(last, e));
      if (e.hasGapAnalysis) {
        last = e;
      }
    }
    return map;
  }, [entries]);

  const segments = useMemo(() => {
    const chronological = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return buildTimelineSegments(chronological);
  }, [entries]);

  if (isLoading) {
    return (
      <div
        className={cn(
          "text-sm text-muted-foreground",
          !embedded && "rounded-xl border border-border bg-card p-5"
        )}
      >
        Loading session history…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={cn(
          "text-sm text-red-800 dark:text-red-200",
          !embedded &&
            "rounded-xl border border-red-300/80 bg-red-50 p-5 dark:border-red-500/40 dark:bg-red-500/10"
        )}
      >
        {loadError}
      </div>
    );
  }

  if (entries.length === 0 && clarificationRounds.length === 0) {
    return (
      <div
        className={cn(
          "text-center text-sm text-muted-foreground",
          !embedded && "rounded-xl border border-dashed border-border bg-card/60 p-8"
        )}
      >
        No history yet
      </div>
    );
  }

  return (
    <div className={cn(!embedded && "rounded-xl border border-border bg-card p-5 shadow-sm")}>
      {!embedded ? (
        <>
          <h3 className="text-sm font-semibold text-foreground">Session timeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">Conversation-style log — oldest at top.</p>
        </>
      ) : null}
      <ClarificationRoundsSummary rounds={clarificationRounds} />
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No checkpoint timeline rows yet; clarifications above are from the live session state.
        </p>
      ) : (
        <div className={cn("mt-6 space-y-4")}>
        {segments.map((seg, si) => {
          if (seg.kind === "milestone") {
            return <MilestoneDivider key={`milestone-${seg.entry.checkpointId}-${si}`} entry={seg.entry} />;
          }
          if (seg.kind === "brief_update") {
            return <BriefUpdateBlock key={`brief-${seg.entry.checkpointId}-${si}`} entry={seg.entry} />;
          }

          const { user, analysis } = seg;
          const showTurnFrame = Boolean(user && analysis);
          const analysisEntry = analysis;
          const resolvedGaps =
            analysisEntry != null ? (resolvedByCheckpointId.get(analysisEntry.checkpointId) ?? []) : [];

          const orphanNotice =
            !user && !analysis ? (
              <p className="text-center text-xs text-muted-foreground">Empty checkpoint</p>
            ) : !user && analysis && !analysis.hasGapAnalysis ? (
              <p className="text-sm text-muted-foreground">Pipeline update recorded.</p>
            ) : user && !user.userClarification && !analysis?.hasGapAnalysis ? (
              <p className="text-sm text-muted-foreground">Pipeline checkpoint (no gap snapshot).</p>
            ) : null;

          const inner = (
            <div className="space-y-3">
              {user?.userClarification ? <UserMessageBubble text={user.userClarification} /> : null}
              {analysis && analysis.hasGapAnalysis ? (
                <AiResponseBubble entry={analysis} resolvedGaps={resolvedGaps} />
              ) : null}
              {orphanNotice}
            </div>
          );

          if (showTurnFrame) {
            return (
              <div
                key={`turn-${user!.checkpointId}-${analysis!.checkpointId}-${si}`}
                className="rounded-xl border border-border/70 bg-muted/20 p-4 shadow-sm dark:bg-muted/10"
              >
                {inner}
              </div>
            );
          }

          return (
            <div key={`block-${user?.checkpointId ?? analysis?.checkpointId ?? si}-${si}`} className="px-0.5">
              {inner}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
