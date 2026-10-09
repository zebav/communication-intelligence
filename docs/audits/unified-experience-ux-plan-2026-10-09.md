# Solvani UX Coverage Matrix

The product should expose decisions, not independent dashboards. Desktop and
mobile use the same information hierarchy, with compact mobile controls and
progressive disclosure.

| View | User goal | Reuse / context | Change recommended | Performance and priority |
| --- | --- | --- | --- | --- |
| Today | Know what matters now | Decisions, calendar, connection health, weather/route where relevant | Show only the next meaningful decisions and upcoming constraints; hide operational detail | Small server summary; P0 |
| Unified Inbox | Read and act on messages | Person Graph, saved analysis, decision status, preferences | One channel selector; compact recommendation and draft; no duplicate decision cards | Paginate, defer sent mail; P0 |
| Source inboxes | Handle a channel appropriately | Connected account, identity, channel style, conversation history | Preserve account identity and show source-specific controls only | Lazy load by source; P0 |
| Notiscenter | Decide, approve or dismiss | Same `assistant_tasks` as Inbox | Groups: requires decision, ready, waiting, completed, note only | Deduplicate by task/conversation; P0 |
| Decision & Execution | Understand exact effect before approval | Stored plan, evidence, approval brief, policy | Show who, why, preparation, missing data, exact effect and risk | Never rerun model on open; P0 |
| Contacts | Understand and edit a person | Person Graph, vault avatar, relationships, commitments | Profile summary first; advanced identity/merge history collapsed | Optimized private avatar cache; P0 |
| Relationships | Compare meaningful relationships | Evidence-backed snapshots and feedback | Explain score, trend, uncertainty and correction controls | Incremental backfill only; P1 |
| Calendar | Plan a realistic day | Availability, attendees, place, travel and weather | Show conflicts and travel impact; proposal distinct from booking | Cache per planning task; P1 |
| Documents & Media | Find and understand relevant evidence | Vault provenance, person/conversation/task links | Inline image/audio/video/PDF preview where safe; exclude signature assets | Background ingestion, thumbnails; P1 |
| Personal Context | Maintain verified owner data | Existing encrypted vault and profile | Categorised facts; provenance, consent and removal controls | Load only selected category; P1 |
| Learning & Memory | Correct behaviour | Existing feedback/signals/outcomes | Show active rules, source and revoke action; no raw model internals | Paginated signals; P1 |
| Connections | Trust data freshness | Connections, last sync, last inbound, Operations | Account-level health and reconnect action; routine work stays automatic | Poll only this view; P0 |
| Operations | Diagnose exceptional failures | Sanitised jobs, traces and retries | Show recovery, retry and user action separately | MFA-gated, no private payloads; P0 |
| Settings / account | Configure rather than operate | Existing subviews | Compact Swedish hierarchy; no floating global tools | Dynamic import subviews; P1 |

## Information architecture

Primary mobile navigation: **Today, Inbox, Notiscenter, Kalender, Mer**.
“Mer” contains Contacts, Relationships and Settings. Source channels are a
visible Inbox selector, not a nested desktop-only menu. Settings owns
configuration; Operations remains an advanced, MFA-protected exception view.

## Acceptance criteria

- Any daily action is reachable within two intentional taps.
- One task has one persisted status across Inbox, Notiscenter and Decision
  Center.
- No horizontal overflow at 320–430 px; primary controls are at least 44 px.
- Images and private data never enter public caches.
- The default page contains no raw identifiers, technical error codes or
  duplicate operational controls.
