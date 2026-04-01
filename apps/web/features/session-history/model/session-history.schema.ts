import { z } from "zod";
import { GapItemSchema } from "@/features/gap-viewer/model/gap-session-state.schema";

export const SessionHistoryItemTypeSchema = z.enum([
  "USER_INPUT",
  "ANALYSIS_RESULT",
  "MILESTONE",
  "BRIEF_UPDATE"
]);

export const SessionHistoryEntrySchema = z.object({
  checkpointId: z.string(),
  timestamp: z.string(),
  type: SessionHistoryItemTypeSchema,
  milestoneLabel: z.string().nullable(),
  userClarification: z.string().nullable(),
  /** Set when type is BRIEF_UPDATE (Step 1 prompt revision). */
  previousBrief: z.string().nullable(),
  newBrief: z.string().nullable(),
  gapCount: z.number(),
  gapCountBefore: z.number().nullable(),
  hasGapAnalysis: z.boolean(),
  gaps: z.array(GapItemSchema)
});

export const SessionHistoryResponseSchema = z.array(SessionHistoryEntrySchema);

export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;
export type SessionHistoryItemType = z.infer<typeof SessionHistoryItemTypeSchema>;
