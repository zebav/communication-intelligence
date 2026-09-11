# Instagram Messaging Integration V1

Do not ask the owner to test this connector until every item under **Ready for testing** is complete.

## Meta configuration

1. Create or select the Meta app that will own the Instagram integration.
2. Add the Instagram API product and configure Instagram Login for an eligible professional account.
3. Add this exact production redirect URI:
   `https://communication-intelligence-blush.vercel.app/api/connectors/instagram/callback`
4. Configure the webhook callback:
   `https://communication-intelligence-blush.vercel.app/api/connectors/instagram/webhook`
5. Subscribe the app to Instagram messaging events.
6. Request the minimum permissions declared in `src/lib/connectors/instagram.ts`.
7. Complete Meta review before connecting accounts that are not app testers.

## Vercel environment variables

- `INSTAGRAM_APP_ID`: Meta app identifier.
- `INSTAGRAM_APP_SECRET`: Meta app secret. Never expose it to browser code.
- `INSTAGRAM_REDIRECT_URI`: the exact production redirect URI above.
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`: a new random secret shared only with Meta's webhook setup.
- `META_GRAPH_API_VERSION`: approved Graph API version, for example `v23.0`.
- `CREDENTIAL_ENCRYPTION_KEY`: already required by the email connectors.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: required so signed webhooks can store messages without a browser session.
- `CRON_SECRET`: protects the retry endpoint `/api/cron/instagram-intelligence`.

Enable the Instagram variables for Production and Preview only when their callback domains are registered in Meta. The stable production callback is preferred so temporary Vercel URLs do not break OAuth.

## Safety boundaries

- Every webhook request must have a valid Meta HMAC signature.
- Each conversation remains linked to its exact Instagram account connection.
- Provider message IDs are unique, so Meta retries do not create duplicates.
- Sending requires an authenticated owner session with MFA and a deliberate send action.
- The application never auto-sends a generated reply in V1.
- Failed or interrupted AI work remains unprocessed and is retried by the protected Instagram intelligence job.
- Temporary attachment URLs are not persisted. Attachment type and processing state are retained until the media-analysis worker is enabled.

## Ready for testing

- [ ] PR #37 has deployed successfully and is merged.
- [ ] The Instagram work has been moved to its own branch and pull request.
- [ ] All required Meta and Vercel values are configured.
- [ ] Meta accepts both callback URLs and verifies the webhook token.
- [ ] The Instagram account is Professional (Creator or Business) and available to the Meta app.
- [ ] Preview is Ready and automated tests pass.
- [ ] An end-to-end test confirms receive, deduplicate, person matching, AI draft, owner approval, and send.
