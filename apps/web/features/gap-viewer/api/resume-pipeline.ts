import { z } from "zod";

const ResumeResponseSchema = z.object({
  ok: z.literal(true)
});

export async function resumePipeline(sessionId: string, userInput: string): Promise<void> {
  const response = await fetch("/api/pipeline/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, userInput: userInput.trim() })
  });

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "error" in json ? String(json.error) : "Resume request failed.";
    throw new Error(message);
  }

  const parsed = ResumeResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Resume API returned an invalid response.");
  }
}
