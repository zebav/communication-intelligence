# Solvani manual MCP bearer tokens

This private integration is for the Solvani owner to connect ChatGPT Desktop or Web to the existing Streamable HTTP MCP server without replacing the OAuth flow.

## Owner setup

1. Sign in to Solvani and complete MFA.
2. Open **Settings → Security → Manage MCP connection**.
3. Choose **Generate new MCP token** and copy the secret immediately. Solvani cannot show the token again.
4. In ChatGPT, create a custom MCP connection:

   - Name: `Solvani`
   - Type: `Streamable HTTP`
   - URL: `https://www.solvani.app/api/mcp`
   - Header key: `Authorization`
   - Header value: `Bearer <PASTE_TOKEN_HERE>`

Leave `MCP_BEARER_TOKEN` empty. No other headers are required.

Use **Test connection** before leaving the token screen. It runs `initialize` and `tools/list` against the production endpoint and confirms that `find_contacts` and `set_contact_avatar` are visible.

## Security model

- The token is generated with `randomBytes(32)`, prefixed `slv_mcp_`, and returned once with `Cache-Control: no-store`.
- Only its SHA-256 hash and an eight-character non-secret fingerprint are stored.
- Token creation, revocation, and listing require an authenticated owner with MFA AAL2.
- The owner is configured by `SOLVANI_PRIVATE_OWNER_ID`, with the existing `CHATGPT_CAPTURE_OWNER_ID` as a backwards-compatible fallback.
- Browser-origin mutations require an exact same-origin `Origin` header.
- Manual tokens are limited to `contacts.read contacts.write`, expire after one year, have a one-minute generation cooldown, and are capped at five active tokens.
- Revocation takes effect on the next MCP request. The MCP route records a best-effort `last_used_at` timestamp and rejects revoked or expired credentials.
- The table is RLS-enabled and service-role-only. The browser never gets direct table access.
- The existing OAuth 2.1 + PKCE flow and the secure contact-avatar storage pipeline stay unchanged.

## Database release

Apply `supabase/migrations/20261009090000_manual_mcp_bearer_tokens.sql` alongside the application release. It creates `public.solvani_mcp_tokens`, its indexes, and service-only RLS/grants.

No plaintext credential should be copied into environment variables, URLs, analytics, audit rows, chat messages, or source control. If a token may have been exposed, revoke it from the MCP settings page and create a replacement.
