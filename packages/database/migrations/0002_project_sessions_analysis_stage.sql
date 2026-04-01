-- Allow distinct "analysis" stage for session stepper / pipeline navigation
alter table public.project_sessions
  drop constraint if exists project_sessions_current_stage_check;

alter table public.project_sessions
  add constraint project_sessions_current_stage_check
  check (current_stage in
    ('intake','analysis','clarify','prd','tasks','design_sync','handoff','export'));
