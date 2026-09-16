# Physical meetings and reviewed invitations

## Included

- Open a master-calendar appointment in the day/week/month board, then **Redigera mötet**. The editor scrolls into view and receives focus.
- Edit title, description and participant email addresses; move a one-off meeting with a new availability check; cancel with a separately reviewed participant update.
- New meeting composer: explicit times, guest list and description; physical meetings add selected Google place IDs, a user-authored invitation location, departure and onward/return destination.
- Both travel legs are checked before reservation and checked again before booking/moving. The full user-selected travel window is reserved (up to three hours on either side), including preparation/recovery. Private origin/onward locations are not sent to guests.
- Recipient approval is separate from calendar approval. Google `sendUpdates=all` is used only with a reviewed guest list. Acknowledgement means Google accepted the request, not inbox delivery.
- Immutable proposal details, conditional ETag writes, deterministic create IDs, and unknown-outcome recovery prevent accidental retry sends. RSVP data is preserved for retained guests.

## Deployment

Apply `20260916005059_calendar_meeting_details.sql` before the new app. It adds nullable fields and extends action kinds; old app versions remain compatible. No existing appointments are changed by the migration.

`CALENDAR_MAPS_ENABLED=true` and the existing server key enable Places/Routes. The database-backed usage reservation runs before each provider call, with shared estimated USD 5/month, USD 1/day and 20 requests/minute caps. These are application limits, not a guaranteed Google invoice cap. Interactive browser Maps remains disabled independently.

## Deliberate limits

External-source events remain read-only. Recurring series and all-day moves must be edited in their original calendar. Physical moves must not overlap the original booking; that time remains occupied until the move succeeds. Travel windows block this application's scheduling, but do not create separate Google travel events or guest invitations.

All enabled calendars must be fresh and externally sourced commitments must be reviewed. This release does not automatically attest that review or send invitations in response to untrusted message text.

## Verification

Calendar unit tests cover normalization, recipient approval, RSVP preservation, exact typed times, unknown-outcome recovery and a physical move rejected after changed travel evidence. The PGlite migration suite checks immutable details and the existing owner/MFA/conflict protections. The isolated browser harness exercises board → editor → review → approval with synthetic responses only. No real guest invitation has been sent in these checks.
