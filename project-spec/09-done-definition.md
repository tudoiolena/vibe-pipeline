# 09. Definition of Done (Quality Gates)

## 1) Product Completion Gates
- Full flow `Intake -> Clarify -> PRD -> Tasks -> Design Sync -> Handoff` is implemented and works end-to-end.
- All key entities persist in the database and are available after restart.
- All required artifacts are generated and versioned.
- Review/approve gate exists before export.

## 2) UI/UX Gate
- All 7 required screens are available in one connected workspace.
- Each stage clearly shows status, errors, and next action.
- Forms include baseline validation with understandable error messages.
- UI is responsive (desktop and tablet minimum).
- User can edit generated PRD/tasks directly without workarounds.

## 3) Data & State Gate
- Zod schemas cover Brief/PRD/TaskTree/ImplementationPlan outputs.
- Schema validation errors are logged and debuggable.
- `project_sessions` consistently stores stage and state JSON.
- Artifact version history is preserved on regenerate/edit.

## 4) Security Gate
- Secrets are not hardcoded; environment variables are used.
- Baseline Snyk checklist is generated and usable.
- Endpoint validation checklist includes input validation and auth assumptions.
- Logs do not expose secrets/PII beyond minimum required data.

## 5) PR Checks Gate (Continue + Internal)
- **Architecture Guard**: changes follow the defined modular structure.
- **Validation Guard**: new generators return only schema-valid output.
- **Scope Guard**: changes do not introduce out-of-scope MVP features without explicit approval.
- CI/local checks are green: typecheck, lint, and unit/smoke tests where applicable.

## 6) Testing Gate
- Smoke test plan covers auth (if enabled), navigation, dashboard, and core interactions.
- Critical happy-path generation and export are validated.
- Regression checks confirm manual edits do not break the pipeline.

## 7) Handoff Gate
- `project-spec` package is complete and internally consistent.
- `.cursor/rules` are generated and aligned with current artifacts.
- Export to repository and Linear completes without blocking errors.
- README/setup guide enables a clean local run.

## 8) Release Readiness
- Implemented vs not-implemented scope is documented.
- Known MVP limitations are documented.
- Team/client confirms acceptance criteria.
