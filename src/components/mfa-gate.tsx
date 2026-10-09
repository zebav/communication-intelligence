"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { verifyMfa } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "enroll" | "verify";

type MfaGateProps = {
  verifiedFactorId?: string;
  enrollmentRequired: boolean;
  loadError?: string;
};

export function MfaGate({ verifiedFactorId, enrollmentRequired, loadError }: MfaGateProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(verifiedFactorId ? "verify" : "loading");
  const [factorId, setFactorId] = useState(verifiedFactorId ?? "");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verification, verifyAction, pending] = useActionState(verifyMfa, undefined);

  useEffect(() => {
    let active = true;
    async function prepare() {
      if (verifiedFactorId) {
        setFactorId(verifiedFactorId);
        setMode("verify");
        return;
      }

      if (loadError || !enrollmentRequired) {
        setError(loadError ?? "Din autentiseringsapp kunde inte förberedas. Försök igen.");
        setMode("verify");
        return;
      }

      const supabase = createClient();
      let enrollment: Awaited<ReturnType<typeof supabase.auth.mfa.enroll>>;
      try {
        enrollment = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Solvani",
        });
      } catch {
        if (!active) return;
        setError("En ny autentiseringsapp kunde inte skapas. Försök igen.");
        setMode("verify");
        return;
      }
      if (!active) return;
      if (enrollment.error || !enrollment.data.totp) {
        setError("En ny autentiseringsapp kunde inte skapas. Försök igen.");
        setMode("verify");
        return;
      }
      setFactorId(enrollment.data.id);
      setQrCode(enrollment.data.totp.qr_code);
      setSecret(enrollment.data.totp.secret);
      setMode("enroll");
    }
    void prepare();
    return () => { active = false; };
  }, [enrollmentRequired, loadError, router, verifiedFactorId]);

  if (mode === "loading") return <div className="mfa-loading"><LoaderCircle size={22} className="spin" /><span>Förbereder säker inloggning…</span></div>;

  return <div className="mfa-content">
    <div className="auth-heading"><span className="eyebrow">Säker inloggning</span><h1>{mode === "enroll" ? "Ställ in din autentiseringsapp" : "Verifiera att det är du"}</h1><p>{mode === "enroll" ? "Skanna QR-koden med din autentiseringsapp och ange sedan den sexsiffriga koden." : "Ange den sexsiffriga koden från din autentiseringsapp för att fortsätta."}</p></div>
    {mode === "enroll" && qrCode && <div className="mfa-qr"><Image src={qrCode} alt="QR-kod för att ställa in autentiseringsapp" width={220} height={220} unoptimized /><details><summary>Kan du inte skanna QR-koden?</summary><code>{secret}</code></details></div>}
    {!factorId && error ? <div className="auth-form"><div className="auth-error" role="alert">{error}</div><button className="auth-submit" type="button" onClick={() => router.refresh()}>Försök igen</button></div> : <form className="auth-form" action={verifyAction}>
      <label htmlFor="code">Sexsiffrig kod</label>
      <input type="hidden" name="factorId" value={factorId} />
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus={mode === "verify"} />
      {(error || verification?.error) && <div className="auth-error" role="alert">{error || verification?.error}</div>}
      <button className="auth-submit" type="submit" disabled={pending || code.length !== 6 || !factorId}>{pending ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{pending ? "Verifierar…" : "Verifiera och fortsätt"}</button>
    </form>}
  </div>;
}
