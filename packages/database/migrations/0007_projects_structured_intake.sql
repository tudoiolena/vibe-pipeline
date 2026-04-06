-- Structured intake fields (ТЗ 7.1). All nullable for backward compatibility with existing rows.
-- deadline: calendar date only (no time component); use timestamptz later if time-of-day is required.

alter table public.projects
  add column if not exists client_name text,
  add column if not exists business_goal text,
  add column if not exists target_users text,
  add column if not exists constraints text,
  add column if not exists raw_brief text,
  add column if not exists deadline date;

comment on column public.projects.deadline is 'Target delivery date (date only, UTC calendar date from intake form).';
