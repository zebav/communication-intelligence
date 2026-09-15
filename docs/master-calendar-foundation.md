# Master calendar foundation — implementation plan

Status: in development; not activated in production.

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
