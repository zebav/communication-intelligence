# Master Calendar & Scheduling Intelligence V2

Status: **integrated development candidate; not ready for production or full user acceptance**.
Branch: `phase/master-calendar-scheduling-v2`, based on calendar foundation PR #51.
Do not merge into main before the foundation and the remaining release gates below are satisfied.

## Implemented in the first integrated block

- Owner/MFA-protected saved planning rules: weekdays, local start/end, notice, daily occupied-time budget and minimum preparation/recovery.
- Suggestions apply these rules server-side. Reservations made through the calendar endpoint are rechecked against current rules; DB conflict/MFA guards remain in place.
- Complete-snapshot, sequential sync-all UI with per-source progress and explicit partial failure. This is **manual**, not background sync.
- External-commitment review: exact title/time/location match suggestions, conflicts, missing and informational events. No automatic merge, copy or approval.
- Explicitly approved copy of a future missing commitment: stable Google event ID, source fingerprint recheck, source/master mapping, compare-and-set claim and shared DB lock against overlapping transfers/holds. Uncertain outcomes require lookup, never a blind second insert. No attendees/invitations; source remains unchanged.
- Distinguish possible cancellation/change from proposals; multiple explicit dates remain ambiguous. This is a conservative rules-based discovery, **not the finished AI intent extraction**.
- Provider-neutral Places/Routes interfaces and Google Places (New)/Routes adapters with minimal field masks, fixed hosts, bounded requests, separate travel/preparation/recovery, no persistent raw Places cache.
- Place search and route research UI behind a disabled-by-default server feature gate. Research alone cannot authorize or book a physical meeting.
- Additive preferences migration, tested in local PGlite. Not applied to production.

## Required next implementation, before user acceptance testing

### Second integrated block (local, not activated)

- Durable per-account background queue, 90-second fenced leases, exponential retry, one bounded source fetch per tick and snapshot compare-and-set. Failed or superseded fetches cannot erase newer data. Credential refresh is serialized per account.
- Dedicated authenticated POST `/api/cron/calendar-sync`, disabled until `CALENDAR_BACKGROUND_SYNC_ENABLED=true` and `CALENDAR_SYNC_SECRET` are configured. A scheduler is **not installed**. Intended activation is a server-side scheduler calling this endpoint, not browser polling; verify the scheduler and secrets before enabling it.
- Persisted conversation proposals with exact message quotations, stable input hashes and dismissals. No booking tool is exposed to the model. Dates not literally grounded in evidence require manual clarification. Uses the existing Responses API with `OPENAI_CALENDAR_MODEL` or `OPENAI_FAST_MODEL`; no new SDK or live model calls in verification.
- Prepared rename/cancel actions for one-off master events without attendees. Fresh provider read, immutable review plan, explicit approval, `If-Match`, no invitations, and uncertain-write recovery without automatic duplicate writes. Moving event times is not implemented yet.
- Additional release migrations: `20260915225449_calendar_background_sync.sql`, `20260915225656_calendar_approved_actions.sql`, `20260915225904_calendar_intent_proposals.sql`. Apply in order with the coherent release, not independently of its code.

### Third integrated block (local, not activated)

- Master event moves reuse serialized reservations and require a separate approval. The original event remains unchanged until a conditional PATCH succeeds. A move hold cannot be confirmed as a new booking. Completed/uncertain moves recover only at the exact approved time; dismissal releases the target reservation atomically.
- Saved proposed/executing actions can be reopened from the same master event after navigation. One-off events without attendees or a physical location only. The original slot remains occupied during planning, so overlapping shifts are conservatively excluded.
- Two-leg travel assessment ties exact selected place IDs, departure, meeting, onward-arrival deadline and mode together. Both routes, buffers, stale estimates and conflicts during travel are checked. Research returns `canReserve:false`: it is not yet a persisted authorization for physical booking. No paid calls made.
- Migration `20260915230729_calendar_move_plans.sql` adds immutable move targets and atomic reservation status transitions. Verified with local PGlite, including conflicting reservations and declined-plan release.
- Synthetic browser tested: select move → choose day → select slot → review old/new times → approve → visible confirmation. This verifies the client contract, not live Google writes. Real provider service tests use mocked responses separately.

The list below describes remaining acceptance gates; parts noted above have local implementations, not live verification.

