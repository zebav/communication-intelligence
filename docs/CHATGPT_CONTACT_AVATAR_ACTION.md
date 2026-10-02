# Solvani ChatGPT contact-avatar action

Solvani exposes a server-to-server action for ChatGPT/custom integrations:

- OpenAPI schema: `GET /api/integrations/chatgpt/openapi`
- Action: `POST /api/integrations/chatgpt/contact-avatar`

Authentication uses the existing server-only `CHATGPT_CAPTURE_SECRET`:

```
Authorization: Bearer <CHATGPT_CAPTURE_SECRET>
```

The target owner is resolved from `CHATGPT_CAPTURE_OWNER_ID`.

## setContactAvatar

Send JSON:

```json
{
  "personId": "preferred-stable-person-uuid",
  "participantName": "Melissa",
  "imageBase64": "<base64 image bytes or data URL>",
  "mimeType": "image/jpeg",
  "filename": "melissa.jpeg"
}
```

Use `personId` whenever possible. `participantName` is supported as a fallback only when it resolves unambiguously.

The action:
1. verifies the server-to-server secret;
2. verifies the contact belongs to the configured owner;
3. stores the image privately in `secure-vault`;
4. deduplicates by SHA-256;
5. saves/links `vault_assets` and `person_media`;
6. marks the owner-selected avatar as `user_verified=true`;
7. demotes the previous avatar to `reference`;
8. updates `people.avatar_asset_id`;
9. writes an audit log.

Never expose `CHATGPT_CAPTURE_SECRET` to browser code.
