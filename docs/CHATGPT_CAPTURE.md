# ChatGPT Conversation Capture

The endpoint `POST /api/integrations/chatgpt/capture` lets an authorized ChatGPT workflow persist a message that the owner has shown to ChatGPT into Communication Intelligence.

## Contract

Authentication:

```
Authorization: Bearer <CHATGPT_CAPTURE_SECRET>
```

Server configuration:

```
CHATGPT_CAPTURE_SECRET=<random high-entropy secret>
CHATGPT_CAPTURE_OWNER_ID=<profiles.id for the owner>
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service role key>
```

Example payload:

```json
{
  "source": "whatsapp",
  "participantName": "Margo",
  "inboundText": "Hope you have a good day...",
  "draftResponse": "Hey you 😘 ...",
  "draftTone": "Warm, confident",
  "sentAt": "2026-09-23T14:03:31+02:00",
  "externalMessageId": "optional-stable-id",
  "summary": "Margo shared weekend plans and asked about the boat trip.",
  "priorityScore": 6
}
```

## Behaviour

- Reuses an existing person when possible, preferring a person who already has an identity on the same channel.
- Reuses the most recent conversation for that person and channel.
- Creates an `assistant_observed` conversation only when no conversation exists yet.
- Saves the received text as an inbound message.
- Saves the ChatGPT-written reply in `messages.metadata.ai_analysis.draftResponse`.
- Does **not** mark the draft as sent.
- Preserves the original communication source so the existing UI shows the exchange in the correct channel.
- Writes an audit-log entry for provenance.

The endpoint is intended for server-to-server use only. Never expose `CHATGPT_CAPTURE_SECRET` or a Supabase service-role/secret key in client-side code.
