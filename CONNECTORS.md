# Connectors

Connectors expose capabilities instead of a lowest-common-denominator API. Planned operations include connection validation, synchronization, fetch, draft, send, archive, delete, mark-read, unsubscribe, webhook registration, and webhook processing. Unsupported operations must be declared false and never inferred.

Milestone 1 uses realistic mock and manual-capture data only. Outlook and Microsoft 365 are the next provider milestone; Gmail follows. Meta and other provider capabilities require an official API audit before implementation. Closed platforms use user-reviewed paste or screenshot capture.

## Outlook and Microsoft 365 foundation

The Outlook connector uses the Microsoft identity platform OAuth 2.0 authorization-code flow and Microsoft Graph. The app registration must support accounts in any organizational directory and personal Microsoft accounts. The `/common` authority is used so both Microsoft 365 work or school accounts and private Outlook.com, Hotmail, and Live accounts can connect.

Authorization codes, access tokens, and refresh tokens must only be handled server-side. Tokens will be encrypted before persistence and retrieved through the future centralized `CredentialService`. Delegated access requests `offline_access`, `User.Read`, `Mail.ReadWrite`, and `Mail.Send`.

Initial and incremental mailbox synchronization use Microsoft Graph message delta queries. Delta links are stored per mail folder. Change notifications are capability-declared but remain disabled until webhook validation, subscription renewal, and safe processing are implemented.

The capability definition in `src/lib/connectors/microsoft-graph.ts` is authoritative for the current implementation boundary. Sending is always subject to explicit user approval. Permanent deletion and automatic unsubscribe remain disabled.

The OAuth start and callback routes enforce a validated Supabase owner session and MFA assurance. OAuth uses state validation and PKCE. Access and refresh tokens are encrypted with AES-256-GCM before storage; plaintext tokens are never written to the database or browser.

The signed-in application performs a bounded inbox delta synchronization when the last sync is older than five minutes. The initial window covers the last 30 days in pages of at most 25 messages; subsequent calls resume Microsoft Graph's opaque next or delta link. Stored cursor URLs are restricted to the expected Microsoft Graph HTTPS endpoint before use. This session-bound approach preserves the owner's Supabase MFA/RLS boundary.

Unattended synchronization while the app is closed remains disabled until a narrowly scoped server credential, scheduler policy, monitoring, and token-revocation workflow have been reviewed.
