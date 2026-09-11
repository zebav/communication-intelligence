import { describe, expect, it } from "vitest";
import { connectorById, connectorCatalog, connectorsForSource } from "./catalog";

describe("universal connector catalog", () => {
  it("keeps provider identifiers unique", () => { expect(new Set(connectorCatalog.map((item) => item.id)).size).toBe(connectorCatalog.length); });
  it("describes available and planned channels without claiming they are connected", () => { expect(connectorById("instagram-professional")?.availability).toBe("available"); expect(connectorById("instagram-professional")?.capabilities.incrementalSync).toBe(false); expect(connectorById("whatsapp-business")?.accountAudience).toBe("business-account"); });
  it("finds connectors by normalized source", () => { expect(connectorsForSource("email").map((item) => item.id)).toContain("microsoft-graph"); });
});
