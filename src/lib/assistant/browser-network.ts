import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const v6Global = new BlockList();
v6Global.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");

export function publicBrowserAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  // Conservatively exclude mapped, transition, local and non-global IPv6 ranges.
  return family === 6 && v6Global.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

type Resolver = (host: string) => Promise<ReadonlyArray<{ address: string }>>;
/** Preflight only. The remote browser MUST enforce these rules on its actual network path too. */
export async function checkBrowserRequest(
  input: { url: string; method: string; approvedUrls: readonly string[] },
  resolve: Resolver = host => lookup(host, { all: true }),
) {
  if (input.method !== "GET" && input.method !== "HEAD") throw new Error("Inlämning kräver ett separat godkännande.");
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Webbadressen är inte tillåten.");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(url.hostname) || /\.(local|localhost|internal|test|invalid|onion)$/.test(url.hostname)) throw new Error("Webbplatsen är inte offentlig.");
  url.hash = "";
  if (!input.approvedUrls.some(raw => { const allowed = new URL(raw); allowed.hash = ""; return allowed.href === url.href; })) throw new Error("Adressen omfattas inte av godkännandet.");
  const addresses = await resolve(url.hostname);
  if (!addresses.length || addresses.some(item => !publicBrowserAddress(item.address))) throw new Error("Webbplatsens nätverksadress kunde inte godkännas.");
  return { url: url.href, addresses: addresses.map(item => item.address) };
}
