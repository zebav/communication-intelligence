-- Phase 10: enrich the existing learning ledger. This is deliberately not a
-- second memory store: it adds provenance, safe automation state and a
-- correction trail to public.learning_signals.

alter table public.learning_signals
  add column if not exists learning_mode text not null default 'review_required'
    check (learning_mode in ('automatic', 'review_required', 'blocked')),
  add column if not exists fact_state text not null default 'inferred'
    check (fact_state in ('confirmed', 'inferred', 'uncertain')),
  add column if not exists sensitivity text not null default 'personal'
    check (sensitivity in ('personal', 'sensitive', 'restricted')),
  add column if not exists autonomy_level smallint not null default 0
    check (autonomy_level between 0 and 3),
  add column if not exists last_validated_at timestamptz,
  add column if not exists auto_applied_at timestamptz,
  add column if not exists correction_count integer not null default 0
    check (correction_count >= 0),
  add column if not exists version integer not null default 1
    check (version >= 1);

-- Automatic promotion is intentionally only used for repetitive low-risk
-- communication-style preferences. Existing rows remain review-required.
create index if not exists learning_signals_autonomous_review_idx
  on public.learning_signals(owner_id, learning_mode, status, updated_at desc);

alter table public.automation_jobs
  drop constraint if exists automation_jobs_operation_check;
alter table public.automation_jobs
  add constraint automation_jobs_operation_check check (operation in (
    'gmail_intelligence', 'outlook_intelligence', 'instagram_intelligence',
    'whatsapp_intelligence', 'slack_intelligence', 'calendar_sync',
    'vault_ingestion', 'relationship_backfill', 'autonomous_learning'
  ));

comment on column public.learning_signals.learning_mode is
  'automatic is limited to safe, repeated, evidence-backed learning; it never authorizes external action.';
comment on column public.learning_signals.fact_state is
  'Distinguishes owner-confirmed facts from inference and uncertainty.';
