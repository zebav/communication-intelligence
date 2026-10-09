# Autonomous Decision Architecture V2

## Canonical flow

`event → normalise/deduplicate → resolve person → retrieve authorised context
→ analyse incrementally → persist decision → prepare → ask if data is missing
→ owner approval → execute once → verify → learn`

`assistant_tasks`, its stored plan, approval claims and task events are the
canonical decision state. Inbox, Today and Notiscenter are presentations of
that state; none creates a competing action record.

## Shared context contract

Each decision receives only task-relevant, owner-authorised context:

- person and relationship evidence;
- recent conversation and confirmed communication preferences;
- calendar availability and stored commitments;
- selected vault documents/media and their provenance;
- time, route, place and weather only when the task needs planning;
- past approved decisions and explicit learning feedback.

Every returned context item needs source, retrieval time, verification/freshness
state, sensitivity and allowed use. Inferences remain labelled as inferences.
Provider data with a time-sensitive value (weather, price, availability) is
retrieved or revalidated for the current task, never treated as permanent fact.

## Ask, Save & Resume

Extend the existing task plan rather than starting a new chat/task when a
required value is absent. A typed request contains a human label, purpose,
validation, sensitivity, allowed destination and persistence class:

1. verified reusable fact;
2. restricted reusable fact;
3. task-only value;
4. ephemeral secret/one-time code.

The task transitions to `awaiting_information`, preserves its exact plan and
resumes at its last safe checkpoint after validation. One-time codes are not
saved. Sensitive values are stored only in the existing encrypted vault with
owner consent and are passed only to an authorised destination.

## Approval and orchestration

The existing agent registry remains a policy layer, not an independent agent
runtime. The central orchestrator selects a bounded specialist capability and
checks whether cached preparation can be reused. All external actions bind
exact recipient, source account, URL, document, amount or booking terms where
applicable. High-risk effects always require explicit approval and uncertain
provider outcomes are never automatically re-sent.

## Notifications and recovery

Notifications reference the same task id, avoid sensitive lock-screen detail
by default and group by unresolved decision. Background jobs are owner-scoped,
idempotent, traceable and retried with a bounded policy. A stale claimed job is
returned to the queue; a final failure becomes an Operations signal or a
specific reconnect request.

## Release gates

1. Schema/RLS migration review and preview parity.
2. Real low-risk source tests for each connected provider.
3. Mobile and desktop journey tests.
4. Performance baselines from real deployment telemetry.
5. Controlled preview review, merge, production deployment SHA verification
   and post-release operation check.
