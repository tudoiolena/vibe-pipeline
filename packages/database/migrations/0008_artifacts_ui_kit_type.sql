-- Allow `ui_kit` artifact rows (design_map already allowed).
alter table public.artifacts drop constraint if exists artifacts_artifact_type_check;
alter table public.artifacts add constraint artifacts_artifact_type_check check (artifact_type in
    ('brief','clarifications','prd','scope','user_stories','acceptance_criteria',
     'design_map','implementation_plan','test_plan','done_definition','tasks','cursor_rules','implementation_pack','ui_kit'));
