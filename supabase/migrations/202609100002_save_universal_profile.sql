create or replace function public.save_universal_communication_profile(profile_data jsonb)
returns table(preferences jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles as profile
  set
    preferences = jsonb_set(
      coalesce(profile.preferences, '{}'::jsonb),
      '{universal_communication_profile}',
      profile_data,
      true
    ),
    updated_at = now()
  where profile.id = auth.uid()
  returning profile.preferences, profile.updated_at
  into preferences, updated_at;

  if not found then
    raise exception 'Authenticated profile not found';
  end if;

  return next;
end;
$$;

revoke all on function public.save_universal_communication_profile(jsonb) from public;
grant execute on function public.save_universal_communication_profile(jsonb) to authenticated;

create or replace function public.get_universal_communication_profile()
returns table(preferences jsonb, updated_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select profile.preferences, profile.updated_at
  from public.profiles as profile
  where profile.id = auth.uid();
$$;

revoke all on function public.get_universal_communication_profile() from public;
grant execute on function public.get_universal_communication_profile() to authenticated;
