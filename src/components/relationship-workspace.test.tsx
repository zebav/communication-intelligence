import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RelationshipWorkspace } from "./relationship-workspace";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("./contact-avatar", () => ({ ContactAvatar: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("./relationship-backfill-control", () => ({ RelationshipBackfillControl: () => <span>Historisk analys</span> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const payload = { category: "romantic", job: null, rows: [{ id: "snapshot", person_id: "person", strength_score: 75, quality_score: 70, priority_score: 90, ranking_score: 80, trend: "rising", confidence: .8, explanation: "Tydligt underlag.", person: { id: "person", display_name: "Anna", organization: null, last_contact_at: null } }] };

describe("RelationshipWorkspace", () => {
  it("shows a retry path after a relationship request fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Tillfälligt fel" }), { status: 503, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RelationshipWorkspace />);
    expect((await screen.findByRole("alert")).textContent).toContain("Tillfälligt fel");
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    await waitFor(() => expect(screen.getAllByText("Anna").length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
