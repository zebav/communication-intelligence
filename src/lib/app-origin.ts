const previewHost = /^communication-intelligence(?:-[a-z0-9-]+)?\.vercel\.app$/i;
const productionHosts = new Set(["solvani.app", "www.solvani.app"]);

/**
 * OAuth flows may return to the stable Solvani address or to an authenticated
 * preview. Keep this intentionally small: it is an open-redirect boundary.
 */
export function isPermittedAppOrigin(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (productionHosts.has(url.hostname.toLowerCase()) || previewHost.test(url.hostname));
  } catch {
    return false;
  }
}

export function permittedAppOrigin(value: string | null | undefined) {
  return isPermittedAppOrigin(value) ? new URL(value!).origin : null;
}
