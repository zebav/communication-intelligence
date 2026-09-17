import { expect, it } from "vitest";
import { chooseAdvisorConversation } from "./follow-up";
const sent = "2026-09-17T10:00:00Z";
const thread = { id: "advisor-thread", title: "FW: Granskning av avtal", last_user_message_at: sent, last_other_message_at: null };
it("finds the synchronized advisor thread for the same subject", () => expect(chooseAdvisorConversation([thread], "Granskning av avtal", sent)?.id).toBe("advisor-thread"));
it("does not substitute another topic", () => expect(chooseAdvisorConversation([thread], "Faktura", sent)).toBeNull());
it("rejects ambiguity instead of selecting an arbitrary thread", () => expect(chooseAdvisorConversation([thread, { ...thread, id: "other" }], "Granskning av avtal", sent)).toBeNull());
it("does not chase an advisor who has already replied", () => expect(chooseAdvisorConversation([{ ...thread, last_other_message_at: "2026-09-17T11:00:00Z" }], "Granskning av avtal", sent)).toBeNull());
it("does not reuse a historic thread from before forwarding", () => expect(chooseAdvisorConversation([{ ...thread, last_user_message_at: "2026-09-16T10:00:00Z" }], "Granskning av avtal", sent)).toBeNull());
