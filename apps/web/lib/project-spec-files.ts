import {
  BriefSchema,
  DesignMapSchema,
  PRDSchema,
  TaskTreeSchema,
  UIKitSchema,
  serializePrdToMarkdown,
  type Brief,
  type DesignMap,
  type PRD,
  type TaskTree,
  type UIKit
} from "@vibe/schema";
import { CURSOR_HANDOFF_FILENAME, CURSOR_HANDOFF_MARKDOWN } from "./cursor-handoff-template";

export type ProjectSpecFile = {
  filename: string;
  content: string;
};

export type BuildProjectSpecPackInput = {
  prd: PRD;
  uiKit?: UIKit | null;
  brief?: Brief | null;
  designMap?: DesignMap | null;
  taskTree?: TaskTree | null;
};

function bulletOrTbd(items: string[], fallback = "TBD"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function assumptionsMarkdown(items: PRD["assumptions"], fallback = "None"): string {
  return items.length > 0
    ? items.map((a) => `- ${a.description} — _Mitigation:_ ${a.mitigation}`).join("\n")
    : `- ${fallback}`;
}

function risksMarkdown(items: PRD["risks"], fallback = "None"): string {
  return items.length > 0
    ? items.map((r) => `- ${r.description} — _Impact:_ ${r.impact}`).join("\n")
    : `- ${fallback}`;
}

function techStackBulletOrTbd(items: PRD["techStack"], fallback = "TBD"): string {
  return items.length > 0
    ? items.map((item) => `- ${item.name} (${item.category}, ${item.color})`).join("\n")
    : `- ${fallback}`;
}

function staticCursorHandoffFile(): ProjectSpecFile {
  return { filename: CURSOR_HANDOFF_FILENAME, content: CURSOR_HANDOFF_MARKDOWN };
}

/** Ensures the non-LLM Cursor / Superpowers handoff doc is present exactly once. */
export function withCursorHandoffDoc(files: ProjectSpecFile[]): ProjectSpecFile[] {
  if (files.some((f) => f.filename === CURSOR_HANDOFF_FILENAME)) {
    return files;
  }
  return [...files, staticCursorHandoffFile()];
}

/** Markdown export of structured brief (ТЗ §9 `00-brief.md`). */
function serializeBriefToMarkdown(brief: Brief): string {
  const b = BriefSchema.parse(brief);
  const lines: string[] = [
    "# 00. Brief",
    "",
    "## Name",
    b.name,
    "",
    "## Summary",
    b.summary,
    "",
    "## Goal",
    b.goal,
    ""
  ];
  if (b.businessGoal?.trim()) {
    lines.push("## Business goal (intake)", "", b.businessGoal.trim(), "");
  }
  if (b.clientName?.trim()) {
    lines.push("## Client", "", b.clientName.trim(), "");
  }
  if (b.deadline?.trim()) {
    lines.push("## Target deadline", "", b.deadline.trim(), "");
  }
  if (b.constraints?.trim()) {
    lines.push("## Constraints", "", b.constraints.trim(), "");
  }
  lines.push("## Problems / pain points", "", ...b.problem.map((p) => `- ${p}`), "");
  lines.push("## Target audience", "", bulletOrTbd(b.targetAudience), "");
  lines.push("## Business value", "", bulletOrTbd(b.businessValue), "");
  lines.push("## Key user scenarios", "", bulletOrTbd(b.keyUserScenarios), "");
  lines.push("## MVP focus", "", bulletOrTbd(b.mvpFocus), "");
  lines.push("## Source links", "");
  if (b.sourceLinks.length > 0) {
    for (const link of b.sourceLinks) {
      lines.push(`- [${link.label}](${link.url})${link.type ? ` _(${link.type})_` : ""}`);
    }
  } else {
    lines.push("- TBD");
  }
  return lines.join("\n");
}

/** When no brief artifact exists yet, stub 00-brief from PRD so the pack stays complete. */
function build00BriefFallbackMarkdown(prd: PRD): string {
  return [
    "# 00. Brief",
    "",
    "_Structured brief artifact not available yet; draft from PRD below._",
    "",
    "## Product overview (from PRD)",
    prd.productOverview,
    "",
    "## Problem statement",
    prd.problemStatement,
    "",
    "## Goals",
    bulletOrTbd(prd.goals),
    "",
    "## Target users (personas)",
    bulletOrTbd(prd.usersAndPersonas)
  ].join("\n");
}

/**
 * ТЗ §9: `06-design-map.json` — Figma design map + UI kit tokens + PRD architecture hints in one JSON file.
 */
function build06DesignMapJson(prd: PRD, designMap: DesignMap | null | undefined, uiKit: UIKit): string {
  const kit = UIKitSchema.parse(uiKit);
  const dmParsed = DesignMapSchema.safeParse(designMap ?? { nodes: [], links: [] });
  const designMapNormalized = dmParsed.success ? dmParsed.data : { nodes: [], links: [] };
  const payload = {
    designMap: designMapNormalized,
    uiKit: kit,
    prdArchitectureFlow: prd.architectureFlow,
    prdTechStack: prd.techStack
  };
  return JSON.stringify(payload, null, 2);
}

/** ТЗ §9: canonical task tree JSON for agents. */
function build10TasksJson(taskTree: TaskTree | null | undefined): string {
  const parsed = TaskTreeSchema.safeParse(taskTree ?? { epics: [] });
  const tree = parsed.success ? parsed.data : { epics: [] };
  return JSON.stringify(tree, null, 2);
}

function build09DoneDefinitionMarkdown(prd: PRD): string {
  return [
    "# 09. Done definition",
    "",
    "## Build / release",
    "- All selected tasks from `10-tasks.json` have passing acceptance criteria tied to `05-acceptance-criteria.md` and PRD functional requirements.",
    "- No open High/Critical gaps from clarification rounds unless explicitly waived in writing.",
    "",
    "## Quality bar",
    "- Critical user flows from `04-user-stories.md` are demonstrable.",
    "- Non-functional expectations in the PRD are either implemented or documented as deferred with rationale.",
    "",
    "## Product context",
    `**Product:** ${prd.productOverview.slice(0, 200)}${prd.productOverview.length > 200 ? "…" : ""}`,
    "",
    "## Sign-off",
    "- Feature owner confirms scope matches `03-scope.md` and PRD; changes after export are tracked in-repo."
  ].join("\n");
}

/**
 * Full `project-spec/` pack aligned with ТЗ §9 (00–10 + handoff doc via `withCursorHandoffDoc`).
 */
export function buildProjectSpecPack(input: BuildProjectSpecPackInput): ProjectSpecFile[] {
  const prd = PRDSchema.parse(input.prd);
  const uiKit = UIKitSchema.parse(input.uiKit ?? {});
  const prdMarkdown = serializePrdToMarkdown(prd);

  const briefMd =
    input.brief != null && BriefSchema.safeParse(input.brief).success
      ? serializeBriefToMarkdown(BriefSchema.parse(input.brief))
      : build00BriefFallbackMarkdown(prd);

  return [
    { filename: "00-brief.md", content: briefMd },
    {
      filename: "01-clarifications.md",
      content: [
        "# 01. Clarifications",
        "",
        "## Problem Statement",
        prd.problemStatement,
        "",
        "## Users and Personas",
        bulletOrTbd(prd.usersAndPersonas)
      ].join("\n")
    },
    { filename: "02-prd.md", content: prdMarkdown },
    {
      filename: "03-scope.md",
      content: [
        "# 03. Scope",
        "",
        "## Scope Summary",
        bulletOrTbd(prd.scopeSummary),
        "",
        "## Assumptions",
        assumptionsMarkdown(prd.assumptions, "None")
      ].join("\n")
    },
    {
      filename: "04-user-stories.md",
      content: [
        "# 04. User Stories",
        "",
        ...(prd.userStories.length > 0
          ? prd.userStories.map(
              (us) =>
                `## ${us.id}\n- Persona: ${us.persona}\n- Intent: ${us.intent}\n- Benefit: ${us.benefit}\n${
                  us.acceptanceHints.length > 0 ? us.acceptanceHints.map((hint) => `- ${hint}`).join("\n") : "- No hints"
                }`
            )
          : ["No user stories generated."])
      ].join("\n\n")
    },
    {
      filename: "05-acceptance-criteria.md",
      content: [
        "# 05. Acceptance Criteria",
        "",
        ...(prd.functionalRequirements.length > 0
          ? prd.functionalRequirements.map(
              (fr) =>
                `## ${fr.id}: ${fr.title}\n${
                  fr.details.length > 0 ? fr.details.map((detail) => `- ${detail}`).join("\n") : "- Acceptance criteria TBD"
                }`
            )
          : ["No functional requirements generated."])
      ].join("\n\n")
    },
    {
      filename: "06-design-map.json",
      content: build06DesignMapJson(prd, input.designMap ?? null, uiKit)
    },
    {
      filename: "07-implementation-plan.md",
      content: [
        "# 07. Implementation Plan",
        "",
        "## Functional Requirements",
        prd.functionalRequirements.length > 0
          ? prd.functionalRequirements.map((fr) => `- ${fr.id}: ${fr.title}`).join("\n")
          : "- TBD",
        "",
        "## Architecture flow (stages)",
        bulletOrTbd(prd.architectureFlow),
        "",
        "## Tech stack",
        techStackBulletOrTbd(prd.techStack),
        "",
        "## Risks",
        risksMarkdown(prd.risks, "None")
      ].join("\n")
    },
    {
      filename: "08-test-plan.md",
      content: [
        "# 08. Test Plan",
        "",
        "## Non-Functional Requirements",
        bulletOrTbd(prd.nonFunctionalRequirements),
        "",
        "## User Story Validation Checklist",
        prd.userStories.length > 0 ? prd.userStories.map((us) => `- Validate ${us.id}`).join("\n") : "- TBD"
      ].join("\n")
    },
    { filename: "09-done-definition.md", content: build09DoneDefinitionMarkdown(prd) },
    { filename: "10-tasks.json", content: build10TasksJson(input.taskTree ?? null) }
  ];
}

/** Prefer `buildProjectSpecPack` with full context; this wraps PRD + UIKit only. */
export function buildProjectSpecFilesFromPrd(prdInput: PRD, uiKitInput?: UIKit): ProjectSpecFile[] {
  return buildProjectSpecPack({ prd: prdInput, uiKit: uiKitInput ?? undefined });
}
