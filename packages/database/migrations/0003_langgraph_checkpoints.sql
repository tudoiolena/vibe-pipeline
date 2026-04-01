-- Append-only LangGraph checkpoint snapshots per session (audit / history)
create table public.langgraph_checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.project_sessions(id) on delete cascade,
  checkpoint_id text not null,
  checkpoint_ts timestamptz,
  pipeline_state_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (session_id, checkpoint_id)
);

create index idx_langgraph_checkpoints_session_created_desc
  on public.langgraph_checkpoints (session_id, created_at desc);
