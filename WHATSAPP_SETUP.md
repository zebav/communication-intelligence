# WhatsApp Business setup

The application uses the official WhatsApp Cloud API. No browser automation or personal WhatsApp session is used.

## Local implementation

- `GET /api/connectors/whatsapp/start` validates the configured Meta phone number and stores its token encrypted.
- `GET /api/connectors/whatsapp/webhook` completes Meta webhook verification.
- `POST /api/connectors/whatsapp/webhook` verifies Meta's signature, deduplicates incoming messages, creates contacts and conversations, and starts AI analysis.
- `POST /api/connectors/whatsapp/reply` sends an owner-reviewed reply and records delivery status updates.
- `GET /api/connectors/whatsapp/health` reports missing configuration without exposing secrets.

## Required environment values

`WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER`, and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

The webhook URL is the stable production URL followed by `/api/connectors/whatsapp/webhook`. Subscribe the WhatsApp Business Account to the `messages` field. The token must have `whatsapp_business_messaging` and `whatsapp_business_management` permissions.

Meta applies a 24-hour customer-service window to free-form replies. Outside that window, an approved message template is required; the V1 UI deliberately does not pretend a free-form message can be sent.
