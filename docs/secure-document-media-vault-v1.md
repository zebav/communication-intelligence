# Secure Document & Media Vault V1

## Goal
Preserve durable documents and reusable contact media from communication channels without turning every attachment into permanent storage.

## Documents
Outlook and Gmail sync now enqueue messages that contain attachments. A separate bounded ingestion processor downloads those attachments, runs a retention decision, deduplicates by SHA-256 and stores only files that have durable future value.

Examples that normally qualify:
- contracts and signed/unsigned agreements
- invoices, receipts, tax/accounting material
- insurance documents and claims
- travel confirmations, tickets and booking documents
- certificates, warranties and licenses
- identity/travel documents
- durable legal/business attachments

Routine logos, tracking images, transient graphics, boilerplate and low-value attachments are rejected and are not persisted in Storage.

Binary files live in the private Supabase Storage bucket `secure-vault`; searchable metadata lives in `vault_assets`. Access requires the owner and MFA AAL2. Signed download URLs are short lived.

Stored assets retain provenance back to the source message/conversation/person. `vault_asset_links` supports future links to people, tasks, calendar events, companies and other objects so a document can later be proposed for forwarding or sharing.

## Contact images
Person images use the same private storage layer. A verified contact avatar is represented by `person_media` and `people.avatar_asset_id`.

The system does **not** automatically identify a real person from their face. Contact images must be linked through explicit user selection or strong non-biometric context (for example, a screenshot uploaded from that person's known conversation) and can then be confirmed by the owner.

The shared `PersonLink` component renders the verified avatar in Contacts, Inbox and Handlingsinkorg wherever a Person Graph id is available.

## ChatGPT screenshots
A screenshot uploaded to the product can be stored with source type `chatgpt_upload` or `manual`. If the conversation/contact is already known, the image can be attached to that person as a reference/avatar after owner confirmation. We should not infer a person's identity solely from facial appearance.

## Google Photos
Google removed the broad Google Photos Library API scopes for reading an entire user's library after March 31, 2025. A new integration should therefore use Google Photos Picker API: the owner explicitly selects one or more photos, and the app imports only those selected items.

That means Google Photos can be a convenient source for choosing contact photos, but it should not be designed as an unrestricted background crawler or automatic face-identification service.

## Next execution layer
When composing a future reply/forward action, Decision & Execution Center can query vault assets linked to the current person/conversation and propose a specific saved document as an attachment. Sending still requires the same explicit final approval as the message body and recipient.
