import { describe, expect, it } from "vitest";
import { queueVaultIngestion } from "./ingestion-queue";

describe("vault ingestion queue diagnostics", () => {
  it("keeps database details out of the worker error", async () => {
    const database = {
      from: () => ({ upsert: async () => ({ error: { code: "23514", message: "private provider identifier" } }) }),
    };
    await expect(queueVaultIngestion(database as never, {
      ownerId: "owner", connectionId: "connection", provider: "provider", sourceType: "email",
      providerMessageId: "message", sourceMessageId: "source-message", sourceConversationId: "conversation",
    })).rejects.toThrow("vault_ingestion_queue_constraint");
  });

  it("reports a schema cache mismatch without exposing its field details", async () => {
    const database = {
      from: () => ({ upsert: async () => ({ error: { code: "PGRST204", message: "private column name" } }) }),
    };
    await expect(queueVaultIngestion(database as never, {
      ownerId: "owner", connectionId: "connection", provider: "provider", sourceType: "email",
      providerMessageId: "message", sourceMessageId: "source-message", sourceConversationId: "conversation",
    })).rejects.toThrow("vault_ingestion_queue_schema_mismatch");
  });
});
