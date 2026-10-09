# Solvani agent architecture V1

Solvani uses one application and one approval chain. Agent roles are policy
boundaries around existing services, not independent bots or new stores of
private information.

## Execution model

1. A connector or scheduled worker writes normalized owner-scoped data.
2. The relevant intelligence role prepares a deterministic result or an AI
   recommendation using the stored, bounded context.
3. The Decision & Execution Center presents the recommendation and the exact
   proposed external effect.
4. Existing approval, MFA, service-policy and execution safeguards decide
   whether an external action may proceed.
5. The outcome is persisted and auditable.

No role can send a message, make a booking, sign a document or move money on
its own. The registry only permits `read`, `suggest`, or `prepare`; it never
grants an execution permission.

## Role ownership

| Durable work | Accountable role |
| --- | --- |
| Gmail, Outlook, Instagram, WhatsApp and Slack intelligence | Communication Intelligence |
| Calendar synchronization | Calendar & Scheduling |
| Document/media ingestion | Document & Knowledge Intelligence |
| Relationship backfill | Relationship Intelligence |

Research, Browserbase, legal, financial and health roles are defined with
explicit service ceilings for future approved flows. They do not introduce new
credentials or bypass the current service policies.

## Security properties

- Service access is an allowlist per role and is further limited by the
  service's configured maximum permission.
- Every operation stays owner-scoped; the registry contains no owner data.
- Browser work remains constrained by the existing exact-target and final
  approval policy.
- Sensitive domains remain preparation-only and must use the existing MFA and
  owner-approval flow before any external effect.
