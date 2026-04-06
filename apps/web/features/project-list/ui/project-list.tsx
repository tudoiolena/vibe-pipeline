import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isDisplayableHttpUrl } from "@/lib/repo-display-url";
import type { ProjectListResult } from "../model/get-projects";
import { ProjectArchiveButton } from "./project-archive-button";

export function ProjectList({ projects, errorMessage }: ProjectListResult) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your projects</CardTitle>
        <CardDescription>
          Open a project to continue the pipeline, or start another intake beside this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            Failed to load projects: {errorMessage}
          </p>
        ) : null}
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet. Add a brief on the left to create your first pipeline session.
          </p>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {isDisplayableHttpUrl(project.source_repo_url) ? (
                      <a
                        href={project.source_repo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        aria-label={`Open repository for ${project.name}`}
                      >
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        Repo
                      </a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
