"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type TokenRecord = {
  id: string;
  token_fingerprint: string;
  scope: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  status: "active" | "expired" | "revoked";
};

type TokenListResponse = { tokens?: TokenRecord[]; error?: string };
type TokenGenerationResponse = { token?: string; tokenRecord?: TokenRecord; error?: string };

const endpoint = "https://www.solvani.app/api/mcp";

function formatDate(value: string | null) {
  if (!value) return "Not used yet";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function readJson<T>(response: Response) {
  return response.json() as Promise<T>;
}

export function ManualMcpTokenManager() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<"generate" | "revoke" | "test" | null>(null);
  const [newToken, setNewToken] = useState("");
  const [testResult, setTestResult] = useState("");

  async function loadTokens() {
    setLoading(true);
    setActionError("");
    try {
      const response = await fetch("/api/settings/mcp-tokens", { cache: "no-store" });
      const payload = await readJson<TokenListResponse>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load MCP tokens.");
      setTokens(payload.tokens ?? []);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not load MCP tokens.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void Promise.resolve().then(loadTokens); }, []);

  async function generateToken() {
    setBusy("generate");
    setActionError("");
    setTestResult("");
    setNewToken("");
    try {
      const response = await fetch("/api/settings/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const payload = await readJson<TokenGenerationResponse>(response);
      if (!response.ok || !payload.token || !payload.tokenRecord) throw new Error(payload.error || "Could not generate an MCP token.");
      setNewToken(payload.token);
      setTokens((current) => [payload.tokenRecord!, ...current]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not generate an MCP token.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken(tokenId: string) {
    setBusy("revoke");
    setActionError("");
    try {
      const response = await fetch("/api/settings/mcp-tokens/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      const payload = await readJson<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not revoke the MCP token.");
      setTokens((current) => current.map((token) => token.id === tokenId ? { ...token, revoked_at: new Date().toISOString(), status: "revoked" } : token));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not revoke the MCP token.");
    } finally {
      setBusy(null);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(newToken);
      setTestResult("Token copied. Paste it into ChatGPT now; Solvani cannot show it again after you close this panel.");
    } catch {
      setActionError("Copy was blocked by this browser. Select the token and copy it manually.");
    }
  }

  async function testConnection() {
    if (!newToken) return;
    setBusy("test");
    setActionError("");
    setTestResult("");
    try {
      const response = await fetch("/api/settings/mcp-tokens/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: newToken }),
      });
      const payload = await readJson<{ ok?: boolean; tools?: string[]; error?: string }>(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "MCP connection test failed.");
      setTestResult(`Connection verified: ${payload.tools?.join(" and ")} are available.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "MCP connection test failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mcp-settings-page">
      <div className="mcp-settings-shell">
        <Link className="mcp-back-link" href="/?view=settings">← Back to Settings</Link>
        <p className="eyebrow">Private integration</p>
        <h1>Solvani MCP</h1>
        <p className="mcp-intro">Create a personal connection for ChatGPT Desktop or Web. It can find your contacts and change an avatar only when you explicitly ask it to.</p>

        <section className="mcp-endpoint-card" aria-label="MCP endpoint">
          <span>Streamable HTTP endpoint</span>
          <code>{endpoint}</code>
        </section>

        <section className="mcp-token-section" aria-labelledby="mcp-token-heading">
          <div className="mcp-section-head">
            <div><h2 id="mcp-token-heading">Personal bearer tokens</h2><p>Each token is limited to this private owner account and expires after one year.</p></div>
            <button className="btn primary" type="button" onClick={() => void generateToken()} disabled={busy !== null}>{busy === "generate" ? "Generating…" : "Generate new MCP token"}</button>
          </div>
          {actionError && <p className="mcp-error" role="alert">{actionError}</p>}
          {loading ? <p className="muted">Loading token status…</p> : tokens.length === 0 ? <div className="mcp-empty">No manual MCP tokens exist yet.</div> : <div className="mcp-token-list">
            {tokens.map((token) => <article className="mcp-token-row" key={token.id}>
              <div><strong>••••••••{token.token_fingerprint}</strong><span className={`mcp-token-state ${token.status}`}>{token.status}</span><small>Created {formatDate(token.created_at)} · Expires {formatDate(token.expires_at)}</small><small>Last used {formatDate(token.last_used_at)} · {token.scope}</small></div>
              {token.status === "active" && <button className="btn" type="button" onClick={() => void revokeToken(token.id)} disabled={busy !== null}>{busy === "revoke" ? "Revoking…" : "Revoke"}</button>}
            </article>)}
          </div>}
        </section>

        {newToken && <section className="mcp-new-token" aria-live="polite">
          <p className="eyebrow">Copy now</p>
          <h2>Your new MCP token</h2>
          <p>This is the only time Solvani can show this secret. Store it only in the ChatGPT connection setup — never in a URL, note, or shared document.</p>
          <code className="mcp-plaintext-token">{newToken}</code>
          <div className="mcp-action-row"><button className="btn primary" type="button" onClick={() => void copyToken()}>Copy token</button><button className="btn" type="button" onClick={() => void testConnection()} disabled={busy !== null}>{busy === "test" ? "Testing…" : "Test connection"}</button></div>
          {testResult && <p className="mcp-success" role="status">{testResult}</p>}
          <div className="mcp-setup-instructions">
            <h3>ChatGPT setup</h3>
            <ol>
              <li>Name: <strong>Solvani</strong></li>
              <li>Type: <strong>Streamable HTTP</strong></li>
              <li>URL: <code>{endpoint}</code></li>
              <li>Header key: <code>Authorization</code></li>
              <li>Header value: <code>Bearer &lt;PASTE_TOKEN_HERE&gt;</code></li>
            </ol>
            <p>Leave <code>MCP_BEARER_TOKEN</code> empty. No other headers are needed.</p>
          </div>
        </section>}
      </div>
    </main>
  );
}
