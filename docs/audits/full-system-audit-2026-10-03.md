# Full System Audit — 2026-10-03

Baseline: `main@3749f01005c96461298d7503a5a6afa6e9b29fb6`

This is an audit branch only. Findings below are evidence-backed and no production behavior is changed by this document.

## Scope observed

- 514 repository files
- 404 TypeScript/TSX files
- 82 API route handlers
- 101 test files
- 48 SQL migration files
- Supabase production database and built-in Security/Performance advisors
- current Vercel configuration and production deployment status
- open pull requests / branch hygiene
- live operational counts for messages, contacts, assistant tasks and Vault ingestion

## Executive findings

### P0 — Release safety: main has no GitHub CI workflow

`.github/workflows/` is empty on main. Validation workflows used during recent feature work were temporary and deleted before merge. Vercel verifies that the application can build, but there is no persistent branch check that guarantees typecheck + unit/integration tests + lint before every future merge.

Impact: a change can merge to main even if tests or lint would fail.

Action: add a permanent `ci.yml` required check for install, typecheck, tests and lint. Add branch protection/ruleset after the check exists.

### P0 — Vault ingestion is materially unhealthy

Live production:
- 64 ingestion jobs total
- 33 done
- 31 failed
- 30 failures report `vault_upload_failed`
- 1 reports `audio_transcription_400`
- failed jobs are concentrated in Gmail (25) and Microsoft Graph (5), plus one WhatsApp/YCloud audio case.

Message metadata also contains earlier failure reasons including `document_analysis_400_invalid_value` and `outlook_attachments_400`.

Impact: the Secure Document & Media Vault is not reliably ingesting important mail attachments despite channels being connected.

Action: instrument stage-specific errors instead of collapsing them to `vault_upload_failed`; fix Gmail document-analysis request validation and Outlook attachment 400s; introduce bounded retry/backoff and a dead-letter/retry UI; replay failed jobs only after the root causes are fixed.

### P1 — Database performance debt is already visible

Supabase advisor reports 53 foreign keys without covering indexes. Examples include:
- `assistant_tasks.message_id`
- `attachments.message_id`
- `conversations.person_id`
- `conversations.connection_id`
- `identities.person_id`
- `messages.sender_identity_id`
- `people.avatar_asset_id`
- multiple commitments/outcomes/memory/contact relations.

Live statistics show high sequential scan counts in identity/conversation-related tables even at the current small scale.

Impact: Contacts, Inbox, joins, deletes and synchronization will become slower as message/contact volume grows.

Action: add indexes based on actual query paths, starting with the high-read relationship columns above; validate with `EXPLAIN (ANALYZE, BUFFERS)` on representative queries.

### P1 — RLS policy performance needs normalization

Supabase advisor reports many RLS policies that re-evaluate `auth.uid()` / auth functions per row. This includes assistant tasks, calendar tables, vault tables, service policies and contact tables.

Action: migrate policies to the `(select auth.uid())` / `(select auth.jwt())` form where semantics are unchanged.

### P1 — SECURITY DEFINER RPC surface needs explicit review

Two public-schema functions are SECURITY DEFINER and executable by `authenticated`:
- `get_universal_communication_profile()`
- `save_universal_communication_profile(profile_data jsonb)`

This may be intentional, but because they are exposed through the Data API they need a dedicated authorization review. If direct client RPC access is not required, revoke authenticated EXECUTE or move the privileged operation behind a server route.

### P1 — Auth leaked-password protection is disabled

Supabase advisor reports leaked-password protection disabled.

Action: enable it in Supabase Auth unless there is a deliberate compatibility reason not to.

### P1 — Package reproducibility risk

`package.json` uses `latest` for Next, React, Supabase, Zod, lucide and multiple development dependencies.

The lockfile protects an existing install, but dependency refreshes can silently introduce major-version changes and make future maintenance/recovery less deterministic.

Action: pin direct dependencies to explicit versions and use controlled dependency-update PRs.

### P1 — Open PR / stale branch hygiene

Open PRs currently include #46, #54, #55 and #58. Several overlap areas that have since evolved substantially (browser policy, executive assistant, Microsoft OAuth, CSP).

