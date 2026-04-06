"use client";

import { AlertTriangle, CheckCircle2, FileEdit } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GapItem } from "@/features/gap-viewer/model/gap-session-state.schema";
import { useSessionHistoryVersion } from "../context/session-history-refresh-context";
import {
  SessionHistoryPayloadSchema,
  type ClarificationTimelineEvent,
  type SessionHistoryEntry
} from "../model/session-history.schema";
import {
  CollapsibleTextWithFigma,
  CollapsibleTimelineBlock,
  TimelineEntry,
  gapsListSummary,
  inferUserContentSummary
} from "./timeline-entry";

type SessionAuditLogProps = {
  sessionId: string;
  embedded?: boolean;
};

type TimelineEvent =
  | {
      kind: "timeline_figma_verified";
      id: string;
      sortAt: string;
      tie: number;
      fileKey?: string;
    }
  | {
      kind: "timeline_figma_failed";
      id: string;
      sortAt: string;
      tie: number;
      error?: string;
    }
  | {
      kind: "timeline_clarifications_merged";
      id: string;
      sortAt: string;
      tie: number;
    }
  | {
      kind: "user_message";
      id: string;
      sortAt: string;
      tie: number;
      text: string;
    }
  | {
      kind: "assistant_gaps";
      id: string;
      sortAt: string;
      tie: number;
      entry: SessionHistoryEntry;
      resolvedGaps: GapItem[];
    }
  | {
      kind: "milestone";
      id: string;
      sortAt: string;
      tie: number;
      entry: SessionHistoryEntry;
    }
  | {
      kind: "brief_update";
      id: string;
      sortAt: string;
      tie: number;
      entry: SessionHistoryEntry;
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

function userMessageNeedsCollapse(text: string): boolean {
  const lines = text.split(/\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 3) {
    return true;
  }
  return text.trim().length > 200;
}

function assistantGapsNeedCollapse(gaps: GapItem[], resolvedGaps: GapItem[]): boolean {
  if (resolvedGaps.length > 0) {
    return true;
  }
  if (gaps.length > 2) {
    return true;
  }
  const descChars = gaps.reduce((n, g) => n + (g.description?.length ?? 0), 0);
  return descChars > 180;
}

function gapListPreviewText(gaps: GapItem[]): string {
  return gaps
    .slice(0, 2)
    .map((g) => (g.description?.trim() ? `${g.title} — ${g.description.trim()}` : g.title))
    .join("\n");
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

function AssistantGapsBody({
  entry,
  resolvedGaps
}: {
  entry: SessionHistoryEntry;
  resolvedGaps: GapItem[];
}) {
  const figmaOkBanner =
    entry.figmaLinkVerified === true ? (
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-50">
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <span>
          Figma design linked and validated. Specification gaps that depended on a confirmed file were cleared or
          downgraded.
        </span>
      </div>
    ) : null;

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

  const gaps = entry.gaps;
  const summary = gapsListSummary(gaps.map((g) => g.title));
  const collapse = assistantGapsNeedCollapse(gaps, resolvedGaps);
  const preview = gapListPreviewText(gaps);

  const fullList = (
    <div className="space-y-3">
      {figmaOkBanner}
      <div className="flex flex-wrap items-center gap-2">
        {deltaBadge}
        {summaryLine ? <div className="min-w-0 flex-1">{summaryLine}</div> : null}
      </div>
      <ul className="space-y-2 text-sm">
        {gaps.map((gap, gi) => (
          <li key={`${entry.checkpointId}-g-${gi}-${gap.title}`} className="list-none">
            <div className="flex flex-wrap items-center gap-2">
              {gap.priority === "High" ? (
                <AlertTriangle
                  className="size-4 shrink-0 text-red-600 dark:text-red-400"
                  aria-hidden
                />
              ) : null}
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
      <ResolvedGapsNestedList entryKey={entry.checkpointId} resolvedGaps={resolvedGaps} />
    </div>
  );

  if (!collapse) {
    return fullList;
  }

  return (
    <CollapsibleTimelineBlock
      summary={summary}
      collapsedContent={
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground line-clamp-2">
          {preview || summary}
        </p>
      }
    >
      {fullList}
    </CollapsibleTimelineBlock>
  );
}

function buildTimelineAnnotationEvents(timeline: ClarificationTimelineEvent[]): TimelineEvent[] {
  const sorted = [...timeline].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return sorted.map((e, i) => {
    const tie = i;
    if (e.kind === "figma_verified") {
      return {
        kind: "timeline_figma_verified" as const,
        id: `tl-figma-ok-${e.at}-${i}`,
        sortAt: e.at,
        tie,
        fileKey: e.fileKey
      };
    }
    if (e.kind === "figma_failed") {
      return {
        kind: "timeline_figma_failed" as const,
        id: `tl-figma-fail-${e.at}-${i}`,
        sortAt: e.at,
        tie,
        error: e.error
      };
    }
    return {
      kind: "timeline_clarifications_merged" as const,
      id: `tl-merge-${e.at}-${i}`,
      sortAt: e.at,
      tie
    };
  });
}

function buildCheckpointTimelineEvents(entries: SessionHistoryEntry[]): TimelineEvent[] {
  const chrono = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const events: TimelineEvent[] = [];
  let tie = 0;

  for (const entry of chrono) {
    if (entry.type === "MILESTONE") {
      events.push({
        kind: "milestone",
        id: `milestone-${entry.checkpointId}`,
        sortAt: entry.timestamp,
        tie: tie++,
        entry
      });
      continue;
    }
    if (entry.type === "BRIEF_UPDATE") {
      events.push({
        kind: "brief_update",
        id: `brief-${entry.checkpointId}`,
        sortAt: entry.timestamp,
        tie: tie++,
        entry
      });
      continue;
    }

    const u = entry.userClarification?.trim() ?? "";
    const hasUser = u.length > 0;
    const hasGaps = entry.hasGapAnalysis;

    if (hasUser) {
      events.push({
        kind: "user_message",
        id: `user-${entry.checkpointId}`,
        sortAt: entry.timestamp,
        tie: tie++,
        text: u
      });
    }

    if (hasGaps) {
      events.push({
        kind: "assistant_gaps",
        id: `gaps-${entry.checkpointId}`,
        sortAt: entry.timestamp,
        tie: tie++,
        entry,
        resolvedGaps: []
      });
    }
  }

  return events.map((ev) => ({ ...ev, tie: ev.tie + 500 }));
}

function mergeChronologicalTimeline(annotations: TimelineEvent[], checkpoint: TimelineEvent[]): TimelineEvent[] {
  return [...annotations, ...checkpoint].sort((a, b) => {
    const ta = new Date(a.sortAt).getTime();
    const tb = new Date(b.sortAt).getTime();
    if (ta !== tb) {
      return ta - tb;
    }
    return a.tie - b.tie;
  });
}

/** Attach resolved gap deltas per assistant checkpoint after sorting. */
function attachResolvedGaps(
  events: TimelineEvent[],
  resolvedByCheckpointId: Map<string, GapItem[]>
): TimelineEvent[] {
  return events.map((ev) => {
    if (ev.kind !== "assistant_gaps") {
      return ev;
    }
    return {
      ...ev,
      resolvedGaps: resolvedByCheckpointId.get(ev.entry.checkpointId) ?? []
    };
  });
}

export function SessionAuditLog({ sessionId, embedded = false }: SessionAuditLogProps) {
  const historyVersion = useSessionHistoryVersion();
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [clarificationRounds, setClarificationRounds] = useState<string[]>([]);
  const [clarificationTimeline, setClarificationTimeline] = useState<ClarificationTimelineEvent[]>([]);
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
      const parsed = SessionHistoryPayloadSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error("Unexpected history response shape.");
      }
      setEntries(parsed.data.entries);
      setClarificationRounds(parsed.data.clarificationRounds);
      setClarificationTimeline(parsed.data.clarificationTimeline ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load history.");
      setEntries([]);
      setClarificationRounds([]);
      setClarificationTimeline([]);
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

  const timelineEvents = useMemo(() => {
    const annot = buildTimelineAnnotationEvents(clarificationTimeline);
    const checkpoint = attachResolvedGaps(buildCheckpointTimelineEvents(entries), resolvedByCheckpointId);
    return mergeChronologicalTimeline(annot, checkpoint);
  }, [entries, clarificationTimeline, resolvedByCheckpointId]);

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

  if (entries.length === 0 && clarificationRounds.length === 0 && clarificationTimeline.length === 0) {
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
          <p className="mt-1 text-xs text-muted-foreground">Unified feed — oldest at top.</p>
        </>
      ) : null}

      {timelineEvents.length > 0 ? (
        <div className={cn("space-y-4", !embedded && "mt-6")}>
          {timelineEvents.map((ev) => {
            if (ev.kind === "timeline_figma_verified") {
              return (
                <TimelineEntry
                  key={ev.id}
                  role="system"
                  senderLabel="Design"
                  timeIso={ev.sortAt}
                  align="center"
                  className="py-0.5"
                  bubbleClassName=""
                >
                  <div
                    className="flex items-center justify-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-950 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-50"
                    role="status"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span className="text-foreground">
                      Figma link resolved and file validated
                      {ev.fileKey ? (
                        <span className="text-muted-foreground"> · {ev.fileKey}</span>
                      ) : null}
                      . Related specification gaps were cleared or downgraded.
                    </span>
                  </div>
                </TimelineEntry>
              );
            }

            if (ev.kind === "timeline_figma_failed") {
              return (
                <TimelineEntry
                  key={ev.id}
                  role="system"
                  senderLabel="Design"
                  timeIso={ev.sortAt}
                  align="center"
                  className="py-0.5"
                  bubbleClassName=""
                >
                  <div
                    className="flex items-start justify-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-950 shadow-sm dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-50"
                    role="status"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                    <span className="text-foreground">
                      Figma file could not be validated.{ev.error ? ` ${ev.error}` : ""}
                    </span>
                  </div>
                </TimelineEntry>
              );
            }

            if (ev.kind === "timeline_clarifications_merged") {
              return (
                <TimelineEntry
                  key={ev.id}
                  role="system"
                  senderLabel="Brief"
                  timeIso={ev.sortAt}
                  align="center"
                  className="py-0.5"
                  bubbleClassName=""
                >
                  <div
                    className="flex items-center justify-center gap-2 rounded-full border border-border/80 bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm"
                    role="status"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span className="text-foreground">Your clarification was saved into the project brief.</span>
                  </div>
                </TimelineEntry>
              );
            }

            if (ev.kind === "user_message") {
              const collapse = userMessageNeedsCollapse(ev.text);
              const summary = inferUserContentSummary(ev.text);
              return (
                <TimelineEntry
                  key={ev.id}
                  role="user"
                  senderLabel="You"
                  timeIso={ev.sortAt}
                  align="right"
                >
                  <CollapsibleTextWithFigma
                    text={ev.text}
                    summary={summary}
                    collapsible={collapse}
                  />
                </TimelineEntry>
              );
            }

            if (ev.kind === "assistant_gaps") {
              return (
                <TimelineEntry
                  key={ev.id}
                  role="assistant"
                  senderLabel="Assistant"
                  timeIso={ev.sortAt}
                  align="left"
                >
                  <AssistantGapsBody entry={ev.entry} resolvedGaps={ev.resolvedGaps} />
                </TimelineEntry>
              );
            }

            if (ev.kind === "milestone") {
              const label = ev.entry.milestoneLabel ?? "Milestone";
              return (
                <TimelineEntry
                  key={ev.id}
                  role="system"
                  senderLabel="Milestone"
                  timeIso={ev.sortAt}
                  align="center"
                  className="py-1"
                >
                  <div className="flex items-center gap-3" role="separator" aria-label={label}>
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
                </TimelineEntry>
              );
            }

            if (ev.kind === "brief_update") {
              const beforeText = ev.entry.previousBrief?.trim() ? ev.entry.previousBrief : "—";
              const afterText = ev.entry.newBrief?.trim() ? ev.entry.newBrief : "—";
              return (
                <TimelineEntry
                  key={ev.id}
                  role="system"
                  senderLabel="Brief update"
                  timeIso={ev.sortAt}
                  align="center"
                >
                  <div
                    className="overflow-hidden rounded-xl border border-violet-500/25 bg-linear-to-br from-violet-500/[0.07] to-transparent px-4 py-4 text-left shadow-sm dark:border-violet-400/20 dark:from-violet-500/12"
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
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                          <div className="rounded-lg border border-border/80 bg-background/60 px-3 py-2.5 dark:bg-background/40">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Before
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
                              {beforeText}
                            </p>
                          </div>
                          <div className="rounded-lg border border-primary/25 bg-primary/4 px-3 py-2.5 ring-1 ring-primary/10 dark:bg-primary/8">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">After</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">
                              {afterText}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TimelineEntry>
              );
            }

            return null;
          })}
        </div>
      ) : null}
    </div>
  );
}
