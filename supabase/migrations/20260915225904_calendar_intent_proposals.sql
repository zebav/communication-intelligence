create table public.calendar_intent_proposals (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 conversation_id uuid not null references public.conversations(id),input_hash text not null,
 proposal jsonb not null check(jsonb_typeof(proposal)='object'),
 status text not null default 'proposed' check(status in ('proposed','dismissed')),
 created_at timestamptz not null default now(),unique(owner_id,conversation_id,input_hash)
);
create index calendar_intent_owner_status on public.calendar_intent_proposals(owner_id,status,created_at desc);
alter table public.calendar_intent_proposals enable row level security;
revoke all on public.calendar_intent_proposals from public,anon,authenticated;
grant select,insert,update on public.calendar_intent_proposals to authenticated;
create policy calendar_intent_owner on public.calendar_intent_proposals for all to authenticated
using((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2')
with check((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2' and exists(select 1 from public.conversations c where c.id=conversation_id and c.owner_id=(select auth.uid())));
