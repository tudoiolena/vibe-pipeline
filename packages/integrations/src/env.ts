import { z } from "zod";

/**
 * Validates Figma-related environment variables before any Figma REST API call.
 */
export const FigmaAccessTokenSchema = z.object({
  FIGMA_ACCESS_TOKEN: z
    .string({
      required_error: 'Missing environment variable "FIGMA_ACCESS_TOKEN".',
      invalid_type_error: 'Environment variable "FIGMA_ACCESS_TOKEN" must be a string.'
    })
    .min(1, 'Environment variable "FIGMA_ACCESS_TOKEN" cannot be empty.')
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: 'Environment variable "FIGMA_ACCESS_TOKEN" cannot be whitespace only.'
    })
});

export type FigmaAccessEnv = z.infer<typeof FigmaAccessTokenSchema>;

/**
 * Returns a trimmed Figma personal access token or throws if env is invalid.
 * Call this (or {@link assertFigmaAccessEnv}) before any Figma API request.
 */
export function requireFigmaAccessToken(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = FigmaAccessTokenSchema.safeParse({
    FIGMA_ACCESS_TOKEN: env.FIGMA_ACCESS_TOKEN
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message ?? 'Invalid "FIGMA_ACCESS_TOKEN" environment variable.');
  }
  return parsed.data.FIGMA_ACCESS_TOKEN;
}

export function assertFigmaAccessEnv(env: NodeJS.ProcessEnv = process.env): FigmaAccessEnv {
  return FigmaAccessTokenSchema.parse({
    FIGMA_ACCESS_TOKEN: env.FIGMA_ACCESS_TOKEN
  });
}

const trimmedNonEmptyString = (envName: string) =>
  z
    .string({
      required_error: `Missing environment variable "${envName}".`,
      invalid_type_error: `Environment variable "${envName}" must be a string.`
    })
    .min(1, `Environment variable "${envName}" cannot be empty.`)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: `Environment variable "${envName}" cannot be whitespace only.`
    });

export const LinearApiKeySchema = z.object({
  LINEAR_API_KEY: trimmedNonEmptyString("LINEAR_API_KEY")
});

export type LinearApiKeyEnv = z.infer<typeof LinearApiKeySchema>;

export function requireLinearApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = LinearApiKeySchema.safeParse({
    LINEAR_API_KEY: env.LINEAR_API_KEY
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message ?? 'Invalid "LINEAR_API_KEY" environment variable.');
  }
  return parsed.data.LINEAR_API_KEY;
}

export const LinearDefaultTeamIdSchema = z.object({
  LINEAR_TEAM_ID: trimmedNonEmptyString("LINEAR_TEAM_ID").pipe(z.string().uuid('Environment variable "LINEAR_TEAM_ID" must be a valid UUID.'))
});

export type LinearDefaultTeamIdEnv = z.infer<typeof LinearDefaultTeamIdSchema>;

/** Default team UUID from env (used when the client does not override team). */
export function requireLinearDefaultTeamId(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = LinearDefaultTeamIdSchema.safeParse({
    LINEAR_TEAM_ID: env.LINEAR_TEAM_ID
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue?.message ?? 'Invalid "LINEAR_TEAM_ID" environment variable.');
  }
  return parsed.data.LINEAR_TEAM_ID;
}
