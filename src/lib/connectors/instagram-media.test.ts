import { describe, expect, it, vi } from "vitest";
import { downloadEphemeralInstagramMedia, ephemeralInstagramMediaUrls } from "./instagram-media";

describe("ephemeral Instagram media", () => {
  it("keeps provider URLs only in transient webhook memory", () => {
    const urls = ephemeralInstagramMediaUrls(JSON.stringify({ object: "instagram", entry: [{ messaging: [{ message: { mid: "mid-1", attachments: [{ payload: { url: "https://lookaside.fbsbx.com/media?token=secret" } }] } }] }] }));
    expect(urls.get("mid-1")).toEqual(["https://lookaside.fbsbx.com/media?token=secret"]);
  });
  it("rejects an untrusted host before a fetch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(downloadEphemeralInstagramMedia(["https://evil.example/media"])).rejects.toThrow("untrusted_instagram_media_url");
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
