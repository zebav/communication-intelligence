import { describe, expect, it } from "vitest";
import { isPermittedAppOrigin, permittedAppOrigin } from "./app-origin";

describe("app origin allowlist", () => {
  it("accepts Solvani and authenticated Vercel previews", () => {
    expect(permittedAppOrigin("https://www.solvani.app/anything?x=1")).toBe("https://www.solvani.app");
    expect(isPermittedAppOrigin("https://solvani.app")).toBe(true);
    expect(isPermittedAppOrigin("https://communication-intelligence-9erjq9tnv-ci20.vercel.app")).toBe(true);
  });

  it("rejects lookalike, insecure, and malformed callback destinations", () => {
    expect(isPermittedAppOrigin("http://www.solvani.app")).toBe(false);
    expect(isPermittedAppOrigin("https://solvani.app.attacker.example")).toBe(false);
    expect(isPermittedAppOrigin("not a url")).toBe(false);
  });
});
