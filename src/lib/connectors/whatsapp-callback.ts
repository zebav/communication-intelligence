type CallbackEnvironment = {
  [key: string]: string | undefined;
  WHATSAPP_WEBHOOK_URL?: string;
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

export function whatsappCallbackUrl(requestOrigin: string, environment: CallbackEnvironment = process.env) {
  const explicit = environment.WHATSAPP_WEBHOOK_URL?.trim();
  const base = environment.APP_URL?.trim() || environment.NEXT_PUBLIC_APP_URL?.trim()
    || (environment.VERCEL_PROJECT_PRODUCTION_URL ? `https://${environment.VERCEL_PROJECT_PRODUCTION_URL}` : requestOrigin);
  const url = new URL(explicit || `${base.replace(/\/$/, "")}/api/connectors/whatsapp/webhook`);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("Configure a public HTTPS WhatsApp callback without credentials, query parameters or fragments.");
  }
  return url.toString();
}
