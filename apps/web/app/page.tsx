import { FeatureStrip, PageHero } from "@/components/home";
import { IntakeForm } from "@/features/intake-form";
import { ProjectList } from "@/features/project-list";
import { getProjects } from "@/features/project-list/model/get-projects";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FEATURE_ITEMS = [
  {
    title: "Capture the brief",
    description: "Drop in goals, constraints, and links so the pipeline has real context."
  },
  {
    title: "Shape the plan",
    description: "Move through clarification, PRD, and tasks with reviewable outputs."
  },
  {
    title: "Hand off cleanly",
    description: "When you are ready, push structured artifacts to your repository."
  }
] as const;

export default async function Home() {
  const list = await getProjects();
  const hasProjects = list.projects.length > 0;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHero
        eyebrow="Vibe Pipeline"
        title="Turn a client brief into an executable plan"
        subtitle="Run intake, structured documents, and handoff from one workspace—without losing context between steps."
      />
      <FeatureStrip items={[...FEATURE_ITEMS]} />
      <div
        className={cn(
          "grid gap-6",
          hasProjects ? "lg:grid-cols-2 lg:items-start" : "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] lg:items-start"
        )}
      >
        <div className="min-w-0">
          <IntakeForm />
        </div>
        <div className="min-w-0">
          <ProjectList projects={list.projects} errorMessage={list.errorMessage} />
        </div>
      </div>
    </div>
  );
}
