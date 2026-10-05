-- Relationship Intelligence V1 deliberately extends the Person Graph. It stores
-- derived, owner-scoped evidence rather than copies of private message bodies.
create table if not exists public.relationship_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  category text not null check (category in ('romantic','friends','family','colleagues','customers','suppliers','business_partners','professional_network','advisors_professional_services','other')),
  category_confidence numeric(4,3) not null default 0 check (category_confidence between 0 and 1),
  strength_score numeric(5,2) not null check (strength_score between 0 and 100),
  quality_score numeric(5,2) not null check (quality_score between 0 and 100),
  priority_score numeric(5,2) not null check (priority_score between 0 and 100),
  ranking_score numeric(5,2) not null check (ranking_score between 0 and 100),
  interaction_frequency_score numeric(5,2) not null default 0 check (interaction_frequency_score between 0 and 100),
  recency_score numeric(5,2) not null default 0 check (recency_score between 0 and 100),
  reciprocity_score numeric(5,2) not null default 0 check (reciprocity_score between 0 and 100),
  responsiveness_score numeric(5,2) not null default 0 check (responsiveness_score between 0 and 100),
  emotional_depth_score numeric(5,2) not null default 0 check (emotional_depth_score between 0 and 100),
  reliability_score numeric(5,2) not null default 0 check (reliability_score between 0 and 100),
  shared_context_score numeric(5,2) not null default 0 check (shared_context_score between 0 and 100),
  trajectory_score numeric(5,2) not null default 0 check (trajectory_score between 0 and 100),
  category_dimensions jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  evidence_coverage numeric(4,3) not null default 0 check (evidence_coverage between 0 and 1),
  trend text not null default 'uncertain' check (trend in ('rising','stable','cooling','dormant','reconnecting','new','uncertain')),
  explanation text not null default '',
  missing_information text[] not null default '{}',
  model_version text not null default 'deterministic-v1',
  scoring_version text not null default 'v1',
  snapshot_date date not null default current_date,
  last_analyzed_message_id uuid references public.messages(id) on delete set null,
  last_analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, person_id, category, snapshot_date)
);

create index if not exists relationship_snapshots_owner_category_rank_idx
  on public.relationship_snapshots(owner_id, category, snapshot_date desc, ranking_score desc);
create index if not exists relationship_snapshots_person_idx
  on public.relationship_snapshots(owner_id, person_id, snapshot_date desc);

create table if not exists public.relationship_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relationship_snapshot_id uuid references public.relationship_snapshots(id) on delete set null,
  source_type text not null check (source_type in ('message','conversation','calendar_event','contact','personal_context','commitment','user_feedback')),
  source_id text not null,
  evidence_type text not null,
  direction text check (direction in ('in','out','mutual','owner')),
  observed_at timestamptz not null default now(),
  summary text not null,
  signal jsonb not null default '{}'::jsonb,
  weight numeric(5,3) not null default 0 check (weight between -1 and 1),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique(owner_id, person_id, source_type, source_id, evidence_type)
);
create index if not exists relationship_evidence_person_observed_idx on public.relationship_evidence(owner_id, person_id, observed_at desc);

create table if not exists public.relationship_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  category text check (category in ('romantic','friends','family','colleagues','customers','suppliers','business_partners','professional_network','advisors_professional_services','other')),
  feedback_type text not null check (feedback_type in ('category_confirmed','category_rejected','importance_adjusted','fact_corrected','interpretation_corrected','relationship_ended')),
  ai_inference jsonb not null default '{}'::jsonb,
  owner_correction jsonb not null default '{}'::jsonb,
  effective_state jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists relationship_feedback_person_idx on public.relationship_feedback(owner_id, person_id, created_at desc);

create table if not exists public.relationship_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','running','paused','completed','failed','cancelled')),
  cursor_person_id uuid references public.people(id) on delete set null,
  processed_people integer not null default 0,
  skipped_people integer not null default 0,
  evidence_watermark timestamptz,
  cost_budget_cents integer not null default 0 check (cost_budget_cents >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists relationship_backfill_jobs_owner_status_idx on public.relationship_backfill_jobs(owner_id, status, created_at desc);

alter table public.relationship_snapshots enable row level security;
alter table public.relationship_evidence enable row level security;
alter table public.relationship_feedback enable row level security;
alter table public.relationship_backfill_jobs enable row level security;

revoke all on public.relationship_snapshots, public.relationship_evidence, public.relationship_feedback, public.relationship_backfill_jobs from anon;
grant select, insert, update, delete on public.relationship_snapshots, public.relationship_evidence, public.relationship_feedback, public.relationship_backfill_jobs to authenticated;
grant all on public.relationship_snapshots, public.relationship_evidence, public.relationship_feedback, public.relationship_backfill_jobs to service_role;

create policy "owners manage relationship snapshots with mfa" on public.relationship_snapshots for all to authenticated
  using ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage relationship evidence with mfa" on public.relationship_evidence for all to authenticated
  using ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage relationship feedback with mfa" on public.relationship_feedback for all to authenticated
  using ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "owners manage relationship backfill jobs with mfa" on public.relationship_backfill_jobs for all to authenticated
  using ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.uid()) = owner_id and (select auth.jwt() ->> 'aal') = 'aal2');

comment on table public.relationship_snapshots is 'Owner-scoped, reproducible Relationship Intelligence scores. Scores are derived signals, never undisclosed psychological diagnoses.';
comment on table public.relationship_evidence is 'Concise provenance for relationship signals. References source records and intentionally does not duplicate private message bodies.';
