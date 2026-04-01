"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useBumpSessionHistory } from "@/features/session-history";
import { IntakeRequestSchema, IntakeResponseSchema } from "../model/intake.schema";

export type IntakeFormProps = {
  /** When set with pipelineSessionId, submits to restart-intake for an existing project session (intake stage). */
  projectId?: string;
  pipelineSessionId?: string;
  initialIntakeText?: string;
};

export function IntakeForm({ projectId, pipelineSessionId, initialIntakeText = "" }: IntakeFormProps) {
  const router = useRouter();
  const bumpSessionHistory = useBumpSessionHistory();
  const revisionTarget =
    projectId !== undefined && pipelineSessionId !== undefined
      ? { projectId, sessionId: pipelineSessionId }
      : null;
  const isProjectRevision = revisionTarget !== null;
  const [intakeText, setIntakeText] = useState(initialIntakeText);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIntakeText(initialIntakeText);
  }, [initialIntakeText]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSessionId(null);

    const parsedRequest = IntakeRequestSchema.safeParse({ intakeText });
    if (!parsedRequest.success) {
      setErrorMessage(parsedRequest.error.issues[0]?.message ?? "Please provide intake text.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (revisionTarget) {
        const response = await fetch(`/api/pipeline/session/${revisionTarget.sessionId}/restart-intake`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            projectId: revisionTarget.projectId,
            intakeText: parsedRequest.data.intakeText
          })
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
          body: JSON.stringify(parsedRequest.data)
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
