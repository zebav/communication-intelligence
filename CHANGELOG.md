# Changelog

## Unreleased — Outlook connector foundation

- Reduced the password-to-MFA path by redirecting successful password sign-in directly to MFA.
- Loaded independent MFA status checks concurrently.
- Added a capability-aware Microsoft Graph connector definition for personal Outlook and Microsoft 365 accounts, server-side OAuth, delta synchronization, change notifications, and approval-gated sending.
- Kept permanent deletion and automatic unsubscribe explicitly disabled.

## Milestone 2 — communication cases

- Added a private form for capturing a person, subject, source, and incoming communication.
- Persisted cases across the existing Supabase people, conversations, and messages tables.
- Added a live list of saved cases with owner-scoped, MFA-protected access.
- Reused existing people by name to avoid unnecessary duplicate contacts.
- Added the minimum authenticated table grants required before owner- and MFA-scoped RLS policies are evaluated.

## Unreleased — Secure authentication

- Added cookie-based Supabase authentication for Next.js.
- Added protected application routes and explicit sign-out.
- Added mandatory TOTP enrollment and verification.
- Added automatic owner profile provisioning and AAL2-enforced RLS policies.

## 0.1.0 — Milestone 1 foundation

- Added responsive product shell and core screens.
- Added realistic unified conversation, people, follow-up, and cleanup mock data.
- Added explainable attention scoring and recommended actions.
- Added provider-independent AI service boundary.
- Added initial Supabase schema with RLS and idempotency constraints.
- Added security headers, tests, environment template, and architecture documentation.
