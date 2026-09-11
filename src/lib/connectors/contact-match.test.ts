import { describe, expect, it } from "vitest";
import { confidentContactMatches, contactMatchScore } from "./contact-match";

describe("cross-channel contact matching", () => {
  it("finds an exact normalized name", () => expect(contactMatchScore("José Lind", "jose.lind", "Jose Lind")).toBe(1));
  it("uses a verified identifier-style match", () => expect(contactMatchScore("", "zebav", "Zebastian Victorin", ["@zebav"])).toBe(0.98));
  it("does not propose weak one-name matches", () => expect(confidentContactMatches("Anna Andersson", "anna88", [{ id: "1", name: "Anna Svensson" }])).toEqual([]));
  it("returns only strong candidates", () => expect(confidentContactMatches("Lisa Rosen", "lisa.rosen", [{ id: "1", name: "Lisa Rosen" }, { id: "2", name: "Lisa Nilsson" }]).map((item) => item.candidate.id)).toEqual(["1"]));
});
