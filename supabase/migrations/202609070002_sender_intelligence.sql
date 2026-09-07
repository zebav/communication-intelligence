alter table public.people
  add column if not exists email_handling_rule text not null default 'normal'
  check (email_handling_rule in ('normal', 'always_priority', 'low_priority')),
  add column if not exists sender_preferences_verified boolean not null default false;

comment on column public.people.sender_preferences_verified is
  'True only after the owner explicitly saves sender intelligence controls.';
