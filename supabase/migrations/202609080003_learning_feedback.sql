create table if not exists public.learning_signals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  source text not null default 'email',
  signal_type text not null check (signal_type in ('draft_accepted', 'draft_edited', 'tone_requested', 'category_corrected')),
  observation text not null,
  proposed_rule text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_signals_owner_status_idx on public.learning_signals(owner_id, status, created_at desc);
alter table public.learning_signals enable row level security;

drop policy if exists "owners manage learning signals with mfa" on public.learning_signals;
create policy "owners manage learning signals with mfa" on public.learning_signals for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');

grant select, insert, update, delete on table public.learning_signals to authenticated;

comment on table public.learning_signals is
  'Owner-reviewable communication learning. Suggested observations never influence AI until explicitly approved.';
