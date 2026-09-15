# Master calendar foundation — implementation plan

Status: integrated local test candidate; not activated in production.

## Latest local progress
- Outlook read-only calendar adapter added with per-calendar bounded calendarView reads, full pagination, recurring-instance expansion, UTC normalization, declined/cancelled handling and strict pagination-host validation.
- Calendar consent, persistence, reconciliation UI, expiring holds and approved Google master creation/event creation are wired. No production credentials or OAuth console settings changed.
- Outlook all-day events currently retain their returned UTC interval; native original timezone/date presentation must be completed before exposing all-day editing.
- Calendar tests cover provider failures without returning partial snapshots. This is not an end-to-end live-account verification.

## Integrated candidate — setup and verification

Migration: `supabase/migrations/20260915153845_master_calendar_foundation.sql` (additive; no existing tables or mail data changed). Includes owner+MFA RLS, composite owner foreign keys, one master per owner, reservation serialization and activity log. Reviewed locally using `scripts/verify-calendar-db.mjs` with PGlite; not installed remotely.

API: `/api/calendar` (authenticated, MFA, same-origin mutations) and `/api/calendar/connect/google|microsoft`. The Calendar menu stays inside the existing workspace. Data is fetched lazily and separately from inbox loading. OAuth credentials remain encrypted; API output never includes credential fields. Calendar capability records use the provider's account ID and do not alter Gmail/Outlook mail connection records.

Before live testing:
1. Install the additive migration and verify RLS in the target Supabase project.
2. Enable Google Calendar API in the existing Google Cloud project. Add the documented calendar scopes to the OAuth consent configuration.
3. For Preview, register stable preview callback URLs ending `/api/connectors/google/callback` and `/api/connectors/microsoft/callback` in the respective OAuth apps. Set `GOOGLE_CALENDAR_REDIRECT_URI` and `MICROSOFT_CALENDAR_REDIRECT_URI` to those exact URLs for Preview. Production can reuse the existing stable callback URLs. No change to the mail callback variables is needed.
4. Microsoft delegated calendar permission: `Calendars.Read` (plus existing identity/User.Read/offline access). Organization administrator consent may be required.
5. Build one preview deployment. Only then ask the owner to consent, choose their Google account, explicitly create the separate master, discover source calendars and sync/reconcile them.

Existing secrets reused: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT, CREDENTIAL_ENCRYPTION_KEY, Supabase public URL/key. No new provider secret is required.

Verified locally: actual SQL migration and reservation/RLS checks; provider normalization and pagination tests; mocked execution (fresh read → claim → Google insert with deterministic ID and no attendees); uncertain retry recovery; separate scope handling; DST gaps/ambiguities. Browser synthetic harness verified suggestions → hold → review → confirmed state with no console errors. Next production build passed using webpack; Turbopack hit the pre-existing out-of-root node_modules symlink limitation in this worktree.

Limits of this first test candidate:
- Source calendar reads use full bounded 67-day snapshots, not automatic background delta sync. Sync per source before reserving; freshness expires after five minutes.
- External calendars require explicit owner reconciliation; they do not mutate the master automatically. Existing obligations must be transferred/reconciled by the owner before acknowledging.
- Meeting discovery is conservative keyword-based, not a new LLM pipeline. Ambiguous dates need owner selection. No claim of automatic confirmation detection.
- Only event creation is exposed. Editing/cancellation in-app remains future work; changes made in Google are picked up by sync.
- Physical travel remains unknown and blocks booking through this flow; no Routes/Places integration.
- No invitations or messages are sent. Approval creates a private master event only.
- External edits can race the final Google API read/write (Google offers no atomic free/busy-and-insert). Local requests are serialized and retried idempotently; uncertain outcomes stay blocked for inspection.
- Calendar creation itself has no provider idempotency key; an uncertain result is blocked from automatic retry to avoid duplicate calendars.

## Decisions
- Extend V1; never replace existing communications or credentials.
- Separate Google calendar: Communication Intelligence – Master.
- Master events and active internal holds are authoritative blockers.
- External calendars supply requests, not silent master mutations.
- Until existing commitments are reconciled, no slot is bookable.
- Explicit approval for event creation/update; fresh conflict check and idempotency required at execution.
- Physical travel without verified route data is unknown, never zero.
- No Places, Routes, browser actions, payments or automatic external messages.

## Repository review
Existing Google OAuth uses PKCE, state, MFA and encrypted credentials in connections. Calendar must reuse that account identity, but keep granted calendar capabilities separate from Gmail. Existing callback currently records requested Gmail scopes rather than the token's granted scopes: calendar consent must validate the actual grant and preserve Gmail credentials/capabilities when denied or partial.

## Delivery sequence
1. Provider-neutral contracts, scheduling policy and tests.
2. Owner-isolated calendar schema, holds, approvals and audit; migration reviewed before installation.
3. Explicit Calendar consent using existing Google client; calendar list and incremental sync with pagination and 410 recovery. Preserve all-day local dates, recurring exceptions, cancelled events and timezone metadata.
4. Native workspace Calendar (day/week/agenda); reconciliation and calendar selection.
5. Conversation intent -> ranked slots -> internal expiring hold -> reviewed event. Resolve ambiguous dates before proposing; never invent a time.
6. Integration/E2E in a test calendar, release only after approval and double-booking tests.

## Proposed Google scopes (not enabled)
- calendar.calendarlist.readonly: choose visible calendars.
- calendar.events.readonly: inspect events in source calendars.
- calendar.events.freebusy: check source availability for reconciliation.
- calendar.app.created: create a secondary master calendar and manage its events only.
Full calendar scope is not needed. Official source: https://developers.google.com/workspace/calendar/api/auth
Google Calendar API must be enabled in the existing Google Cloud project. Consent screen must document these scopes; the user must explicitly consent. No new Google identity for the same account. No secrets in Git.

## Priority quality audit — 2026-09-15
Read-only production sample: 36 stored incoming Marketing/Newsletter/Spam messages have priority >=8 (23/12/1). Examples reviewed include ordinary retail/event advertising rated 10. These scores predate the latest release, so they do not alone prove a failure in newly applied V3 scoring. No priority_feedback records exist, so learning impact cannot yet be measured. The low-score sample did not establish a missed urgent request; more balanced owner-reviewed labels are needed.
Do not upload private message text or identities into this public repository. Use synthetic equivalents for regression tests. Compare stored message/conversation scores, processing version, explicit sender overrides and current V3 output before any backfill. Do not bulk rewrite ratings without a reviewed dry-run.
