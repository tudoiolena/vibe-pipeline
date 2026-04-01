import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjects } from "../model/get-projects";
import { ProjectArchiveButton } from "./project-archive-button";

export async function ProjectList() {
  const { projects, errorMessage } = await getProjects();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>Recent projects from the database.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            Failed to load projects: {errorMessage}
          </p>
        ) : null}
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet. Submit a vibe to create your first one.</p>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {project.name}
                  </Link>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary">{project.status}</Badge>
                    <ProjectArchiveButton projectId={project.id} projectName={project.name} />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{project.description ?? "No description provided."}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
