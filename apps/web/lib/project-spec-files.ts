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

function uiKitColorLines(uiKit: UIKit): string {
  return uiKit.colorPalette.length > 0
    ? uiKit.colorPalette.map((token) => `- ${token.name}: ${token.hex}`).join("\n")
    : "- TBD";
}

function uiKitTypographyLines(uiKit: UIKit): string {
  return uiKit.typography.length > 0
    ? uiKit.typography
        .map((token) => {
          const details = [
            token.fontFamily ? `fontFamily=${token.fontFamily}` : null,
            token.fontWeight !== undefined ? `fontWeight=${token.fontWeight}` : null,
            token.fontSize !== undefined ? `fontSize=${token.fontSize}` : null,
            token.lineHeight !== undefined ? `lineHeight=${token.lineHeight}` : null
          ]
            .filter(Boolean)
            .join(", ");
          return `- ${token.name}${details ? ` (${details})` : ""}`;
        })
        .join("\n")
    : "- TBD";
}

function uiKitComponentLines(uiKit: UIKit): string {
  return uiKit.componentInventory.length > 0
    ? uiKit.componentInventory.map((component) => `- ${component.name}`).join("\n")
    : "- TBD";
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
        bulletOrTbd(prd.assumptions, "None")
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
                `## ${us.id}\n- As a ${us.asA}\n- I want ${us.iWant}\n- So that ${us.soThat}\n${
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
        "## Color Palette",
        uiKitColorLines(uiKit),
        "",
        "## Typography",
        uiKitTypographyLines(uiKit),
        "",
        "## Component Inventory",
        uiKitComponentLines(uiKit)
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
        bulletOrTbd(prd.risks, "None")
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
