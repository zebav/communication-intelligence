alter table public.people
  add column if not exists entity_type text not null default 'unknown'
    check (entity_type in ('person', 'organization', 'automated', 'unknown')),
  add column if not exists professional_specialty text,
  add column if not exists jurisdiction text;

update public.people set entity_type = 'automated'
where entity_type = 'unknown'
  and lower(display_name) ~ '(no.?reply|notification|newsletter|support team|customer service)';

update public.people set entity_type = 'organization'
where entity_type = 'unknown'
  and (lower(display_name) ~ '( ab$| ltd$| limited$| inc\.?$| llc$| bank$| group$| team$| company$| support$)'
    or (organization is not null and lower(trim(display_name)) = lower(trim(organization))));

comment on column public.people.entity_type is 'Owner-reviewable distinction between a real person, organization, automated sender, or unknown sender.';
comment on column public.people.professional_specialty is 'Optional routing specialty, for example spanish_law, swedish_law, bookkeeping, tax, or insurance.';
comment on column public.people.jurisdiction is 'Optional country or legal jurisdiction used when routing specialist matters.';
