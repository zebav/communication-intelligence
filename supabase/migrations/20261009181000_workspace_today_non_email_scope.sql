-- The compact Today query uses one bounded non-email pass in addition to its
-- email pass. Keep this special scope explicit rather than expanding the
-- caller's permissions or issuing one request per source.
create or replace function public.workspace_conversation_summaries(
  p_source text,
  p_after timestamptz default null,
  p_limit integer default 100
)
returns table (
  conversation_id uuid,
  conversation_title text,
  conversation_source text,
  conversation_type text,
  conversation_created_at timestamptz,
  conversation_last_message_at timestamptz,
  conversation_summary text,
  conversation_priority_score numeric,
  conversation_recommended_action jsonb,
  person_id uuid,
  person_name text,
  person_relationship_type text,
  person_manual_priority numeric,
  person_email_handling_rule text,
  message_id uuid,
  message_body_text text,
  message_sent_at timestamptz,
  message_direction text,
  message_classification text,
  message_importance_score numeric,
  message_attachment_count integer,
  message_metadata jsonb
)
language sql stable security invoker set search_path = '' as $$
  select c.id,c.title,c.source::text,c.conversation_type,c.created_at,c.last_message_at,c.summary,c.priority_score,c.recommended_action,
    p.id,p.display_name,p.relationship_type,p.manual_priority,p.email_handling_rule,
    m.id,m.body_text,m.sent_at,m.direction::text,m.classification,m.importance_score,m.attachment_count,m.metadata
  from public.conversations c
  left join public.people p on p.id=c.person_id and p.owner_id=c.owner_id
  left join lateral (
    select candidate.id,candidate.body_text,candidate.sent_at,candidate.direction,candidate.classification,candidate.importance_score,candidate.attachment_count,candidate.metadata
    from public.messages candidate
    where candidate.owner_id=c.owner_id and candidate.conversation_id=c.id and candidate.direction='in'
    order by candidate.sent_at desc,candidate.id desc limit 1
  ) m on true
  where c.owner_id=(select auth.uid())
    and (select auth.jwt()->>'aal')='aal2'
    and ((p_source='__all_non_email__' and c.source::text<>'email') or c.source::text=p_source)
    and (p_after is null or c.last_message_at>=p_after)
  order by c.last_message_at desc nulls last
  limit greatest(1,least(p_limit,150));
$$;
