create extension if not exists pgcrypto;

create type public.communication_source as enum ('email','instagram','whatsapp','messenger','tinder','tiktok','linkedin','manual');
create type public.message_direction as enum ('in','out');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  timezone text not null default 'Europe/Stockholm',
  locale text not null default 'en',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.people (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null, first_name text, last_name text, organization text, relationship_type text,
  relationship_status text, notes text, relationship_summary text, overall_priority numeric(4,2), manual_priority numeric(4,2),
  first_contact_at timestamptz, last_contact_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.identities (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade, source public.communication_source not null,
  external_identifier text not null, username text, profile_url text, metadata jsonb not null default '{}'::jsonb,
  verified_match boolean not null default false, confidence numeric(4,3), created_at timestamptz not null default now(),
  unique(owner_id, source, external_identifier)
);
create table public.connections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null, account_name text, account_identifier text, status text not null default 'disconnected',
  capabilities jsonb not null default '{}'::jsonb, scopes text[] not null default '{}', encrypted_credentials text,
  token_metadata jsonb not null default '{}'::jsonb, last_sync_at timestamptz, health_status text not null default 'disconnected',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null, source public.communication_source not null,
  external_conversation_id text, title text, conversation_type text, status text not null default 'active',
  interest_score numeric(4,2), priority_score numeric(4,2), momentum_score numeric(4,2), reciprocity_score numeric(4,2),
  last_message_at timestamptz, last_user_message_at timestamptz, last_other_message_at timestamptz,
  summary text, recommended_action jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, source, external_conversation_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade, external_message_id text not null,
  direction public.message_direction not null, sender_identity_id uuid references public.identities(id) on delete set null,
  source public.communication_source not null, body_text text, body_html text, sent_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb, attachment_count integer not null default 0, classification text,
  importance_score numeric(4,2), processed_at timestamptz, created_at timestamptz not null default now(),
  unique(owner_id, source, external_message_id)
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade, filename text not null, mime_type text,
  size_bytes bigint, storage_reference text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.memories (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade, conversation_id uuid references public.conversations(id) on delete cascade,
  category text not null, content text not null, confidence numeric(4,3), source_message_id uuid references public.messages(id) on delete set null,
  valid_from timestamptz, valid_until timestamptz, user_verified boolean not null default false, created_at timestamptz not null default now()
);
create table public.commitments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade, person_id uuid references public.people(id) on delete set null,
  description text not null, commitment_owner text not null, due_at timestamptz, status text not null default 'open',
  source_message_id uuid references public.messages(id) on delete set null, confidence numeric(4,3),
  created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.audit_logs (
  id bigint generated always as identity primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid, action text not null, object_type text not null, object_id text, source text, actor_type text not null,
  previous_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);

create index messages_conversation_sent_idx on public.messages(conversation_id, sent_at desc);
create index conversations_owner_attention_idx on public.conversations(owner_id, priority_score desc nulls last);
create index commitments_owner_due_idx on public.commitments(owner_id, status, due_at);

alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.identities enable row level security;
alter table public.connections enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.memories enable row level security;
alter table public.commitments enable row level security;
alter table public.audit_logs enable row level security;

create policy "owners manage profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "owners manage people" on public.people for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage identities" on public.identities for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage connections" on public.connections for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage conversations" on public.conversations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage messages" on public.messages for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage attachments" on public.attachments for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage memories" on public.memories for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage commitments" on public.commitments for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners read audit logs" on public.audit_logs for select using (owner_id = auth.uid());
