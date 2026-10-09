# Solvani — Phase 0 architecture, performance and autonomy audit

**Status:** baseline audit — no production changes made
**Audited branch:** `main` at `80fc6b3`
**Date:** 2026-10-09

## Executive conclusion

Solvani already has the essential building blocks for a reliable personal assistant: a person graph, channel ingestion, a decision-and-execution workflow, service policies, calendar and location helpers, a document vault, relationship intelligence, audit trails and scheduled functions. The immediate risk is not a lack of agents. It is that the existing systems are only partly connected through durable, observable background work.

The next implementation milestone should therefore be **reliability and performance foundations**, not a new parallel agent framework. It should make current imports, media processing, relationship refreshes and message prioritisation measurable, resumable and independent of a user opening the app.

## Verified architecture inventory

| Area | Existing foundation to reuse | Audit conclusion |
| --- | --- | --- |
| Identity and relationships | `people`, identities, contacts, relationship snapshots/evidence/feedback | Keep the Person Graph as the single person identity layer. Do not create channel-specific relationship records. |
| Communication | conversations/messages plus Gmail, Outlook, Instagram, WhatsApp and Slack import routes | Keep one canonical message model; source workers should only ingest, normalize and enqueue downstream work. |
| Decisions and approvals | `assistant_tasks`, task events, task feedback and decision preparation | This is the correct approval boundary for agents. Extend it rather than creating a second action inbox. |
| Services and tools | service catalog, policies, audit events, Browserbase approval/budget records | This is the existing tool layer. Agents must invoke it through policy checks and approval claims. |
| Calendar, maps and planning | calendar sync/holds, Google Maps and assistant preparation | Retain planning as a proposal capability; calendar changes and external reservations remain approved actions. |
| Documents and media | vault assets, ingestion jobs, media references and analysis | Retain the vault pipeline; process attachments asynchronously and reference the original evidence. |
| Relationship intelligence | snapshots, evidence, feedback and backfill job schema in the repository | Reuse it as a prioritisation feature and Decision Center input, not as a separate CRM. |
| Operations status | Operations Dashboard, connection status and structured operation logs | Use this as the start of a private operational dashboard and reliability agent. |

## Evidence-based findings

### P0 — production database schema is behind the repository

The deployed database migration history ends at `20261004002806_attachment_lifecycle_status_v1`, while `main` also contains:

- `20261004090000_relationship_intelligence_v1.sql`
- `20261004103000_relationship_backfill_observability_v1.sql`

The second migration adds fields such as `total_people` to `relationship_backfill_jobs`. Production logs show failed backfill queries requesting that field (`42703`, undefined column). This explains the failed relationship backfill/import status without implying data loss.

**Required repair:** first apply and verify these existing migrations in a preview/staging database, then perform a controlled production migration with a post-migration schema and job check. Do not work around this by adding another compatibility table or a parallel relationship pipeline.

### P0 — critical automation is not consistently durable

The signed-in workspace triggers `/api/system/automation`, which starts several imports and refreshes with `after()`. This keeps the interface responsive but is not a durable queue: interruption, deployment changes and long-running provider calls can leave work incomplete. The relationship backfill and media-analysis endpoints also exist but are not both scheduled in `vercel.json`.

**Required repair:** retain the current per-domain job tables, but introduce one common job contract and dispatcher before adding more agents. A user login may request work; it must not be the only way work finishes.

### P1 — login currently loads a broad workspace snapshot

`app/page.tsx` concurrently requests profile, people, conversations, identities, memories, commitments, learning, outcomes, connections, calendar data and messages before sending a large snapshot to the workspace. The page has timeout/partial-data handling, which is a good safeguard, but it makes unrelated views compete on initial load.

**Required repair:** keep the shell and Today summary small, fetch view-specific data only when the user opens Inbox, Calendar, Contacts, Relationships or Settings, and use cursor pagination for long lists. Preserve the existing last-good-snapshot fallback during this transition.

### P1 — observability exists but has no end-to-end correlation

`observability.ts` already emits structured, privacy-conscious operation logs, while Vercel Analytics and Speed Insights are installed. There is no shared trace identifier through page request, internal automation call, provider import, processing job and UI status. Current Vercel connector permissions allow project discovery but not deployment/runtime-log inspection, so this audit cannot truthfully state current production p50/p95/p99 values.

**Required repair:** add a generated trace/workflow identifier to structured server logs and job records, then use Vercel runtime logs and Speed Insights to establish a baseline before claiming improvements.

### P1 — database performance work needs evidence, not bulk index changes

Supabase advisors report unindexed foreign keys, RLS-init-plan warnings, unused indexes and three duplicate index pairs. These findings are useful leads, but are not permission to drop or create indexes wholesale. Some of the tables are deliberately service-role-only.

**Required repair:** use actual top slow queries and `EXPLAIN (ANALYZE, BUFFERS)` in a safe environment to select only indexes and RLS changes that match proven request paths. Treat OAuth, Browserbase and sensitive vault tables as service-only until an explicit access design says otherwise.

## Performance baseline and acceptance targets

The following are targets for the first implementation milestone. They are not presented as measured production results.

