# Production readiness checkpoint — 10 October 2026

This checkpoint distinguishes an implemented connector from a verified
production workflow. It intentionally contains no account identifiers,
message content, provider tokens or private owner data.

## Evidence gathered

- Production was available through `www.solvani.app` with the authenticated
  Today view and its persisted decision surface loading.
- Gmail and Microsoft mail imports completed from connected accounts during the
  scheduled worker pass.
- Instagram reconciliation, Slack import/analysis, WhatsApp recovery, media
  analysis and calendar synchronization completed during the same observed
  window without a source-worker failure.
- The media worker reported no active queue items in that observed pass.
- The 11:25 CEST scheduled pass completed every observed source worker without
  an error. Slack reconciliation completed in 0.86 seconds. Instagram
  reconciliation completed in 3.67 seconds and correctly skipped six already
  imported messages before person/conversation processing. The immediately
  preceding pre-optimization Instagram pass took roughly 12 seconds; the
  pre-optimization Slack pass observed in the same operational window took
  roughly 23 seconds. These are production observations, not synthetic timing
  claims.
- The follow-up detector previously failed before reading its ledger because
  the server-only worker lacked a table grant. Migration
  `20261010105000_background_decision_worker_grants.sql` restores only the
  necessary service-role permissions. The production database grant check
  returned true for outcomes read, learning read/update, task read/insert/update
  and audit insert.

## Current readiness matrix

| Capability | Implemented | Connected | Observed in production | Operational status | Remaining proof |
| --- | --- | --- | --- | --- | --- |
| Gmail ingestion | Yes | Yes | Scheduled import completed | Operational, subject to new inbound-event test | Confirm one new real inbound message reaches a prepared decision |
| Outlook ingestion | Yes | Yes | Scheduled import completed | Operational, subject to new inbound-event test | Confirm one new real inbound message reaches a prepared decision |
| Instagram ingestion | Yes | Yes | Reconciliation completed | Operational, bounded reconciliation | Confirm a newly received DM and profile enrichment |
| WhatsApp ingestion | Yes | Yes | Recovery completed | Operational when webhook delivery succeeds | Confirm a newly received text and a media item |
| Slack ingestion | Yes | Yes | Import/analysis completed | Operational for approved read scopes | Confirm a new DM or mention routes to a decision |
| Media and document lifecycle | Yes | Account-dependent | Worker healthy and queue empty in observed pass | Degraded until a real current asset completes end-to-end | Confirm image, PDF, audio and video rendering/analysis |
| Canonical decision state | Yes | N/A | Live Today decision surface | Operational for persisted tasks | Verify one decision state transition across Inbox, Notiscenter and Decision Center |
| Follow-up detection | Yes | N/A | Permission repair and duplicate-race recovery applied | Operational, subject to live task-transition test | Confirm a newly eligible follow-up appears once |
| Autonomous learning | Yes | N/A | Completed safely after permission repair | Operational, review-gated | Confirm a new owner correction produces the expected learning candidate |
| Native iOS push | Architecture only | No | No | Not active | Device registration, permission, delivery and deep-link verification |

## Current constraints

1. A successful connector tick proves that the worker ran, not that every
   provider has delivered a fresh message or media asset.
2. External communication, booking, payment, signing and destructive actions
   remain approval-bound.
3. Profile information that a provider does not disclose is shown as a neutral
   channel contact rather than an internal imported identifier. It must still
   be confirmed or matched before being treated as a verified identity.
4. The remaining product work is UX consolidation and live acceptance testing,
   not another parallel decision or contact system.
