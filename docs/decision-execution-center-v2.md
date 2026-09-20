# Decision & Execution Center V2

## Goal

Handlingsinkorgen is a decision surface, not another raw inbox. Existing analysis, communication history, calendar, Maps, provider send flows and guarded browser work are composed into one reviewable plan.

No AI call is triggered merely by opening the workspace or Handlingsinkorg.

## Decision card

Each saved task presents:

- a short summary from already stored analysis/evidence
- why the task matters
- the exact proposed action
- the exact saved reply/forward text when applicable
- website target URL and requested action when applicable
- meeting planning with 2–3 suggested times
- a clear statement of what approval will do

Original messages and lower-level steps remain available under source details instead of dominating the default view.

## Execution boundary

Existing execution contracts remain authoritative:

- Gmail / Outlook / Instagram / WhatsApp replies are sent only from a reviewed saved plan.
- Forwarding keeps the original message and explicitly verified advisor.
- Execution claims the task before provider send and never automatically retries an uncertain provider result.
- Calendar booking and invitations retain their own final approval flow.
- Browserbase remains fail-closed. Website tasks can be planned and reviewed, but no new live external browser execution is enabled by this phase.

A complete stored reply may move directly to ready-for-approval when a task is created. Editing the plan revokes approval and requires a fresh review.

## Learning & Memory

Settings → Learning & Memory replaces the old quality-count-oriented view.

It groups existing owner-controlled data into:

- priority / irrelevant-sender rules
- reply and tone learning
- actions and confirmed outcomes
- verified contact relationships and roles
- open dated commitments
- recurring confirmed calendar booking patterns

Every learning signal shows provenance and remains editable, dismissible and deletable. Suggested signals do not influence future AI until approved.

Structured Contacts and calendar history are shown as verified source data, not converted into AI rules automatically.

## AI usage

Ordinary workspace opening no longer scans for an unanalyzed email and automatically calls AI. AI generation remains explicit where the owner asks for a new draft, analysis or meeting-intent interpretation.

## Release gates

- TypeScript / build must pass in Vercel Preview.
- Existing assistant and calendar execution safety tests must remain compatible.
- No Browserbase live execution flag is enabled by this phase.
- No destructive database migration is required.
