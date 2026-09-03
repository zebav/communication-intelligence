import type { CommunicationSituation, Source, UniversalCommunicationProfile } from "./domain";

export const communicationChannels: { id: Source; label: string }[] = [
  { id: "email", label: "Email" }, { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" }, { id: "linkedin", label: "LinkedIn" },
  { id: "messenger", label: "Messenger" }, { id: "tinder", label: "Tinder" },
  { id: "tiktok", label: "TikTok" }, { id: "manual", label: "Other / manual" },
];

export const communicationSituations: { id: CommunicationSituation; label: string }[] = [
  { id: "business", label: "Business" }, { id: "conflict", label: "Conflict" },
  { id: "followUp", label: "Follow-up" }, { id: "personal", label: "Personal" },
  { id: "romantic", label: "Romantic" }, { id: "logistics", label: "Logistics & planning" },
  { id: "sensitive", label: "Sensitive" },
];

export const defaultUniversalProfile: UniversalCommunicationProfile = {
  identitySummary: "", values: "", defaultTone: "Direct, warm and calm",
  preferredLength: "2–4 short sentences", principles: "Be accurate. Do not promise anything I have not approved.",
  signOff: "", channels: {}, situations: {}, people: {},
};

export function normalizeUniversalProfile(value: unknown, legacy?: unknown): UniversalCommunicationProfile {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<UniversalCommunicationProfile> : {};
  const old = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy as Partial<UniversalCommunicationProfile> : {};
  return {
    ...defaultUniversalProfile, ...old, ...source,
    channels: source.channels && typeof source.channels === "object" ? source.channels : {},
    situations: source.situations && typeof source.situations === "object" ? source.situations : {},
    people: source.people && typeof source.people === "object" ? source.people : {},
  };
}

export function situationForClassification(classification: string): CommunicationSituation {
  if (["Critical", "Financial", "Legal"].includes(classification)) return "sensitive";
  if (classification === "Booking / Travel") return "logistics";
  if (classification === "Personal") return "personal";
  if (classification === "Action Required") return "followUp";
  return "business";
}

export function resolveCommunicationProfile(profile: UniversalCommunicationProfile, input: { source: Source; personId?: string | null; situation?: CommunicationSituation }) {
  const channel = profile.channels[input.source];
  const situation = input.situation ? profile.situations[input.situation] : undefined;
  const person = input.personId ? profile.people[input.personId] : undefined;
  return [
    `GLOBAL\nIdentity: ${profile.identitySummary || "not specified"}\nValues: ${profile.values || "not specified"}\nDefault tone: ${profile.defaultTone}\nPreferred length: ${profile.preferredLength}\nPrinciples: ${profile.principles}\nSign-off: ${profile.signOff || "none specified"}`,
    channel && (channel.tone || channel.guidance) ? `CHANNEL (${input.source})\nTone: ${channel.tone || "use global"}\nGuidance: ${channel.guidance || "use global"}` : "",
    situation && (situation.tone || situation.guidance) ? `SITUATION (${input.situation})\nTone: ${situation.tone || "use channel/global"}\nGuidance: ${situation.guidance || "use channel/global"}` : "",
    person && (person.tone || person.guidance) ? `PERSON (${person.name})\nTone: ${person.tone || "use situation/channel/global"}\nGuidance: ${person.guidance || "use situation/channel/global"}` : "",
    "Priority: person and situation guidance override channel guidance; channel guidance overrides global defaults.",
  ].filter(Boolean).join("\n\n");
}
