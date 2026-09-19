import { checkBrowserRequest } from "./browser-network";

export type BrowserRequestKind = "document" | "subresource" | "iframe" | "websocket" | "download" | "service-worker";

/** Policy for an eventual request-intercepting driver. The driver must install
 * interception before navigation and route EVERY request through this gate.
 * This cannot pin DNS or enforce traffic outside the driver; a trusted egress
 * proxy is still required before live execution can be enabled. */
export class BrowserEgressGate {
  private installed = false;
  private closed = false;
  private failed = false;
  private documents = 0;
  constructor(
    private readonly approvedUrls: readonly string[],
    private readonly check: typeof checkBrowserRequest = checkBrowserRequest,
  ) {}

  interceptionInstalled() {
    if (this.closed || this.failed || this.installed) throw new Error("Nätverksskyddet kunde inte installeras.");
    this.installed = true;
  }

  async authorize(input: { url: string; method: string; kind: BrowserRequestKind }) {
    if (!this.installed || this.closed || this.failed) throw new Error("Webbläsarens nätverksanrop är spärrade.");
    try {
      if (input.kind === "websocket" || input.kind === "download" || input.kind === "service-worker") throw new Error("Anropstypen är förbjuden.");
      const result = await this.check({ url: input.url, method: input.method, approvedUrls: this.approvedUrls });
      if (this.closed) throw new Error("Webbuppgiften har avslutats.");
      if (input.kind === "document") this.documents++;
      return result;
    } catch {
      this.failed = true;
      throw new Error("Ett nätverksanrop föll utanför webbuppgiftens godkännande.");
    }
  }

  verify() {
    if (!this.installed || this.closed || this.failed || this.documents < 1) throw new Error("Webbläsarens nätverk kunde inte verifieras.");
  }

  close() { this.closed = true; }
}
