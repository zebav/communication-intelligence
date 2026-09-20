import { expect, it } from "vitest";
import { googleGmailConnector } from "./google-gmail";

it("requests Gmail plus read-only Contacts access", () => {
  expect(googleGmailConnector.scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
  expect(googleGmailConnector.scopes).toContain("https://www.googleapis.com/auth/contacts.readonly");
});
