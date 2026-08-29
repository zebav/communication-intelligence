# Database

The initial Supabase migration defines profiles, people, identities, connections, conversations, messages, attachments, memories, commitments, and audit logs. Provider identifiers are unique per owner and source, making imports idempotent. Every user-owned table has RLS enabled.

Attachments store metadata and a storage reference; binary content belongs in Supabase Storage. Attachment content is never sent to AI automatically. Provider credentials use a centralized future `CredentialService`; the schema contains only an encrypted server-side payload.
