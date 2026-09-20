import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantBoard, type AssistantSnapshot } from "./assistant-workspace";
import { AssistantBrowserStatus } from "./assistant-browser-status";
import type { Task } from "@/lib/assistant/model";
import { makePlan, type Evidence } from "@/lib/assistant/model";

vi.mock("./person-link", () => ({ PersonLink: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("./priority-feedback", () => ({ PriorityFeedback: () => <span>Korrigera prioritet</span> }));
vi.mock("./assistant-meeting", () => ({ AssistantMeeting: ({ plan }: { plan: { evidence: { conversationId: string } } }) => <div>Bokning för {plan.evidence.conversationId}</div> }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const e: Evidence = {
  messageId: "m", conversationId: "conversation", personId: "p", personName: "Anna", source: "email",
  connectionId: "account", provider: "microsoft-graph", account: "owner@example.invalid",
  title: "Granska förslag", body: "Kan du granska detta?", sentAt: "2026-09-17T00:00:00Z",
  direction: "in", lastUserAt: null, lastOtherAt: null, classification: "Business", priority: 7,
  analysis: { requiresReply: true, draftResponse: "Tack för förslaget!" },
  recipient: "anna@example.invalid", version: "v",
};
const websiteEvidence: Evidence = {
  ...e,
  analysis: {
    actionSuggestion: {
      detected: true,
      type: "website_task",
      task: "Fyll i det godkända formuläret",
      reason: "Ärendet kräver en åtgärd på webbplatsen.",
      targetUrl: "https://example.com/form",
      requiresLogin: false,
      contactIds: [],
      requiredFields: [],
      confidence: .9,
    },
  },
};

const managedReadiness = {
  enabled: true,
  mode: "managed_agent" as const,
  blockers: [],
  capabilities: {
    executeStandardWebTasks: true,
    persistentSiteLogin: true,
    secureVariables: true,
    criticalActions: false,
  },
};

function mount(enabled = true, kind: "reply" | "meeting" | "website" = "reply") {
  const evidence = kind === "website" ? websiteEvidence : e;
  const snapshot: AssistantSnapshot = {
    tasks: [{ id: "task", message_id: "m", kind, status: "ready", revision: 2, plan: makePlan(evidence, kind), result: {}, created_at: e.sentAt, updated_at: e.sentAt }],
    candidates: [], reviewMessages: [], next: null, scanned: 100, tasksLimited: false, feedback: [],
    timezone: "Europe/Stockholm", executionEnabled: enabled,
    browserReadiness: managedReadiness,
  };
  const act = vi.fn(async () => undefined);
  render(<AssistantBoard snapshot={snapshot} people={[]} selected="task" onSelect={() => undefined} act={act} busy={false} onMore={() => undefined} onRefresh={async () => undefined} />);
  return act;
}

function mountCandidate() {
  const snapshot: AssistantSnapshot = {
    tasks: [], candidates: [{ messageId: e.messageId, kind: "reply", plan: makePlan(e, "reply") }],
    reviewMessages: [], next: null, scanned: 1, tasksLimited: false, feedback: [],
    timezone: "Europe/Stockholm", executionEnabled: false,
  };
  const act = vi.fn(async () => undefined);
  render(<AssistantBoard snapshot={snapshot} people={[]} selected="" onSelect={() => undefined} act={act} busy={false} onMore={() => undefined} onRefresh={async () => undefined} />);
  return act;
}

describe("assistant review interface", () => {
  it("removes a not-relevant candidate immediately and uses one relevance action", () => {
    const act = mountCandidate();
    expect(screen.getByText("Anna")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inte relevant" }));
    expect(act).toHaveBeenCalledWith({ action: "dismiss_candidate", messageId: "m", kind: "reply" });
    expect(screen.queryByRole("button", { name: "Inte relevant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prioritera inte avsändaren" })).toBeNull();
  });

  it("offers managed Browserbase execution for approved website tasks", () => {
    const act = mount(true, "website");
    expect(screen.getByText(/Managed Agent aktiv/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Godkänn och kör webbuppgiften/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Godkänn och skicka en gång" })).toBeNull();
    expect(act).not.toHaveBeenCalled();
  });

  it("requires final confirmation before message execution", () => {
    const act = mount();
    const send = screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(act).toHaveBeenCalledWith({ action: "execute", id: "task", revision: 2, approved: true });
  });

  it("shows a decision summary and exact approval outcome before action", () => {
    mount();
    expect(screen.getByText("Sammanfattning")).toBeTruthy();
    expect(screen.getByText("Varför detta är viktigt")).toBeTruthy();
    expect(screen.getAllByText("Detta händer när du godkänner").length).toBeGreaterThan(0);
  });

  it("edits revoke approval until saved and reviewed", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Förslag på svar"), { target: { value: "Nytt svar" } });
    expect((screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("local preparation mode cannot send a message", () => {
    mount(false);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Godkänn och skicka en gång" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("meeting composer keeps the originating conversation", () => {
    mount(false, "meeting");
    fireEvent.click(screen.getByText("Ändra eller planera manuellt"));
    fireEvent.click(screen.getByRole("button", { name: "Öppna masterkalenderns planering" }));
    expect(screen.getByText("Bokning för conversation")).toBeTruthy();
  });
  it("shows the full direct message and its reply suggestion in the decision view", () => {
    const direct: Evidence = {
      ...e,
      source: "whatsapp",
      provider: "whatsapp-business",
      body: "Det här är hela WhatsApp-meddelandet som jag behöver kunna läsa innan beslut.",
      recipient: "46700000000",
      lastOtherAt: new Date().toISOString(),
      analysis: { requiresReply: true, draftResponse: "Absolut, jag kollar detta och återkommer med ett konkret förslag." },
    };
    const snapshot: AssistantSnapshot = {
      tasks: [{ id: "direct-task", message_id: "m", kind: "reply", status: "ready", revision: 2, plan: makePlan(direct, "reply"), result: {}, created_at: direct.sentAt, updated_at: direct.sentAt }],
      candidates: [], reviewMessages: [], next: null, scanned: 1, tasksLimited: false, feedback: [],
      timezone: "Europe/Stockholm", executionEnabled: true,
    };
    render(<AssistantBoard snapshot={snapshot} people={[]} selected="direct-task" onSelect={() => undefined} act={vi.fn(async () => undefined)} busy={false} onMore={() => undefined} onRefresh={async () => undefined} />);
    expect(screen.getAllByText(direct.body).length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Förslag på svar") as HTMLTextAreaElement).value).toContain("konkret förslag");
  });
});

describe("Browserbase result presentation", () => {
  function show(result: Record<string, unknown>, status: Task["status"] = "ready") {
    render(<AssistantBrowserStatus
      readiness={managedReadiness}
      task={{ id: "task", message_id: "m", kind: "website", status, revision: 2, plan: makePlan(websiteEvidence, "website"), result, created_at: e.sentAt, updated_at: e.sentAt }}
    />);
  }

  it("renders provider summary only as text and never executable HTML", () => {
    show({ browserSummary: '<img src=x onerror="alert(1)">', browserConfirmation: "", browserSubmitted: false }, "done");
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps uncertain external results visibly quarantined", () => {
    show({ browserSummary: "Resultatet kunde inte verifieras." }, "uncertain");
    expect(screen.getByRole("status").textContent).toContain("Resultatet är osäkert");
  });

  it("does not display unknown legacy result fields as Browserbase success", () => {
    show({ status: "read", text: "unverified" });
    expect(screen.queryByText("unverified")).toBeNull();
    expect(screen.queryByText("Webbuppgiften är klar")).toBeNull();
  });
});
