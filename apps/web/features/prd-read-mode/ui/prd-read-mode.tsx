"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { PRD } from "@vibe/schema";
import { prdDocumentToMarkdown } from "@vibe/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { techStackBadgeClassName } from "@/lib/tech-stack-badge";

const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  clarify: "Clarify",
  prd: "PRD",
  tasks: "Tasks",
  design_sync: "Design sync",
  handoff: "Handoff",
  export: "Export"
};

type PrdReadModeProps = {
  prd: PRD;
  sessionId?: string;
};

export function PrdReadMode({ prd, sessionId }: PrdReadModeProps) {
  const router = useRouter();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [redraftLoading, setRedraftLoading] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);

  const markdown = prdDocumentToMarkdown(prd);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [markdown]);

  const onRedraftToClarification = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setRedraftError(null);
    setRedraftLoading(true);
    try {
      const res = await fetch("/api/pipeline/redraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, target: "gapDetector" })
      });
      const payload: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as { error?: unknown }).error ?? res.statusText)
            : res.statusText;
        throw new Error(message);
      }
      router.refresh();
    } catch (error) {
      setRedraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setRedraftLoading(false);
    }
  }, [router, sessionId]);

  return (
    <Card className="overflow-hidden border-primary/20 shadow-md shadow-primary/5">
      <CardHeader className="border-b border-border bg-linear-to-br from-primary/6 to-transparent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl tracking-tight">Product requirements</CardTitle>
            <CardDescription className="mt-1.5 max-w-xl leading-relaxed">
              Read-only view of the generated PRD. Copy as Markdown for docs, tickets, or handoff.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {sessionId ? (
              <Button
                type="button"
                variant="outline"
                disabled={redraftLoading}
                onClick={() => void onRedraftToClarification()}
              >
                {redraftLoading ? "Returning…" : "Go back to clarification"}
              </Button>
            ) : null}
            <Button type="button" variant="default" onClick={() => void onCopy()}>
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy to clipboard"}
            </Button>
          </div>
        </div>
        {redraftError ? (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {redraftError}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="max-h-[min(70vh,720px)] overflow-y-auto px-6 py-8 sm:px-10">
        <article className="mx-auto max-w-2xl space-y-10 text-[15px] leading-relaxed text-foreground">
          <header className="space-y-3 border-b border-border pb-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Overview</p>
            <p className="text-lg font-semibold leading-snug tracking-tight text-foreground">{prd.productOverview}</p>
          </header>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Problem</h2>
            <p className="text-foreground/90">{prd.problemStatement}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Goals</h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.goals.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Scope</h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.scopeSummary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Users & personas</h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.usersAndPersonas.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Architecture flow</h2>
            <ol className="flex flex-wrap gap-2">
              {prd.architectureFlow.map((stage) => (
                <li
                  key={stage}
                  className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-secondary-foreground"
                >
                  {STAGE_LABELS[stage] ?? stage}
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">User stories</h2>
            <ul className="space-y-4">
              {prd.userStories.map((us) => (
                <li
                  key={us.id}
                  className="rounded-xl border border-border bg-card/80 p-4 shadow-sm"
                >
                  <p className="font-mono text-xs text-muted-foreground">{us.id}</p>
                  <p className="mt-2 text-foreground/90">
                    As a <span className="font-medium text-foreground">{us.asA}</span>, I want{" "}
                    <span className="font-medium text-foreground">{us.iWant}</span>, so that {us.soThat}.
                  </p>
                  {us.acceptanceHints.length > 0 ? (
                    <ul className="mt-3 list-inside list-disc text-sm text-muted-foreground">
                      {us.acceptanceHints.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Functional requirements
            </h2>
            <ul className="space-y-4">
              {prd.functionalRequirements.map((fr) => (
                <li key={fr.id} className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
                  <p className="font-semibold text-foreground">
                    {fr.id}: {fr.title}
                  </p>
                  {fr.details.length > 0 ? (
                    <ul className="mt-2 list-inside list-disc text-sm text-foreground/90">
                      {fr.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Non-functional requirements
            </h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.nonFunctionalRequirements.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tech stack</h2>
            <ul className="flex flex-wrap gap-2">
              {prd.techStack.map((t) => (
                <li key={t}>
                  <Badge variant="outline" className={techStackBadgeClassName(t)}>
                    {t}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assumptions</h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3 pb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risks</h2>
            <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
              {prd.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        </article>
      </CardContent>
    </Card>
  );
}
