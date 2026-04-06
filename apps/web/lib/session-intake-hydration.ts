import type { Json } from "@vibe/database";
import { BriefSchema } from "@vibe/schema";

export type HydratedStructuredIntake = {
  projectName: string;
  clientName: string;
  businessGoal: string;
  targetUsers: string;
  constraints: string;
  deadline: string;
  repoUrl: string;
  referencesText: string;
};

type ProjectHydrationSource = {
  name: string;
  client_name: string | null;
  business_goal: string | null;
  target_users: string | null;
  constraints: string | null;
  deadline: string | null;
  source_repo_url: string | null;
  source_links: Json;
};

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function sourceLinksToReferenceLines(links: unknown): string {
  if (!Array.isArray(links)) {
    return "";
  }
  const urls: string[] = [];
  for (const item of links) {
    if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      const u = (item as { url: string }).url.trim();
      if (u) {
        urls.push(u);
      }
    }
  }
  return urls.join("\n");
}

/**
 * Pre-fills the full intake form when resuming intake on a project session (state + DB row + normalized brief).
 */
export function buildHydratedStructuredIntake(
  stateJson: Record<string, unknown>,
  project: ProjectHydrationSource | null
): HydratedStructuredIntake {
  const brief = BriefSchema.safeParse(stateJson.brief);

  const projectName =
    str(stateJson.intakeProjectName) ||
    (brief.success ? brief.data.name : "") ||
    (project?.name.trim() ?? "");

  const clientName =
    str(stateJson.intakeClientName) ||
    (brief.success && brief.data.clientName ? brief.data.clientName : "") ||
    (project?.client_name?.trim() ?? "");

  const businessGoal =
    str(stateJson.intakeBusinessGoal) ||
    (brief.success && brief.data.businessGoal ? brief.data.businessGoal : "") ||
    (brief.success ? brief.data.goal : "") ||
    (project?.business_goal?.trim() ?? "");

  const targetUsers =
    str(stateJson.intakeTargetUsers) ||
    (brief.success ? brief.data.targetAudience.join("\n") : "") ||
    (project?.target_users?.trim() ?? "");

  const constraints =
    str(stateJson.intakeConstraints) ||
    (brief.success && brief.data.constraints ? brief.data.constraints : "") ||
    (project?.constraints?.trim() ?? "");

  const deadline =
    str(stateJson.intakeDeadline) ||
    (brief.success && brief.data.deadline ? brief.data.deadline : "") ||
    (project?.deadline?.trim() ?? "");

  const repoUrl = str(stateJson.intakeRepoUrl) || (project?.source_repo_url?.trim() ?? "");

  const fromState = sourceLinksToReferenceLines(stateJson.intakeSourceLinks);
  const referencesText =
    fromState || (project ? sourceLinksToReferenceLines(project.source_links) : "");

  return {
    projectName,
    clientName,
    businessGoal,
    targetUsers,
    constraints,
    deadline,
    repoUrl,
    referencesText
  };
}
