import { describe, expect, it } from "vitest";
import { channelWritingGuidance } from "./channel-context";

describe("channelWritingGuidance", () => {
  it("keeps email and chat writing rules separate", () => {
    expect(channelWritingGuidance("email")).toContain("email structure");
    expect(channelWritingGuidance("whatsapp")).toContain("chat style");
    expect(channelWritingGuidance("whatsapp")).not.toContain("sign-off");
  });

  it("requires owner control for personal channels", () => {
    expect(channelWritingGuidance("tinder")).toContain("Never automate sending");
  });
});
