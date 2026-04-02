import { PRDSchema, UIKitSchema, serializePrdToMarkdown, type PRD, type UIKit } from "@vibe/schema";
import { z } from "zod";

export type ProjectSpecFile = {
  filename: string;
  content: string;
};

const ProjectSpecFileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1)
});

const ProjectSpecFilesSchema = z.array(ProjectSpecFileSchema);

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

export function parseProjectSpecFiles(value: unknown): ProjectSpecFile[] {
  const parsed = ProjectSpecFilesSchema.safeParse(value);
  if (!parsed.success) {
    return [];
  }
  return parsed.data;
}

function uiKitComponentLines(uiKit: UIKit): string {
  return uiKit.componentInventory.length > 0
    ? uiKit.componentInventory.map((component) => `- ${component.name}`).join("\n")
    : "- TBD";
}

function inferVarNameFromToken(name: string, prefix: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `--${prefix}-${slug || "token"}`;
}

function buildDesignTokenRows(uiKit: UIKit): string[] {
  const rows: string[] = [];
  for (const token of uiKit.colorPalette) {
    rows.push(`| ${inferVarNameFromToken(token.name, "color")} | ${token.hex} | ${token.name} |`);
  }
  for (const token of uiKit.typography) {
    const value = [token.fontFamily, token.fontSize, token.fontWeight].filter(Boolean).join(" / ") || "TBD";
    rows.push(`| ${inferVarNameFromToken(token.name, "font")} | ${value} | ${token.name} |`);
  }
  for (const token of uiKit.spacing) {
    rows.push(`| ${token.name} | ${token.value} | ${token.figmaSource ?? "Spacing token"} |`);
  }
  for (const token of uiKit.radii) {
    rows.push(`| ${token.name} | ${token.value} | ${token.figmaSource ?? "Radius token"} |`);
  }
  for (const token of uiKit.effects) {
    rows.push(`| ${token.name} | ${token.value} | ${token.figmaSource ?? "Effect token"} |`);
  }
  return rows;
}

function buildComponentClassLines(uiKit: UIKit): string {
  const primaryColor = uiKit.colorPalette[0]?.name ? inferVarNameFromToken(uiKit.colorPalette[0].name, "color") : "--color-primary";
  const radius = uiKit.radii[0]?.name ?? "--radius-md";
  const shadow = uiKit.effects[0]?.name ?? "--shadow-1";
  const spacing = uiKit.spacing[0]?.name ?? "--spacing-md";
  return [
    "```css",
    ".btn-primary { @apply inline-flex items-center justify-center font-medium transition-colors; background-color: var(" +
      primaryColor +
      "); border-radius: var(" +
      radius +
      "); padding: calc(var(" +
      spacing +
      ") * 0.5) var(" +
      spacing +
      "); }",
    ".card { @apply bg-white border border-slate-200; border-radius: var(" + radius + "); box-shadow: var(" + shadow + "); }",
    ".section-wrapper { @apply mx-auto w-full; max-width: var(--layout-max-content); padding-inline: var(" + spacing + "); }",
    "```",
    "",
    uiKitComponentLines(uiKit)
  ].join("\n");
}

function buildInteractionTokenLines(uiKit: UIKit): string {
  const primaryColor = uiKit.colorPalette[0]?.name ? inferVarNameFromToken(uiKit.colorPalette[0].name, "color") : "--color-primary";
  const shadow = uiKit.effects[0]?.name ?? "--shadow-1";
  return [
    "- `.btn-primary:hover`: use `filter: brightness(0.95)` and `transition: all 180ms ease-out`.",
    "- `.btn-primary:active`: use `transform: translateY(1px)` and keep background as `var(" + primaryColor + ")`.",
    "- `.card:hover`: elevate from `box-shadow: var(" + shadow + ")` to stronger token if available (`--shadow-2`).",
    "- Global interaction timing: `120ms` (active), `180ms` (hover), `240ms` (complex transitions)."
  ].join("\n");
}

export function buildProjectSpecFilesFromPrd(prdInput: PRD, uiKitInput?: UIKit): ProjectSpecFile[] {
  const prd = PRDSchema.parse(prdInput);
  const uiKit = UIKitSchema.parse(uiKitInput ?? {});
  const prdMarkdown = serializePrdToMarkdown(prd);

  return [
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
    {
      filename: "02-prd.md",
      content: prdMarkdown
    },
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
      filename: "06-ui-kit.md",
      content: [
        "# 06. UI Kit",
        "",
        "### 🎨 Design Tokens",
        "| CSS Variable | Hex/Value | Figma Source |",
        "|---|---|---|",
        ...(buildDesignTokenRows(uiKit).length > 0 ? buildDesignTokenRows(uiKit) : ["| --token-tbd | TBD | TBD |"]),
        "",
        "### 🧩 Component Classes",
        buildComponentClassLines(uiKit),
        "",
        "### ⚡ Interaction Tokens",
        buildInteractionTokenLines(uiKit)
      ].join("\n")
    },
    {
      filename: "07-design-map.md",
      content: [
        "# 07. Design Map",
        "",
        "## Architecture Flow",
        bulletOrTbd(prd.architectureFlow),
        "",
        "## Tech Stack",
        techStackBulletOrTbd(prd.techStack)
      ].join("\n")
    },
    {
      filename: "08-implementation-plan.md",
      content: [
        "# 08. Implementation Plan",
        "",
        "## Functional Requirements",
        prd.functionalRequirements.length > 0
          ? prd.functionalRequirements.map((fr) => `- ${fr.id}: ${fr.title}`).join("\n")
          : "- TBD",
        "",
        "## Risks",
        risksMarkdown(prd.risks, "None")
      ].join("\n")
    },
    {
      filename: "09-test-plan.md",
      content: [
        "# 09. Test Plan",
        "",
        "## Non-Functional Requirements",
        bulletOrTbd(prd.nonFunctionalRequirements),
        "",
        "## User Story Validation Checklist",
        prd.userStories.length > 0 ? prd.userStories.map((us) => `- Validate ${us.id}`).join("\n") : "- TBD"
      ].join("\n")
    }
  ];
}
