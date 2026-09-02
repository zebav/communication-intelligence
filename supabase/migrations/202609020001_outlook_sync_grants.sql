-- RLS still restricts every operation to the MFA-verified owner.
-- These table privileges only allow the Outlook sync route to reach those policies.
grant select, insert, update on table public.people to authenticated;
grant select, insert, update on table public.identities to authenticated;
grant select, insert, update on table public.conversations to authenticated;
grant select, insert, update on table public.messages to authenticated;
