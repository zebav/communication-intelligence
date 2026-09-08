-- AI may suggest memories, but only the MFA-verified owner can approve them.
grant select, insert, update, delete on table public.memories to authenticated;

create index if not exists memories_person_verified_idx
  on public.memories(owner_id, person_id, user_verified, created_at desc);

create unique index if not exists memories_source_candidate_idx
  on public.memories(owner_id, source_message_id, category, content);
