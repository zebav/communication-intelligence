-- Keep provider source metadata consistent and backfill person activity timestamps
-- from persisted conversation history. This migration is idempotent and safe to
-- re-run after older environments were created manually through the Supabase UI.

update public.connections
set source = 'email'
where provider in ('microsoft-graph', 'gmail')
  and source is null;

with activity as (
  select
    c.person_id,
    min(m.sent_at) as first_seen,
    max(m.sent_at) as last_seen
  from public.conversations c
  join public.messages m on m.conversation_id = c.id
  where c.person_id is not null
  group by c.person_id
)
update public.people p
set
  first_contact_at = coalesce(p.first_contact_at, a.first_seen),
  last_contact_at = case
    when p.last_contact_at is null then a.last_seen
    when a.last_seen > p.last_contact_at then a.last_seen
    else p.last_contact_at
  end,
  updated_at = now()
from activity a
where p.id = a.person_id
  and (
    p.first_contact_at is null
    or p.last_contact_at is null
    or a.last_seen > p.last_contact_at
  );
