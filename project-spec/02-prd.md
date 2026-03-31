# 02. Product Requirements Document (PRD)

## 1) Product Overview
A platform for the pipeline "from business idea to implementation-ready project" built for vibe coding. The product converts raw briefs into structured artifacts and a task tree, synchronized with design context and ready for handoff to Cursor/repository/Linear.

## 2) Core Architecture Flow (Mandatory)
The system is built around a fixed staged workflow:

`Intake -> Clarify -> PRD -> Tasks -> Design Sync -> Handoff`

### Stage Definitions
- **Intake**: normalize raw brief into `BriefSchema`.
- **Clarify**: run gap detection, produce questions and assumptions.
- **PRD**: generate and edit structured `PRDSchema`.
- **Tasks**: decompose PRD into `TaskTreeSchema` (epics/tasks/subtasks).
- **Design Sync**: pull design context from Figma and map it to tasks/AC.
- **Handoff**: generate implementation pack, test plan, rules, and export package.

### Flow Architecture Principles
- Every stage has strict schema-based input/output.
- Stage state is persisted in `project_sessions.state_json`.
- Stage transition requires review/approve at critical checkpoints.
- Every generated artifact is versioned; manual edits remain first-class.

## 3) Problem Statement
AI-first teams lose delivery predictability when implementation starts from unstructured briefs. A system is needed where requirements, design, and task planning live in one versioned source of truth.

## 4) Goals and Success Outcomes
- Reduce time from idea to implementation-ready specification.
- Increase implementation stability in Cursor and similar workflows.
- Reduce rework caused by incomplete requirements.

## 5) Scope Summary
- Generate and store: brief, clarifications, PRD, scope, user stories, acceptance criteria, implementation plan, test plan, design map, tasks.
- Support manual editing of generated artifacts.
- Support Figma design sync and design-task links.
- Export file package and tasks to Linear.

## 6) Users and Personas
- **Solo Founder Developer**: quickly turns ideas into an implementation package.
- **Small Studio Lead**: standardizes handoff quality across projects.

## 7) Functional Requirements

### FR-1 Project Intake
- Create project records with required intake fields.
- Transform raw brief into a structured brief.
- Store each brief revision as a versioned artifact.

### FR-2 Clarifications Engine
- Automatic gap detection across roles, scenarios, edge cases, integrations, NFR, and DoD.
- Generate clarification questions with priority, source, and status.
- Persist user answers and recompute unresolved gaps.

### FR-3 PRD Builder
- Generate PRD from schema sections: problem, goal, scope, out of scope, stories, requirements, assumptions, and risks.
- Support manual editing and version approval of PRD.

### FR-4 Task Decomposition
- Generate epics/tasks/subtasks with acceptance criteria, dependencies, priority, and estimates.
- Provide hierarchical task tree view and editing.
- Prepare structured task payloads for Linear export.

### FR-5 Design Sync
- Accept Figma URL/node/frame as design input.
- Store design nodes (screens/components/variants/tokens).
- Link design nodes to tasks and acceptance criteria.

### FR-6 AI Handoff Pack
- Generate implementation plan, file plan, architecture notes, API contract draft, test plan, cursor notes, and `.cursor/rules`.
- Require review/approve before export.

### FR-7 Export Center
- Export package to repository structure (md/json/rules).
- Export task tree to Linear.
- Copy handoff pack and generate archive.
- Display export status and history.

## 8) Non-Functional Requirements
- TypeScript strict mode.
- Modular architecture with extensible integration adapters.
- Version history for artifacts and pipeline sessions.
- Responsive UI.
- Deterministic structured outputs (Zod-validated).

## 9) Data Requirements
Minimum entities: `projects`, `project_sessions`, `clarifications`, `artifacts`, `tasks`, `design_nodes`, `design_task_links`, `exports`.

## 10) AI Workflow Requirements
- Orchestrate a stateful step-by-step flow (LangGraph/equivalent).
- Each step must return strict schema-validated output.
- Support retry per step, regenerate specific step, and partial export (MVP+ scope).

## 11) Integrations Requirements
- **Cursor**: file-based handoff package as source of truth.
- **Figma MCP**: metadata pull + mapping.
- **Linear**: create issues from task tree.
- **Playwright**: smoke/e2e test plan structure.
- **Continue**: PR guard-check templates.
- **Snyk**: security gate checklist.
- **Superpowers**: task-first/spec-first execution discipline.

## 12) UX Requirements by Screens
- Project Intake
- Clarifications
- PRD Builder
- Task Breakdown
- Design Sync
- AI Handoff
- Export Center

## 13) Constraints and Risks
- MVP excludes multi-tenant and realtime collaboration.
- Risk of instability in external AI/integration APIs.
- Risk of incorrect design-to-task mapping without human review.

## 14) Acceptance Summary (Product-level)
The system is considered complete when a user can execute the full flow from intake to handoff/export with persisted state, versioned artifacts, and a human approval gate before export.
