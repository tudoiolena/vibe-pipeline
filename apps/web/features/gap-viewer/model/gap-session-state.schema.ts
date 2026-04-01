import { z } from "zod";

export const GapItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(["High", "Med", "Low"]),
  type: z.string()
});

export const GapSessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  projectId: z.string().uuid(),
  currentStage: z.string(),
  stageLabel: z.string(),
  graphStatus: z.string(),
  gaps: z.array(GapItemSchema),
  needsClarification: z.boolean(),
  workflowStatus: z.string().nullable().optional(),
  hasPrd: z.boolean().optional(),
  clarificationRounds: z.array(z.string()).optional(),
  sessionUpdatedAt: z.string().optional()
});

export type GapItem = z.infer<typeof GapItemSchema>;
export type GapSessionState = z.infer<typeof GapSessionStateSchema>;
