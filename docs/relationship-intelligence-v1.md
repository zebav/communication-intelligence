# Relationship Intelligence Engine V1

Relationship Intelligence is a private, owner-scoped layer over the existing
Person Graph. It does not create a separate CRM, duplicate messages, or grant
any new ability to send messages or make bookings.

## What is scored

Each person may have multiple category snapshots. A snapshot keeps three
separate 0–100 scores:

- **Strength** — observed contact, recency, two-way exchange, shared context
  and continuity.
- **Quality** — observable reciprocity, responsiveness and follow-through.
- **Priority** — current owner context, confirmed preference, commitments and
  active relevance. It is intentionally not a closeness score.

The ranking score is a transparent combination of these scores after a
confidence adjustment. Missing information is never treated as positive or
negative evidence.

## Categories and evidence

The V1 categories are romantic, friends, family, colleagues, customers,
suppliers, business partners, professional network, advisors/professional
services and other. Existing confirmed contact relationship types map into
these categories without overwriting the original value. AI relationship
suggestions are only one evidence source; owner corrections have greater
authority.

`relationship_evidence` references the normalized source record and retains a
small derived signal. It never stores a second copy of a private message body.
Supported sources are messages, conversations, commitments, calendar events,
contact context, Personal Context and owner feedback.

## Processing and cost control

New email, Instagram, WhatsApp and Slack analyses refresh the affected
person's derived snapshot after their existing AI analysis is saved. The score
calculation is deterministic and introduces no extra model request.

Historical analysis is a resumable Vercel Cron job. It processes eight people
per run, checkpoints the last person, is idempotent, and has no LLM budget in
V1. It ignores automated senders and does not qualify a weak one-off sender
without a confirmed role.

## Trust boundaries

All tables are owner-scoped and require MFA under RLS. Service-role workers can
write derived data; browser clients cannot access another owner's records.
The feature makes suggestions only. It cannot send, schedule, book or alter
contact data without the existing explicit owner-approved flows.

## V1 limits and next iteration

V1 deliberately avoids psychological diagnosis, attractiveness assessment,
and inference of sensitive traits. Romantic compatibility is not inferred from
photos or unsupported clues. Future V2 work can add LLM-extracted semantic
signals (for example a clearly expressed future plan) only with provenance,
confidence, a model version and incremental processing.
