"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useBumpSessionHistory } from "@/features/session-history";
import { normalizeFigmaSourceUrlForProject } from "@vibe/integrations";
import { cn } from "@/lib/utils";
import { IntakeResponseSchema, StructuredIntakeRequestSchema } from "../model/intake.schema";

const inputClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
);

const HydratedStructuredSchema = z.object({
  projectName: z.string(),
  clientName: z.string(),
  businessGoal: z.string(),
  targetUsers: z.string(),
  constraints: z.string(),
  deadline: z.string(),
  repoUrl: z.string(),
  referencesText: z.string()
});

const SessionHydrationSchema = z.object({
  hydratedIntake: z.object({
    intakeText: z.string(),
    figmaDesignUrl: z.string().optional(),
    structured: HydratedStructuredSchema.optional()
  }),
  figmaFileKey: z.string().nullable().optional()
});

export type IntakeFormProps = {
  /** When set with pipelineSessionId, submits to restart-intake for an existing project session (intake stage). */
  projectId?: string;
  pipelineSessionId?: string;
  initialIntakeText?: string;
  /** Pre-filled Figma URL from session state (file key expanded to a design URL). */
  initialFigmaUrl?: string;
};

function IntakeFormInner({
  projectId,
  pipelineSessionId,
  initialIntakeText = "",
  initialFigmaUrl = ""
}: IntakeFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bumpSessionHistory = useBumpSessionHistory();
  const revisionTarget =
    projectId !== undefined && pipelineSessionId !== undefined
      ? { projectId, sessionId: pipelineSessionId }
      : null;
  const isProjectRevision = revisionTarget !== null;

  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [businessGoal, setBusinessGoal] = useState("");
  const [targetUsers, setTargetUsers] = useState("");
  const [constraints, setConstraints] = useState("");
  const [rawBrief, setRawBrief] = useState(initialIntakeText);
  const [figmaUrl, setFigmaUrl] = useState(initialFigmaUrl);
  const [repoUrl, setRepoUrl] = useState("");
  const [referencesText, setReferencesText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setRawBrief(initialIntakeText);
  }, [initialIntakeText]);

  useEffect(() => {
    setFigmaUrl(initialFigmaUrl);
  }, [initialFigmaUrl]);

  /** Hydrate Figma input from checkpoint `stateJson.figmaFileKey` when editing intake for this session. */
  useEffect(() => {
    if (!pipelineSessionId) {
      return;
    }
    const uuid = z.string().uuid().safeParse(pipelineSessionId);
    if (!uuid.success) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pipeline/session/${pipelineSessionId}`, { cache: "no-store" });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok || cancelled || !json) {
          return;
        }
        const parsed = SessionHydrationSchema.safeParse(json);
        if (!parsed.success || cancelled) {
          return;
        }
        const { intakeText, figmaDesignUrl, structured } = parsed.data.hydratedIntake;
        if (intakeText.trim().length > 0) {
          setRawBrief(intakeText.trim());
        }
        if (typeof figmaDesignUrl === "string" && figmaDesignUrl.trim().length > 0) {
          setFigmaUrl(figmaDesignUrl.trim());
        } else {
          const key =
            typeof parsed.data.figmaFileKey === "string" && parsed.data.figmaFileKey.trim().length > 0
              ? parsed.data.figmaFileKey.trim()
              : null;
          if (key) {
            setFigmaUrl(`https://www.figma.com/design/${encodeURIComponent(key)}/file`);
          }
        }
        if (structured) {
          setProjectName(structured.projectName);
          setClientName(structured.clientName);
          setBusinessGoal(structured.businessGoal);
          setTargetUsers(structured.targetUsers);
          setConstraints(structured.constraints);
          setDeadline(structured.deadline);
          setRepoUrl(structured.repoUrl);
          setReferencesText(structured.referencesText);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pipelineSessionId]);

  useEffect(() => {
    const urlSessionId = searchParams.get("sessionId");
    if (!urlSessionId || !pipelineSessionId || urlSessionId !== pipelineSessionId) {
      return;
    }
    const uuid = z.string().uuid().safeParse(urlSessionId);
    if (!uuid.success) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pipeline/session/${urlSessionId}`, { cache: "no-store" });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok || cancelled || !json) {
          return;
        }
        const parsed = SessionHydrationSchema.safeParse(json);
        if (!parsed.success || cancelled) {
          return;
        }
        const { intakeText: nextText, figmaDesignUrl, structured } = parsed.data.hydratedIntake;
        if (nextText.trim().length > 0) {
          setRawBrief(nextText.trim());
        }
        if (typeof figmaDesignUrl === "string" && figmaDesignUrl.trim().length > 0) {
          setFigmaUrl(figmaDesignUrl.trim());
        }
        if (structured) {
          setProjectName(structured.projectName);
          setClientName(structured.clientName);
          setBusinessGoal(structured.businessGoal);
          setTargetUsers(structured.targetUsers);
          setConstraints(structured.constraints);
          setDeadline(structured.deadline);
          setRepoUrl(structured.repoUrl);
          setReferencesText(structured.referencesText);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, pipelineSessionId]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  function resetNewProjectForm() {
    setProjectName("");
    setClientName("");
    setBusinessGoal("");
    setTargetUsers("");
    setConstraints("");
    setRawBrief("");
    setFigmaUrl("");
    setRepoUrl("");
    setReferencesText("");
    setDeadline("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSessionId(null);

    let figmaUrlField: string | undefined;
    const figmaInput = figmaUrl.trim();
    if (figmaInput.length > 0) {
      if (!normalizeFigmaSourceUrlForProject(figmaInput)) {
        setErrorMessage("Enter a valid Figma design, file, or prototype URL (or paste the file key).");
        return;
      }
      figmaUrlField = figmaInput;
    }

    setIsSubmitting(true);
    try {
      if (revisionTarget) {
        const parsedRevision = StructuredIntakeRequestSchema.safeParse({
          rawBrief: rawBrief.trim(),
          projectName: projectName.trim() || undefined,
          clientName: clientName.trim() || undefined,
          businessGoal: businessGoal.trim() || undefined,
          targetUsers: targetUsers.trim() || undefined,
          constraints: constraints.trim() || undefined,
          repoUrl: repoUrl.trim() || undefined,
          referencesText: referencesText.trim() || undefined,
          deadline: deadline.trim() || undefined,
          figmaUrl: figmaUrlField
        });
        if (!parsedRevision.success) {
          setErrorMessage(parsedRevision.error.issues[0]?.message ?? "Check the form and try again.");
          return;
        }

        const d = parsedRevision.data;
        const body: Record<string, unknown> = {
          projectId: revisionTarget.projectId,
          intakeText: (d.rawBrief ?? "").trim(),
          figmaUrl: figmaInput.length > 0 ? figmaInput : ""
        };
        if (d.projectName?.trim()) {
          body.projectName = d.projectName.trim();
        }
        if (d.clientName?.trim()) {
          body.clientName = d.clientName.trim();
        }
        if (d.businessGoal?.trim()) {
          body.businessGoal = d.businessGoal.trim();
        }
        if (d.targetUsers?.trim()) {
          body.targetUsers = d.targetUsers.trim();
        }
        if (d.constraints?.trim()) {
          body.constraints = d.constraints.trim();
        }
        if (d.repoUrl?.trim()) {
          body.repoUrl = d.repoUrl.trim();
        }
        if (d.referencesText?.trim()) {
          body.referencesText = d.referencesText.trim();
        }
        if (d.deadline?.trim()) {
          body.deadline = d.deadline.trim();
        }

        const response = await fetch(`/api/pipeline/session/${revisionTarget.sessionId}/restart-intake`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });

        const json: unknown = await response.json();
        if (!response.ok) {
          const message = typeof json === "object" && json && "error" in json ? String(json.error) : "Request failed.";
          throw new Error(message);
        }
        bumpSessionHistory();
      } else {
        const briefText = rawBrief.trim();
        const parsedRequest = StructuredIntakeRequestSchema.safeParse({
          rawBrief: briefText,
          projectName: projectName.trim() || undefined,
          clientName: clientName.trim() || undefined,
          businessGoal: businessGoal.trim() || undefined,
          targetUsers: targetUsers.trim() || undefined,
          constraints: constraints.trim() || undefined,
          repoUrl: repoUrl.trim() || undefined,
          referencesText: referencesText.trim() || undefined,
          deadline: deadline.trim() || undefined,
          ...(figmaUrlField ? { figmaUrl: figmaUrlField } : {})
        });
        if (!parsedRequest.success) {
          setErrorMessage(parsedRequest.error.issues[0]?.message ?? "Check the form and try again.");
          return;
        }

        const d = parsedRequest.data;
        const payload: Record<string, unknown> = {
          rawBrief: briefText
        };
        if (d.projectName?.trim()) {
          payload.projectName = d.projectName.trim();
        }
        if (d.clientName?.trim()) {
          payload.clientName = d.clientName.trim();
        }
        if (d.businessGoal?.trim()) {
          payload.businessGoal = d.businessGoal.trim();
        }
        if (d.targetUsers?.trim()) {
          payload.targetUsers = d.targetUsers.trim();
        }
        if (d.constraints?.trim()) {
          payload.constraints = d.constraints.trim();
        }
        if (d.repoUrl?.trim()) {
          payload.repoUrl = d.repoUrl.trim();
        }
        if (d.referencesText?.trim()) {
          payload.referencesText = d.referencesText.trim();
        }
        if (d.deadline?.trim()) {
          payload.deadline = d.deadline.trim();
        }
        if (figmaUrlField) {
          payload.figmaUrl = figmaUrlField;
        }

        const response = await fetch("/api/pipeline", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const json: unknown = await response.json();
        if (!response.ok) {
          const message = typeof json === "object" && json && "error" in json ? String(json.error) : "Request failed.";
          throw new Error(message);
        }

        const parsedResponse = IntakeResponseSchema.safeParse(json);
        if (!parsedResponse.success) {
          throw new Error("Pipeline API returned an invalid response.");
        }

        setSessionId(parsedResponse.data.sessionId);
        resetNewProjectForm();
      }

      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isProjectRevision ? "Revise your brief" : "Start a new pipeline"}</CardTitle>
        <CardDescription>
          {isProjectRevision
            ? "Update your vibe and re-run normalization and gap analysis for this session."
            : "Paste or structure the brief. We will normalize it and kick off the next stages when you submit."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="intake-project-name" className="text-sm font-medium leading-none">
                Project name <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-project-name"
                type="text"
                autoComplete="organization"
                placeholder="e.g. Acme Team Planner"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="intake-client" className="text-sm font-medium leading-none">
                Client <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-client"
                type="text"
                autoComplete="organization"
                placeholder="Client or stakeholder name"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="intake-deadline" className="text-sm font-medium leading-none">
                Target deadline <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-deadline"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="intake-business-goal" className="text-sm font-medium leading-none">
                Business goal <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-business-goal"
                type="text"
                placeholder="What outcome should this project drive?"
                value={businessGoal}
                onChange={(event) => setBusinessGoal(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="intake-target-users" className="text-sm font-medium leading-none">
                Target users <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="intake-target-users"
                placeholder="Who is the product for?"
                value={targetUsers}
                onChange={(event) => setTargetUsers(event.target.value)}
                disabled={isSubmitting}
                className="min-h-[72px]"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="intake-constraints" className="text-sm font-medium leading-none">
                Constraints <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="intake-constraints"
                placeholder="Budget, timeline, tech, compliance…"
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                disabled={isSubmitting}
                className="min-h-[72px]"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="intake-raw-brief" className="text-sm font-medium leading-none">
              Raw brief / description <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="intake-raw-brief"
              placeholder={
                isProjectRevision
                  ? "Updated project description / raw brief…"
                  : "Paste the full client request, notes, and anything else the pipeline should know."
              }
              value={rawBrief}
              onChange={(event) => setRawBrief(event.target.value)}
              disabled={isSubmitting}
              className="min-h-[120px]"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="intake-figma-url" className="text-sm font-medium leading-none">
                Figma URL <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-figma-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://www.figma.com/design/…/…"
                value={figmaUrl}
                onChange={(event) => setFigmaUrl(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="intake-repo-url" className="text-sm font-medium leading-none">
                Repository URL <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="intake-repo-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://github.com/org/repo"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                disabled={isSubmitting}
                className={inputClassName}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="intake-references" className="text-sm font-medium leading-none">
              References <span className="font-normal text-muted-foreground">(optional, one URL per line)</span>
            </label>
            <Textarea
              id="intake-references"
              placeholder={"https://example.com/inspiration\nhttps://docs.product.com"}
              value={referencesText}
              onChange={(event) => setReferencesText(event.target.value)}
              disabled={isSubmitting}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting
              ? isProjectRevision
                ? "Restarting analysis…"
                : "Starting pipeline..."
              : isProjectRevision
                ? "Save and restart analysis"
                : "Start pipeline"}
          </Button>
          {errorMessage ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {errorMessage}
            </p>
          ) : null}
          {sessionId ? (
            <p className="rounded-md border border-border bg-secondary p-3 text-sm">
              Session initialized: <span className="font-mono">{sessionId}</span>
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function IntakeFormFallback() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a new pipeline</CardTitle>
        <CardDescription>Loading form…</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-32 animate-pulse rounded-md bg-muted" />
      </CardContent>
    </Card>
  );
}

export function IntakeForm(props: IntakeFormProps) {
  return (
    <Suspense fallback={<IntakeFormFallback />}>
      <IntakeFormInner {...props} />
    </Suspense>
  );
}
