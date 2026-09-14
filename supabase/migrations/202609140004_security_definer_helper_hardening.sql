-- Internal trigger helpers do not need to be callable through PostgREST.
-- Keep the intentionally authenticated universal-profile RPCs unchanged.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
