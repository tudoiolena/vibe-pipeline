import { z } from "zod";
import { GapItemSchema } from "@/features/gap-viewer/model/gap-session-state.schema";

export const ClarificationTimelineEventSchema = z.discriminatedUnion("kind", [
  z.object({
    at: z.string(),
    kind: z.literal("figma_verified"),
    fileKey: z.string().optional()
  }),
  z.object({
    at: z.string(),
    kind: z.literal("figma_failed"),
    error: z.string().optional()
  }),
  z.object({
    at: z.string(),
    kind: z.literal("clarifications_merged_into_brief")
  })
]);

export type ClarificationTimelineEvent = z.infer<typeof ClarificationTimelineEventSchema>;

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
  gaps: z.array(GapItemSchema),
  /** From pipeline `stateJson` when gap analysis ran (Figma validation). */
  figmaLinkVerified: z.boolean().nullish().default(null)
});

/** API shape: timeline entries plus ordered clarifications from session state. */
export const SessionHistoryPayloadSchema = z.object({
  entries: z.array(SessionHistoryEntrySchema),
  clarificationRounds: z.array(z.string()),
  clarificationTimeline: z.array(ClarificationTimelineEventSchema).default([])
});

export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;
export type SessionHistoryPayload = z.infer<typeof SessionHistoryPayloadSchema>;
export type SessionHistoryItemType = z.infer<typeof SessionHistoryItemTypeSchema>;
