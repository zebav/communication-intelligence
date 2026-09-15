import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PersonLink } from "./person-link";
afterEach(cleanup);
it("keeps same-name contacts linked to their own IDs", () => {
  render(<><PersonLink personId="person-a" name="Alex" /><PersonLink personId="person-b" name="Alex" /></>);
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/contacts/person-a", "/contacts/person-b"]);
});
it("does not guess a profile when no person ID exists", () => { render(<PersonLink name="Alex" />); expect(screen.queryByRole("link")).toBeNull(); });
