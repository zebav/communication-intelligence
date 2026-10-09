import { describe, expect, it } from "vitest";
import { safeOperationFailureSummary } from "./operations-status";

describe("safeOperationFailureSummary", () => {
  it("does not expose raw provider errors", () => {
    expect(safeOperationFailureSummary("gmail_403 https://private.example/token")).toBe("Källfilen kunde inte hämtas från den anslutna tjänsten.");
  });

  it("maps reconnect and analysis failures to useful next-step text", () => {
    expect(safeOperationFailureSummary("reconnect_required")).toBe("En anslutning behöver loggas in igen.");
    expect(safeOperationFailureSummary("audio_transcription_429_failed")).toBe("Innehållet kunde inte analyseras ännu.");
  });
});
