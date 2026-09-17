alter table public.calendar_holds add column meeting_details jsonb check(meeting_details is null or jsonb_typeof(meeting_details)='object');
alter table public.calendar_event_actions add column details jsonb check(details is null or jsonb_typeof(details)='object');
alter table public.calendar_event_actions drop constraint calendar_event_actions_kind_check;
alter table public.calendar_event_actions add constraint calendar_event_actions_kind_check check(kind in ('rename','cancel','move','details'));
alter table public.calendar_event_actions drop constraint calendar_event_actions_check;
alter table public.calendar_event_actions add constraint calendar_event_actions_check check(
 (kind='rename' and new_title is not null and length(new_title) between 1 and 300) or
 (kind in ('cancel','move','details') and new_title is null));
create function public.guard_calendar_meeting_details() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='calendar_holds' and new.meeting_details is distinct from old.meeting_details then raise exception 'Meeting details are immutable; prepare again'; end if;
 return new;
end $$;
revoke all on function public.guard_calendar_meeting_details() from public,anon;
create trigger guard_calendar_meeting_details before update on public.calendar_holds for each row execute function public.guard_calendar_meeting_details();
create function public.guard_calendar_action_details() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.details is distinct from old.details then raise exception 'Action details are immutable; prepare again'; end if;
 return new;
end $$;
revoke all on function public.guard_calendar_action_details() from public,anon;
create trigger guard_calendar_action_details before update on public.calendar_event_actions for each row execute function public.guard_calendar_action_details();
