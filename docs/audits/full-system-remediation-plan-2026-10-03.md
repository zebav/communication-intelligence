# Solvani remediation plan — 3 October 2026

Baseline verified against `main@3749f01` and the production project
`zqcxtsmjhujjsemcwypn`. This is an execution plan, not evidence that every
item below has already been fixed.

## Current production snapshot

| Metric | Verified value |
| --- | ---: |
| People | 2,998 |
| Messages | 2,336 |
| Conversations | 1,976 |
| Identities | 2,319 |
| External contacts | 1,706 |
| Messages without `processed_at` | 119 |
| Connected integrations | 12 |
| Vault jobs | 64 |
| Failed Vault jobs | 31 |
| Pending / processing Vault jobs | 0 / 0 |

The failed Vault jobs are currently recorded as 30 `vault_upload_failed` and
one `audio_transcription_400`. No customer content or credentials were read
for this snapshot.

## Remediation register

| ID | Severity | Evidence and affected component | Confirmed root cause | Fix and migration impact | Regression test and production verification |
| --- | --- | --- | --- | --- | --- |
| REL-01 | P0 | No files existed in `.github/workflows`; a merge had no mandatory test gate. | Confirmed. | Add permanent validation workflow for pull requests and `main`; then require its check through a GitHub ruleset. No database change. | Force a failing local validation change in a throwaway PR and confirm GitHub blocks merge; verify a normal PR reports all five steps. |
| REL-02 | P0 | The first complete validation run against current `main` exposed 15 ESLint errors across API, UI and test code. | Confirmed; the errors prevented a reliable CI gate. | Correct the type, immutable-value and React update-pattern violations without changing product flows. Keep the remaining 17 non-blocking warnings as a separately tracked P2 cleanup. No database change. | Locked install, typecheck, 537 tests, lint with zero errors, and a production build must pass locally and in GitHub Validate. |
| VAULT-01 | P0 | Production has 31 failed jobs; 30 carry only `vault_upload_failed`. Affected files: `src/lib/media/email-worker.ts`, `src/app/api/vault/process-ingestion/route.ts`. | Confirmed loss of diagnostic stage: storage upload, analysis and metadata failures are not consistently distinguished. The provider-specific root cause is not yet proven. | Add a typed ingestion error model, stage/error metadata, retry scheduling, maximum attempts and terminal/dead-letter state. Add an idempotent manual retry endpoint. Requires a migration for lifecycle/diagnostic columns and indexes. | Unit tests for provider download, unsupported MIME, storage error, analysis error, duplicate and retry classification. Replay one copied failed job per provider after the fix and verify one `vault_assets` record at most. |
| MSG-01 | P1 | 119 production messages have no `processed_at`. | Not yet confirmed: this may include legitimate pending analysis and stuck work. | Trace all writers/readers, define a visible lifecycle only if the current fields cannot distinguish waiting from failed. Migration only if new lifecycle fields are needed. | Seed every lifecycle state; Operations must report state, age, safe retryability and reason. |
| DB-01 | P1 | Audit advisor reports 53 foreign-key index candidates; app hot paths join messages, conversations, identities, people and vault assets. | Candidate list is confirmed from advisor, but no individual index is justified yet. | Capture representative query plans and add only indexes that change a hot plan. Migration per approved index. | Store `EXPLAIN (ANALYZE, BUFFERS)` before/after for Inbox, Contacts, conversation, Vault and calendar queries. |
| RLS-01 | P1 | Advisor reports repeated `auth.uid()` / JWT evaluation in owner policies. | Needs policy-by-policy semantic verification. | Replace only equivalent predicates with `(select auth.uid())` or equivalent. No access model changes. | Role-based RLS tests for owner, other user, anonymous and service role; review policy diffs. |
| SEC-01 | P1 | `get_universal_communication_profile` and `save_universal_communication_profile` are exposed `SECURITY DEFINER` functions. | Requires live function-body and caller review before a behavior change. | Prefer server routes; otherwise bind owner to `auth.uid()`, set safe `search_path`, and revoke unnecessary `EXECUTE`. Migration required only after compatibility review. | Test same-user success and cross-owner denial; inspect grants post-deploy. |
| AUTH-01 | P1 | The audit reported leaked-password protection disabled. | Must be rechecked in current Supabase Auth settings. | Enable it if supported and compatible; document any accepted exception. No application migration. | Verify setting in Auth dashboard and test only normal password reset/login flows. |
| DEPS-01 | P1 | Direct dependencies use `latest` in `package.json`. | Confirmed. | Pin the versions currently resolved by `pnpm-lock.yaml`; future upgrades use dedicated PRs. No database change. | Locked install, typecheck, tests, lint and build in CI. |
| OPS-01 | P2 | Operations exists, but failed Vault jobs expose only coarse reason strings. | Confirmed for Vault; broader dashboard coverage needs route-by-route inventory. | Add a unified health contract for connection syncs, queues, failures, retries, budgets and scheduled actions; expose only safe repair actions. Migration may be needed for durable job events. | API contract tests and a production smoke test with no secrets rendered. |
| UI-01 | P2 | `workspace.tsx` controls multiple views and triggers `/api/system/automation` then a fixed eight-second `router.refresh()`. | Confirmed fixed-delay refresh. | Replace with job status plus targeted revalidation; extract feature shells incrementally, beginning with Inbox/Decisions. Restore page-load timing through a render-safe observability path rather than logging during server render. No database migration required for the first extraction. | Component tests for no auto-refresh state jump and mobile visual/browser checks at 320–430px. |
| MOBILE-01 | P2 | Current workspace mixes desktop multi-panel behavior into one central component. | Needs device-by-device measurement before redesign. | Build mobile navigation and decision cards as a feature layer; do not rewrite desktop in the same change. No database migration. | Browser verification of Today → Decision → original message → proposed action → approval at 320, 375 and 430px. |
| AGENT-01 | P2 | Existing intelligence/actions are spread across services and UI paths. | Agent registry/orchestrator does not yet exist as a central contract. | First define structured `AgentContract`, registry and policy-enforced proposal envelope. No agent can send or book directly. Database migration only when durable runs are introduced. | Schema tests, policy tests and audit-log verification for every simulated proposal. |

## Release process

1. Create a feature branch from current `main`.
2. Open a pull request; GitHub Validate must pass.
3. Check Vercel preview and run the relevant browser smoke test.
4. Review, merge, and wait for the production deployment.
5. Run a production smoke test and record any job/data changes in Operations.

## Execution order

1. Land `REL-01`, configure the GitHub ruleset, and pin dependencies.
2. Repair `VAULT-01` with isolated reproduction tests; do not replay failures first.
3. Establish `MSG-01` lifecycle visibility and Operations health contract.
4. Use query plans to perform `DB-01`, then safely normalize RLS under `RLS-01`.
5. Complete security/grants/auth checks in `SEC-01` and `AUTH-01`.
6. Replace the fixed workspace refresh and begin mobile feature shells.
7. Add the agent contract and registry only after the reliability and policy layers are observable.

## Explicitly deferred

- No failed Vault job will be replayed until stage-specific errors and idempotency are implemented.
- No old pull request will be merged without a current-main comparison.
- No new specialist agent will gain direct sending, booking or Browserbase execution rights.
