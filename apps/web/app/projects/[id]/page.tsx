import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { PersistedCheckpointEnvelope } from "@vibe/ai/graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HandoffExportCard } from "@/features/handoff-export";
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
import {
  type CursorRuleFile,
  resolveBriefForSession,
  resolveCursorRulesForSession,
  resolveDesignMapForSession,
  resolveTaskTreeForSession,
  resolveUIKitForSession
} from "@/lib/pipeline-export-state";
import { BriefSchema, PRDSchema, type Brief, type DesignMap, type PRD, type TaskTree, type UIKit } from "@vibe/schema";

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

function parseWorkflowStatusFromSessionState(stateJson: unknown): string | null {
  const envelope = parseEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const ws = (raw as Record<string, unknown>).workflowStatus;
  return typeof ws === "string" && ws.trim().length > 0 ? ws.trim() : null;
}

/** True once the PRD node has finished (workflow advanced past design / generation of the PRD artifact). */
function isPrdNodeComplete(workflowStatus: string | null): boolean {
  if (workflowStatus == null) {
    return true;
  }
  return (
    workflowStatus === "prd_generated" ||
    workflowStatus === "tasks_generated" ||
    workflowStatus === "design_analyzed" ||
    workflowStatus === "handoff_prepared" ||
    workflowStatus === "completed"
  );
}

/** Maps each session stage to the primary UI block for this page. Stages not listed have no main panel. */
const SESSION_STAGE_MAIN_FEATURE: Partial<Record<ProjectSessionStage, "intake" | "gaps" | "prd">> = {
  intake: "intake",
  analysis: "gaps",
  clarify: "gaps",
  prd: "prd",
  tasks: "prd",
  design_sync: "prd",
  handoff: "prd",
  export: "prd"
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
  return "";
}

function getInitialFigmaUrlFromState(stateJson: unknown): string {
  const envelope = parseEnvelope(stateJson);
  const raw = envelope?.pipelineState.stateJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "";
  }
  const key = (raw as Record<string, unknown>).figmaFileKey;
  if (typeof key !== "string" || !key.trim()) {
    return "";
  }
  const k = key.trim();
  return `https://www.figma.com/design/${encodeURIComponent(k)}/file`;
}

function linearTeamDisplayFromEnv(): string {
  const name = process.env.LINEAR_TEAM_NAME?.trim();
  if (name) {
    return name;
  }
  const id = process.env.LINEAR_TEAM_ID?.trim();
  if (id && id.length > 10) {
    return `Team ${id.slice(0, 8)}…`;
  }
  if (id) {
    return `Team ${id}`;
  }
  return "configured team";
}

