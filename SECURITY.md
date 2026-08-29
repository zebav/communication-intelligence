# Security

## V1 controls

- Production access requires Cloudflare Access and Supabase Auth.
- Public signup is disabled; the owner is manually provisioned and TOTP MFA is mandatory.
- All user-owned database records carry `owner_id` and are protected by RLS.
- OAuth and provider credentials are server-only and must be encrypted before database storage.
- No autonomous external send, delete, unsubscribe, or identity merge is permitted.
- Every consequential action must write an audit event.
- Security headers are configured centrally in `next.config.ts`.
- `.env` variants are ignored; only names are documented in `.env.example`.

## Before production

Configure a strict production CSP without development allowances, implement CSRF defenses for mutation endpoints, rate-limit auth/webhook endpoints, validate webhook signatures, verify MFA assurance server-side, add an explicit owner allowlist, configure token revocation, and run dependency/security scanning. Cloudflare Access must protect only `app.*`; provider webhooks live on the isolated `hooks.*` gateway.
