# 03. Scope Definition

## In Scope (MVP)
- Single-user, single-workspace mode.
- Project creation and lifecycle management.
- Intake form and structured brief generation.
- Clarifications: gap detection, questions, assumptions.
- PRD generation, manual editing, and approval.
- Task decomposition: epics/tasks/subtasks with AC/dependencies/priority/estimate.
- Design sync via Figma URL/node and design metadata storage.
- Design-to-task mapping.
- AI handoff generation (implementation/test/design/rules pack).
- Export package to repository file structure.
- Export tasks to Linear.
- Versioned artifacts and pipeline sessions.
- Review/approve step before export.

## Out of Scope (MVP)
- Multi-tenant and billing.
- Full realtime collaboration between multiple editors.
- Automatic production-code generation directly from the dashboard.
- Fully automatic PR creation without user approval.
- Advanced usage analytics/BI.
- CRM functionality.
- Direct IDE orchestration/control of Cursor.

## Scope Boundaries
- Cursor handoff is file-based only through artifacts and `.cursor/rules`.
- Playwright/Continue/Snyk in MVP may be implemented via exported plans/checklists, not full automation.
- Figma sync is limited to metadata/context pull and mapping, without bidirectional design sync.

## MVP Success Boundary
MVP is successful if it covers the full end-to-end preparation workflow for AI implementation, without owning direct code delivery inside the platform.
