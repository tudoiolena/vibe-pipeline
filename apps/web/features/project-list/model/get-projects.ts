import { createClient, listProjects, type ProjectRow } from "@vibe/database";

export type ProjectListResult = {
  projects: ProjectRow[];
  errorMessage: string | null;
};

export async function getProjects(): Promise<ProjectListResult> {
  const client = createClient();
  const { data, error } = await listProjects(client);

  if (error) {
    return {
      projects: [],
      errorMessage: error.message
    };
  }

  return {
    projects: data ?? [],
    errorMessage: null
  };
}
