-- Scheduled messages are immutable owner-approved sends. The worker may only
-- transition a message forward; it never retries an ambiguous provider result.
create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_message_id uuid references public.messages(id) on delete set null,
  source public.communication_source not null,
  body_text text not null check (char_length(trim(body_text)) between 1 and 4096),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','processing','sent','failed','needs_review','cancelled')),
  expected_connection_id uuid references public.connections(id) on delete set null,
  expected_recipient text,
  idempotency_key uuid not null default gen_random_uuid(),
  claim_token uuid,
  claimed_at timestamptz,
  sent_message_id uuid references public.messages(id) on delete set null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

create index scheduled_messages_due_idx on public.scheduled_messages(status, scheduled_for) where status = 'scheduled';
create index scheduled_messages_owner_idx on public.scheduled_messages(owner_id, status, scheduled_for desc);

alter table public.scheduled_messages enable row level security;
create policy "owners manage scheduled messages" on public.scheduled_messages
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update on table public.scheduled_messages to authenticated;

-- Existing audit policy was initially limited to Outlook. Scheduling is also
-- available for the owner-approved Instagram and WhatsApp channels.
drop policy if exists "owners insert own audit logs" on public.audit_logs;
create policy "owners insert own audit logs"
on public.audit_logs for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and actor_id = (select auth.uid())
  and actor_type = 'user'
  and source in ('email','instagram','whatsapp')
);
