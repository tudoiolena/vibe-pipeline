<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles:
  - None renamed; added VI. Design System Enforcement (Figma MCP)
- Added sections:
  - Core principle VI (Design System Enforcement)
- Removed sections:
  - None
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - N/A: .specify/templates/commands/*.md (directory not present in this repo)
- Deferred TODOs:
  - None
- Note: Principle VI names Figma MCP reads as implemented by `plugin-figma-figma`
  (`get_variable_defs`, `get_metadata`, `get_design_context`), covering the intents
  behind generic “design tokens” and “file nodes” resolution.
-->

# VibePipeline Constitution

## Core Principles

### I. Turborepo Monorepo Boundaries
The repository MUST use a Turborepo monorepo layout with `apps/web` (Next.js + FSD) and
`packages/{schema, ai, database, integrations, ui}` as primary boundaries. New features MUST
be implemented inside these boundaries and MUST NOT create ad-hoc top-level application or
package roots without an approved constitutional amendment.

Rationale: Stable package boundaries keep ownership clear, reduce coupling, and preserve build
and cache efficiency as the codebase grows.

### II. Spec-First Requirement Discipline
Before any implementation begins, all project requirements MUST be authored in `project-spec/`
as individual numbered Markdown files from `00` through `10` as applicable to scope.
Implementation tasks, plans, and code changes MUST trace back to these files.

Rationale: A strict specification gate reduces rework and ensures implementation intent is
reviewable before code is written.

### III. Zod Validation Canon
All runtime data validation and parsing MUST use Zod schemas. Canonical shared schemas MUST live
in `packages/schema`, and consuming apps/packages MUST import and reuse them rather than defining
incompatible local validators.

Rationale: A single validation system yields consistent contracts across UI, APIs, jobs, and AI
workflow boundaries.

### IV. LangGraph + Supabase AI Workflow Standard
AI workflows MUST be orchestrated with LangGraph and MUST persist workflow state in Supabase.
Alternative workflow engines or transient-only state handling are non-compliant unless approved
through a constitutional amendment.

Rationale: Durable, inspectable workflow state is required for reliability, retries, and
operational debugging in production.

### V. Integration Isolation Contract
Figma and Linear integrations MUST be strictly isolated inside `@vibe/integrations`
(`packages/integrations`). No other package or app may call Figma or Linear APIs directly; all
access MUST go through typed integration interfaces exposed by this package.

Rationale: Centralized integration adapters contain third-party volatility and simplify testing,
security controls, and future provider changes.

### VI. Design System Enforcement (Figma MCP)
Before drafting a UI Kit or authoring UI specifications grounded in a linked Figma file,
agents MUST validate against the **Figma MCP** for that file. If intake includes a Figma URL,
specifications MUST NOT use `TBD` (or equivalent placeholders) for color, typography, or spacing
values that the file can supply through MCP; those values MUST be resolved from Figma via MCP
reads before the spec is treated as complete. For the official Figma MCP enabled in this project,
agents MUST use `get_variable_defs` to resolve variables (including color, typography, and spacing)
and `get_metadata` or `get_design_context` as needed for file and node context—covering the same
intents as generic “get design tokens” and “get file nodes” workflows.

Rationale: MCP-grounded specs prevent invented tokens and keep UI kits aligned with the design
system of record when a Figma URL exists.

## Architecture Standards

- `apps/web` MUST remain a Next.js application organized with FSD conventions.
- `packages/schema` defines shared Zod schemas and schema composition utilities.
- `packages/ai` contains LangGraph workflow definitions and orchestration logic.
- `packages/database` contains Supabase data access and persistence adapters.
- `packages/integrations` contains all Figma/Linear clients and integration use-cases.
- `packages/ui` contains shared UI components and design primitives for `apps/web`.
- Cross-package imports MUST follow public entry points and MUST NOT rely on private internals.

## Delivery Workflow & Quality Gates

1. **Spec Gate (Blocking)**: `project-spec/` numbered requirement files are present and reviewed
   before planning or coding.
2. **Plan Gate**: implementation plans include constitutional checks for monorepo boundaries,
   Zod contracts, LangGraph + Supabase workflow persistence, integration isolation, and—when a
   Figma URL is in scope—Figma MCP validation before UI Kit / UI token specs are finalized.
3. **Implementation Gate**: tasks and PRs reference originating requirement documents and verify
   all new runtime data paths are Zod-validated.
4. **Integration Gate**: Figma/Linear API usage is only from `packages/integrations`.
5. **Review Gate**: reviewers MUST reject changes that violate any constitutional principle.

## Governance

This constitution is the highest-priority project policy and supersedes conflicting process docs.
Amendments require: (1) documented proposal, (2) explicit rationale, (3) migration plan for
existing code if required, and (4) updates to affected templates in `.specify/templates/`.

Versioning policy:
- **MAJOR**: Backward-incompatible principle removals/redefinitions.
- **MINOR**: New principle/section or materially expanded mandatory guidance.
- **PATCH**: Clarifications or non-semantic wording improvements.

Compliance policy:
- Every `/speckit.plan`, `/speckit.specify`, and `/speckit.tasks` output MUST include explicit
  constitutional alignment.
- Every PR review MUST include a constitution compliance check.

**Version**: 1.1.0 | **Ratified**: 2026-03-31 | **Last Amended**: 2026-04-02
