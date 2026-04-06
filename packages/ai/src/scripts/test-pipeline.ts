import {
  createClient,
  createProject,
  createProjectSession,
  getProjectSessionById,
  listArtifactsByProjectId
} from "@vibe/database";
import { TaskTreeSchema } from "@vibe/schema";
import {
  createPipelineGraph,
  createSessionConfig,
  resumePipelineWithClarification,
  type PersistedCheckpointEnvelope
} from "../graph";

type ScriptArgs = {
  sessionId?: string;
  brief: string;
  /** When set with --session-id, runs resumePipelineWithClarification instead of a raw graph.invoke. */
  clarification?: string;
  /** Exit non-zero unless tasks + cursor rules exist in state and artifact rows were created. */
  strictHandoff: boolean;
  /**
   * Sets VIBE_TEST_PIPELINE_SKIP_CLARIFICATION so gapDetector does not stop on High gaps (local script only).
   * Production UI must not rely on this.
   */
  skipClarificationGate: boolean;
};

const DEFAULT_MESSY_BRIEF =
  "I want a web app for selling coffee beans, but I'm not sure about the checkout or users.";

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    brief: DEFAULT_MESSY_BRIEF,
    strictHandoff: false,
    skipClarificationGate: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--session-id") {
      args.sessionId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--brief") {
      args.brief = argv[index + 1] ?? DEFAULT_MESSY_BRIEF;
      index += 1;
      continue;
    }
    if (token === "--strict-handoff") {
      args.strictHandoff = true;
      continue;
    }
    if (token === "--clarification") {
      args.clarification = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (token === "--skip-clarification-gate") {
      args.skipClarificationGate = true;
      continue;
    }
  }

  return args;
}

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

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.skipClarificationGate) {
    process.env.VIBE_TEST_PIPELINE_SKIP_CLARIFICATION = "1";
    console.log("[test-pipeline] skip-clarification-gate: gap High-priority stop disabled for this process only.");
  }
  const client = createClient();

  if (args.clarification !== undefined) {
    if (!args.sessionId) {
      throw new Error("--clarification requires --session-id (existing session waiting for input).");
    }
    if (args.clarification.length === 0) {
      throw new Error("--clarification value must be non-empty.");
    }
  }

  let projectId: string;
  let sessionId: string;

  if (args.sessionId) {
    const { data: existingSession, error: sessionError } = await getProjectSessionById(client, args.sessionId);
    if (sessionError) {
      throw new Error(`Failed to load provided session ${args.sessionId}: ${sessionError.message}`);
    }
    if (!existingSession) {
      throw new Error(`Session ${args.sessionId} was not found.`);
    }
    projectId = existingSession.project_id;
    sessionId = existingSession.id;
    console.log(`Using existing session: ${sessionId}`);
  } else {
    const slug = `pipeline-test-${Date.now()}`;
    const { data: project, error: projectError } = await createProject(client, {
      slug,
      name: "Pipeline Script Validation",
      description: "Session created by @vibe/ai test-pipeline script."
    });
    if (projectError || !project) {
      throw new Error(`Failed to create validation project: ${projectError?.message ?? "unknown insert error"}`);
    }

    const { data: session, error: createSessionError } = await createProjectSession(client, {
      project_id: project.id,
      current_stage: "intake",
      graph_status: "idle",
      state_json: {}
    });
    if (createSessionError || !session) {
      throw new Error(`Failed to create validation session: ${createSessionError?.message ?? "unknown insert error"}`);
    }

    projectId = project.id;
    sessionId = session.id;
    console.log(`Created new project: ${projectId}`);
    console.log(`Created new session: ${sessionId}`);
  }

  const { data: beforeSession, error: beforeSessionError } = await getProjectSessionById(client, sessionId);
  if (beforeSessionError || !beforeSession) {
    throw new Error(`Failed to load session before run: ${beforeSessionError?.message ?? "unknown load error"}`);
  }

  const beforeEnvelope = parseEnvelope(beforeSession.state_json);
  const checkpointId = beforeEnvelope ? (beforeEnvelope.checkpoint as { id?: string }).id : undefined;
  const mode =
    args.clarification !== undefined ? "clarification_resume" : checkpointId ? "resume" : "fresh";
  const sessionConfig = createSessionConfig(sessionId, checkpointId);

  const { graph } = createPipelineGraph(client);
  const inputState = {
    projectId,
    sessionId,
    currentStage: "intake" as const,
    stateJson: {
      rawIntakeText: args.brief
    }
  };

  const artifactsBefore = await listArtifactsByProjectId(client, projectId);
  if (artifactsBefore.error) {
    throw new Error(`Failed to list artifacts before run: ${artifactsBefore.error.message}`);
  }
  const briefArtifactsBefore = (artifactsBefore.data ?? []).filter((artifact) => artifact.artifact_type === "brief").length;
  const prdArtifactsBefore = (artifactsBefore.data ?? []).filter((artifact) => artifact.artifact_type === "prd").length;

  console.log(`Run mode: ${mode}`);
  console.log(`Checkpoint before run: ${checkpointId ?? "<none>"}`);
  if (args.clarification !== undefined) {
    console.log("Invoking resumePipelineWithClarification…");
    await resumePipelineWithClarification(client, sessionId, args.clarification);
  } else if (mode === "resume") {
    await graph.invoke(undefined as never, sessionConfig);
  } else {
    await graph.invoke(inputState, sessionConfig);
  }

  const { data: afterSession, error: afterSessionError } = await getProjectSessionById(client, sessionId);
  if (afterSessionError || !afterSession) {
    throw new Error(`Failed to load session after run: ${afterSessionError?.message ?? "unknown load error"}`);
  }

  const afterEnvelope = parseEnvelope(afterSession.state_json);
  if (!afterEnvelope) {
    throw new Error("No persisted checkpoint envelope found in project_sessions.state_json after graph execution.");
  }

  const artifactsAfter = await listArtifactsByProjectId(client, projectId);
  if (artifactsAfter.error) {
    throw new Error(`Failed to list artifacts after run: ${artifactsAfter.error.message}`);
  }
  const briefArtifactsAfter = (artifactsAfter.data ?? []).filter((artifact) => artifact.artifact_type === "brief").length;
  const prdArtifactsAfter = (artifactsAfter.data ?? []).filter((artifact) => artifact.artifact_type === "prd").length;
  const tasksArtifactRows = (artifactsAfter.data ?? []).filter((artifact) => artifact.artifact_type === "tasks").length;
  const cursorRulesArtifactRows = (artifactsAfter.data ?? []).filter((artifact) => artifact.artifact_type === "cursor_rules")
    .length;

  const pipelineState = afterEnvelope.pipelineState;
  const stateJson = pipelineState.stateJson as Record<string, unknown>;
  const brief = stateJson.brief ?? null;
  const prd = stateJson.prd ?? null;

  const gapAnalysis = stateJson.gapAnalysis as { gaps?: unknown[] } | undefined;
  const gaps = Array.isArray(gapAnalysis?.gaps) ? gapAnalysis.gaps : [];
  const highPriorityGapExists = gaps.some((gap) => {
    if (!gap || typeof gap !== "object" || Array.isArray(gap)) {
      return false;
    }
    return (gap as { priority?: string }).priority === "High";
  });

  console.log("---- Pipeline Output ----");
  console.log("Brief:");
  console.log(prettyJson(brief));
  console.log("Gaps:");
  console.log(prettyJson(gapAnalysis ?? { gaps: [] }));
  console.log("PRD (state_json.prd):");
  console.log(prettyJson(prd));

  console.log("---- Session Status ----");
  console.log(`project_id: ${afterSession.project_id}`);
  console.log(`session_id: ${afterSession.id}`);
  console.log(`graph_status: ${afterSession.graph_status}`);
  console.log(`current_stage: ${afterSession.current_stage}`);
  console.log(`workflowStatus: ${String(stateJson.workflowStatus ?? "<missing>")}`);
  console.log(`last_node: ${afterSession.last_node ?? "<none>"}`);
  console.log(`checkpoint_after: ${String((afterEnvelope.checkpoint as { id?: string }).id ?? "<none>")}`);
  console.log(`brief_artifact_count_before: ${briefArtifactsBefore}`);
  console.log(`brief_artifact_count_after: ${briefArtifactsAfter}`);
  console.log(`prd_artifact_count_before: ${prdArtifactsBefore}`);
  console.log(`prd_artifact_count_after: ${prdArtifactsAfter}`);
  console.log(`tasks_artifact_rows_after: ${tasksArtifactRows}`);
  console.log(`cursor_rules_artifact_rows_after: ${cursorRulesArtifactRows}`);
  console.log(
    `resumed_from_checkpoint: ${mode === "resume" || mode === "clarification_resume" ? "true" : "false"}`
  );

  const tasksParsed = TaskTreeSchema.safeParse(stateJson.tasks ?? stateJson.taskTree);
  const epicCount = tasksParsed.success ? tasksParsed.data.epics.length : 0;
  const cursorRulesRaw = stateJson.cursorRules;
  const cursorRuleFilesInState = Array.isArray(cursorRulesRaw) ? cursorRulesRaw.length : 0;
  const workflowStatus = typeof stateJson.workflowStatus === "string" ? stateJson.workflowStatus : "";
  const stoppedForClarification =
    workflowStatus === "awaiting_user_clarification" && afterSession.graph_status === "interrupted_for_input";
  const handoffPrepared = workflowStatus === "handoff_prepared";
  const hasValidTaskTree = tasksParsed.success && epicCount > 0;
  const hasFiveCursorRules = cursorRuleFilesInState === 5;

  console.log("---- Handoff / export readiness ----");
  console.log(`workflowStatus: ${workflowStatus || "<missing>"}`);
  console.log(`stopped_for_clarification: ${stoppedForClarification}`);
  console.log(`task_tree_epics_in_state: ${epicCount}${tasksParsed.success ? "" : " (parse failed — see state_json.tasks)"}`);
  console.log(`cursor_rule_files_in_state: ${cursorRuleFilesInState} (implementation planner emits 5)`);
  console.log(`handoff_prepared: ${handoffPrepared}`);
  if (stoppedForClarification) {
    console.log(
      "Note: No task backlog or cursor rules are produced until gaps are resolved — the graph ends at needsClarification."
    );
  }
  if (!stoppedForClarification && !hasValidTaskTree) {
    console.log(
      "Note: Missing or invalid task tree in checkpoint state. Export ZIP reads latest `tasks` artifact rows; if the run failed after PRD or never reached taskGenerator, rows may be empty."
    );
  }
  if (handoffPrepared && (!hasFiveCursorRules || cursorRulesArtifactRows === 0)) {
    console.log(
      "Warning: workflow says handoff_prepared but cursor rules missing in state or DB — check persistCursorRulesArtifact errors."
    );
  }

  const highPriorityStopConfirmed =
    highPriorityGapExists &&
    afterSession.graph_status === "interrupted_for_input" &&
    stateJson.workflowStatus === "awaiting_user_clarification";

  console.log("---- Validation ----");
  console.log(`high_priority_gap_present: ${highPriorityGapExists}`);
  console.log(`high_priority_stop_confirmed: ${highPriorityStopConfirmed}`);
  if (mode === "resume") {
    console.log(
      `resume_reused_prior_checkpoint_without_new_brief_artifact: ${briefArtifactsAfter === briefArtifactsBefore}`
    );
  } else {
    console.log("resume_reused_prior_checkpoint_without_new_brief_artifact: <not_applicable_on_fresh_run>");
  }
  console.log(
    `To run resume test: npm run test:pipeline --workspace @vibe/ai -- --session-id ${sessionId}`
  );

  if (args.strictHandoff) {
    const failures: string[] = [];
    if (stoppedForClarification) {
      failures.push(
        "Pipeline stopped for user clarification (high-priority gaps or redraft). Resume via API after answering gaps."
      );
    }
    if (!hasValidTaskTree) {
      failures.push("Expected non-empty TaskTree in state (tasks/taskTree) after a full run.");
    }
    if (tasksArtifactRows === 0) {
      failures.push("Expected at least one `tasks` artifact row on the project (taskGenerator persist).");
    }
    if (!hasFiveCursorRules) {
      failures.push("Expected exactly 5 cursor rule files in state (implementationPlanner output).");
    }
    if (cursorRulesArtifactRows === 0) {
      failures.push("Expected at least one `cursor_rules` artifact row on the project.");
    }
    if (failures.length > 0) {
      console.error("---- --strict-handoff FAILED ----");
      for (const line of failures) {
        console.error(` - ${line}`);
      }
      process.exitCode = 1;
    } else {
      console.log("---- --strict-handoff OK ----");
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test-pipeline] ${message}`);
  process.exitCode = 1;
});
