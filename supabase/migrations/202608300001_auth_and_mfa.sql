-- Provision a profile for every manually created auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Owner'), '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles when an owner was provisioned before this migration.
insert into public.profiles (id, name, email)
select
  id,
  coalesce(raw_user_meta_data ->> 'name', split_part(coalesce(email, 'Owner'), '@', 1)),
  coalesce(email, '')
from auth.users
on conflict (id) do nothing;

-- Application data requires an authenticated AAL2 (MFA-verified) session.
drop policy if exists "owners manage profile" on public.profiles;
drop policy if exists "owners manage people" on public.people;
drop policy if exists "owners manage identities" on public.identities;
drop policy if exists "owners manage connections" on public.connections;
drop policy if exists "owners manage conversations" on public.conversations;
drop policy if exists "owners manage messages" on public.messages;
drop policy if exists "owners manage attachments" on public.attachments;
drop policy if exists "owners manage memories" on public.memories;
drop policy if exists "owners manage commitments" on public.commitments;
drop policy if exists "owners read audit logs" on public.audit_logs;

create policy "owners manage profile with mfa" on public.profiles for all
  using (id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage people with mfa" on public.people for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage identities with mfa" on public.identities for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage connections with mfa" on public.connections for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage conversations with mfa" on public.conversations for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage messages with mfa" on public.messages for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage attachments with mfa" on public.attachments for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage memories with mfa" on public.memories for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage commitments with mfa" on public.commitments for all
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners read audit logs with mfa" on public.audit_logs for select
  using (owner_id = auth.uid() and (select auth.jwt() ->> 'aal') = 'aal2');
