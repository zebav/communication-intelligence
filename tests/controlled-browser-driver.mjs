import { createServer } from "node:http";
import { once } from "node:events";

// TEST ONLY: accepts neither a caller URL nor HTML. Not remote egress protection.
export async function readControlledFixture() {
  if (!process.env.CI_PLAYWRIGHT_MODULE || !process.env.CI_CHROME_EXECUTABLE) throw new Error("Local browser dependencies missing");
  const { chromium } = await import(/* @vite-ignore */ process.env.CI_PLAYWRIGHT_MODULE);
  const html = '<!doctype html><html lang="sv"><meta charset="utf-8"><title>Kontrollerad testsida</title><body><h1>Kontrollerat mötesunderlag</h1><p>Möteslokalen öppnar kl. 09.00. Ta med legitimation.</p><p>Detta är en lokal testsida utan externa resurser.</p></body></html>';
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/fixture") { res.writeHead(403); res.end(); return; }
    hits++;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'none'; frame-ancestors 'none'", "Cache-Control": "no-store" });
    res.end(html);
  });
  let browser, timer;
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/fixture`;
    browser = await chromium.launch({ executablePath: process.env.CI_CHROME_EXECUTABLE, headless: true, timeout: 15_000 });
    timer = setTimeout(() => { void browser.close(); }, 30_000);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", route => {
      const r = route.request();
      return r.url() === url && r.method() === "GET" && r.resourceType() === "document" && !r.redirectedFrom() ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "load", timeout: 10_000 });
    if (!response?.ok() || page.url() !== url) throw new Error("Fixture navigation failed");
    const text = await page.locator("body").innerText({ timeout: 5000 });
    if (!text.includes("Kontrollerat mötesunderlag") || hits !== 1) throw new Error("Fixture read failed");
    return { text, hits, localBrowser: true };
  } finally {
    clearTimeout(timer);
    try { if (browser) await browser.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
