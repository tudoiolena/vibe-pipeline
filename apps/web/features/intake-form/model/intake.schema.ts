import { z } from "zod";

const SourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

/** Client-side validation aligned with POST /api/pipeline and restart-intake (use rawBrief; map to intakeText when restarting). */
export const StructuredIntakeRequestSchema = z
  .object({
    projectName: z.string().optional(),
    clientName: z.string().optional(),
    businessGoal: z.string().optional(),
    targetUsers: z.string().optional(),
    constraints: z.string().optional(),
    rawBrief: z.string().optional(),
    figmaUrl: z.string().optional(),
    repoUrl: z.string().optional(),
    referencesText: z.string().optional(),
    references: z.array(SourceLinkSchema).optional(),
    deadline: z.string().optional()
  })
  .superRefine((data, ctx) => {
    const brief = (data.rawBrief ?? "").trim();
    if (brief.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Describe the project (raw brief) before submitting.",
        path: ["rawBrief"]
      });
    }
  });

export type StructuredIntakeRequest = z.infer<typeof StructuredIntakeRequestSchema>;

export const IntakeResponseSchema = z.object({
  sessionId: z.string().uuid()
});

export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
