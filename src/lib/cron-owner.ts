/** A cron request may scope one bounded pass to an owner queued by the app. */
export function ownerIdFromCronHeaders(headers: Headers) {
  const value = headers.get("x-owner-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
