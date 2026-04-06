import { z } from "zod";
import type { Json, UpdateProjectInput } from "@vibe/database";
import { normalizeFigmaSourceUrlForProject } from "@vibe/integrations";

const SourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  type: z.string().min(1).optional()
});

export const DeadlineDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "deadline must be YYYY-MM-DD");

export function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);

  return normalized.length > 0 ? normalized : "project";
}

export function toProjectName(value: string): string {
  const tokens = value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  if (tokens.length === 0) {
    return "Untitled Project";
  }

  return tokens.map((token) => token.slice(0, 1).toUpperCase() + token.slice(1)).join(" ");
}

export function parseReferencesFromLines(text: string | undefined): z.infer<typeof SourceLinkSchema>[] {
  if (!text || !text.trim()) {
    return [];
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: z.infer<typeof SourceLinkSchema>[] = [];
  let i = 0;
  for (const line of lines) {
    const urlParse = z.string().url().safeParse(line);
    if (!urlParse.success) {
      continue;
    }
    i += 1;
    out.push({ label: `Reference ${i}`, url: urlParse.data });
  }
  return out;
}

export function normalizeRepoUrl(raw: string | undefined): string | null {
  const t = raw?.trim() ?? "";
  if (t.length === 0) {
    return null;
  }
  const parsed = z.string().url().safeParse(t);
  return parsed.success ? parsed.data : null;
}

export type IntakeFormFieldsInput = {
  rawBrief: string;
  projectName?: string;
  clientName?: string;
  businessGoal?: string;
  targetUsers?: string;
  constraints?: string;
  figmaUrl?: string;
  /** When false (intake restart without figma field), `source_figma_url` is omitted from the project update. */
  applyFigmaToProject?: boolean;
  repoUrl?: string;
  referencesText?: string;
  references?: z.infer<typeof SourceLinkSchema>[];
  deadline?: string;
};

export type ParsedIntakePayload =
  | {
      ok: true;
      effectiveBrief: string;
      sessionStateSlice: Record<string, unknown>;
      projectUpdate: UpdateProjectInput;
      sourceFigmaUrl: string | null | undefined;
      sourceLinks: z.infer<typeof SourceLinkSchema>[];
    }
  | { ok: false; error: string };

/**
 * Validates optional URLs/deadline and builds session `intake*` keys + project row fields (new project or intake restart).
 */
export function parseIntakeFormFieldsForSession(input: IntakeFormFieldsInput): ParsedIntakePayload {
  const effectiveBrief = input.rawBrief.trim();
  if (effectiveBrief.length === 0) {
    return { ok: false, error: "Describe the project (raw brief) before submitting." };
  }

  const applyFigma = input.applyFigmaToProject !== false;
  const figmaUrlInput = input.figmaUrl?.trim();
  let sourceFigmaUrl: string | null | undefined = null;
  if (applyFigma) {
    if (figmaUrlInput && figmaUrlInput.length > 0) {
      sourceFigmaUrl = normalizeFigmaSourceUrlForProject(figmaUrlInput);
      if (!sourceFigmaUrl) {
        return {
          ok: false,
          error: "Invalid figmaUrl. Use a Figma design, file, or prototype URL, or paste the file key."
        };
      }
    }
  } else {
    sourceFigmaUrl = undefined;
  }

  const sourceRepoUrl = normalizeRepoUrl(input.repoUrl);
  if (input.repoUrl && input.repoUrl.trim().length > 0 && !sourceRepoUrl) {
    return { ok: false, error: "Invalid repoUrl. Use a full https URL to the repository." };
  }

  const fromArray = input.references ?? [];
  const fromText = parseReferencesFromLines(input.referencesText);
  const sourceLinks = fromArray.length > 0 ? fromArray : fromText;

  let deadline: string | null = null;
  if (input.deadline && input.deadline.length > 0) {
    const d = DeadlineDateSchema.safeParse(input.deadline);
    if (!d.success) {
      return { ok: false, error: "Invalid deadline. Use YYYY-MM-DD." };
    }
    deadline = d.data;
  }

  const projectName = (input.projectName ?? "").trim() || toProjectName(effectiveBrief);
  const clientName = (input.clientName ?? "").trim() || null;
  const businessGoal = (input.businessGoal ?? "").trim() || null;
  const targetUsers = (input.targetUsers ?? "").trim() || null;
  const constraints = (input.constraints ?? "").trim() || null;

  const sessionStateSlice: Record<string, unknown> = {
    rawIntakeText: effectiveBrief,
    intakeProjectName: projectName,
    ...(clientName ? { intakeClientName: clientName } : {}),
    ...(businessGoal ? { intakeBusinessGoal: businessGoal } : {}),
    ...(targetUsers ? { intakeTargetUsers: targetUsers } : {}),
    ...(constraints ? { intakeConstraints: constraints } : {}),
    ...(sourceRepoUrl ? { intakeRepoUrl: sourceRepoUrl } : {}),
    ...(deadline ? { intakeDeadline: deadline } : {}),
    ...(sourceLinks.length > 0 ? { intakeSourceLinks: sourceLinks } : {})
  };

  const projectUpdate: UpdateProjectInput = {
    name: projectName,
    description: effectiveBrief,
    raw_brief: effectiveBrief,
    client_name: clientName,
    business_goal: businessGoal,
    target_users: targetUsers,
    constraints,
    deadline,
    source_repo_url: sourceRepoUrl,
    source_links: sourceLinks as unknown as Json,
    updated_at: new Date().toISOString()
  };
  if (applyFigma) {
    projectUpdate.source_figma_url = sourceFigmaUrl;
  }

  return {
    ok: true,
    effectiveBrief,
    sessionStateSlice,
    projectUpdate,
    sourceFigmaUrl,
    sourceLinks
  };
}
