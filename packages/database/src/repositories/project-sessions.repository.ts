import type { PostgrestError } from "@supabase/supabase-js";
import type { DatabaseClient } from "../client";
import type { Json, TableInsert, TableRow, TableUpdate } from "../database.types";

export type ProjectSessionRow = TableRow<"project_sessions">;
export type CreateProjectSessionInput = TableInsert<"project_sessions">;
export type UpdateProjectSessionInput = TableUpdate<"project_sessions">;

export type GraphStatus = ProjectSessionRow["graph_status"];
export type Stage = ProjectSessionRow["current_stage"];

export type RepositoryResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export async function createProjectSession(
  client: DatabaseClient,
  input: CreateProjectSessionInput
): Promise<RepositoryResult<ProjectSessionRow>> {
  return client.from("project_sessions").insert(input).select("*").single();
}

export async function getProjectSessionById(
  client: DatabaseClient,
  id: string
): Promise<RepositoryResult<ProjectSessionRow>> {
  return client.from("project_sessions").select("*").eq("id", id).maybeSingle();
}

export async function getLatestProjectSessionByProjectId(
  client: DatabaseClient,
  projectId: string
): Promise<RepositoryResult<ProjectSessionRow>> {
  return client
    .from("project_sessions")
    .select("*")
    .eq("project_id", projectId)
    .order("session_version", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function updateProjectSessionById(
  client: DatabaseClient,
  id: string,
  updates: UpdateProjectSessionInput
): Promise<RepositoryResult<ProjectSessionRow>> {
  return client.from("project_sessions").update(updates).eq("id", id).select("*").single();
}

export async function setProjectSessionState(
  client: DatabaseClient,
  id: string,
  stateJson: Json,
  lastNode?: string | null
): Promise<RepositoryResult<ProjectSessionRow>> {
  return updateProjectSessionById(client, id, {
    state_json: stateJson,
    last_node: lastNode ?? null
  });
}

export async function setProjectSessionStatus(
  client: DatabaseClient,
  id: string,
  graphStatus: GraphStatus,
  currentStage?: Stage,
  lastError?: Json | null
): Promise<RepositoryResult<ProjectSessionRow>> {
  return updateProjectSessionById(client, id, {
    graph_status: graphStatus,
    current_stage: currentStage,
    last_error: lastError ?? null
  });
}
