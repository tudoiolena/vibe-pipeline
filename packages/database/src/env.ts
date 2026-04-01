import { z } from "zod";

const SupabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1)
});

export type SupabaseEnv = z.infer<typeof SupabaseEnvSchema>;

let cachedEnv: SupabaseEnv | null = null;

export function getSupabaseEnv(): SupabaseEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = SupabaseEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Supabase environment configuration. ${errorDetails}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
