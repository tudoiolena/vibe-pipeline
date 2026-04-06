const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
}

export async function exchangeGithubOAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ access_token: string } | { error: string }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { error: "Invalid token response from GitHub." };
  }
  const rec = data as Record<string, unknown>;
  if (typeof rec.access_token === "string" && rec.access_token.length > 0) {
    return { access_token: rec.access_token };
  }
  const err =
    typeof rec.error_description === "string"
      ? rec.error_description
      : typeof rec.error === "string"
        ? rec.error
        : "GitHub declined to issue an access token.";
  return { error: err };
}

export async function getGithubUserLogin(token: string): Promise<{ login: string } | { error: string }> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: authHeaders(token) });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== "object") {
    return { error: "Could not load GitHub user profile." };
  }
  const login = (data as { login?: unknown }).login;
  if (typeof login !== "string" || !login.trim()) {
    return { error: "GitHub user login missing from profile response." };
  }
  return { login: login.trim() };
}

/** GitHub repo name: alphanumeric, hyphens, underscores, dots; max 100 chars. */
export function slugifyRepoName(projectName: string, projectId: string): string {
  const fallback = `vibe-project-${projectId.replace(/-/g, "").slice(0, 8)}`;
  const base = projectName.trim() || fallback;
  let s = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!s) {
    s = fallback;
  }
  if (s.length > 100) {
    s = s.slice(0, 100).replace(/-+$/g, "") || fallback;
  }
  return s;
}

async function createUserRepo(
  token: string,
  name: string,
  options: { description: string; private: boolean }
): Promise<{ full_name: string; html_url: string } | { error: string; status: number }> {
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      description: options.description,
      private: options.private,
      auto_init: false
    })
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.status === 201 && data && typeof data === "object") {
    const full = (data as { full_name?: unknown }).full_name;
    const html = (data as { html_url?: unknown }).html_url;
    if (typeof full === "string" && typeof html === "string") {
      return { full_name: full, html_url: html };
    }
  }
  let msg = "Failed to create repository.";
  if (data && typeof data === "object") {
    const m = (data as { message?: unknown }).message;
    if (typeof m === "string") {
      msg = m;
    }
  }
  return { error: msg, status: res.status };
}

function encodeRepoContentPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function putRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  contentUtf8: string,
  message: string
): Promise<{ ok: true } | { error: string }> {
  const encodedPath = encodeRepoContentPath(path);
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(contentUtf8, "utf8").toString("base64")
    })
  });
  if (res.ok) {
    return { ok: true };
  }
  const data: unknown = await res.json().catch(() => null);
  let msg = `HTTP ${res.status}`;
  if (data && typeof data === "object") {
    const m = (data as { message?: unknown }).message;
    if (typeof m === "string") {
      msg = m;
    }
  }
  return { error: `${path}: ${msg}` };
}

export async function createHandoffGithubRepoAndPush(
  token: string,
  projectName: string,
  projectId: string,
  files: Record<string, string>
): Promise<
  | { ok: true; full_name: string; html_url: string }
  | { ok: false; error: string; phase: "user" | "create_repo" | "push" }
> {
  const user = await getGithubUserLogin(token);
  if ("error" in user) {
    return { ok: false, error: user.error, phase: "user" };
  }

  const wantPrivate = process.env.GITHUB_NEW_REPO_PRIVATE !== "false";
  const baseName = slugifyRepoName(projectName, projectId);
  const description = `Vibe Pipeline handoff export (project ${projectId.slice(0, 8)}…)`;

  let repoName = baseName;
  let created: { full_name: string; html_url: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = attempt === 0 ? "" : `-export-${attempt}`;
    repoName = `${baseName}${suffix}`.slice(0, 100).replace(/-+$/g, "") || baseName;
    const result = await createUserRepo(token, repoName, { description, private: wantPrivate });
    if ("full_name" in result) {
      created = result;
      break;
    }
    if (result.status === 422 && /already exists|name already/i.test(result.error)) {
      continue;
    }
    return { ok: false, error: result.error, phase: "create_repo" };
  }

  if (!created) {
    return {
      ok: false,
      error: "Could not create a repository: name conflicts after several attempts.",
      phase: "create_repo"
    };
  }

  const [owner, repo] = created.full_name.split("/");
  if (!owner || !repo) {
    return { ok: false, error: "Unexpected full_name from GitHub.", phase: "create_repo" };
  }

  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    const body = files[path];
    if (path.trim() === "") {
      continue;
    }
    const put = await putRepoFile(token, owner, repo, path, body, `Add ${path}`);
    if ("error" in put) {
      return { ok: false, error: put.error, phase: "push" };
    }
  }

  return { ok: true, full_name: created.full_name, html_url: created.html_url };
}
