import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

type CookieValue = {
  name: string;
  value: string;
};

type CookieMethods = {
  getAll: () => CookieValue[];
  setAll?: (cookies: CookieValue[]) => void;
};

export type CreateClientOptions = {
  cookies?: CookieMethods;
};

const defaultServerCookies: CookieMethods = {
  getAll: () => [],
  setAll: () => {
    // Server Components can read cookies but often cannot set them.
  }
};

export type DatabaseClient = SupabaseClient<Database>;

export function createClient(options?: CreateClientOptions): DatabaseClient {
  const env = getSupabaseEnv();

  if (typeof window !== "undefined") {
    return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  }

  const cookieStore = options?.cookies ?? defaultServerCookies;

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: cookieStore.getAll,
      setAll: cookieStore.setAll ?? defaultServerCookies.setAll
    }
  });
}
