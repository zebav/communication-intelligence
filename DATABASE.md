# Database

## Person memories

`memories` stores conversation-backed candidates separately from verified person context. `user_verified = false` is a review suggestion; only an explicit owner action can change it to `true`. The source-message reference preserves provenance, and the unique candidate index prevents duplicate suggestions during repeated analysis.

The initial Supabase migration defines profiles, people, identities, connections, conversations, messages, attachments, memories, commitments, and audit logs. Provider identifiers are unique per owner and source, making imports idempotent. Every user-owned table has RLS enabled.

Attachments store metadata and a storage reference; binary content belongs in Supabase Storage. Attachment content is never sent to AI automatically. Provider credentials are encrypted server-side with AES-256-GCM. The application encryption key remains in Vercel secret storage and is never stored in PostgreSQL.
