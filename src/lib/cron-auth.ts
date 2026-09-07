import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCron(authorization: string | null, secret = process.env.CRON_SECRET) {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  const left = Buffer.from(supplied);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
