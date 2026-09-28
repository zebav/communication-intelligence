import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkspaceSnapshot } from "./workspace-snapshot";
import type { ComponentProps } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./workspace", () => ({ Workspace: ({ userEmail, backgroundPaused }: { userEmail: string; backgroundPaused: boolean }) => <div data-testid="workspace">{userEmail}{backgroundPaused ? " paused" : ""}</div> }));
afterEach(cleanup);
const data = (name: string) => ({ userEmail: name }) as ComponentProps<typeof WorkspaceSnapshot>["data"];
describe("workspace refresh protection", () => {
  it("retains loaded content across repeated failed refreshes and recovers", () => {
    const { rerender } = render(<WorkspaceSnapshot data={data("loaded")} failedSections={[]} />);
    rerender(<WorkspaceSnapshot data={data("empty fallback")} failedSections={["Kontakter"]} />);
    expect(screen.getByTestId("workspace").textContent).toBe("loaded paused");
    rerender(<WorkspaceSnapshot data={data("another empty fallback")} failedSections={["Follow-ups"]} />);
    expect(screen.getByTestId("workspace").textContent).toBe("loaded paused");
    rerender(<WorkspaceSnapshot data={data("recovered")} failedSections={[]} />);
    expect(screen.getByTestId("workspace").textContent).toBe("recovered");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps a safe partial workspace visible after a failed first load", () => {
    render(<WorkspaceSnapshot data={data("empty")} failedSections={["Kontakter"]} />);
    expect(screen.getByTestId("workspace").textContent).toBe("empty paused");
    expect(screen.getByRole("alert").textContent).toContain("ingenting har tagits bort");
  });
  it("uses the new owner snapshot when the authenticated owner changes", () => {
    const { rerender } = render(<WorkspaceSnapshot key="owner-a" data={data("private-a")} failedSections={[]} />);
    rerender(<WorkspaceSnapshot key="owner-b" data={data("empty")} failedSections={["Kontakter"]} />);
    expect(screen.getByTestId("workspace").textContent).toBe("empty paused");
  });
});
