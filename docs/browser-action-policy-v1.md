# Browser Action Policy V1

This phase introduces the first Browserbase-backed execution boundary for Communication Intelligence.

## Security model

Browserbase `allowedDomains` is treated as a secondary control, not the authoritative policy. Browserbase restricts main-frame navigation to configured domains and their subdomains. It does not block iframe/subframe loads or in-page requests such as images, scripts, XHR, or fetch traffic.

Communication Intelligence therefore keeps its own exact-host policy in front of Browserbase:

1. The planner proposes a concrete HTTPS target.
2. The app normalizes that target to an exact hostname.
3. Local/private targets are rejected.
4. The risk engine decides whether explicit approval is required.
5. Critical actions are never executed by the browser action layer.
6. A Browserbase session is created with the narrowest known `allowedDomains` list.
7. All agent-initiated top-frame navigation must still pass the app's exact-host check.
8. Browser session creation is audited.

## Risk levels

- `low`: non-binding research/read-only activity.
- `medium`: routine form/navigation work without a binding final action.
- `high`: actions with meaningful external effect; explicit user approval is required before a browser session may be created for the action.
- `critical`: payments, legally binding acceptance, or similarly sensitive final actions. V1 refuses execution even when approval is present.

## Browserbase configuration

Required server-side environment variables:

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`

No Browserbase secret is exposed to the client.

## Current endpoint

`POST /api/browser/session`

The endpoint requires an authenticated Supabase session, AAL2 MFA, same-origin requests, a valid public HTTPS target, and successful risk/domain policy evaluation.

It returns only session metadata (`sessionId`, status, expiry, allowed hosts). It does not expose the Browserbase connection URL or credentials to the browser client.

## Browserbase questions still open

The provider has been asked to clarify exact-host behavior, redirects, popups/new tabs, request interception, blocked-navigation events, credential injection, and upload/download controls. Until those answers arrive, app-side exact-host and approval enforcement remain mandatory.

## Next phase

Add a controlled browser runner that:

- validates every requested top-frame navigation against the exact-host policy;
- stops on any unexpected domain transition;
- requires a fresh approval immediately before a high-risk final submit;
- never places credentials, API keys, payment data, or session cookies in model-visible prompts;
- records navigation and action outcomes without storing sensitive page content in audit logs.
