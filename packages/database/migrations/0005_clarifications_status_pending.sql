alter table public.clarifications
  drop constraint if exists clarifications_status_check;

alter table public.clarifications
  add constraint clarifications_status_check
  check (status in ('open', 'answered', 'resolved', 'dismissed', 'pending'));
