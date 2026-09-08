-- AI creates review suggestions; only an MFA-verified owner can activate them.
grant select, insert, update, delete on table public.commitments to authenticated;

create index if not exists commitments_owner_status_due_idx
  on public.commitments(owner_id, status, due_at);

create unique index if not exists commitments_source_candidate_idx
  on public.commitments(owner_id, source_message_id, description);