function renderSessionStageContent(options: {
  stage: ProjectSessionStage;
  sessionId: string;
  projectId: string;
  project: { description: string | null; source_figma_url: string | null };
  stateJson: unknown;
  prdForRead: PRD | null;
  prdLoadError: string | null;
  prdNodeComplete: boolean;
  taskTreeForExport: TaskTree | null;
  taskTreeLoadError: string | null;
  designMapForRead: DesignMap | undefined;
  designMapLoadError: string | null;
  cursorRulesForRead: CursorRuleFile[];
  cursorRulesLoadError: string | null;
  uiKitForRead: UIKit | null;
  uiKitLoadError: string | null;
  briefForRead: Brief | null;
  briefLoadError: string | null;
  linearTeamDisplay: string;
  defaultLinearTeamId: string | undefined;
}): ReactNode {
  const feature = SESSION_STAGE_MAIN_FEATURE[options.stage];
  if (feature === "intake") {
    return (
      <IntakeForm
        projectId={options.projectId}
        pipelineSessionId={options.sessionId}
        initialIntakeText={getIntakeEditorInitialText(options.project, options.stateJson)}
        initialFigmaUrl={
          options.project.source_figma_url?.trim() || getInitialFigmaUrlFromState(options.stateJson)
        }
      />
    );
  }
  if (feature === "gaps") {
    return <GapViewer sessionId={options.sessionId} />;
  }
  if (feature === "prd") {
    return (
      <>
        {options.taskTreeLoadError ? (
          <Card className="border-red-300 dark:border-red-500/50">
            <CardHeader>
              <CardTitle className="text-base text-red-800 dark:text-red-200">Task tree could not be loaded</CardTitle>
              <CardDescription className="text-red-700 dark:text-red-300">{options.taskTreeLoadError}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {options.designMapLoadError || options.uiKitLoadError ? (
          <Card className="border-red-300 dark:border-red-500/50">
            <CardHeader>
              <CardTitle className="text-base text-red-800 dark:text-red-200">Design / UI kit</CardTitle>
              <CardDescription className="space-y-1 text-red-700 dark:text-red-300">
                {options.designMapLoadError ? <p>Design map: {options.designMapLoadError}</p> : null}
                {options.uiKitLoadError ? <p>UI kit: {options.uiKitLoadError}</p> : null}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {options.briefLoadError || (options.prdForRead != null && options.briefForRead == null) ? (
          <Card className="border-amber-300 dark:border-amber-500/50">
            <CardHeader>
              <CardTitle className="text-base text-amber-900 dark:text-amber-100">Brief</CardTitle>
              <CardDescription className="text-amber-800 dark:text-amber-200">
                {options.briefLoadError ?? "No brief artifact."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {options.cursorRulesLoadError ? (
          <Card className="border-red-300 dark:border-red-500/50">
            <CardHeader>
              <CardTitle className="text-base text-red-800 dark:text-red-200">Cursor rules artifact</CardTitle>
              <CardDescription className="text-red-700 dark:text-red-300">{options.cursorRulesLoadError}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {options.prdForRead ? (
          <PrdReadMode
            prd={options.prdForRead}
            prdNodeComplete={options.prdNodeComplete}
            sessionId={options.sessionId}
            projectId={options.projectId}
            taskTree={options.taskTreeForExport}
            designMap={options.designMapForRead}
            cursorRules={options.cursorRulesForRead}
            uiKit={options.uiKitForRead ?? undefined}
            brief={options.briefForRead}
            linearTeamDisplay={options.linearTeamDisplay}
            defaultLinearTeamId={options.defaultLinearTeamId}
          />
        ) : (
          <Card className={options.prdLoadError ? "border-red-300 dark:border-red-500/50" : undefined}>
            <CardHeader>
              <CardTitle>Product requirements</CardTitle>
              <CardDescription
                className={
                  options.prdLoadError ? "text-red-700 dark:text-red-300" : undefined
                }
              >
                {options.prdLoadError ?? "No valid PRD artifact."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </>
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

  const isReadModeStage = (stage: ProjectSessionStage) =>
    stage === "prd" || stage === "tasks" || stage === "design_sync" || stage === "handoff" || stage === "export";

  let prdForRead: PRD | null = null;
  let prdLoadedFromArtifact = false;
  let prdLoadError: string | null = null;
  const workflowStatus = session && !sessionError ? parseWorkflowStatusFromSessionState(session.state_json) : null;
  if (session && !sessionError && isReadModeStage(session.current_stage)) {
    const { data: prdArtifact, error: prdArtifactError } = await getLatestArtifactVersion(client, projectId, "prd");
    if (prdArtifactError) {
      prdLoadError = `Failed to load PRD artifact: ${prdArtifactError.message}`;
    } else if (prdArtifact?.content_json) {
      const parsed = PRDSchema.safeParse(prdArtifact.content_json);
      if (parsed.success) {
        prdForRead = parsed.data;
        prdLoadedFromArtifact = true;
      } else {
        prdLoadError = `Latest PRD artifact failed validation: ${parsed.error.message}`;
      }
    }
  }
  const prdNodeComplete = isPrdNodeComplete(workflowStatus) || prdLoadedFromArtifact;

  let taskTreeForExport: TaskTree | null = null;
  let taskTreeLoadError: string | null = null;
  let designMapForRead: DesignMap | undefined;
  let designMapLoadError: string | null = null;
  let cursorRulesForRead: CursorRuleFile[] = [];
  let cursorRulesLoadError: string | null = null;
  let uiKitForRead: UIKit | null = null;
  let uiKitLoadError: string | null = null;
  let briefForRead: Brief | null = null;
  let briefLoadError: string | null = null;
  if (session && !sessionError && isReadModeStage(session.current_stage)) {
    const resolvedTasks = await resolveTaskTreeForSession(client, projectId);
    taskTreeForExport = resolvedTasks.taskTree;
    taskTreeLoadError = resolvedTasks.loadError;
    const resolvedDesign = await resolveDesignMapForSession(client, projectId);
    designMapForRead = resolvedDesign.designMap;
    designMapLoadError = resolvedDesign.loadError;
    const resolvedUi = await resolveUIKitForSession(client, projectId);
    uiKitForRead = resolvedUi.uiKit;
    uiKitLoadError = resolvedUi.loadError;
    const resolvedCr = await resolveCursorRulesForSession(client, projectId);
    cursorRulesForRead = resolvedCr.cursorRules;
    cursorRulesLoadError = resolvedCr.loadError;
    const resolvedBrief = await resolveBriefForSession(client, projectId);
    briefForRead = resolvedBrief.brief;
    briefLoadError = resolvedBrief.loadError;
  }

  const linearTeamDisplay = linearTeamDisplayFromEnv();
  const defaultLinearTeamId = process.env.NEXT_PUBLIC_LINEAR_TEAM_ID?.trim() || undefined;

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

      <HandoffExportCard
        projectId={projectId}
        specPackLikelyReady={Boolean(prdForRead)}
        cursorRulesLikelyReady={cursorRulesForRead.length > 0}
        prdHint={prdLoadError}
        taskHint={taskTreeLoadError}
        cursorRulesHint={cursorRulesLoadError}
        briefHint={briefLoadError}
      />

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
            prdForRead,
            prdLoadError,
            prdNodeComplete,
            taskTreeForExport,
            taskTreeLoadError,
            designMapForRead,
            designMapLoadError,
            cursorRulesForRead,
            cursorRulesLoadError,
            uiKitForRead,
            uiKitLoadError,
            briefForRead,
            briefLoadError,
            linearTeamDisplay,
            defaultLinearTeamId
          })}
        </SessionProgressWithHistory>
      ) : null}
    </div>
  );
}
