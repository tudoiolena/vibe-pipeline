# 07. Implementation Plan

## 1) Architecture Baseline

Pipeline remains fixed:
`Intake -> Clarify -> PRD -> Tasks -> Design Sync -> Handoff -> Export`.

Non-negotiable rules:
- Supabase/Postgres is source of truth.
- LangGraph persists stage state in `project_sessions.state_json`.
- All generated outputs are validated by Zod before writes.
- Handoff/export only from approved artifacts.

## 2) Database Schema (Supabase/Postgres)

### 2.1 SQL Schema (strict)

```sql
create extension if not exists "pgcrypto";

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  status text not null default 'draft' check (status in
    ('draft','intake','clarify','prd','tasks','design_sync','handoff','approved','exported','archived')),
  source_figma_url text,
  source_repo_url text,
  source_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_version int not null default 1,
  current_stage text not null check (current_stage in
    ('intake','clarify','prd','tasks','design_sync','handoff','export')),
  graph_status text not null default 'idle' check (graph_status in
    ('idle','running','interrupted_for_input','failed','completed')),
  state_json jsonb not null default '{}'::jsonb,
  last_node text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, session_version)
);

create table public.clarifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.project_sessions(id) on delete set null,
  question_key text not null,
  question_text text not null,
  category text not null check (category in
    ('roles','nfr','edge_case','integration','security','scope','data','workflow')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  answer_text text,
  status text not null default 'open' check (status in ('open','answered','resolved','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, question_key)
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.project_sessions(id) on delete set null,
  artifact_type text not null check (artifact_type in
    ('brief','clarifications','prd','scope','user_stories','acceptance_criteria',
     'design_map','implementation_plan','test_plan','done_definition','tasks','cursor_rules','implementation_pack')),
  format text not null check (format in ('md','json')),
  version int not null,
  status text not null default 'draft' check (status in ('draft','review','approved','exported','superseded')),
  content_md text,
  content_json jsonb,
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, artifact_type, version)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.project_sessions(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  hierarchy_level smallint not null check (hierarchy_level in (0,1,2)),
  task_type text not null check (task_type in ('epic','task','subtask')),
  external_key text not null,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','review','done','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  estimate_points int,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  linear_issue_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, external_key)
);

create table public.design_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  figma_file_key text not null,
  node_id text not null,
  node_type text not null,
  node_name text not null,
  figma_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, figma_file_key, node_id)
);

create table public.design_task_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  design_node_id uuid not null references public.design_nodes(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  relation_type text not null check (relation_type in
    ('screen_to_epic','component_to_task','variant_to_acceptance_criteria','token_to_constraint')),
  confidence_score numeric(4,3) not null check (confidence_score >= 0 and confidence_score <= 1),
  implementation_status text not null default 'not_started' check (implementation_status in
    ('not_started','in_progress','implemented','verified','blocked')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, design_node_id, task_id, relation_type)
);
```

### 2.2 TypeScript Interfaces

