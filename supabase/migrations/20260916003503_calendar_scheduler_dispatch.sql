-- Short-lived, single-use scheduler credentials; no reusable secret in code or cron text.
create schema if not exists calendar_private;
revoke all on schema calendar_private from public,anon,authenticated;
grant usage on schema calendar_private to service_role;
create table calendar_private.dispatch_tokens (
 token_hash bytea primary key, expires_at timestamptz not null
);
alter table calendar_private.dispatch_tokens enable row level security;
revoke all on calendar_private.dispatch_tokens from public,anon,authenticated;
grant select,delete on calendar_private.dispatch_tokens to service_role;
create function public.consume_calendar_dispatch(p_token text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
 delete from calendar_private.dispatch_tokens
 where token_hash=sha256(convert_to(p_token,'UTF8')) and expires_at>now();
 return found;
end $$;
revoke all on function public.consume_calendar_dispatch(text) from public,anon,authenticated;
grant execute on function public.consume_calendar_dispatch(text) to service_role;
