# Browserbase managed execution

Decision & Execution Center V2.1 uses Browserbase managed Agents for standard website actions after an explicit owner approval.

## Execution model

The stored assistant task is the source of truth. The client can submit only the task id, current revision, explicit approval and ephemeral one-time values. The server reloads the task, validates MFA AAL2, validates the exact HTTPS target and public DNS, and blocks critical categories before starting Browserbase.

Standard actions include reviewed form completion, portal updates, check-in flows and non-payment website submissions. Payments, money transfers, purchases/checkout, gambling, legal signatures, password/MFA/security changes and destructive account actions remain outside this capability.

Browserbase Agent runs are asynchronous. The app reserves a server-only run record before starting the external run, stores the returned run id, polls the provider and never automatically retries an uncertain external result.

## Private data and login

Website-specific stable values live in Personal Context → Dina privata uppgifter:

- usernames / email logins
- passwords
- customer/member/account identifiers
- addresses and form values requested for an approved task

Values are encrypted with the application credential-encryption key. Passwords and other credential entries are masked in the API/UI and are never returned to the browser after storage.

When an event card needs a missing field, it asks for that field inline. Stable values can be saved to the Vault and are scoped to the website host. Verification / one-time codes are never persisted.

For Browserbase Agent execution, private values are supplied as per-run Browserbase variables and the task prompt contains placeholders rather than literal values. The Agent is instructed never to reproduce those values in output. A persistent Browserbase Context is maintained per owner + website host so cookies and site login state can be reused.

## Navigation boundary

Browserbase Agents currently expose Context and variable configuration but do not expose the raw-session `allowedDomains` setting in their Agent run browser settings. Therefore managed execution uses a narrower risk tier:

- exact target URL/host is validated by our application before execution
- public DNS/private-network preflight is required
- the Agent is instructed not to use web search or intentionally leave the approved host
- credentials must not be entered after a cross-host redirect
- the terminal structured result includes `finalUrl`; a mismatched final host quarantines the task as uncertain
- critical actions are blocked rather than delegated to the Agent

This is not treated as authorization for critical financial, legal, security or destructive actions.

## Results and missing information

The Agent must return structured output:

- completed
- submitted
- summary
- finalUrl
- confirmationText
- requiresHuman
- blockedReason
- missingInformation

If more private data or an MFA code is needed, the task returns to waiting state and the event card asks the owner for the missing input. After the owner supplies it, the same reviewed task can be explicitly approved and resumed. The system does not automatically retry.

## Database

`assistant_browser_contexts` maps owner + exact host to a Browserbase Context.

`assistant_browser_agent_runs` is a server-only run ledger tied to an assistant task revision. A partial unique index allows only one PREPARING/PENDING/RUNNING Agent run per owner.

Both tables have RLS enabled and no authenticated-client policies. Access is service-role only.
