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
