# Solvani Capability & Resource Inventory

**Status:** Release 0 planning baseline. “Implemented” means code exists; it
does not mean a provider account has been authenticated or tested in production.

## Release dependency

| PR | Status | Dependency decision |
| --- | --- | --- |
| #108 — mobile contacts and settings recovery | Open; 32 commits, preview branch | Release 0 candidate. Contains the current recovery, mobile and decision-state work. |
| #107 — secure notification preferences | Open; 1 commit | Contains the same migration file as #108: `20261009170000_notification_preferences_v1.sql`. Do **not** merge it separately. Reconcile/close it after the migration is verified through #108. |

## Verified release boundary — 9 October 2026

The Vercel deployment view confirms the following boundary. This must be kept
explicit during Release 0; a successful Preview is not a production release.

| Environment | Verified revision | State | Meaning |
| --- | --- | --- | --- |
| `www.solvani.app` / Production | `96310be` — “Phase 10: durable notification orchestration” | Ready | The live release is on `main`, not the Release 0 candidate. |
| PR #108 Preview | `9ef8cfb` — “docs: add unified experience release plan” | Ready | This is the current recovery/release candidate and is not yet live. |

### Evidence completed

- PR #107 and #108 were compared: their notification-preferences migration is
  byte-for-byte identical.
- Owner scoping and AAL2 checks are present in the reviewed migration set for
  notifications, automation jobs, assistant tasks, relationship intelligence,
  calendar and vault metadata.
- The targeted automated release suite passed: **46 tests across 11 suites**
  covering decision state, automation jobs, source adapters and media lifecycle.

### Evidence still required before production promotion

- Compare the migration ledger in the connected Supabase project with this
  branch. The local environment has no Supabase CLI or database management
  connection, so repository migrations alone cannot prove they ran.
- Run one approved, low-risk fresh inbound event per connected provider and
  confirm source → person → analysis → decision → shared UI state.
- Complete iPhone journeys using an authenticated Preview session.
- Capture live performance telemetry for login, Inbox and Notiscenter.

## Resources and truthful operating state

| Resource | Implementation and permissions | Used today | Status that still needs evidence | Best next use |
| --- | --- | --- | --- | --- |
| Person Graph / Contacts | Owner-scoped people, identities, contact editing and private avatars | Contacts, Inbox, relationships, decisions | Real multi-channel identity resolution | Canonical person context everywhere |
| Gmail | OAuth, narrow mailbox import, encrypted tokens, drafts and approved send | Inbox, decisions, priority | Fresh production import and reply test | Reply preparation and commitments |
| Outlook | Graph delta import, encrypted tokens, drafts, forwarding and approved send | Inbox, decisions, calendar | Fresh production import and send test | Priority inbox, commitments, documents |
| Instagram | OAuth, webhook/reconciliation, analysis and approved reply | Source inbox, decisions | Meta webhook and current-token test | Social reply preparation |
| WhatsApp | Business webhook, delivery, media queue and approved reply | Source inbox, decisions | New real message and media test | Fast personal communication |
| Slack | User OAuth, DM/channel import, mentions and analysis | Source inbox, decisions | Current workspace scopes and live import | Work/private message routing |
| Calendar | Google/Microsoft read, Solvani-owned writes, availability and planning | Calendar, decision preparation | Connected-account and invitation tests | Meeting plans and travel-aware alternatives |
| Maps / Routes / Weather | Server-side Maps budget/policy layer | Meeting preparation | API key/quota/live response test | Place, route and weather-aware plans |
| Documents & Media Vault | Private storage, provenance, analysis and lifecycle jobs | Documents, decisions, contacts | Real image/PDF/audio/video ingestion | Evidence before drafting or executing |
| Personal Context / Knowledge Vault | Encrypted, owner-scoped facts and controlled grants | Settings and AI context | Field-level consent and retrieval tests | Minimal task-specific context |
| Relationship Intelligence | Evidence, snapshots, feedback and resumable backfill | Relationships, priority inputs | Backfill migration and real-history test | Contextual priority and maintenance suggestions |
| Decision & Execution | Persisted tasks, approval claims, audit trail, provider executors | Inbox, Notiscenter, Decision Center | Full provider round trips | One canonical decision state |
| Browserbase | Exact URL/host guardrails, approval claims and budgets | Approved web tasks | One approved low-risk production run | Forms and research after approval |
| Automation jobs | Owner-scoped queue, idempotency, retries, stale-job recovery | Background maintenance, Operations | Production cron and recovery observation | Source orchestration |
| Notifications | Shared task state, orchestration and preferences schema | Notiscenter | Native/iOS delivery is not active | Context-aware in-app notices |

## Non-negotiable truth rules

1. A service is **operational** only after a real, current source event has
   reached its intended view and its operation status is healthy.
2. An AI inference is never promoted to a verified personal fact without its
   source, confidence and owner correction path.
3. Private vault content is retrieved by task scope, not bulk-loaded into
   generic prompts or UI state.
4. New providers are deferred until existing sources pass their live checks.

## Release 0 readiness matrix

| Area | Implemented | Configured/connected | Real-world tested | Operational | Current gate |
| --- | --- | --- | --- | --- | --- |
| Mobile contact and Settings recovery | Yes | Preview | Partial | Preview only | iPhone acceptance test |
| Canonical decisions | Yes | Preview | Mocked/targeted tests | Preview only | Cross-view live action test |
| Background recovery | Yes | Vercel Preview | Targeted tests | Pending production observation | Cron and operation history |
| Gmail / Outlook | Yes | Account-dependent | Not proven in this audit | Unknown | Receive/import/decision test |
| Instagram / WhatsApp / Slack | Yes | Account-dependent | Not proven in this audit | Unknown | Receive/import/media test |
| Media & documents | Yes | Account-dependent | Targeted tests | Unknown | Real asset lifecycle test |
| Relationships | Yes | Migration-dependent | Not proven in this audit | Blocked pending schema parity | Apply/verify migrations |
| Production release | No | — | No | No | PR reconciliation and approval |
