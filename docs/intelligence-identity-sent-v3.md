# Relevance, Contact Identity and Sent Messages

This phase follows PR #49 on `fix/channel-reliability-mobile-v1-active`.

## Activation order

1. Apply `supabase/migrations/20260915141418_intelligence_identity_sent_v3.sql` to the shared database after reviewing it.
2. Deploy the complete branch as Preview and verify it with an authenticated owner session.
3. Confirm email and social priority correction, contact merge/undo, and Sent Messages filters before merging.

## Behavior

- Import scoring considers actionable content before relationship/history/unread boosts. Promotional urgency does not by itself create a task.
- AI analysis uses the shared scoring guard for every channel using the common AI service.
- Explicit message priority corrections survive subsequent analysis and imports. Two distinct corrections in the same contact/source/category influence later scored messages by 25%. Explanations are retained for review; the system does not infer universal preferences from one correction.
- Contact matching suggests identical names or identifiers. Batch automatic merging requires identical full names, person entity types, and matching verified non-role email addresses. Other suggestions need explicit confirmation.
- Matching runs when the contact matching screen is opened or refreshed. Automatic merging is an on-demand batch, not a background scheduler.
- Merge operations run atomically under owner/MFA checks. Original contact profiles are retained and hidden from the workspace list, while identities and related records move to the destination. Original fields remain visible on its contact page. Undo restores recorded associations without deleting later messages. A destination with active merges cannot itself be merged until those merges are undone.
- Sent Messages reads outgoing records separately from the workspace, 50 per page, with person/source/account/date filters. It covers records imported or sent by the app, not provider history that has never been imported. Dates use explicitly labeled UTC boundaries.
- Delivery/read states are provider evidence. A later incoming message is labeled as such rather than asserting it specifically answered an outgoing question. The owner can mark whether a reply is expected.

## Verification

- TypeScript and unit tests: `pnpm typecheck`, `pnpm test`.
- Production build: `pnpm exec next build --webpack`.
- Database verification: `scripts/verify-intelligence-db.mjs` uses PGlite (tested with 0.3.14). Install it in a disposable test directory and set `PGLITE_MODULE` to that installation's module URL. The script runs against an in-memory database, never production. It checks SQL execution, merge/undo, preserved notes, owner isolation, MFA, RLS and correction persistence.

## Known boundaries

The workspace's existing initial 100-email/300-contact limits are unchanged. Sent Messages paginates independently; matching reads contacts in batches. Existing stored AI assessments are not bulk-reanalyzed during deployment. New analyses use V3.
