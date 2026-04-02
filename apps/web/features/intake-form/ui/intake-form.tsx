"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useBumpSessionHistory } from "@/features/session-history";
import { extractFigmaFileKeyFromUrl } from "@vibe/integrations";
import { cn } from "@/lib/utils";
import { IntakeRequestSchema, IntakeResponseSchema } from "../model/intake.schema";

const SessionHydrationSchema = z.object({
  hydratedIntake: z.object({
    intakeText: z.string(),
    figmaDesignUrl: z.string().optional()
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

function resolveFigmaKeyFromInput(figmaInput: string): string | null {
  const trimmed = figmaInput.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const fromUrl = extractFigmaFileKeyFromUrl(trimmed);
  const asRawKey = /^[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
  return fromUrl ?? asRawKey;
}

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
  const [intakeText, setIntakeText] = useState(initialIntakeText);
  const [figmaUrl, setFigmaUrl] = useState(initialFigmaUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIntakeText(initialIntakeText);
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
        const key =
          typeof parsed.data.figmaFileKey === "string" && parsed.data.figmaFileKey.trim().length > 0
            ? parsed.data.figmaFileKey.trim()
            : null;
        if (key) {
          setFigmaUrl(`https://www.figma.com/design/${encodeURIComponent(key)}/file`);
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
        const { intakeText: nextText, figmaDesignUrl } = parsed.data.hydratedIntake;
        if (nextText.trim().length > 0) {
          setIntakeText(nextText.trim());
        }
        if (typeof figmaDesignUrl === "string" && figmaDesignUrl.trim().length > 0) {
          setFigmaUrl(figmaDesignUrl.trim());
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSessionId(null);

    let figmaFileKey: string | undefined;
    const figmaInput = figmaUrl.trim();
    if (figmaInput.length > 0) {
      const resolved = resolveFigmaKeyFromInput(figmaInput);
      if (!resolved) {
        setErrorMessage("Enter a valid Figma design, file, or prototype URL (or paste the file key).");
        return;
      }
      figmaFileKey = resolved;
    }

    const parsedRequest = IntakeRequestSchema.safeParse({
      intakeText,
      ...(figmaFileKey ? { figmaFileKey } : {})
    });
    if (!parsedRequest.success) {
      setErrorMessage(parsedRequest.error.issues[0]?.message ?? "Please provide intake text.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (revisionTarget) {
        const body: {
          projectId: string;
          intakeText: string;
          figmaFileKey?: string | null;
        } = {
          projectId: revisionTarget.projectId,
          intakeText: parsedRequest.data.intakeText
        };
        if (figmaFileKey) {
          body.figmaFileKey = figmaFileKey;
        } else {
          body.figmaFileKey = "";
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
        const response = await fetch("/api/pipeline", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            intakeText: parsedRequest.data.intakeText,
            figmaFileKey: parsedRequest.data.figmaFileKey ?? ""
          })
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
        setIntakeText("");
        setFigmaUrl("");
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
        <CardTitle>{isProjectRevision ? "Revise your brief" : "New Intake"}</CardTitle>
        <CardDescription>
          {isProjectRevision
            ? "Update your vibe and re-run normalization and gap analysis for this session."
            : "Describe your project vibe to start a pipeline session."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Textarea
            placeholder="Example: I want a lightweight team planning tool with role-based access and AI-assisted task drafting."
            value={intakeText}
            onChange={(event) => setIntakeText(event.target.value)}
            disabled={isSubmitting}
          />
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
              className={cn(
                "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              )}
            />
          </div>
          <Button type="submit" disabled={isSubmitting}>
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
        <CardTitle>Intake</CardTitle>
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
