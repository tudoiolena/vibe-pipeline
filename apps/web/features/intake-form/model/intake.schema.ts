import { z } from "zod";

export const IntakeRequestSchema = z.object({
  intakeText: z.string().min(1, "Please describe your vibe before submitting.")
});

export type IntakeRequest = z.infer<typeof IntakeRequestSchema>;

export const IntakeResponseSchema = z.object({
  sessionId: z.string().uuid()
});

export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
