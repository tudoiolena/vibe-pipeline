# 08. Test Plan

## Goal
Validate that the core pipeline `Intake -> Clarify -> PRD -> Tasks -> Design Sync -> Handoff` is stable, stateful, and export-ready for real project usage.

## Test Strategy
- Use layered validation: schema checks, integration checks, and UI/e2e smoke tests.
- Prioritize critical happy path and state persistence between stages.
- Block export on critical quality gates.

## Test Types

### 1) Schema and Validation Tests
- Validate `BriefSchema` output from intake normalizer.
- Validate clarification payload shape (question, source, priority, status).
- Validate `PRDSchema` and required sections.
- Validate `TaskTreeSchema` structure and field completeness.
- Validate `ImplementationPlanSchema` before handoff/export.

### 2) API and Integration Tests
- Project create/read/update flows.
- Stage transitions and session persistence in `project_sessions`.
- Artifacts versioning and history retrieval.
- Figma metadata pull and design node persistence.
- Linear export payload generation and API call behavior.

### 3) UI/E2E Smoke Tests (Playwright-ready)
- Intake form submission and project creation.
- Clarification question list rendering and answer persistence.
- PRD generation, manual edit, approval action.
- Task tree generation and edit interactions.
- Design sync screen loading, node pull, and mapping.
- Handoff generation and export center actions.

## Mandatory Smoke Flows

### Flow A: New Project Happy Path
1. Create project with required intake fields.
2. Submit raw brief and generate structured brief.
3. Generate clarifications and resolve high-priority questions.
4. Generate PRD and approve PRD version.
5. Generate tasks and validate tree completeness.
6. Run design sync and map at least one node to one task.
7. Generate handoff package.
8. Export to repository package.

Expected result: all stages complete without blocking errors and artifacts are versioned.

### Flow B: Export to Linear
1. Start from approved task tree.
2. Trigger Linear export.
3. Verify external IDs and tracker metadata are saved.

Expected result: issues are created and export status is `success`.

### Flow C: Resume Stateful Session
1. Stop at Clarify stage with partial answers.
2. Reload application.
3. Continue from last saved stage.

Expected result: no state loss and no duplicate artifact version conflicts.

## Quality Gates Before Export
- PRD status: approved.
- Task tree status: generated and reviewed.
- Design mapping status: minimum required links created.
- Implementation plan status: generated and validated.
- Security checklist and PR checks package generated.

## Security and PR Checks Coverage

### Security (Snyk-aligned checklist)
- Dependency baseline review complete.
- Endpoint input validation checklist complete.
- Secret handling and environment variable policy reviewed.

### PR Checks (Continue-aligned)
- Architecture Guard passed.
- Validation Guard passed.
- Scope Guard passed.

## Test Data and Fixtures
- Sample raw brief with ambiguous requirements.
- Sample Figma file with at least 7 frames matching required screens.
- Linear test workspace and project.
- Mock user answers for clarification questions.

## Exit Criteria
- All mandatory smoke flows pass.
- No critical severity defects in stage transitions or data persistence.
- Export package is complete and consistent with approved artifacts.
- Release notes include known limitations and unresolved non-critical items.