Action: reconcile each against current main; close obsolete PRs, extract only still-needed commits, and avoid accidental later merge of superseded architecture.

## P2 — Frontend architecture / performance

### Monolithic workspace

`src/components/workspace.tsx` remains the central UI coordinator for navigation, Inbox, Contacts, settings, AI planning and numerous action flows. Some large sections are dynamically imported, which is good, but the parent still owns broad state and imports a large number of domain/action modules.

Risks:
- high regression surface
- difficult mobile-specific iteration
- broad re-render scope
- harder ownership/testing boundaries.

Action: split route/view controllers into feature shells (Inbox, Contacts, Settings, Overview) and move view-specific state/hooks into each feature.

### Automatic post-login automation + fixed refresh

Workspace starts `/api/system/automation` 350ms after mount and schedules a full router refresh eight seconds after a successful response.

Risk: unnecessary refreshes, visible state jumps, duplicate server work and wasted reads if background processing takes materially less/more than eight seconds.

Action: return a job/run id and poll lightweight status, or update only affected data via targeted refresh/revalidation.

### CSS has grown into a broad global surface

The application now has a very large global stylesheet plus a mobile stylesheet and feature CSS. This increases collision/regression risk as the product grows.

Action: keep design tokens global but migrate feature styles toward CSS modules or feature-scoped styles; add visual regression coverage for critical mobile/desktop views.

## P2 — Database/index cleanup

Supabase reports:
- 3 duplicate-index groups
- 17 currently unused indexes.

Do not blindly delete unused indexes from a young system; some may protect infrequent but important paths. Duplicate indexes, however, should be reconciled after confirming constraint dependencies.

## P2 — RLS “enabled, no policy” findings require classification

11 tables have RLS enabled with no policies, including Browserbase internal ledgers, `vault_media_references`, private calendar dispatch tokens and OAuth token/code tables.

Several are intentionally service-role-only and therefore “no client policy” is a valid deny-by-default design. The audit should document those explicitly so future maintainers do not “fix” them by adding unsafe authenticated access.

## Live-data observations

- 1 auth user
- 2,998 people
- 2,336 messages
- 1,976 conversations
- 2,319 identities
- 1,707 external contacts
- message mix: 2,082 email, 115 Instagram, 91 WhatsApp, 45 Tinder, 3 Messenger
- 119 messages currently have `processed_at IS NULL`
- 12 connections report `connected`
- assistant tasks are mostly dismissed; only one reply is in decision and one in ready state.

The gap between 2,998 people and 2,336 messages is not automatically a bug because contact sync imports address books, but Contacts performance and duplicate-resolution behavior should be stress-tested around the ~3k-contact scale.

## Audit workstream

1. **Release gate first** — permanent CI + branch protection.
2. **Repair live ingestion failures** — Gmail/Outlook Vault pipeline and retry observability.
3. **Database hot-path optimization** — indexes + RLS policy optimization.
4. **Security hardening** — SECURITY DEFINER RPC review, leaked-password protection, service-only table documentation.
5. **Backend correctness sweep** — all 82 API routes: auth, origin/CSRF, owner scoping, idempotency, retries, timeouts, provider errors, external side effects.
6. **Frontend UX sweep** — desktop/mobile Inbox, Notiscenter, Contacts, Calendar, Settings, loading/error/empty states and optimistic updates.
7. **Performance sweep** — server query counts, payload sizes, client bundle boundaries, unnecessary router refreshes, sync jobs.
8. **Connector E2E matrix** — Gmail, Outlook, Instagram, WhatsApp/YCloud, calendar, Maps, Browserbase, Vault.
9. **Architecture cleanup** — stale PRs/branches, dependency pinning, split monolithic Workspace.
10. **Regression suite** — turn every reproduced production bug into a permanent automated test before the fix merges.

## Definition of done

The audit is complete only when each finding has:
- severity
- reproducible evidence
- affected component
- root cause
- fix or explicit accepted-risk decision
- automated regression coverage where applicable
- production verification after merge.
