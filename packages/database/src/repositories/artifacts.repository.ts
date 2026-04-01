import type { PostgrestError } from "@supabase/supabase-js";
import type { DatabaseClient } from "../client";
import type { TableInsert, TableRow, TableUpdate } from "../database.types";

export type ArtifactRow = TableRow<"artifacts">;
export type CreateArtifactInput = TableInsert<"artifacts">;
export type UpdateArtifactInput = TableUpdate<"artifacts">;
export type ArtifactType = ArtifactRow["artifact_type"];

export type RepositoryResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export async function createArtifactVersion(
  client: DatabaseClient,
  input: CreateArtifactInput
): Promise<RepositoryResult<ArtifactRow>> {
  return client.from("artifacts").insert(input).select("*").single();
}

export async function getArtifactById(client: DatabaseClient, id: string): Promise<RepositoryResult<ArtifactRow>> {
  return client.from("artifacts").select("*").eq("id", id).maybeSingle();
}

export async function getLatestArtifactVersion(
  client: DatabaseClient,
  projectId: string,
  artifactType: ArtifactType
): Promise<RepositoryResult<ArtifactRow>> {
  return client
    .from("artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("artifact_type", artifactType)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function listArtifactsByProjectId(
  client: DatabaseClient,
  projectId: string
): Promise<RepositoryResult<ArtifactRow[]>> {
  return client.from("artifacts").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
}

export async function updateArtifactById(
  client: DatabaseClient,
  id: string,
  updates: UpdateArtifactInput
): Promise<RepositoryResult<ArtifactRow>> {
  return client.from("artifacts").update(updates).eq("id", id).select("*").single();
}
