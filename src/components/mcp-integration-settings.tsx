"use client";

import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Token = { id: string; fingerprint: string; scope: string; createdAt: string; expiresAt: string; lastUsedAt: string | null };
type ApiState = { endpoint: string; tokens: Token[] };
const date = (value: string | null) => value ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Aldrig använd";

export function McpIntegrationSettings() {
  const [state, setState] = useState<ApiState | null>(null);
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/settings/integrations/mcp", { cache: "no-store" });
    const data = await response.json() as ApiState & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "MCP-inställningarna kunde inte läsas.");
    setState(data);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((reason) => setError(reason instanceof Error ? reason.message : "MCP-inställningarna kunde inte läsas."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const request = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/settings/integrations/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = await response.json() as { error?: string; token?: string; tokenInfo?: Token; success?: boolean };
    if (!response.ok) throw new Error(data.error ?? "Åtgärden kunde inte genomföras.");
    return data;
  };
  const generate = async () => { setBusy(true); setError(""); setNotice(""); try { const data = await request({ action: "generate" }); setSecret(data.token ?? ""); setNotice("Ny MCP-nyckel skapad. Kopiera den nu — den visas aldrig igen."); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "MCP-nyckeln kunde inte skapas."); } finally { setBusy(false); } };
  const revoke = async (id: string) => { setBusy(true); setError(""); try { await request({ action: "revoke", id }); setNotice("MCP-nyckeln är återkallad."); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "MCP-nyckeln kunde inte återkallas."); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(secret); setNotice("Nyckeln är kopierad. Spara den i ChatGPT-konfigurationen nu."); } catch { setError("Nyckeln kunde inte kopieras automatiskt."); } };
  const test = async () => { if (!secret) return; setBusy(true); setError(""); try { await request({ action: "test", token: secret }); setNotice("Anslutningstest godkänt: initialize och båda Solvani-verktygen svarar."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Anslutningstestet misslyckades."); } finally { setBusy(false); } };
  const endpoint = state?.endpoint ?? "https://www.solvani.app/api/mcp";
  return <section className="card mcp-settings"><div className="card-top"><div><span className="eyebrow">PRIVAT INTEGRATION</span><h3>Solvani MCP</h3></div><ShieldCheck size={20} /></div><p>Anslut din privata Solvani-workspace till ChatGPT. Nyckeln kan bara skapas av ditt MFA-verifierade ägarkonto och lagras aldrig i klartext.</p><dl className="mcp-details"><div><dt>MCP-adress</dt><dd><code>{endpoint}</code></dd></div><div><dt>Behörighet</dt><dd>Kontakter: läsa och ändra kontaktbild efter ditt uttryckliga uppdrag.</dd></div></dl>{error && <p className="negative" role="alert">{error}</p>}{notice && <p className="positive" role="status">{notice}</p>}{secret ? <div className="mcp-secret"><strong>Kopiera din nya nyckel nu</strong><p>Den kan inte visas igen. Återkalla den direkt om den hamnar fel.</p><code>{secret}</code><div className="connector-actions"><button className="btn primary" type="button" onClick={() => void copy()}><Copy size={15} />Kopiera</button><button className="btn" type="button" disabled={busy} onClick={() => void test()}><RefreshCw size={15} />Testa anslutning</button></div><details><summary>Konfigurera i ChatGPT</summary><ol><li>Namn: <strong>Solvani</strong></li><li>Typ: <strong>Streamable HTTP</strong></li><li>URL: <code>{endpoint}</code></li><li>Header – Nyckel: <code>Authorization</code></li><li>Header – Värde: <code>Bearer &lt;klistra in nyckeln här&gt;</code></li></ol><p>Lämna <code>MCP_BEARER_TOKEN</code> tom och lägg inte till andra headers.</p></details></div> : <button className="btn primary" type="button" disabled={busy} onClick={() => void generate()}><KeyRound size={15} />Generera ny MCP-nyckel</button>}<div className="mcp-token-list"><h4>Aktiva MCP-nycklar</h4>{state === null ? <p className="muted">Hämtar nyckelstatus…</p> : state.tokens.length === 0 ? <p className="muted">Inga aktiva MCP-nycklar.</p> : state.tokens.map((token) => <article key={token.id}><div><strong>…{token.fingerprint}</strong><small>Skapad {date(token.createdAt)} · Senast använd {date(token.lastUsedAt)} · Går ut {date(token.expiresAt)}</small></div><button className="icon-button" type="button" aria-label="Återkalla MCP-nyckel" disabled={busy} onClick={() => void revoke(token.id)}><Trash2 size={16} /></button></article>)}</div></section>;
}
