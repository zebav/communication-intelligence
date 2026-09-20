import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantBoard, type AssistantSnapshot } from "./assistant-workspace";
import { AssistantBrowserStatus } from "./assistant-browser-status";
import type { Task } from "@/lib/assistant/model";
import { makePlan, type Evidence } from "@/lib/assistant/model";
vi.mock("./person-link", () => ({ PersonLink: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("./priority-feedback", () => ({ PriorityFeedback: () => <span>Korrigera prioritet</span> }));
vi.mock("./assistant-meeting", () => ({ AssistantMeeting: ({ plan }: { plan: { evidence: { conversationId: string } } }) => <div>Bokning för {plan.evidence.conversationId}</div> }));
afterEach(cleanup);
const e: Evidence = { messageId: "m", conversationId: "conversation", personId: "p", personName: "Anna", source: "email", connectionId: "account", provider: "microsoft-graph", account: "owner@example.invalid", title: "Granska förslag", body: "Kan du granska detta?", sentAt: "2026-09-17T00:00:00Z", direction: "in", lastUserAt: null, lastOtherAt: null, classification: "Business", priority: 7, analysis: { requiresReply: true, draftResponse: "Tack för förslaget!" }, recipient: "anna@example.invalid", version: "v" };
function mount(enabled = true, kind: "reply" | "meeting" | "website" = "reply") {
  const snapshot: AssistantSnapshot = { tasks: [{ id: "task", message_id: "m", kind, status: "ready", revision: 2, plan: makePlan(e, kind), result: {}, created_at: e.sentAt, updated_at: e.sentAt }], candidates: [], reviewMessages: [], next: null, scanned: 100, tasksLimited: false, feedback: [], timezone: "Europe/Stockholm", executionEnabled: enabled };
  const act = vi.fn(async () => undefined);
  render(<AssistantBoard snapshot={snapshot} people={[]} selected="task" onSelect={() => undefined} act={act} busy={false} onMore={() => undefined} onRefresh={async () => undefined} />);
  return act;
}
function mountCandidate() {
  const snapshot: AssistantSnapshot = { tasks: [], candidates: [{ messageId: e.messageId, kind: "reply", plan: makePlan(e, "reply") }], reviewMessages: [], next: null, scanned: 1, tasksLimited: false, feedback: [], timezone: "Europe/Stockholm", executionEnabled: false };
  const act = vi.fn(async () => undefined);
  render(<AssistantBoard snapshot={snapshot} people={[]} selected="" onSelect={() => undefined} act={act} busy={false} onMore={() => undefined} onRefresh={async () => undefined} />);
  return act;
}
describe("assistant review interface", () => {
  it("lets the owner reject only a message or teach a sender rule", () => {
    const act = mountCandidate();
    fireEvent.click(screen.getByRole("button", { name: "Inte relevant" }));
    expect(act).toHaveBeenCalledWith({ action: "dismiss_candidate", messageId: "m", kind: "reply", scope: "message" });
    fireEvent.click(screen.getByRole("button", { name: "Prioritera inte avsändaren" }));
    expect(act).toHaveBeenCalledWith({ action: "dismiss_candidate", messageId: "m", kind: "reply", scope: "sender" });
  });
  it("website tasks cannot start automatic execution even when sending is enabled", () => {
    const act = mount(true, "website");
    expect(screen.getByText(/Automatisk webbkörning är avstängd/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Godkänn och skicka en gång" })).toBeNull();
    expect(act).not.toHaveBeenCalled();
  });
  it("requires final confirmation before execution", () => {
    const act = mount(); const send = screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); expect(send.disabled).toBe(false);
    fireEvent.click(send); expect(act).toHaveBeenCalledWith({ action: "execute", id: "task", revision: 2, approved: true });
  });
  it("shows a decision summary and exact approval outcome before action", () => {
    mount();
    expect(screen.getByText("Sammanfattning")).toBeTruthy();
    expect(screen.getByText("Varför detta är viktigt")).toBeTruthy();
    expect(screen.getAllByText("Detta händer när du godkänner").length).toBeGreaterThan(0);
  });
  it("edits revoke approval until saved and reviewed", () => {
    mount(); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Förslag på svar"), { target: { value: "Nytt svar" } });
    expect((screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("local preparation mode cannot send", () => {
    mount(false); fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("meeting composer keeps the originating conversation", () => {
    mount(false, "meeting"); fireEvent.click(screen.getByRole("button", { name: "Planera i masterkalendern" }));
    expect(screen.getByText("Bokning för conversation")).toBeTruthy();
  });
});
describe("browser result presentation", () => {
  function show(result: Record<string, unknown>, status: Task["status"] = "ready") {
    render(<AssistantBrowserStatus task={{ id: "task", message_id: "m", kind: "website", status, revision: 2, plan: makePlan(e, "website"), result, created_at: e.sentAt, updated_at: e.sentAt }} />);
  }
  it("renders page markup only as text and never as executable HTML", () => {
    show({ status: "read", text: '<img src=x onerror="alert(1)">', externalSubmissionPerformed: false, cleanup: "confirmed" });
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/betyder inte att den ursprungliga uppgiften är genomförd/)).toBeTruthy();
  });
  it("keeps unconfirmed termination visible", () => {
    show({ cleanup: "needs_review" });
    expect(screen.getByRole("status").textContent).toContain("Starta inte om");
  });
  it("does not treat unknown results as success", () => {
    show({ status: "read", text: "unverified" });
    expect(screen.queryByText("unverified")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Inget automatiskt läsresultat");
  });
});
