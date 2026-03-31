# 10. Task Breakdown (Dependency-Ordered)

This backlog is ordered for execution safety (dependencies first) and atomic implementation sessions (roughly 50-100 LOC per feature task).

Conventions:
- `[P]` means the task is parallelizable after dependencies are complete.
- Every feature task includes a required **Verification** sub-task.
- `apps/web` tasks explicitly respect FSD boundaries (`app -> processes -> widgets -> features -> entities -> shared`).

---

## Phase 0: Workspace & Infra

### VP-0001 — Initialize Turborepo and npm workspaces
- **Description:** Create root workspace configuration and baseline package manifests for apps and packages.
- **Dependencies:** None
- **Affected packages:** `workspace-root`
- **Acceptance criteria:**
  - Root workspace recognizes `apps/*` and `packages/*`.
  - Workspace install succeeds without unresolved local package references.
  - Base folder structure exists for `apps/web` and `packages/*`.
- **Verification (VP-0001-V):** Validate workspace bootstrap.

### VP-0002 — Configure `turbo.json` task pipeline
- **Description:** Define build, lint, test, and typecheck pipelines with outputs/cache boundaries.
- **Dependencies:** `VP-0001`
- **Affected packages:** `workspace-root`
- **Acceptance criteria:**
  - Turbo pipeline includes build, lint, typecheck, and test.
  - Task dependencies align with package graph.
  - Local run executes tasks in expected order.
- **Verification (VP-0002-V):** Run Turbo dry pipeline.

### VP-0003 — [P] Configure root `tsconfig.json` for monorepo paths
- **Description:** Add strict compiler options and shared path aliases for all workspace packages.
- **Dependencies:** `VP-0001`
- **Affected packages:** `workspace-root`
- **Acceptance criteria:**
  - Root TypeScript config enables strict mode.
  - Path aliases resolve `@vibe/*` imports.
  - Child package tsconfig files extend root config cleanly.
- **Verification (VP-0003-V):** Run TypeScript project references check.

### VP-0004 — [P] Create `@vibe/ui` with shared Tailwind preset
- **Description:** Set up `@vibe/ui`, shared design tokens, and reusable Tailwind preset.
- **Dependencies:** `VP-0001`
- **Affected packages:** `@vibe/ui`, `apps/web (shared/ui)`
- **Acceptance criteria:**
  - `@vibe/ui` exports UI primitives and style entrypoints.
  - Shared Tailwind configuration is consumable in `apps/web`.
  - A sample component renders with shared tokens.
- **Verification (VP-0004-V):** Build `@vibe/ui` package.

### VP-0005 — Integrate Shadcn/ui into `apps/web` via `@vibe/ui`
- **Description:** Configure Shadcn/ui component generation and route shared components through `@vibe/ui`.
- **Dependencies:** `VP-0003`, `VP-0004`
- **Affected packages:** `@vibe/ui`, `apps/web (shared/ui)`
- **Acceptance criteria:**
  - Shadcn/ui components are generated/wrapped in `@vibe/ui`.
  - `apps/web` consumes shared components from package exports.
  - Theme tokens and utility classes are consistent.
- **Verification (VP-0005-V):** Render shared Shadcn component in app.

---

## Phase 1: Core Foundation

### VP-0101 — Implement `@vibe/schema` core Zod contracts from PRD
- **Description:** Define `BriefSchema`, `PRDSchema`, `TaskTreeSchema`, `DesignMapSchema`, and shared enums.
- **Dependencies:** `VP-0003`
- **Affected packages:** `@vibe/schema`
- **Acceptance criteria:**
  - All schema roots are implemented.
  - Enums match spec status/category sets.
  - Valid fixtures parse; invalid fixtures fail.
- **Verification (VP-0101-V):** Run schema unit tests.

### VP-0102 — Publish schema package entrypoints and validation helpers
- **Description:** Export inferred TS types and reusable validator helpers.
- **Dependencies:** `VP-0101`
- **Affected packages:** `@vibe/schema`
- **Acceptance criteria:**
  - Public API exports schemas and inferred types.
  - Validators return structured errors.
  - Consumers import without circular dependency issues.
- **Verification (VP-0102-V):** Typecheck consumer imports.

### VP-0103 — [P] Implement `@vibe/database` Supabase client and env guards
- **Description:** Create typed Supabase client initialization with runtime env validation.
- **Dependencies:** `VP-0003`
- **Affected packages:** `@vibe/database`
- **Acceptance criteria:**
  - Env vars are validated at startup.
  - Typed client factory exists.
  - Repositories/routes can reuse connection helper.
- **Verification (VP-0103-V):** Check Supabase client initialization.

### VP-0104 — Create initial SQL migrations for core pipeline tables
- **Description:** Add migration scripts for all core MVP pipeline entities and constraints.
- **Dependencies:** `VP-0103`
- **Affected packages:** `@vibe/database`
- **Acceptance criteria:**
  - Required tables and constraints are created.
  - Enum/check constraints match spec statuses.
  - Migration applies cleanly on empty DB.
- **Verification (VP-0104-V):** Apply and inspect migration.

