import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GapViewer } from "@/features/gap-viewer";
import { IntakeForm } from "@/features/intake-form";
import { PrdReadMode } from "@/features/prd-read-mode";
import { SessionProgressWithHistory } from "@/features/session-history";
import { getPipelineStageLabel, type ProjectSessionStage } from "@/lib/pipeline-stage-labels";
import { getSessionStepperActiveIndex } from "@/lib/session-progress";
import {
  createClient,
  getLatestArtifactVersion,
  getLatestProjectSessionByProjectId,
  getProjectById
} from "@vibe/database";
import { BriefSchema, PRDSchema, type PRD } from "@vibe/schema";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
};

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

function parsePrdFromSessionState(stateJson: unknown): PRD | null {
  const envelope = parseEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const prd = (raw as Record<string, unknown>).prd;
  const parsed = PRDSchema.safeParse(prd);
  return parsed.success ? parsed.data : null;
}

/** Maps each session stage to the primary UI block for this page. Stages not listed have no main panel. */
const SESSION_STAGE_MAIN_FEATURE: Partial<Record<ProjectSessionStage, "intake" | "gaps" | "prd">> = {
  intake: "intake",
  analysis: "gaps",
  clarify: "gaps",
  prd: "prd"
};

function getIntakeEditorInitialText(project: { description: string | null }, stateJson: unknown): string {
  const desc = project.description?.trim();
  if (desc) {
    return desc;
  }

  const envelope = parseEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "";
  }
  const rec = raw as Record<string, unknown>;
  const briefParsed = BriefSchema.safeParse(rec.brief);
  if (briefParsed.success) {
    return briefParsed.data.summary;
  }
  for (const key of ["rawIntakeText", "intakeText", "rawBrief", "inputText"] as const) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return "";
}

function renderSessionStageContent(options: {
  stage: ProjectSessionStage;
  sessionId: string;
  projectId: string;
  project: { description: string | null };
  stateJson: unknown;
  prdForRead: PRD | null;
}): ReactNode {
  const feature = SESSION_STAGE_MAIN_FEATURE[options.stage];
  if (feature === "intake") {
    return (
      <IntakeForm
        projectId={options.projectId}
        pipelineSessionId={options.sessionId}
        initialIntakeText={getIntakeEditorInitialText(options.project, options.stateJson)}
      />
    );
  }
  if (feature === "gaps") {
    return <GapViewer sessionId={options.sessionId} />;
  }
  if (feature === "prd") {
    return options.prdForRead ? (
      <PrdReadMode prd={options.prdForRead} sessionId={options.sessionId} />
    ) : (
      <Card>
        <CardHeader>
          <CardTitle>Product requirements</CardTitle>
          <CardDescription>
            This session is in the PRD stage, but no structured PRD was found on the latest artifact or checkpoint.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return null;
}

export default async function ProjectSessionPage({ params }: ProjectPageProps) {
  const { id: projectId } = await params;
  const client = createClient();

  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError || !project) {
    notFound();
  }

  const { data: session, error: sessionError } = await getLatestProjectSessionByProjectId(client, projectId);

  let prdForRead: PRD | null = null;
  if (session && !sessionError && session.current_stage === "prd") {
    const { data: prdArtifact } = await getLatestArtifactVersion(client, projectId, "prd");
    if (prdArtifact?.content_json) {
      const parsed = PRDSchema.safeParse(prdArtifact.content_json);
      if (parsed.success) {
        prdForRead = parsed.data;
      }
    }
    if (!prdForRead) {
      prdForRead = parsePrdFromSessionState(session.state_json);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to home
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              <CardDescription className="mt-1">{project.description ?? "No description."}</CardDescription>
            </div>
            <Badge variant="secondary">{project.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessionError ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              Failed to load session: {sessionError.message}
            </p>
          ) : !session ? (
            <p className="text-sm text-muted-foreground">No pipeline session yet for this project.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Session</p>
              <p className="font-mono text-xs text-foreground">{session.id}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">Stage</span>
                <Badge variant="outline">{getPipelineStageLabel(session.current_stage)}</Badge>
                <Badge variant="secondary">{session.graph_status}</Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {session && !sessionError ? (
        <SessionProgressWithHistory
          sessionId={session.id}
          projectId={projectId}
          activeStepperIndex={getSessionStepperActiveIndex(session)}
        >
          {renderSessionStageContent({
            stage: session.current_stage,
            sessionId: session.id,
            projectId,
            project,
            stateJson: session.state_json,
            prdForRead
          })}
        </SessionProgressWithHistory>
      ) : null}
    </div>
  );
}
