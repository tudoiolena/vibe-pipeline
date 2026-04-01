import type { PostgrestError } from "@supabase/supabase-js";
import type { DatabaseClient } from "../client";
import type { TableInsert, TableRow, TableUpdate } from "../database.types";

export type ProjectRow = TableRow<"projects">;
export type CreateProjectInput = TableInsert<"projects">;
export type UpdateProjectInput = TableUpdate<"projects">;

export type RepositoryResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export async function createProject(client: DatabaseClient, input: CreateProjectInput): Promise<RepositoryResult<ProjectRow>> {
  return client.from("projects").insert(input).select("*").single();
}

export async function getProjectById(client: DatabaseClient, id: string): Promise<RepositoryResult<ProjectRow>> {
  return client.from("projects").select("*").eq("id", id).maybeSingle();
}

export async function getProjectBySlug(client: DatabaseClient, slug: string): Promise<RepositoryResult<ProjectRow>> {
  return client.from("projects").select("*").eq("slug", slug).maybeSingle();
}

export async function listProjects(
  client: DatabaseClient,
  options?: { includeArchived?: boolean }
): Promise<RepositoryResult<ProjectRow[]>> {
  let query = client.from("projects").select("*").order("created_at", { ascending: false });
  if (!options?.includeArchived) {
    query = query.neq("status", "archived");
  }
  return query;
}

export async function updateProjectById(
  client: DatabaseClient,
  id: string,
  updates: UpdateProjectInput
): Promise<RepositoryResult<ProjectRow>> {
  return client.from("projects").update(updates).eq("id", id).select("*").single();
}

export async function deleteProjectById(client: DatabaseClient, id: string): Promise<RepositoryResult<ProjectRow>> {
  return client.from("projects").delete().eq("id", id).select("*").single();
}
