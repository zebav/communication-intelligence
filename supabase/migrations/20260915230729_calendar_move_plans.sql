-- Move reservations use the existing serialized conflict guard, but can never create new events.
alter table public.calendar_holds add column purpose text not null default 'booking' check(purpose in ('booking','move'));
alter table public.calendar_holds add constraint calendar_holds_owner_id_unique unique(owner_id,id);
alter table public.calendar_event_actions add column hold_id uuid,
 add column target_start timestamptz, add column target_end timestamptz,
 add foreign key(owner_id,hold_id) references public.calendar_holds(owner_id,id);
alter table public.calendar_event_actions drop constraint calendar_event_actions_kind_check;
alter table public.calendar_event_actions add check(kind in ('rename','cancel','move'));
alter table public.calendar_event_actions drop constraint calendar_event_actions_check;
alter table public.calendar_event_actions add check(
 (kind='rename' and new_title is not null and length(new_title) between 1 and 300) or
 (kind in ('cancel','move') and new_title is null));
alter table public.calendar_event_actions add check(
 (kind='move' and hold_id is not null and target_start is not null and target_end is not null and target_end>target_start) or
 (kind<>'move' and hold_id is null and target_start is null and target_end is null));
create unique index calendar_action_hold on public.calendar_event_actions(hold_id) where hold_id is not null;

create function public.guard_calendar_move() returns trigger language plpgsql security invoker set search_path='' as $$
declare h record;
begin
 if tg_op='UPDATE' and (new.hold_id,new.target_start,new.target_end) is distinct from (old.hold_id,old.target_start,old.target_end) then raise exception 'Move facts cannot change'; end if;
 if new.kind<>'move' then return new; end if;
 select * into h from public.calendar_holds where owner_id=new.owner_id and id=new.hold_id for update;
 if not found or h.purpose<>'move' or h.starts_at<>new.target_start or h.ends_at<>new.target_end then raise exception 'Move reservation mismatch'; end if;
 if tg_op='INSERT' and (h.status<>'active' or h.expires_at<=now()) then raise exception 'Move reservation expired'; end if;
 if tg_op='UPDATE' and old.status='proposed' and new.status='executing' then
  if h.status<>'active' or h.expires_at<=now() then raise exception 'Move reservation expired'; end if;
  -- This invokes the same master/hold/transfer conflict guards as a normal booking.
  update public.calendar_holds set status='executing' where id=h.id;
 end if;
 if tg_op='UPDATE' and old.status='executing' and new.status='completed' then
  update public.calendar_holds set status='confirmed',external_event_id=new.event_id where id=h.id;
 end if;
 if tg_op='UPDATE' and new.status='stale' and old.status<>new.status then
  update public.calendar_holds set status='released' where id=h.id and status in ('active','executing');
 end if;
 return new;
end $$;
revoke all on function public.guard_calendar_move() from public,anon;
create trigger guard_calendar_move before insert or update on public.calendar_event_actions for each row execute function public.guard_calendar_move();
create function public.guard_calendar_hold_purpose() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.purpose<>old.purpose then raise exception 'Reservation purpose cannot change'; end if;
 return new;
end $$;
revoke all on function public.guard_calendar_hold_purpose() from public,anon;
create trigger guard_calendar_hold_purpose before update on public.calendar_holds for each row execute function public.guard_calendar_hold_purpose();
