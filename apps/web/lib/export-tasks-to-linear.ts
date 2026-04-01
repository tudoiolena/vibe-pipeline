type ExportTasksToLinearInput = {
  sessionId: string;
  selectedTaskIds: string[];
  teamId?: string;
};

type ExportTasksToLinearResponse = {
  workspaceUrl?: string | null;
};

export async function exportTasksToLinear(input: ExportTasksToLinearInput): Promise<ExportTasksToLinearResponse> {
  const res = await fetch("/api/pipeline/export/linear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error ?? res.statusText)
        : res.statusText;
    throw new Error(message);
  }

  return payload as ExportTasksToLinearResponse;
}