| Journey | Target after warm-up | Measurement |
| --- | --- | --- |
| Authenticated shell / Today usable | p95 under 2.5 s | browser navigation + server timing |
| Inbox first page usable | p95 under 2.5 s | browser navigation + query timing |
| Notification center first page usable | p95 under 2.0 s | browser navigation + query timing |
| Background import acknowledgement | under 500 ms | route timing; work itself runs separately |
| Source sync freshness | visible per source, with last success/failure and next retry | job state, not inferred UI text |
| Task/worker failure | traceable and retryable without data duplication | operation/job audit trail |

Baseline measurement must capture p50, p95 and p99 by route, source, error class and deployment. Payloads, tokens, message bodies and attachment contents must never be written to telemetry.

## Recommended milestone sequence

### Milestone A — Reliability and performance foundation

1. **Restore schema parity.** Validate the two relationship migrations in preview/staging, run targeted backfill checks, then migrate production in a controlled release.
2. **Create a common background-work contract.** A typed job record should include owner, operation, source, idempotency key, lifecycle state, attempts, next run, trace ID, error code and sanitized result summary. Reuse existing vault, calendar, relationship and scheduled-message jobs through adapters; do not replace all workers at once.
3. **Make imports independently schedulable.** Keep separate Gmail, Outlook, Instagram, WhatsApp, Slack, calendar and vault schedules, but dispatch their work through the common lifecycle and expose real freshness in Connections.
4. **Instrument before optimising.** Add route and job timing, query-count/payload-size guards, trace propagation and an internal operations screen. Use Vercel Speed Insights and runtime logs once access is available.
5. **Slim the workspace bootstrap.** Ship an overview endpoint for Today and lazy, paginated endpoints for heavy views. Maintain the current partial-data/last-good-state behaviour.

**Acceptance:** a login does not synchronously import every provider; every source has a current job state; relationship backfill runs without missing-column failures; Inbox and Notifications do not load unrelated data; an operator can follow a failed import by trace ID.

### Milestone B — Mobile-first information architecture

The current responsive shell and bottom navigation are a useful base. Consolidate it around five primary destinations: Today, Inbox, Relationships, Calendar and Settings. Source selection belongs inside Inbox as a compact filter/drawer, not as a permanently expanded navigation tree. Keep Contacts and the Decision Center discoverable contextually from those destinations.

**Acceptance:** no horizontal overflow at 320–430 px; tap targets are at least 44 px; a user can reach any connected source, an approval, a contact and Settings within two intentional actions.

### Milestone C — Proactive intelligence, with approval boundaries

Use the existing analysis metadata, relationship snapshots, communication preferences and `assistant_tasks` to create proposals for:

- urgent or important messages;
- reply and send-time recommendations;
- calendar and route-aware meeting suggestions;
- relationship maintenance and unresolved commitments;
- media/document follow-up.

The system may analyze and propose automatically. Sending, booking, purchasing, sharing documents or acting in Browserbase continues to require the existing policy and approval chain.

### Milestone D — Agent roles on the existing tool layer

Only after Milestone A, package existing capabilities into bounded roles:

| Role | Reuses | May do automatically | Requires approval |
| --- | --- | --- | --- |
| Reliability agent | job state, connections, operations logs | retry safe reads/imports within policy | reconnect, permission change, destructive repair |
| Communication agent | analysis, preferences, relationship context | summarize, classify, draft, prioritize | send or schedule an external message |
| Calendar and planning agent | calendars, maps, contacts, preferences | check conflicts, propose times/routes/places | create/edit invitations or bookings |
| Document agent | vault, extraction and source references | classify, extract and link evidence | share, sign, upload or submit |

Every role emits a task/event record, declares cost and scope, and calls the shared service-policy layer. There should be no autonomous social manipulation and no hidden external action.

## Data, AI and cost controls

- Extract incremental signals when a new message or event arrives; do not resend full histories to an LLM.
- Store source references, concise evidence and analysis/model versions; never duplicate raw private messages merely for scoring.
- Use watermarks, idempotency keys and content hashes to prevent repeat analysis.
- Route low-risk classification, summarisation and extraction to lower-cost models; reserve deeper synthesis for changed or owner-opened cases.
- Add per-owner and per-service budgets before autonomous work becomes broad.
- Make every inference visibly distinct from an owner-confirmed fact and expose confidence/missing evidence.

## Security and privacy gates

- Preserve owner-scoped RLS and service-role-only access for provider secrets/tokens and sensitive operational tables.
- Require the existing MFA/AAL2 model for sensitive Settings, relationship intelligence and approval actions where it already applies.
- Keep raw communication and vault data out of telemetry, audit summaries and error messages.
- Never expose relationship data with public URLs; retain correction, deletion and provenance paths.
- Add rate limits, idempotency and explicit approval claims before any external write.

## Decisions deferred until evidence is available

1. The precise queue/workflow product choice. Existing durable job tables should be normalized first; a Vercel Queue or Workflow decision should follow proven execution durations, retries and plan availability.
2. Exact database index/RLS changes. These require query plans and production workload evidence.
3. Push-notification provider and iOS release work. They depend on notification priority and task lifecycle stability.
4. New external service integrations. They should be evaluated against an explicit owner benefit, permission scope, data-retention impact and cost budget.

## Release discipline

Each milestone gets a dedicated branch, migration review, preview verification, targeted automated tests, rollback notes and a production checklist. Production database migration, cron activation and provider permission changes are separate, explicitly approved operations.
