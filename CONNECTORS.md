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
| Manual/file/screenshot import | Available | Reviewed text, CSV, JSON, PNG, JPEG, or WebP imports linked to an exact account label |
| iMessage | Manual import available | No Apple account access requested |
| Gmail / Google Workspace | Implemented | OAuth, separate multi-account identity, bounded history import, incremental re-check |
| Instagram Professional | Planned | Official Meta integration for eligible professional accounts |
| Messenger Page | Planned | Official Meta Page integration |
| WhatsApp Business | Planned | Official business platform and webhooks |
| LinkedIn / TikTok / Tinder | Manual import available | No account automation without an approved provider API |

Each connection represents one specific account, not merely one provider. Multiple Microsoft 365 companies, personal Outlook/Hotmail accounts, Gmail accounts, and manual social identities remain separate through `connection_id` and the owner-supplied account label.

Microsoft OAuth always starts and returns on the stable production domain. Requests initiated from a temporary Vercel Preview are first redirected to production so PKCE/state cookies and the Entra redirect URI remain on the same host.

Google OAuth follows the same stable-domain rule. Gmail V1 requests read-only access, imports the Inbox in bounded pages from the last year, encrypts refresh credentials, prefixes provider message/thread IDs by Google account, and never sends, archives, or deletes mail. Outlook uses the same one-year relationship-history window. Unread messages receive an explicit unhandled-message relevance signal; repeated conversations and prior owner replies strengthen the contact signal without overriding explicit owner rules.

Conversation screenshots are sent to the configured OpenAI API after the owner deliberately selects an image, with storage disabled, to extract visible text. The image itself is not persisted by the application. Large or HEIC/HEIF iPhone selections are normalized locally in the browser to a bounded JPEG before upload. Successful mobile screenshot analysis automatically stores the structured transcript, links it through a stable channel/person identity, and creates an unverified conversation-context memory that remains distinguishable from owner-verified facts.

Screenshot analysis uses `OPENAI_VISION_MODEL` when configured. If that model is unavailable to the API project, the server safely retries with the configured fast model and established vision-capable fallback models instead of failing the upload.

Pasted text, exported files, and screenshots use the same automatic import analysis. It infers the likely channel, participants, topic, intent, priority, recommended action, and an editable reply. Channels without an approved sending API expose Copy reply rather than pretending to send externally.

Adding a provider requires a catalog entry, a provider adapter, normalization tests, permission review, and an explicit owner-controlled connection flow.
