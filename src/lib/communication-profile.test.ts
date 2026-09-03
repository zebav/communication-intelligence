import { describe, expect, it } from "vitest";
import { defaultUniversalProfile, normalizeUniversalProfile, resolveCommunicationProfile, situationForClassification } from "./communication-profile";

describe("universal communication profile", () => {
  it("migrates the earlier communication persona without losing it", () => {
    expect(normalizeUniversalProfile(undefined, { defaultTone: "Warm" }).defaultTone).toBe("Warm");
  });
  it("sends only the selected channel, situation and person context", () => {
    const profile = { ...defaultUniversalProfile, channels: { email: { tone: "Formal", guidance: "Use paragraphs" }, whatsapp: { tone: "Brief", guidance: "Use short lines" } }, situations: { conflict: { tone: "Calm", guidance: "De-escalate" } }, people: { p1: { name: "Alex", tone: "Warm", guidance: "Be candid" }, p2: { name: "Sam", tone: "Neutral", guidance: "Be concise" } } };
    const result = resolveCommunicationProfile(profile, { source: "email", situation: "conflict", personId: "p1" });
    expect(result).toContain("Formal"); expect(result).toContain("De-escalate"); expect(result).toContain("Alex");
    expect(result).not.toContain("WhatsApp"); expect(result).not.toContain("Sam");
  });
  it("maps inbox categories to communication situations", () => {
    expect(situationForClassification("Legal")).toBe("sensitive");
    expect(situationForClassification("Booking / Travel")).toBe("logistics");
  });
});
