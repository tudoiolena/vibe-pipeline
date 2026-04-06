import { z } from "zod";

const GithubOAuthEnvSchema = z.object({
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_OAUTH_REDIRECT_URI: z.string().url()
});

export type GithubOAuthEnv = z.infer<typeof GithubOAuthEnvSchema>;

export function getGithubOAuthEnv(): GithubOAuthEnv {
  const parsed = GithubOAuthEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid GitHub OAuth environment configuration. ${errorDetails}`);
  }
  return parsed.data;
}

export function isGithubOAuthConfigured(): boolean {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_OAUTH_REDIRECT_URI } = process.env;
  return Boolean(
    GITHUB_CLIENT_ID?.trim() &&
      GITHUB_CLIENT_SECRET?.trim() &&
      GITHUB_OAUTH_REDIRECT_URI?.trim()
  );
}
