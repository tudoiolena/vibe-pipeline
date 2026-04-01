import type { PostgrestError } from "@supabase/supabase-js";
import type { DatabaseClient } from "../client";
import type { Json, TableInsert, TableRow } from "../database.types";

export type LanggraphCheckpointRow = TableRow<"langgraph_checkpoints">;
export type InsertLanggraphCheckpointInput = TableInsert<"langgraph_checkpoints">;

export type RepositoryResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export async function insertLanggraphCheckpoint(
  client: DatabaseClient,
  input: InsertLanggraphCheckpointInput
): Promise<RepositoryResult<LanggraphCheckpointRow>> {
  return client.from("langgraph_checkpoints").insert(input).select("*").single();
}

export async function listLanggraphCheckpointsBySessionId(
  client: DatabaseClient,
  sessionId: string
): Promise<RepositoryResult<LanggraphCheckpointRow[]>> {
  return client
    .from("langgraph_checkpoints")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
}
