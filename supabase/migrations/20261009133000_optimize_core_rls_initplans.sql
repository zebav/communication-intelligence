-- Cache auth context once per query in the remaining high-traffic owner
-- policies. Ownership rules, MFA requirements, roles and commands are
-- intentionally unchanged; only auth.uid() is turned into an initplan.

alter policy "owners manage attachments with mfa" on public.attachments
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners read audit logs with mfa" on public.audit_logs
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage commitments with mfa" on public.commitments
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage communication outcomes with mfa" on public.communication_outcomes
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage connections with mfa" on public.connections
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage conversations with mfa" on public.conversations
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage identities with mfa" on public.identities
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage learning signals with mfa" on public.learning_signals
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage memories with mfa" on public.memories
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage messages with mfa" on public.messages
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage people with mfa" on public.people
  using (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');

alter policy "owners manage profile with mfa" on public.profiles
  using (id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
