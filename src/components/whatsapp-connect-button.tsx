"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseWhatsAppEmbeddedSignupEvent, type WhatsAppEmbeddedSignupSession } from "@/lib/connectors/whatsapp-embedded-signup";

declare global {
  interface Window {
    FB?: { init(options: Record<string, unknown>): void; login(callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>): void };
    fbAsyncInit?: () => void;
  }
}

type Config =
  | { mode: "direct" }
  | { mode: "embedded"; appId: string; configId: string; version: string };

export function WhatsAppConnectButton({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const session = useRef<WhatsAppEmbeddedSignupSession | null>(null);
  const config = useRef<Config | null>(null);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      const parsed = parseWhatsAppEmbeddedSignupEvent(event.data);
      if (parsed) session.current = parsed;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      try {
      const response = await fetch("/api/connectors/whatsapp/config");
      const setup = await response.json() as Config & { error?: string };
      if (!response.ok) throw new Error(setup.error || "WhatsApp coexistence is not configured yet.");
      if (setup.mode === "direct") {
        if (active) { config.current = setup; setReady(true); }
        return;
      }
      await new Promise<void>((resolve, reject) => {
        if (window.FB) return resolve();
        window.fbAsyncInit = () => { window.FB?.init({ appId: setup.appId, autoLogAppEvents: true, xfbml: false, version: setup.version }); resolve(); };
        const existing = document.getElementById("facebook-jssdk");
        if (!existing) { const script = document.createElement("script"); script.id = "facebook-jssdk"; script.src = "https://connect.facebook.net/en_US/sdk.js"; script.async = true; script.defer = true; script.onerror = () => reject(new Error("Meta's connection window could not be loaded.")); document.body.appendChild(script); }
      });
        if (active) { config.current = setup; setReady(true); }
      } catch (caught) {
        if (active) setStatus(caught instanceof Error ? caught.message : "The WhatsApp connection could not be prepared.");
      }
    };
    void prepare();
    return () => { active = false; };
  }, []);

  const connect = () => {
    const setup = config.current;
    if (!setup) { setStatus("The secure WhatsApp connection is still loading. Try again in a moment."); return; }
    if (setup.mode === "direct") {
      setBusy(true);
      setStatus("Connecting your verified WhatsApp Business account…");
      window.location.assign("/api/connectors/whatsapp/start");
      return;
    }
    if (!window.FB) { setStatus("The secure Meta connection is still loading. Try again in a moment."); return; }
    setBusy(true); session.current = null;
      setStatus("Choose your existing WhatsApp Business account in Meta…");
      const completeLogin = async (login: { authResponse?: { code?: string } }) => {
        const code = login.authResponse?.code;
        const selected = session.current;
        if (!code || !selected) { setBusy(false); setStatus("The connection was cancelled or Meta did not return the selected WhatsApp number."); return; }
        const complete = await fetch("/api/connectors/whatsapp/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...selected }) });
        const result = await complete.json() as { error?: string; accountIdentifier?: string };
        if (!complete.ok) { setBusy(false); setStatus(result.error || "The WhatsApp connection could not be completed."); return; }
        setBusy(false); setStatus(`Connected securely${result.accountIdentifier ? ` · ${result.accountIdentifier}` : ""}.`); router.refresh();
      };
      window.FB?.login((login) => { void completeLogin(login); }, { config_id: setup.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
  };

  return <div className="connector-actions"><button className="btn" disabled={busy || !ready} onClick={connect}>{busy ? "Connecting WhatsApp…" : !ready ? "Preparing WhatsApp…" : connected ? "Reconnect WhatsApp Business" : "Connect WhatsApp Business"}</button>{status && <small className={status.startsWith("Connected") ? "positive" : "muted"}>{status}</small>}</div>;
}
