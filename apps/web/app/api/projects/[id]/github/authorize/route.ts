import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { getGithubOAuthEnv, isGithubOAuthConfigured } from "@/lib/github-env";

const STATE_COOKIE = "vibe_gh_oauth_state";
const PROJECT_COOKIE = "vibe_gh_oauth_project_id";

type RouteContext = { params: Promise<{ id: string }> };

function cookieBaseOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600
  };
}

export async function GET(_request: Request, context: RouteContext) {
  if (!isGithubOAuthConfigured()) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured (missing GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, or GITHUB_OAUTH_REDIRECT_URI)." },
      { status: 503 }
    );
  }

  const { id: projectId } = await context.params;
  const idParse = z.string().uuid().safeParse(projectId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }

  let env: ReturnType<typeof getGithubOAuthEnv>;
  try {
    env = getGithubOAuthEnv();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, cookieBaseOptions());
  cookieStore.set(PROJECT_COOKIE, projectId, cookieBaseOptions());

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", env.GITHUB_OAUTH_REDIRECT_URI);
  authorize.searchParams.set("scope", "repo");
  authorize.searchParams.set("state", state);

  return NextResponse.redirect(authorize.toString());
}
