-- Non-destructive contact merges. Original profiles remain available for undo.
create table public.contact_merges (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 source_id uuid not null references public.people(id),
 target_id uuid not null references public.people(id),
 source_profile jsonb not null,
 moved_rows jsonb not null default '{}',
 automatic boolean not null default false,
 created_at timestamptz not null default now(),
 undone_at timestamptz,
 check(source_id <> target_id)
);
create unique index contact_merges_active_source on public.contact_merges(owner_id,source_id) where undone_at is null;
alter table public.contact_merges enable row level security;
create policy owner_contact_merges on public.contact_merges for all to authenticated
 using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2')
 with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
grant select, insert, update on public.contact_merges to authenticated;

create function public.merge_contacts_v3(source_person uuid, target_person uuid, auto_match boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
 owner uuid := auth.uid();
 source_row public.people; target_row public.people;
 table_name text; moved jsonb := '{}'; ids jsonb; event_id uuid;
begin
 if owner is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then raise exception 'MFA required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
 select * into source_row from public.people where id=source_person and owner_id=owner for update;
 if not found then raise exception 'Source unavailable'; end if;
 select * into target_row from public.people where id=target_person and owner_id=owner for update;
 if not found or source_person=target_person then raise exception 'Target unavailable'; end if;
 if exists(select 1 from public.contact_merges where owner_id=owner and undone_at is null and (source_id in(source_person,target_person) or target_id=source_person)) then raise exception 'Undo earlier merges first'; end if;
 if auto_match and not (
   source_row.entity_type='person' and target_row.entity_type='person'
   and lower(regexp_replace(trim(source_row.display_name),'\s+',' ','g'))=lower(regexp_replace(trim(target_row.display_name),'\s+',' ','g'))
   and trim(source_row.display_name) like '% %'
   and exists(select 1 from public.identities a join public.identities b on lower(trim(a.external_identifier))=lower(trim(b.external_identifier)) and a.source=b.source
    where a.owner_id=owner and b.owner_id=owner and a.person_id=source_person and b.person_id=target_person
    and a.verified_match and b.verified_match and a.source='email'
    and a.external_identifier ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and a.external_identifier !~* '^(info|support|sales|hello|office|admin|billing|contact|team|no-?reply)@')
 ) then raise exception 'Automatic match is not verified'; end if;
 -- Identical pending learning rules have a person-scoped unique key. Preserve
 -- the second record as dismissed rather than deleting it or aborting the merge.
 select coalesce(jsonb_agg(s.id),'[]'::jsonb) into ids from public.learning_signals s
 where s.owner_id=owner and s.person_id=source_person and s.status='suggested'
 and exists(select 1 from public.learning_signals t where t.owner_id=owner and t.person_id=target_person and t.status='suggested' and t.source=s.source and t.signal_type=s.signal_type and t.proposed_rule=s.proposed_rule);
 moved := moved || jsonb_build_object('duplicate_learning_ids',ids);
 update public.learning_signals set status='dismissed' where owner_id=owner and id in(select value::uuid from jsonb_array_elements_text(ids));
 foreach table_name in array array['identities','conversations','memories','commitments','learning_signals','communication_outcomes','priority_feedback'] loop
  execute format('select coalesce(jsonb_agg(id), ''[]''::jsonb) from public.%I where owner_id=$1 and person_id=$2',table_name) into ids using owner,source_person;
  moved := moved || jsonb_build_object(table_name,ids);
  execute format('update public.%I set person_id=$1 where owner_id=$2 and person_id=$3',table_name) using target_person,owner,source_person;
 end loop;
 insert into public.contact_merges(owner_id,source_id,target_id,source_profile,moved_rows,automatic)
 values(owner,source_person,target_person,to_jsonb(source_row),moved,auto_match) returning id into event_id;
 update public.people set relationship_status='merged' where owner_id=owner and id=source_person;
 return event_id;
end $$;
revoke all on function public.merge_contacts_v3(uuid,uuid,boolean) from public,anon;
grant execute on function public.merge_contacts_v3(uuid,uuid,boolean) to authenticated;

create function public.undo_contact_merge_v3(merge_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare owner uuid := auth.uid(); event public.contact_merges; table_name text;
begin
 if owner is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then raise exception 'MFA required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 select * into event from public.contact_merges where id=merge_id and owner_id=owner and undone_at is null for update;
 if not found then raise exception 'Merge unavailable'; end if;
 foreach table_name in array array['identities','conversations','memories','commitments','learning_signals','communication_outcomes','priority_feedback'] loop
  execute format('update public.%I set person_id=$1 where owner_id=$2 and person_id=$3 and id in (select value::uuid from jsonb_array_elements_text($4))',table_name)
   using event.source_id,owner,event.target_id,event.moved_rows->table_name;
 end loop;
 -- New messages follow their existing conversation; subsequent edits are retained.
 update public.learning_signals set status='suggested' where owner_id=owner and person_id=event.source_id and status='dismissed'
 and id in(select value::uuid from jsonb_array_elements_text(event.moved_rows->'duplicate_learning_ids'));
 update public.people set relationship_status=event.source_profile->>'relationship_status' where owner_id=owner and id=event.source_id;
 update public.contact_merges set undone_at=now() where id=event.id;
end $$;
revoke all on function public.undo_contact_merge_v3(uuid) from public,anon;
grant execute on function public.undo_contact_merge_v3(uuid) to authenticated;

create table public.priority_feedback (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 person_id uuid references public.people(id), source text not null, category text not null,
 score numeric not null check(score between 1 and 10), reason text not null check(length(reason) between 1 and 1000),
 created_at timestamptz not null default now(), unique(owner_id,message_id)
);
alter table public.priority_feedback enable row level security;
create policy owner_priority_feedback on public.priority_feedback for all to authenticated
 using(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2')
 with check(owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
grant select,insert,update on public.priority_feedback to authenticated;
grant select on public.priority_feedback to service_role;
create index priority_feedback_context on public.priority_feedback(owner_id,person_id,source,category);
create index messages_owner_outgoing_date on public.messages(owner_id,sent_at desc,id desc) where direction='out';

create function public.correct_priority_v3(message_id uuid, priority numeric, explanation text)
returns void language plpgsql security invoker set search_path = '' as $$
declare owner uuid := auth.uid(); m public.messages; c public.conversations;
begin
 if owner is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then raise exception 'MFA required'; end if;
 if priority not between 1 and 10 or length(trim(explanation)) not between 1 and 1000 then raise exception 'Invalid correction'; end if;
 select * into m from public.messages where id=message_id and owner_id=owner for update;
 if not found then raise exception 'Message unavailable'; end if;
 select * into c from public.conversations where id=m.conversation_id and owner_id=owner for update;
 if not found then raise exception 'Conversation unavailable'; end if;
 insert into public.priority_feedback(owner_id,message_id,person_id,source,category,score,reason)
 values(owner,m.id,c.person_id,m.source::text,coalesce(m.classification,'Information Only'),priority,trim(explanation))
 on conflict on constraint priority_feedback_owner_id_message_id_key do update set score=excluded.score,reason=excluded.reason,created_at=now();
 update public.messages set importance_score=priority,metadata=metadata||jsonb_build_object('priority_override',priority) where id=m.id and owner_id=owner;
 update public.conversations set priority_score=priority,recommended_action=coalesce(recommended_action,'{}')||jsonb_build_object('relevance_reasons',jsonb_build_array(explanation),'priority_source','owner') where id=c.id and owner_id=owner;
end $$;
revoke all on function public.correct_priority_v3(uuid,numeric,text) from public,anon;
grant execute on function public.correct_priority_v3(uuid,numeric,text) to authenticated;

-- Preserve explicit corrections during sync/reanalysis; learn only within the same
-- person, channel and category, and only after two distinct corrected examples.
create function public.apply_priority_feedback_v3() returns trigger
language plpgsql security invoker set search_path='' as $$
declare corrected numeric; examples integer; learned numeric; person uuid;
begin
 select score into corrected from public.priority_feedback where owner_id=new.owner_id and message_id=new.id;
 if corrected is not null then
  new.importance_score := corrected;
  new.metadata := coalesce(new.metadata,'{}') || jsonb_build_object('priority_override',corrected,'priority_learning_reason','Din korrigerade prioritering');
 else
  select person_id into person from public.conversations where id=new.conversation_id and owner_id=new.owner_id;
  select count(*),avg(score) into examples,learned from public.priority_feedback where owner_id=new.owner_id and person_id=person and source=new.source::text and category=new.classification;
  if examples>=2 and new.importance_score is not null and new.processed_at is distinct from old.processed_at then
   new.importance_score := round(new.importance_score * 0.75 + learned * 0.25,1);
   new.metadata := coalesce(new.metadata,'{}') || jsonb_build_object('priority_learning_reason','Tidigare korrigeringar för samma kontakt, källa och kategori vägs in.');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.apply_priority_feedback_v3() from public,anon;
create trigger apply_priority_feedback_v3 before insert or update on public.messages for each row execute function public.apply_priority_feedback_v3();

create function public.apply_conversation_priority_v3() returns trigger
language plpgsql security invoker set search_path='' as $$
declare m public.messages;
begin
 select * into m from public.messages where conversation_id=new.id and owner_id=new.owner_id and direction='in' order by sent_at desc,id desc limit 1;
 if m.metadata ? 'priority_learning_reason' then
  new.priority_score := m.importance_score;
  new.recommended_action := coalesce(new.recommended_action,'{}') || jsonb_build_object('relevance_reasons',jsonb_build_array(m.metadata->>'priority_learning_reason'));
 end if;
 return new;
end $$;
revoke all on function public.apply_conversation_priority_v3() from public,anon;
create trigger apply_conversation_priority_v3 before update on public.conversations for each row execute function public.apply_conversation_priority_v3();

create function public.set_expects_reply_v3(outgoing_id uuid, expects boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'MFA required'; end if;
 update public.messages set metadata=coalesce(metadata,'{}')||jsonb_build_object('expects_reply',expects)
 where id=outgoing_id and owner_id=auth.uid() and direction='out';
 if not found then raise exception 'Outgoing message unavailable'; end if;
end $$;
revoke all on function public.set_expects_reply_v3(uuid,boolean) from public,anon;
grant execute on function public.set_expects_reply_v3(uuid,boolean) to authenticated;