```ts
export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "draft" | "intake" | "clarify" | "prd" | "tasks" | "design_sync" | "handoff" | "approved" | "exported" | "archived";
  sourceFigmaUrl: string | null;
  sourceRepoUrl: string | null;
  sourceLinks: Array<{ label: string; url: string; type?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSession {
  id: string;
  projectId: string;
  sessionVersion: number;
  currentStage: "intake" | "clarify" | "prd" | "tasks" | "design_sync" | "handoff" | "export";
  graphStatus: "idle" | "running" | "interrupted_for_input" | "failed" | "completed";
  stateJson: Record<string, unknown>;
  lastNode: string | null;
  lastError: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Clarification {
  id: string;
  projectId: string;
  sessionId: string | null;
  questionKey: string;
  questionText: string;
  category: "roles" | "nfr" | "edge_case" | "integration" | "security" | "scope" | "data" | "workflow";
  priority: "low" | "medium" | "high" | "critical";
  answerText: string | null;
  status: "open" | "answered" | "resolved" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  projectId: string;
  sessionId: string | null;
  artifactType:
    | "brief" | "clarifications" | "prd" | "scope" | "user_stories" | "acceptance_criteria"
    | "design_map" | "implementation_plan" | "test_plan" | "done_definition" | "tasks"
    | "cursor_rules" | "implementation_pack";
  format: "md" | "json";
  version: number;
  status: "draft" | "review" | "approved" | "exported" | "superseded";
  contentMd: string | null;
  contentJson: Record<string, unknown> | null;
  checksumSha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskNode {
  id: string;
  projectId: string;
  sessionId: string | null;
  parentTaskId: string | null;
  hierarchyLevel: 0 | 1 | 2;
  taskType: "epic" | "task" | "subtask";
  externalKey: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  estimatePoints: number | null;
  acceptanceCriteria: string[];
  dependencies: string[];
  metadata: Record<string, unknown>;
  linearIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignNode {
  id: string;
  projectId: string;
  figmaFileKey: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  figmaUrl: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DesignTaskLink {
  id: string;
  projectId: string;
  designNodeId: string;
  taskId: string;
  relationType: "screen_to_epic" | "component_to_task" | "variant_to_acceptance_criteria" | "token_to_constraint";
  confidenceScore: number;
  implementationStatus: "not_started" | "in_progress" | "implemented" | "verified" | "blocked";
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

## 3) AI Orchestration (LangGraph)

Node sequence and transitions:
1. `IntakeNormalizer`
   - Input: raw brief, source links.
   - Output: `BriefSchema`.
   - Edge: valid -> `GapDetector`; invalid -> retry with constrained repair prompt.
2. `GapDetector`
   - Finds gaps in NFR, roles, edge cases, integrations, security.
   - Edge: no critical gaps -> `PRDWriter`; else -> `ClarificationGen`.
3. `ClarificationGen`
   - Creates ranked questions.
   - Writes rows to `clarifications`.
   - Interrupts graph (`graph_status = interrupted_for_input`).
   - Resume edge: when required questions are answered -> `GapDetector`.
4. `PRDWriter`
   - Builds `PRDSchema` from brief + resolved clarifications.
   - Edge: approved PRD exists -> `TaskDecomposer`; else interrupt for review.
5. `TaskDecomposer`
   - Produces `TaskTreeSchema` (`epic > task > subtask`).
   - Persists task hierarchy in `tasks`.
   - Edge: success -> `DesignMapper`.
6. `DesignMapper`
   - Pulls Figma REST context, stores `design_nodes`.
   - Creates `design_task_links` with `confidence_score` and `implementation_status`.
   - Enriches task acceptance criteria with design evidence.
   - Edge: success -> `Exporter`.
7. `Exporter`
   - Gathers approved artifacts into implementation-pack.
   - Emits `project-spec/*` and `.cursor/rules/*`.
   - Optional branch: Linear export adapter execution.

Failure policy:
- Per node retry up to 2 attempts.
- Third failure marks session failed and stores `last_error`.
- Resume always starts from failed node with same `session_id`.

## 4) Monorepo Strategy (Turborepo)

Required package boundaries:
- `@vibe/schema`
  - Zod schemas and DTOs: `BriefSchema`, `PRDSchema`, `TaskTreeSchema`, `DesignMapSchema`.
- `@vibe/ai`
  - LangGraph nodes, state reducers, prompt templates, LLM clients (OpenAI/Anthropic).
- `@vibe/integrations`
  - Adapters: Figma API, Linear API, Snyk API (+ retry and rate-limit handling).
- `@vibe/database`
  - Supabase client, SQL migrations, generated DB types, repositories.
- `apps/web`
  - Next.js App Router UI with FSD layering:
    - `src/app`
    - `src/processes`
    - `src/widgets`
    - `src/features`
    - `src/entities`
    - `src/shared`

Dependency direction:
- `apps/web` -> may depend on all packages.
- `@vibe/ai` -> depends on `@vibe/schema`, `@vibe/database`, `@vibe/integrations`.
- `@vibe/integrations` -> standalone, no `apps/web` imports.
- `@vibe/schema` -> no runtime dependencies on app/integration layers.

## 5) Cursor Rules Structure Plan

Keep `.cursor/rules/001-005` as enforcement layer:
- `001-project-context.mdc`
  - Source-of-truth files and stage contract.
- `002-architecture.mdc`
  - FSD boundaries, package imports, adapter-only integrations.
- `003-task-execution.mdc`
  - Task-first order, dependency gate, AC completion checks.
- `004-design-sync.mdc`
  - Figma node -> task linkage requirements, confidence + implementation status policy.
- `005-output-format.mdc`
  - Zod-validated structured outputs and export guards.

Rule enforcement additions:
- Reject feature code if missing mapped acceptance criteria or unresolved high-priority clarifications.
- Require schema validation (`@vibe/schema`) on all AI outputs before DB writes.
- Prevent cross-layer FSD imports that violate architecture.

### 5.1 Superpowers (workflow discipline, not a runtime dependency)

- Superpowers is a **Cursor editor plugin**. The vibe-pipeline app does not call it or embed it.
- Product requirement: exported handoff and generated `.cursor/rules` (for customer projects) should **encode** spec-first, task-first, and review-before-export behavior, and may **recommend** installing Superpowers for skill-based workflows.
- Acceptance: no expectation that the dashboard controls Superpowers; alignment is proven by artifact contents and README/handoff notes, not by an API integration.

## 6) Delivery Sequence

1. Apply SQL migration and generate Supabase types.
2. Implement `@vibe/schema` first (contracts before logic).
3. Implement LangGraph nodes with persistent checkpoints.
4. Implement integrations adapters with mock + real providers.
5. Build `apps/web` screens in stage order.
6. Enable exporter and rule generation.
7. Validate end-to-end against `project-spec/05-acceptance-criteria.md`.
