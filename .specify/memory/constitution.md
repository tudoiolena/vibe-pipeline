<!--
Sync Impact Report
- Version change: N/A (template) -> 1.0.0
- Modified principles:
  - Principle 1 -> I. Turborepo Monorepo Boundaries
  - Principle 2 -> II. Spec-First Requirement Discipline
  - Principle 3 -> III. Zod Validation Canon
  - Principle 4 -> IV. LangGraph + Supabase AI Workflow Standard
  - Principle 5 -> V. Integration Isolation Contract
- Added sections:
  - Architecture Standards
  - Delivery Workflow & Quality Gates
- Removed sections:
  - None
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ⚠ pending: .specify/templates/commands/*.md (directory not present in this repo)
- Deferred TODOs:
  - None
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
   Zod contracts, LangGraph + Supabase workflow persistence, and integration isolation.
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

**Version**: 1.0.0 | **Ratified**: 2026-03-31 | **Last Amended**: 2026-03-31
