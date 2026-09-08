# Database

## Person memories

`memories` stores conversation-backed candidates separately from verified person context. `user_verified = false` is a review suggestion; only an explicit owner action can change it to `true`. The source-message reference preserves provenance, and the unique candidate index prevents duplicate suggestions during repeated analysis.

## Commitments

`commitments.status` separates AI suggestions from owner-approved open loops. The lifecycle is `suggested` to `open`, then `completed`; rejected suggestions become `dismissed`. All owner decisions are written to the audit log. Source-message uniqueness prevents repeated analysis from creating duplicate follow-ups.

## People intelligence

The People view joins owner-scoped `people`, `identities`, `conversations`, verified `memories`, and open `commitments` into one Personal CRM projection. Profile edits update only existing owner-controlled fields and are audit logged. A verified relationship or priority correction is also applied to existing email relevance scores.

The initial Supabase migration defines profiles, people, identities, connections, conversations, messages, attachments, memories, commitments, and audit logs. Provider identifiers are unique per owner and source, making imports idempotent. Every user-owned table has RLS enabled.

Attachments store metadata and a storage reference; binary content belongs in Supabase Storage. Attachment content is never sent to AI automatically. Provider credentials are encrypted server-side with AES-256-GCM. The application encryption key remains in Vercel secret storage and is never stored in PostgreSQL.
