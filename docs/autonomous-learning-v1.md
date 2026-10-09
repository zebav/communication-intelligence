# Autonomous Learning V1

Autonomous Learning V1 extends the existing `learning_signals` ledger. It does
not introduce a second memory database or a second agent runtime.

## Safe operating boundary

Only a repeated low-risk reply-style signal can be applied automatically:

- signal type is `draft_accepted` or `draft_edited`;
- confidence is at least 0.75;
- the same evidence-backed rule was observed at least three times; and
- the item is classified `personal`, never `sensitive` or `restricted`.

Automatic learning is autonomy level 1: it prepares future reply guidance. It
cannot send a message, book an event, delete content, change an integration,
or make a sensitive relationship, health, legal, financial or credential claim.
Everything else remains review-required.

## Provenance and correction

Every learning signal keeps its source, evidence summary, confidence, fact
state, sensitivity, version, correction count and validation timestamps. The
original message remains in its existing source store; the ledger contains no
copied message body. Owner corrections and dismissals remain authoritative and
are audit logged.

## Background operation

`/api/cron/autonomous-learning` runs every 15 minutes and only promotes eligible
existing signals. It is idempotent, owner-scoped when dispatched through the
durable automation queue, and records `learning.auto_applied` in the audit log.
The route is protected by the existing cron authorization and returns no message
content. It is safe to run while the owner is offline.

## Release order

1. Apply `20261009140000_autonomous_learning_v1.sql`.
2. Deploy the application and verify one cron run in Vercel logs.
3. Confirm that a routine signal appears in **Settings → Learning & Memory**
   with the **Automatiskt sparat** label only after the third observation.

If the migration has not yet been applied, do not deploy code that queries the
new learning columns.
