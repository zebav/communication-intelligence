-- `assistant_tasks` is the canonical decision state. Notification rows are a
-- delivery projection only, so they must never continue to look actionable
-- after the same task has been completed or dismissed in Inbox, Today or the
-- Decision Center.
create or replace function public.sync_assistant_notification_task_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  update public.assistant_notifications
  set
    state = case
      when new.status in ('done', 'dismissed') then 'dismissed'
      when new.status in ('executing', 'waiting') then 'read'
      when new.status in ('decision', 'ready', 'uncertain') then 'unread'
      else state
    end,
    read_at = case
      when new.status in ('done', 'dismissed', 'executing', 'waiting') then coalesce(read_at, now())
      when new.status in ('decision', 'ready', 'uncertain') then null
      else read_at
    end,
    updated_at = now()
  where owner_id = new.owner_id
    and task_id = new.id
    -- Avoid write amplification for old task transitions that do not affect
    -- what the owner should see in the notification centre.
    and state is distinct from case
      when new.status in ('done', 'dismissed') then 'dismissed'
      when new.status in ('executing', 'waiting') then 'read'
      when new.status in ('decision', 'ready', 'uncertain') then 'unread'
      else state
    end;

  return new;
end;
$$;

drop trigger if exists assistant_task_notification_lifecycle on public.assistant_tasks;
create trigger assistant_task_notification_lifecycle
after update of status on public.assistant_tasks
for each row execute function public.sync_assistant_notification_task_lifecycle();
