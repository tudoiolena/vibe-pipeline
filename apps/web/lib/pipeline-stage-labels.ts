import type { Database } from "@vibe/database";

export type ProjectSessionStage = Database["public"]["Tables"]["project_sessions"]["Row"]["current_stage"];

const STAGE_LABELS: Record<ProjectSessionStage, string> = {
  intake: "Intake",
  analysis: "Analysis",
  clarify: "Clarifying Requirements",
  prd: "PRD Drafting",
  tasks: "Task Breakdown",
  design_sync: "Design Sync",
  handoff: "Handoff",
  export: "Export"
};

export function getPipelineStageLabel(stage: ProjectSessionStage): string {
  return STAGE_LABELS[stage] ?? stage;
}
