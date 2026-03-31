# 04. User Stories

## Epic A: Project Intake

### US-A1 Create Project
As a solo developer, I want to create a new project with core intake fields so that I can capture initial business context.

**Acceptance hints**
- Project fields are persisted in the database.
- Project receives a valid lifecycle status such as `draft` or `active`.

### US-A2 Submit Raw Brief
As a user, I want to submit a raw brief and links (Figma/repo/references) so that the system can start analysis.

**Acceptance hints**
- Raw brief is stored as source input.
- Structured brief is generated as a separate versioned artifact.

## Epic B: Clarifications

### US-B1 Detect Gaps
As a user, I want to see missing requirements so that I can reduce downstream errors before PRD generation.

### US-B2 Answer Questions
As a user, I want to answer clarification questions and resolve them so that the requirement set becomes complete.

### US-B3 Track Assumptions
As a user, I want assumptions tracked separately from confirmed facts so that project risks are explicit.

## Epic C: PRD Builder

### US-C1 Generate PRD
As a user, I want a structured PRD generated from intake and clarifications so that I have a reliable source of truth.

### US-C2 Edit and Approve PRD
As a user, I want to manually edit and approve PRD versions so that quality is controlled before decomposition.

## Epic D: Task Breakdown

### US-D1 Decompose to Tasks
As a user, I want automatic epic/task/subtask decomposition from PRD so that execution can begin quickly.

### US-D2 Enrich Tasks
As a user, I want each task to include acceptance criteria, dependencies, priority, and estimate so that implementation is plannable.

### US-D3 Update Task Tree
As a user, I want to manually adjust the task tree so that the plan matches project reality.

## Epic E: Design Sync

### US-E1 Pull Figma Context
As a user, I want to connect a Figma URL/node and pull design nodes so that UI context is available to the team.

### US-E2 Map Design to Work
As a user, I want to map screens/components/variants to tasks and acceptance criteria so that design and execution stay aligned.

## Epic F: AI Handoff

### US-F1 Generate Implementation Pack
As a user, I want an implementation plan, file plan, API drafts, and test plan so that I can hand off work to Cursor effectively.

### US-F2 Generate Cursor Rules
As a user, I want `.cursor/rules` generated from approved artifacts so that coding agents follow project constraints.

## Epic G: Export

### US-G1 Export to Repository
As a user, I want to export markdown/json/rules packages into the repository so that specification artifacts are versioned with code.

### US-G2 Export to Linear
As a user, I want to create Linear issues from the task tree so that delivery tracking is synchronized.

### US-G3 Download and Copy Handoff
As a user, I want to download an archive or copy the handoff pack so that I can share it with my delivery workflow.