### VP-0105 — [P] Generate DB types and add typed repository modules
- **Description:** Generate TS DB types and implement repositories aligned to schema contracts.
- **Dependencies:** `VP-0104`, `VP-0102`
- **Affected packages:** `@vibe/database`, `@vibe/schema`
- **Acceptance criteria:**
  - Generated DB types are available.
  - Repositories exist for core entities.
  - Repository outputs are strongly typed.
- **Verification (VP-0105-V):** Run repository integration checks.

---

## Phase 2: LangGraph Orchestration

### VP-0201 — Scaffold `@vibe/ai` LangGraph state machine core
- **Description:** Create graph state model, node contracts, and reducer wiring.
- **Dependencies:** `VP-0102`, `VP-0105`
- **Affected packages:** `@vibe/ai`, `@vibe/schema`
- **Acceptance criteria:**
  - State includes stage/status/node/error metadata.
  - Shared node contract interface is defined.
  - Reducer supports deterministic transitions.
- **Verification (VP-0201-V):** Execute graph bootstrap test.

### VP-0202 — Implement persisted checkpoints to `project_sessions.state_json`
- **Description:** Persist/reload graph checkpoints for interruption and resume flows.
- **Dependencies:** `VP-0201`
- **Affected packages:** `@vibe/ai`, `@vibe/database`
- **Acceptance criteria:**
  - Checkpoints persist to `project_sessions.state_json`.
  - Resume restores last checkpoint state.
  - `last_error` is persisted on terminal failure.
- **Verification (VP-0202-V):** Simulate interrupt and resume.

### VP-0203 — [P] Implement `IntakeNormalizer` node
- **Description:** Transform raw intake into `BriefSchema` and persist versioned brief artifact.
- **Dependencies:** `VP-0201`, `VP-0102`, `VP-0105`
- **Affected packages:** `@vibe/ai`, `@vibe/schema`, `@vibe/database`
- **Acceptance criteria:**
  - Output validates against `BriefSchema`.
  - Validation errors are structured.
  - Success persists brief artifact version.
- **Verification (VP-0203-V):** Run IntakeNormalizer node test.

### VP-0204 — [P] Implement `GapDetector` node
- **Description:** Detect unresolved requirement gaps and emit prioritized clarification candidates.
- **Dependencies:** `VP-0201`, `VP-0102`, `VP-0105`
- **Affected packages:** `@vibe/ai`, `@vibe/schema`, `@vibe/database`
- **Acceptance criteria:**
  - Gaps include required categories (roles/NFR/edge/integration/security).
  - Each gap includes priority and source.
  - Critical gaps route to clarification branch.
- **Verification (VP-0204-V):** Run GapDetector node test.

### VP-0205 — Wire Intake + GapDetector transitions, retries, and interrupt/resume
- **Description:** Connect node flow with retry policy and user-input interruption semantics.
- **Dependencies:** `VP-0202`, `VP-0203`, `VP-0204`
- **Affected packages:** `@vibe/ai`, `@vibe/database`
- **Acceptance criteria:**
  - Intake routes to GapDetector on valid output.
  - Two-retry cap and failure policy are enforced.
  - Interrupted sessions can resume using same session id.
- **Verification (VP-0205-V):** Execute orchestration flow test.

---

## Phase 3: The Dashboard (App)

### VP-0301 — Create `apps/web` FSD skeleton for all layers
- **Description:** Establish `app`, `processes`, `widgets`, `features`, `entities`, `shared` boundaries and conventions.
- **Dependencies:** `VP-0005`
- **Affected packages:** `apps/web (all FSD layers)`
- **Acceptance criteria:**
  - All required layers exist under `apps/web/src`.
  - Boundary rules are documented/enforced.
  - Route shell uses FSD-compliant import direction.
- **Verification (VP-0301-V):** Validate FSD boundary rules.

### VP-0302 — Build Project Intake form in `features` layer
- **Description:** Implement intake UI + submission logic strictly in feature/entity/shared boundaries.
- **Dependencies:** `VP-0301`, `VP-0105`, `VP-0203`
- **Affected packages:** `apps/web (features/intake)`, `apps/web (entities/project)`, `@vibe/schema`
- **Acceptance criteria:**
  - Required intake fields are captured.
  - Inline validation is displayed.
  - Submission persists project/intake data.
- **Verification (VP-0302-V):** Run intake feature tests.

### VP-0303 — Build Clarification UI in `widgets` layer with feature actions
- **Description:** Compose clarification list widget with answer/status mutations in features layer.
- **Dependencies:** `VP-0301`, `VP-0105`, `VP-0204`
- **Affected packages:** `apps/web (widgets/clarifications)`, `apps/web (features/clarification-answer)`, `apps/web (entities/clarification)`
- **Acceptance criteria:**
  - Questions show category, priority, and state.
  - User answers/status updates persist.
  - Widget-feature-entity boundaries remain compliant.
- **Verification (VP-0303-V):** Run clarifications interaction tests.

