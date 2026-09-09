# Universal connector foundation

All communication providers must pass through the same boundary before their data reaches people, memory, relevance, commitments, outcomes, learning, or reply generation.

## Shared flow

Provider adapter → normalize message → deduplicate → resolve person → persist conversation → run source-independent intelligence.

The normalized message contains a source, channel kind, direction, sender identity, conversation ID, body, time, attachments, and provider metadata. Provider-specific response objects must not enter the intelligence layer.

## Capability gates

Each connector declares exactly what it can do. Reading history, incremental sync, live updates, draft creation, approved sending, archiving, deletion, and marking messages read are separate permissions. The interface must not offer an action unless both the connector and the connected account permit it.

## Current catalog

| Channel | Status | Supported path |
| --- | --- | --- |
| Outlook / Microsoft 365 | Implemented | OAuth, history import, incremental sync, approved send |
| Manual capture | Available | Owner-provided communication |
| Instagram Professional | Planned | Official Meta integration for eligible professional accounts |
| Messenger Page | Planned | Official Meta Page integration |
| WhatsApp Business | Planned | Official business platform and webhooks |
| Tinder | Planned manual path | No account automation without an approved provider API |

Adding a provider requires a catalog entry, a provider adapter, normalization tests, permission review, and an explicit owner-controlled connection flow.
