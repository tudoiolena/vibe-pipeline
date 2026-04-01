import { GapSessionStateSchema, type GapSessionState } from "../model/gap-session-state.schema";

export async function fetchSessionGapState(sessionId: string): Promise<GapSessionState> {
  const response = await fetch(`/api/pipeline/session/${sessionId}`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store"
  });

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "error" in json ? String(json.error) : "Failed to load session state.";
    throw new Error(message);
  }

  const parsed = GapSessionStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Session API returned an invalid payload.");
  }

  return parsed.data;
}
