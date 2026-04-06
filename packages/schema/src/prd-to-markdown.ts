import { type z } from "zod";
import { PRDSchema } from "./schemas";

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  clarify: "Clarify",
  prd: "PRD",
  tasks: "Tasks",
  design_sync: "Design sync",
  handoff: "Handoff",
  export: "Export"
};

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "_None listed._\n";
  }
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function assumptionList(items: z.infer<typeof PRDSchema>["assumptions"]): string {
  if (items.length === 0) {
    return "_None listed._\n";
  }
  return items.map((a) => `- ${a.description} — _Mitigation:_ ${a.mitigation}`).join("\n") + "\n";
}

function riskList(items: z.infer<typeof PRDSchema>["risks"]): string {
  if (items.length === 0) {
    return "_None listed._\n";
  }
  return items.map((r) => `- ${r.description} — _Impact:_ ${r.impact}`).join("\n") + "\n";
}

function techStackBulletList(items: z.infer<typeof PRDSchema>["techStack"]): string {
  if (items.length === 0) {
    return "_None listed._\n";
  }
  return items.map((item) => `- ${item.name} (${item.category}, ${item.color})`).join("\n") + "\n";
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}\n\n`;
}

/**
 * Renders a validated PRD object as a clean Markdown document suitable for sharing or version control.
 */
export function prdDocumentToMarkdown(prd: z.infer<typeof PRDSchema>): string {
  const flow = prd.architectureFlow
    .map((stage) => {
      const label = PIPELINE_STAGE_LABELS[stage] ?? stage;
      return `- **${label}** (\`${stage}\`)`;
    })
    .join("\n");

  const functional = prd.functionalRequirements
    .map((fr) => {
      const details =
        fr.details.length > 0 ? `\n${fr.details.map((d) => `  - ${d}`).join("\n")}` : "";
      return `### ${fr.id}: ${fr.title}${details}`;
    })
    .join("\n\n");

  const stories = prd.userStories
    .map((us) => {
      const hints =
        us.acceptanceHints.length > 0
          ? `\n\n_Acceptance hints:_\n${bulletList(us.acceptanceHints)}`
          : "";
      return `### ${us.id}\n\n**Persona:** ${us.persona} · **Intent:** ${us.intent} · **Benefit:** ${us.benefit}.${hints}`;
    })
    .join("\n\n");

  const parts: string[] = [
    "# Product requirements document\n",
    section("Product overview", prd.productOverview.trim()),
    section("Problem statement", prd.problemStatement.trim()),
    section("Goals", bulletList(prd.goals)),
    section("Scope", bulletList(prd.scopeSummary)),
    section("Users & personas", bulletList(prd.usersAndPersonas)),
    section("Architecture flow", flow + "\n"),
    section("User stories", stories || "_None listed._\n"),
    section("Functional requirements", functional || "_None listed._\n"),
    section("Non-functional requirements", bulletList(prd.nonFunctionalRequirements)),
    section("Tech stack", techStackBulletList(prd.techStack)),
    section("Assumptions", assumptionList(prd.assumptions)),
    section("Risks", riskList(prd.risks))
  ];

  return parts.join("\n").trim() + "\n";
}
