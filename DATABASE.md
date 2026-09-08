# Database

## Person memories

`memories` stores conversation-backed candidates separately from verified person context. `user_verified = false` is a review suggestion; only an explicit owner action can change it to `true`. The source-message reference preserves provenance, and the unique candidate index prevents duplicate suggestions during repeated analysis.

## Commitments

`commitments.status` separates AI suggestions from owner-approved open loops. The lifecycle is `suggested` to `open`, then `completed`; rejected suggestions become `dismissed`. All owner decisions are written to the audit log. Source-message uniqueness prevents repeated analysis from creating duplicate follow-ups.

## People intelligence

The People view joins owner-scoped `people`, `identities`, `conversations`, verified `memories`, and open `commitments` into one Personal CRM projection. Profile edits update only existing owner-controlled fields and are audit logged. A verified relationship or priority correction is also applied to existing email relevance scores.

The initial Supabase migration defines profiles, people, identities, connections, conversations, messages, attachments, memories, commitments, and audit logs. Provider identifiers are unique per owner and source, making imports idempotent. Every user-owned table has RLS enabled.

Attachments store metadata and a storage reference; binary content belongs in Supabase Storage. Attachment content is never sent to AI automatically. Provider credentials are encrypted server-side with AES-256-GCM. The application encryption key remains in Vercel secret storage and is never stored in PostgreSQL.

## Learning signals

`learning_signals` separates observed behavior from approved communication rules. Each row has a source, signal type, proposed rule, confidence, optional person and conversation scope, and a `suggested`, `approved`, or `dismissed` status. Repeated pending conclusions for the same person are consolidated into one review item with an evidence count. Row-level security and all review actions require the authenticated MFA-verified owner. Suggested or dismissed rows never influence AI prompts; only approved rows can be selected as bounded context.

## Communication outcomes

`communication_outcomes` links one tracked result to the outgoing message that initiated the wait and optionally the later incoming response. It stores deterministic response timing separately from the owner's assessment. Automatic synchronization can move `waiting` to `reply_received`; only an authenticated MFA-verified owner can confirm success, change the desired outcome, mark resolution or follow-up, or delete the record.