1. Background sync: decide a scheduler compatible with the actual deployment plan. Add durable per-account claims, bounded retries, last attempt/success, renewal where relevant, no overlapping refresh-token writes, preserve snapshots on failure. No frequent Hobby cron or UI polling presented as background sync.
2. Complete commitment lifecycle: approved copy is implemented, but changed/cancelled originals still need persistent review items, exclusion decisions and explicit master update/cancel plans. Add mocked end-to-end service tests including provider timeouts and changed source between read/write. No silent move or delete.
3. AI intent proposals grounded in actual conversation/message IDs and timestamp, timezone and evidence. Ambiguous dates/locations require clarification; cancellation never becomes a new booking. Prepared replies may cite only verified offered slots.
4. Physical scheduling: time-bound origin/next destination, validate **both** route legs, persist approved route evidence with expiry and plan fingerprint; repeat conflict/route checks before confirm. Current `physical` holds intentionally remain disabled.
5. Verify rename/cancel/move flows end-to-end in a configured preview with explicit approval for test events. Invitations and outgoing messages require separate explicit approval. Provider edits exist in code but were not run against real calendars.
6. Surface pending scheduling plans in Overview with links to the native calendar, not a disconnected second application.
7. Full local API + UI tests with provider failure/timeout scenarios, then one coherent preview. Do not ask user to test paid Maps features before configuration is complete.

## Activation prerequisites (do not activate automatically)

### Maps decision and verification — 2026-09-16

- User approved shipping this candidate with the interactive map disabled. Keep `CALENDAR_BROWSER_MAPS_ENABLED` unset/false independently of `CALENDAR_MAPS_ENABLED`.
- Google Cloud displayed Maps JavaScript daily loads as unlimited/non-adjustable. The browser key is website/API restricted, but our server counter alone is not a hard billing cap for a public browser key. Do not present the approximately SEK 100/month target as guaranteed.
- Server and separate browser key names were verified in Vercel Preview and Production; no redeploy or paid request was made during this verification.
- New contact/place context links existing master bookings to owned contacts and optional conversation IDs, with revision conflict protection. Contact cards show linked calendar entries. No invitations are sent.
- `20260915232306_calendar_contact_places.sql` and `20260915235716_calendar_maps_budget.sql` are required along with preceding V2 migrations. All remain unapplied to the live project.
- Shared service-only budget reservations reject failed/missing counters, include failed provider calls, and serialize preview/production usage. Estimated server-side ceilings are USD 5/month and USD 1/day with 20 requests/minute. These are application controls, not Google account-wide billing limits.
- Weather and interactive map are implemented for selected planning places; weather advice never changes bookings. Routes/Weather API activation, live provider checks, scheduler installation and remaining acceptance gates are still outstanding.
- Verification: 90 calendar tests passed; PGlite security, ownership, revisions and budget tests passed; scoped ESLint and Next webpack build passed. No real calendar writes were performed.

- Apply `20260915223834_calendar_scheduling_v2.sql` only with the coherent V2 release.
- Google Maps billing/API activation requires user's explicit cost approval.
- Server-only `GOOGLE_MAPS_SERVER_API_KEY`, restricted to Places API (New) and Routes API; never NEXT_PUBLIC.
- `CALENDAR_MAPS_ENABLED=true` only after approval, quotas/rate limits and required Google Maps attribution/privacy review. Default unset/false makes **no paid API calls**.
- Dedicated scheduler still to be selected and verified. No V2 cron has been registered.
- Existing calendar OAuth setup is reused. Do not replace Gmail/Outlook mail scopes or create another master.

## Verification evidence

- Calendar unit suite including DST, notice, daily budgets, overlapping-event union, reconciliation, ambiguous dates, Places/Routes mocked responses and both travel legs.
- PGlite: original calendar security/conflict tests plus preferences owner isolation.
- TypeScript, scoped ESLint, Next webpack production build.
- Local synthetic browser: planning fields render; saved minimum preparation flows back to suggestion inputs; Maps disabled notice renders. Synthetic browser test is not proof of live provider integration.

## Known limitations to address before release

- Planning rules are enforced at the app endpoints, not yet in the reservation DB trigger; direct owner-authenticated Data API writes can bypass planning preferences (not owner/MFA/conflict protections). Add server-owned proposal/approval validation before enabling autonomous execution.
- Daily budget currently counts occupied minutes inside the configured planning window, including hold buffers. General event buffers and all-day handling need final acceptance rules.
- A transferred recurring occurrence is a one-off master copy, not an independently cloned recurrence series. Original notes/attendees are not copied. The source mapping must support viewing original details in the finished UI.
- Sync-all runs while the view remains open. No claim of automatic sync until a scheduler is operating.
- Full V2 is not finished. No deployment, production migration, real calendar modification, invitation or paid Maps request was performed by this block.
