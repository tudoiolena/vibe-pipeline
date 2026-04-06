import type { ZodError } from "zod";

export function zodIssuesPayload(error: ZodError) {
  return {
    error: "Validation failed.",
    issues: error.flatten()
  };
}
