alter type public.communication_source add value if not exists 'imessage';

alter table public.connections add column if not exists source public.communication_source;
alter table public.conversations add column if not exists connection_id uuid references public.connections(id) on delete set null;

update public.connections set source = 'email' where provider = 'microsoft-graph' and source is null;

create unique index if not exists connections_owner_provider_account_idx
  on public.connections(owner_id, provider, account_identifier)
  where account_identifier is not null;
create index if not exists conversations_connection_idx on public.conversations(owner_id, connection_id);

comment on column public.connections.source is 'Normalized channel represented by this specific external or manual account.';
comment on column public.conversations.connection_id is 'Exact account context for this conversation; keeps company and private accounts separate.';
