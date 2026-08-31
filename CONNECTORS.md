# Connectors

Connectors expose capabilities instead of a lowest-common-denominator API. Planned operations include connection validation, synchronization, fetch, draft, send, archive, delete, mark-read, unsubscribe, webhook registration, and webhook processing. Unsupported operations must be declared false and never inferred.

Milestone 1 uses realistic mock and manual-capture data only. Gmail is the next provider milestone; Outlook follows. Meta and other provider capabilities require an official API audit before implementation. Closed platforms use user-reviewed paste or screenshot capture.

## Gmail foundation

The Gmail connector uses Google's OAuth 2.0 web-server flow. Authorization codes, access tokens, and refresh tokens must only be handled server-side. Tokens will be encrypted before persistence and retrieved through the future centralized `CredentialService`.

Initial synchronization uses Gmail's full synchronization flow. Subsequent synchronization uses `history.list` with the last durable history ID. A history ID outside Gmail's available range requires a new full synchronization. Push notifications use `users.watch`; the watch must be renewed before its expiration.

The capability definition in `src/lib/connectors/gmail.ts` is authoritative for the current implementation boundary. Sending is always subject to explicit user approval. Permanent deletion and automatic unsubscribe remain disabled.

The OAuth callback and live mailbox synchronization are not enabled until Google Cloud credentials, redirect URIs, encrypted token storage, and a sandbox mailbox have been configured.
