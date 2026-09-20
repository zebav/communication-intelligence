import { createHash } from "node:crypto";
import { checkBrowserRequest } from "./browser-network";

export type BrowserPage = { id: string; url: string };
type Check = typeof checkBrowserRequest;

/** A driver must report pages when they are created, navigated and closed. A
 * final snapshot is compared with those observations before any result can be
 * trusted. This is defense in depth, not remote-network enforcement. */
export class PageSetGuard {
  private readonly pages = new Map<string, string>();
  private failed = false;
  constructor(private readonly approvedUrls: readonly string[], private readonly check: Check = checkBrowserRequest) {}

  async opened(page: BrowserPage) { await this.observe(page); }
  async navigated(page: BrowserPage) { await this.observe(page); }
  closed(id: string) { this.pages.delete(id); }
  private async observe(page: BrowserPage) {
    if (this.failed || !page.id || !page.url) throw new Error("Webbplatsens navigering kunde inte verifieras.");
    try {
      const checked = await this.check({ url: page.url, method: "GET", approvedUrls: this.approvedUrls });
      this.pages.set(page.id, checked.url);
    } catch {
      this.failed = true;
      throw new Error("Webbplatsen navigerade utanför godkända adresser.");
    }
  }
  async verify(snapshot: readonly BrowserPage[]) {
    try {
      if (this.failed || !snapshot.length || snapshot.length !== this.pages.size) throw new Error("Alla öppna sidor kunde inte verifieras.");
      const ids = new Set<string>();
      for (const page of snapshot) {
        if (ids.has(page.id) || !this.pages.has(page.id)) throw new Error("En oväntad flik öppnades.");
        ids.add(page.id);
        const checked = await this.check({ url: page.url, method: "GET", approvedUrls: this.approvedUrls });
        if (checked.url !== this.pages.get(page.id)) throw new Error("En navigering saknar verifierad händelse.");
      }
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
}

/** Stable, tenant-scoped context key for a future Browserbase adapter. This
 * never enables or creates a persisted browser context by itself. */
export function browserContextScope(input: { userId: string; approvedHost: string; reuseApproved: boolean }) {
  if (!input.reuseApproved) return null;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.userId) || !/^[a-z0-9.-]+$/.test(input.approvedHost) || input.approvedHost.startsWith(".") || input.approvedHost.endsWith(".")) throw new Error("Webbläsarkontexten kunde inte avgränsas säkert.");
  return createHash("sha256").update(JSON.stringify([input.userId, input.approvedHost])).digest("hex");
}

export function navigationReachedTarget(expected: string, observed: string) {
  if (new URL(expected).href !== new URL(observed).href) throw new Error("Webbplatsen nådde inte den godkända adressen. Resultatet är osäkert.");
}

/** Preparation for a future final-action driver. Nothing in the current app
 * calls this to submit a form, make a booking or pay. */
export async function verifyFinalBrowserAction(input: {
  approvedUrl: string; approvedRevision: number; currentRevision: number;
  approvalExpiresAt: string; now: number; pages: readonly BrowserPage[];
  guard: PageSetGuard;
}) {
  if (input.currentRevision !== input.approvedRevision || !Number.isFinite(input.now) || Date.parse(input.approvalExpiresAt) <= input.now) throw new Error("Slutgodkännandet har ändrats eller gått ut.");
  await input.guard.verify(input.pages);
  if (!input.pages.some(page => new URL(page.url).href === new URL(input.approvedUrl).href)) throw new Error("Den godkända sidan är inte längre öppen.");
}

export function validateBrowserFile(input: { name: string; mime: string; bytes: number; destination: string }, policy: {
  exactDestination: string; allowedMime: readonly string[]; maxBytes: number;
}) {
  if (!/^[^/\\\0]{1,255}$/.test(input.name) || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > policy.maxBytes || !policy.allowedMime.includes(input.mime) || input.destination !== policy.exactDestination) throw new Error("Filen omfattas inte av det godkända filflödet.");
  return input;
}
