import { createClient, getProjectById } from "@vibe/database";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildFullHandoffFileMap } from "@/lib/full-handoff-file-map";
import { getGithubOAuthEnv, isGithubOAuthConfigured } from "@/lib/github-env";
import { createHandoffGithubRepoAndPush, exchangeGithubOAuthCode } from "@/lib/github-handoff-repo";

const STATE_COOKIE = "vibe_gh_oauth_state";
const PROJECT_COOKIE = "vibe_gh_oauth_project_id";

function appOrigin(): string {
  try {
    return new URL(process.env.GITHUB_OAUTH_REDIRECT_URI ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

function redirectToProject(projectId: string, query: Record<string, string>): NextResponse {
  const u = new URL(`/projects/${projectId}`, appOrigin());
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return NextResponse.redirect(u.toString());
}

export async function GET(request: Request) {
  if (!isGithubOAuthConfigured()) {
    return NextResponse.json({ error: "GitHub OAuth is not configured." }, { status: 503 });
  }

  let env: ReturnType<typeof getGithubOAuthEnv>;
  try {
    env = getGithubOAuthEnv();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const projectIdCookie = cookieStore.get(PROJECT_COOKIE)?.value ?? null;
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value ?? null;

  const clearOAuthCookies = () => {
    cookieStore.delete(STATE_COOKIE);
    cookieStore.delete(PROJECT_COOKIE);
  };

  const projectIdParse = z.string().uuid().safeParse(projectIdCookie);

  if (err) {
    const reason = errDesc?.trim() || err;
    if (projectIdParse.success) {
      clearOAuthCookies();
      return redirectToProject(projectIdParse.data, {
        github_export: "error",
        github_reason: reason.slice(0, 500)
      });
    }
    clearOAuthCookies();
    return NextResponse.json(
      { error: "GitHub authorization failed.", detail: reason },
      { status: 400 }
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!projectIdParse.success || !stateCookie || !state || state !== stateCookie) {
    clearOAuthCookies();
    return NextResponse.json({ error: "Invalid or expired OAuth state. Start again from the project page." }, { status: 400 });
  }

  if (!code?.trim()) {
    clearOAuthCookies();
    return redirectToProject(projectIdParse.data, {
      github_export: "error",
      github_reason: "missing_code"
    });
  }

  const tokenResult = await exchangeGithubOAuthCode(
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    code.trim(),
    env.GITHUB_OAUTH_REDIRECT_URI
  );

  if ("error" in tokenResult) {
    clearOAuthCookies();
    return redirectToProject(projectIdParse.data, {
      github_export: "error",
      github_reason: tokenResult.error.slice(0, 500)
    });
  }

  const client = createClient();
  const { data: project, error: projectError } = await getProjectById(client, projectIdParse.data);
  if (projectError || !project) {
    clearOAuthCookies();
    return redirectToProject(projectIdParse.data, {
      github_export: "error",
      github_reason: "project_not_found"
    });
  }

  const fileMap = await buildFullHandoffFileMap(client, projectIdParse.data);
  if (!fileMap.ok) {
    clearOAuthCookies();
    return redirectToProject(projectIdParse.data, {
      github_export: "error",
      github_reason: fileMap.error.slice(0, 500)
    });
  }

  const push = await createHandoffGithubRepoAndPush(
    tokenResult.access_token,
    project.name,
    projectIdParse.data,
    fileMap.files
  );

  clearOAuthCookies();

  if (!push.ok) {
    return redirectToProject(projectIdParse.data, {
      github_export: "error",
      github_reason: `${push.phase}: ${push.error}`.slice(0, 500)
    });
  }

  return redirectToProject(projectIdParse.data, {
    github_export: "success",
    github_repo: push.full_name,
    github_url: push.html_url
  });
}