### VP-0304 — [P] Implement graph session entity and status polling/subscription client
- **Description:** Create session entity and shared API client for graph state updates.
- **Dependencies:** `VP-0301`, `VP-0205`, `VP-0105`
- **Affected packages:** `apps/web (entities/session)`, `apps/web (shared/api)`, `@vibe/database`
- **Acceptance criteria:**
  - Session model maps persisted graph state fields.
  - Polling/subscription mode is supported.
  - Status payload normalization is available for widgets.
- **Verification (VP-0304-V):** Validate session status data flow.

### VP-0305 — Implement real-time stage status widget
- **Description:** Build live status widget to show stage progression and blockers.
- **Dependencies:** `VP-0304`
- **Affected packages:** `apps/web (widgets/stage-status)`, `apps/web (entities/session)`
- **Acceptance criteria:**
  - Current stage and graph status are visible.
  - UI updates in near real-time.
  - Interrupted/failed states provide next-step hints.
- **Verification (VP-0305-V):** Test real-time status widget updates.

### VP-0306 — Add stage control actions in `processes` layer
- **Description:** Implement start/resume/approve process actions orchestrating features/entities.
- **Dependencies:** `VP-0302`, `VP-0303`, `VP-0304`
- **Affected packages:** `apps/web (processes/pipeline-control)`, `apps/web (features/intake)`, `apps/web (features/clarification-answer)`, `apps/web (entities/session)`
- **Acceptance criteria:**
  - Start/resume actions drive graph execution.
  - Approval gates control stage transitions.
  - Process orchestration preserves FSD boundaries.
- **Verification (VP-0306-V):** Exercise process-level stage controls.

---

## Phase 4: Integrations & Export

### VP-0401 — [P] Build `@vibe/integrations` Figma REST adapter
- **Description:** Add Figma metadata pull adapter with retry/rate-limit handling.
- **Dependencies:** `VP-0102`, `VP-0003`
- **Affected packages:** `@vibe/integrations`, `@vibe/schema`
- **Acceptance criteria:**
  - Adapter ingests Figma URL/key and fetches metadata.
  - Retry strategy handles transient failures.
  - Output maps into design-node persistence schema.
- **Verification (VP-0401-V):** Run Figma adapter contract tests.

### VP-0402 — [P] Build `@vibe/integrations` Linear SDK adapter
- **Description:** Add Linear export adapter with deterministic task-to-issue mapping.
- **Dependencies:** `VP-0003`
- **Affected packages:** `@vibe/integrations`
- **Acceptance criteria:**
  - Task payload fields map correctly to Linear API inputs.
  - Duplicate/idempotency strategy is defined.
  - Created issue IDs return in normalized format.
- **Verification (VP-0402-V):** Run Linear adapter integration checks.

### VP-0403 — Implement `ImplementationPlanner` node for `.cursor/rules` generation
- **Description:** Generate implementation artifacts and rules drafts from validated specs.
- **Dependencies:** `VP-0205`, `VP-0401`, `VP-0402`, `VP-0102`
- **Affected packages:** `@vibe/ai`, `@vibe/schema`, `@vibe/integrations`, `@vibe/database`
- **Acceptance criteria:**
  - Node consumes validated PRD/task/design inputs only.
  - Output includes architecture/task/design-aligned rules drafts.
  - Payload is schema-validated before persistence/export.
- **Verification (VP-0403-V):** Run ImplementationPlanner node test.

### VP-0404 — Build Export Center UI in `widgets` + `features` layers
- **Description:** Implement export readiness, trigger controls, and operation history screen.
- **Dependencies:** `VP-0306`, `VP-0402`, `VP-0403`
- **Affected packages:** `apps/web (widgets/export-center)`, `apps/web (features/export-actions)`, `apps/web (entities/export)`
- **Acceptance criteria:**
  - Readiness state for required artifacts is visible.
  - User can trigger repo export and Linear export.
  - FSD boundaries are preserved across layers.
- **Verification (VP-0404-V):** Test Export Center interaction flow.

### VP-0405 — Implement export service for `project-spec/*` artifacts and status logging
- **Description:** Emit markdown/json/rules bundles and persist export operation status.
- **Dependencies:** `VP-0404`, `VP-0403`, `VP-0105`
- **Affected packages:** `apps/web (features/export-actions)`, `@vibe/database`, `@vibe/ai`
- **Acceptance criteria:**
  - Required artifact files are generated in repository structure.
  - Export operation status/history is persisted.
  - Approval gate blocks invalid export attempts.
- **Verification (VP-0405-V):** Run export service integration test.

### VP-0406 — Generate internal .cursor/rules for the project itself based on the finalized spec.
- **Description:** Produce final internal rules enforcing architecture, FSD boundaries, task discipline, and output guards.
- **Dependencies:** `VP-0405`
- **Affected packages:** `.cursor/rules`, `workspace-root`
- **Acceptance criteria:**
  - Rules reference finalized spec artifacts in `project-spec/*`.
  - Rules enforce package dependency direction and FSD boundaries.
  - Rules include schema-validation and approval-before-export guardrails.
- **Verification (VP-0406-V):** Validate generated internal rules consistency.
