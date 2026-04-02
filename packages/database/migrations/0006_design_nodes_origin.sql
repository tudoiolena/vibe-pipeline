-- Source of design_nodes rows: Figma UI kit sync vs synthetic placeholders from design-task links.
alter table public.design_nodes
  add column if not exists origin text not null default 'figma';

alter table public.design_nodes
  drop constraint if exists design_nodes_origin_check;

alter table public.design_nodes
  add constraint design_nodes_origin_check
  check (origin in ('figma', 'synthetic', 'manual'));

update public.design_nodes
set origin = 'synthetic'
where (raw_payload->>'fromDesignTaskLink') = 'true'
   or (raw_payload->>'synthetic') = 'true';
