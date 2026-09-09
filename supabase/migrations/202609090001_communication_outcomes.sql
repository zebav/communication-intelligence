create table if not exists public.communication_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  trigger_message_id uuid not null references public.messages(id) on delete cascade,
  response_message_id uuid references public.messages(id) on delete set null,
  desired_outcome text not null default 'Receive a useful reply or advance the conversation',
  status text not null default 'waiting' check (status in ('waiting', 'reply_received', 'resolved', 'follow_up_needed', 'unknown')),
  owner_rating text check (owner_rating in ('successful', 'neutral', 'unsuccessful')),
  response_time_minutes integer check (response_time_minutes is null or response_time_minutes >= 0),
  evidence jsonb not null default '{}'::jsonb,
  user_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, trigger_message_id)
);

create index if not exists communication_outcomes_owner_status_idx on public.communication_outcomes(owner_id, status, updated_at desc);
alter table public.communication_outcomes enable row level security;

drop policy if exists "owners manage communication outcomes with mfa" on public.communication_outcomes;
create policy "owners manage communication outcomes with mfa" on public.communication_outcomes for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');

grant select, insert, update, delete on table public.communication_outcomes to authenticated;

alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in ('draft_accepted', 'draft_edited', 'tone_requested', 'category_corrected', 'outcome_confirmed'));

comment on table public.communication_outcomes is
  'Owner-controlled outcomes linked to sent messages. Automatic reply detection is evidence, not a success judgment.';

-- Seed one current outcome per existing email conversation so the first Preview
-- can be reviewed without sending a new message solely for testing.
insert into public.communication_outcomes (owner_id, person_id, conversation_id, trigger_message_id, response_message_id, status, response_time_minutes, evidence)
select latest.owner_id, latest.person_id, latest.conversation_id, latest.trigger_message_id,
  response.id,
  case when response.id is null then 'waiting' else 'reply_received' end,
  case when response.sent_at is null then null else greatest(0, round(extract(epoch from (response.sent_at - latest.sent_at)) / 60)::integer) end,
  jsonb_build_object('created_from', 'existing_conversation_backfill')
from (
  select distinct on (message.owner_id, message.conversation_id)
    message.owner_id, conversation.person_id, message.conversation_id, message.id as trigger_message_id, message.sent_at
  from public.messages message
  join public.conversations conversation on conversation.id = message.conversation_id and conversation.owner_id = message.owner_id
  where message.source = 'email' and message.direction = 'out'
  order by message.owner_id, message.conversation_id, message.sent_at desc
) latest
left join lateral (
  select incoming.id, incoming.sent_at
  from public.messages incoming
  where incoming.owner_id = latest.owner_id and incoming.conversation_id = latest.conversation_id
    and incoming.source = 'email' and incoming.direction = 'in' and incoming.sent_at > latest.sent_at
  order by incoming.sent_at asc limit 1
) response on true
on conflict (owner_id, trigger_message_id) do nothing;
