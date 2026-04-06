import { getProjectById, type DatabaseClient } from "@vibe/database";
import { extractFigmaFileKeyFromUrl } from "@vibe/integrations";

/**
 * Canonical Figma file key for pipeline nodes: from `projects.source_figma_url` only
 * (not session checkpoint or brief sourceLinks).
 */
export async function resolveFigmaFileKeyFromProject(
  client: DatabaseClient,
  projectId: string
): Promise<string | null> {
  const { data: project, error } = await getProjectById(client, projectId);
  if (error || !project) {
    console.log("[figma] resolveFigmaFileKeyFromProject: project missing", { projectId, error: error?.message });
    return null;
  }
  const raw = project.source_figma_url?.trim();
  if (!raw) {
    console.log("[figma] resolveFigmaFileKeyFromProject: no source_figma_url", { projectId });
    return null;
  }
  const fromUrl = extractFigmaFileKeyFromUrl(raw);
  if (fromUrl) {
    console.log("[figma] resolveFigmaFileKeyFromProject", { projectId, source: "source_figma_url", fileKey: fromUrl });
    return fromUrl;
  }
  if (/^[A-Za-z0-9]+$/.test(raw)) {
    console.log("[figma] resolveFigmaFileKeyFromProject", { projectId, source: "source_figma_url_raw_key", fileKey: raw });
    return raw;
  }
  console.log("[figma] resolveFigmaFileKeyFromProject: could not parse key from source_figma_url", {
    projectId,
    urlPreview: raw.slice(0, 120)
  });
  return null;
}

/** True when the project row has a non-empty `source_figma_url` (user configured design source). */
export async function projectHasStoredFigmaSource(client: DatabaseClient, projectId: string): Promise<boolean> {
  const { data: project, error } = await getProjectById(client, projectId);
  if (error || !project) {
    return false;
  }
  return Boolean(project.source_figma_url?.trim());
}
