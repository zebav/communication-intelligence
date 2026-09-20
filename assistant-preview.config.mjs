const previewConfig = {
  cacheDir: "/private/tmp/ci-assistant-preview-cache",
  plugins: [{ name: "isolated-browser-lab", configureServer(server) {
    server.middlewares.use("/__browser_lab", async (req, res) => {
      res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
      if (req.method !== "POST" || req.headers.origin !== "http://127.0.0.1:4326" || req.headers.host !== "127.0.0.1:4326") { res.statusCode = 403; res.end(JSON.stringify({ error: "Endast lokalt test tillåts." })); return; }
      try {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error("För stor begäran."); }
        const labModule = await server.ssrLoadModule("/tests/browser-lab-server.ts");
        res.end(JSON.stringify(await labModule.browserLabAction(JSON.parse(body))));
      } catch { res.statusCode = 409; res.end(JSON.stringify({ error: "Testet kunde inte köras. Godkännandet kan vara förbrukat eller utgånget; förbered ett nytt test." })); }
    });
  } }],
  esbuild: { jsx: "automatic" }, envDir: "/private/tmp/ci-calendar-browser",
  server: { host: "127.0.0.1", port: 4326, strictPort: true },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname, "next/navigation": new URL("./tests/assistant-navigation-stub.ts", import.meta.url).pathname } },
};
export default previewConfig;
