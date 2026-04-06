# 05. Acceptance Criteria

## AC-01 Project Creation & Intake
- User can create a project with required intake fields.
- Project data is persisted in `projects`.
- Raw brief is saved and available for downstream stages.

## AC-02 Intake Normalization
- System generates a structured brief aligned to `BriefSchema`.
- Schema validation errors are visible to the user.
- Brief artifact is saved in `artifacts` with versioning.

## AC-03 Clarifications
- System shows gaps/questions/assumptions with priority and source.
- User can provide answers and change status open/resolved.
- Clarifications are persisted in `clarifications`.

## AC-04 PRD Generation & Editing
- System generates PRD aligned to `PRDSchema`.
- User can edit PRD in the UI.
- Approved PRD version is stored as a versioned artifact.

## AC-05 Task Decomposition
- Task tree generation is available after PRD approval.
- Tree contains epics/tasks/subtasks and AC/dependencies/priority/estimate fields.
- Structure is validated against `TaskTreeSchema`.

## AC-06 Design Sync
- User can submit Figma URL/node/frame.
- System stores design nodes and metadata.
- Design node to task mapping exists via `design_task_links`.

## AC-07 AI Handoff Pack
- `07-implementation-plan.md`, `08-test-plan.md`, `06-design-map.json`, and `.cursor/rules/*` are generated.
- Handoff pack includes architecture summary, file plan, API contract draft, and test checklist.
- Handoff clarifies file-based Cursor workflow: optional Superpowers (and similar) are developer-side; source of truth remains exported specs and rules.
- Review/approve is required before export.

## AC-08 Export Flows
- Spec package export to repository structure is available.
- Task export to Linear is available.
- Export operations are logged in `exports` with status.

## AC-09 Stateful Pipeline
- Pipeline state is persisted between stages in `project_sessions.state_json`.
- On reload/re-entry, user returns to current project state.
- Each stage produces structured output (not unbounded free text).

## AC-10 Versioning & History
- Key artifacts have version and history.
- Manual edits are stored as new versions.
- Previous versions can be restored (at least read-only access).

## AC-11 UX & Usability
- UI covers the 7 required pipeline screens.
- UI is responsive and usable for solo/small studio workflows.
- Stage status and export readiness are clearly visible.

## AC-12 Quality & Documentation
- Project runs locally using README instructions.
- SQL schema/migrations are provided.
- Architecture and MVP constraints are documented.
