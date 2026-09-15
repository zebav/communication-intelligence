import { expect, it } from "vitest";
import { contactMatch, type MatchPerson } from "./contact-matching";
const person = (id: string, email = "anna@example.com"): MatchPerson => ({ id, display_name: "Anna Andersson", entity_type: "person", identities: [{ source: "email", external_identifier: email, verified_match: true }] });
it("only automatically matches independently verified personal identifiers", () => {
  expect(contactMatch(person("a"), person("b"))?.safe).toBe(true);
  expect(contactMatch(person("a"), person("b", "other@example.com"))?.safe).toBe(false);
  expect(contactMatch(person("a", "support@example.com"), person("b", "support@example.com"))?.safe).toBe(false);
});
it("does not confuse platform-scoped identifiers", () => {
  const b = { ...person("b"), display_name: "Eva Svensson", identities: [{ source: "instagram", external_identifier: "anna@example.com", verified_match: true }] };
  expect(contactMatch(person("a"), b)).toBeNull();
});
