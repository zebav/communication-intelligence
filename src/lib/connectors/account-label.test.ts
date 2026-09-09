import { describe, expect, it } from "vitest";
import { accountDisplayLabel, accountOrganization } from "./account-label";

describe("Microsoft account labels", () => {
  it("identifies a company from its email domain", () => {
    expect(accountOrganization("zebastian@axcrypt.net")).toBe("Axcrypt");
  });

  it("marks common consumer mail domains as personal", () => {
    expect(accountOrganization("zebastian@hotmail.com")).toBe("Personal account");
  });

  it("includes the unique email address even when display names match", () => {
    expect(accountDisplayLabel({ id: "1", provider: "microsoft-graph", accountName: "Zebastian Victorin", accountIdentifier: "zebastian@zocom.se", status: "connected", healthStatus: "healthy", capabilities: {} })).toBe("Zocom · zebastian@zocom.se");
  });
});
