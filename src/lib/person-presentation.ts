import type { Source } from "@/lib/domain";

type IdentityHint = { source?: string | null; username?: string | null };

const sourceLabels: Partial<Record<Source, string>> = {
  email: "E-postkontakt",
  instagram: "Instagram-kontakt",
  whatsapp: "WhatsApp-kontakt",
  slack: "Slack-kontakt",
  messenger: "Messenger-kontakt",
  linkedin: "LinkedIn-kontakt",
  tiktok: "TikTok-kontakt",
};

/**
 * Provider imports sometimes arrive before the provider can disclose a profile
 * name. Never expose an imported internal-id placeholder (for example
 * "Instagram contact 639911") as though it were a person's real name.
 */
export function isImportedPlaceholderName(value?: string | null) {
  return /^(instagram|whatsapp|slack|email|messenger|linkedin|tiktok) contact(?:\s+[\w-]+)?$/i.test(value?.trim() ?? "");
}

export function presentPersonName(input: {
  displayName?: string | null;
  source?: Source | string | null;
  identities?: IdentityHint[];
  fallback?: string;
}) {
  const name = input.displayName?.trim();
  if (name && !isImportedPlaceholderName(name)) return name;

  const source = input.source ?? undefined;
  const username = input.identities?.find((identity) => identity.source === source && identity.username?.trim())?.username?.trim();
  if (username && source === "instagram") return `@${username.replace(/^@/, "")}`;
  if (username) return username;
  if (source && source in sourceLabels) return sourceLabels[source as Source] ?? input.fallback ?? "Okänd kontakt";
  return input.fallback ?? "Okänd kontakt";
}
