import type { ChannelConnection } from "@/lib/domain";

const personalDomains = new Set(["hotmail.com", "live.com", "outlook.com", "gmail.com"]);

export function accountOrganization(identifier?: string) {
  const domain = identifier?.split("@").at(1)?.toLowerCase();
  if (!domain) return "Microsoft account";
  if (personalDomains.has(domain)) return "Personal account";
  const name = domain.split(".")[0].replace(/[-_]+/g, " ");
  return name ? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) : domain;
}

export function accountDisplayLabel(connection: ChannelConnection) {
  const identifier = connection.accountIdentifier?.trim();
  return identifier ? `${accountOrganization(identifier)} · ${identifier}` : connection.accountName ?? "Microsoft account";
}
