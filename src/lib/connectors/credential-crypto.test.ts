import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./credential-crypto";

describe("credential encryption", () => {
  it("round-trips credentials without storing plaintext", () => {
    const key = randomBytes(32).toString("base64");
    const credential = { accessToken: "access-secret", refreshToken: "refresh-secret" };
    const encrypted = encryptCredential(credential, key);
    expect(encrypted).not.toContain("access-secret");
    expect(decryptCredential(encrypted, key)).toEqual(credential);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptCredential({}, Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});
