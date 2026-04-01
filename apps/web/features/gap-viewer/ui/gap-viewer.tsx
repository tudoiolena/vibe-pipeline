"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useBumpSessionHistory } from "@/features/session-history";
import { fetchSessionGapState } from "../api/fetch-session-gap-state";
import { resumePipeline } from "../api/resume-pipeline";
import type { GapItem, GapSessionState } from "../model/gap-session-state.schema";

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

function sortGaps(gaps: GapItem[]): GapItem[] {
  const order = { High: 0, Med: 1, Low: 2 } as const;
  return [...gaps].sort((a, b) => order[a.priority] - order[b.priority]);
}

type GapViewerProps = {
  sessionId: string;
};

type ReadyForDesignPanelProps = {
  title: string;
  description: string;
  resumeError: string | null;
  isResuming: boolean;
  onGeneratePRD: () => void;
};

function ReadyForDesignPanel({
  title,
  description,
  resumeError,
  isResuming,
  onGeneratePRD
}: ReadyForDesignPanelProps) {
  return (
    <div className="rounded-lg border border-emerald-300/80 bg-emerald-50 p-5 shadow-sm dark:border-emerald-500/35 dark:bg-emerald-500/10">
      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">{description}</p>
      {resumeError ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {resumeError}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="mt-4 w-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 sm:w-auto"
        disabled={isResuming}
        onClick={() => void onGeneratePRD()}
      >
        {isResuming ? "Drafting full PRD…" : "Generate full PRD"}
      </Button>
    </div>
  );
}

export function GapViewer({ sessionId }: GapViewerProps) {
  const bumpSessionHistory = useBumpSessionHistory();
  const [state, setState] = useState<GapSessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clarification, setClarification] = useState("");
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await fetchSessionGapState(sessionId);
      setState(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onResume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResumeError(null);
    const text = clarification.trim();
    if (text.length === 0) {
      setResumeError("Please answer the open questions before continuing.");
      return;
    }

    setIsResuming(true);
    try {
      await resumePipeline(sessionId, text);
      setClarification("");
      await reload();
      bumpSessionHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResumeError(message);
    } finally {
      setIsResuming(false);
    }
  }

  async function onGeneratePRD() {
    setResumeError(null);
    setIsResuming(true);
    try {
      await resumePipeline(sessionId, "Proceed to PRD generation");
      await reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResumeError(message);
    } finally {
      setIsResuming(false);
    }
  }

  if (isLoading && !state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Requirements gaps</CardTitle>
          <CardDescription>Loading latest pipeline state…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Requirements gaps</CardTitle>
          <CardDescription>Could not load session state.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {loadError}
          </p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => void reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return null;
  }

  const sorted = sortGaps(state.gaps);
  const highGaps = sorted.filter((g) => g.priority === "High");
  const showReadyForDesign =
    !state.needsClarification && (sorted.length === 0 || highGaps.length === 0);

  const analysisInProgress =
    state.graphStatus === "running" && state.currentStage === "analysis" && sorted.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requirements gaps</CardTitle>
        <CardDescription>
          Latest gap analysis for this session ({sorted.length} item{sorted.length === 1 ? "" : "s"}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {analysisInProgress ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium text-foreground">Analysis in progress</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The pipeline is processing your brief. Gap results will appear here when ready—try refreshing in a
              moment if this stays empty.
            </p>
          </div>
        ) : sorted.length === 0 ? (
          showReadyForDesign ? (
            <ReadyForDesignPanel
              title="Ready for design"
              description="No open gaps were recorded. Your project brief is validated—continue to generate the full PRD."
              resumeError={resumeError}
              isResuming={isResuming}
              onGeneratePRD={onGeneratePRD}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No open gaps recorded. The brief may be ready for the next step.
            </p>
          )
        ) : (
          <>
            <ul className="space-y-3">
              {sorted.map((gap, index) => (
                <li
                  key={`${gap.title}-${index}`}
                  className="rounded-lg border border-border bg-card/50 p-4 shadow-sm"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={priorityBadgeVariant(gap.priority)}>{gap.priority}</Badge>
                    <Badge variant="outline">{gap.type}</Badge>
                    <span className="font-medium">{gap.title}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{gap.description}</p>
                </li>
              ))}
            </ul>
            {showReadyForDesign ? (
              <ReadyForDesignPanel
                title="Brief validated — no high-priority gaps"
                description="Remaining items are lower priority. You can proceed to the full PRD when you are ready."
                resumeError={resumeError}
                isResuming={isResuming}
                onGeneratePRD={onGeneratePRD}
              />
            ) : null}
          </>
        )}

        {state.needsClarification ? (
          <form onSubmit={onResume} className="space-y-3 border-t border-border pt-6">
            <p className="text-sm font-medium">Clarifications</p>
            <p className="text-sm text-muted-foreground">
              The pipeline is waiting for your answers. Add detail below, then continue to re-run gap detection.
            </p>
            <Textarea
              placeholder="Answer the open questions from the gap list (security, scale, missing requirements, etc.)."
              value={clarification}
              onChange={(event) => setClarification(event.target.value)}
              disabled={isResuming}
              className="min-h-[120px]"
            />
            {resumeError ? (
              <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {resumeError}
              </p>
            ) : null}
            <Button type="submit" disabled={isResuming}>
              {isResuming ? "Continuing pipeline…" : "Submit clarification & continue"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
