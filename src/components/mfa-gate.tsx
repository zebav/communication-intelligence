"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { verifyMfa } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/client";

type Mode = "loading" | "enroll" | "verify";

export function MfaGate() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verification, verifyAction, pending] = useActionState(verifyMfa, undefined);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const supabase = createClient();
      const [{ data: assurance }, { data: factors, error: factorsError }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (!active) return;
      if (assurance?.currentLevel === "aal2") {
        router.replace("/");
        return;
      }

      if (factorsError) {
        setError("MFA kunde inte laddas. Logga in igen.");
        setMode("verify");
        return;
      }

      const verified = factors.totp.find((factor) => factor.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }

      const { data: enrollment, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Solvani",
      });
      if (!active) return;
      if (enrollError || !enrollment.totp) {
        setError("En ny autentiseringsapp kunde inte skapas. Försök igen.");
        setMode("verify");
        return;
      }
      setFactorId(enrollment.id);
      setQrCode(enrollment.totp.qr_code);
      setSecret(enrollment.totp.secret);
      setMode("enroll");
    }
    void prepare();
    return () => { active = false; };
  }, [router]);

  if (mode === "loading") return <div className="mfa-loading"><LoaderCircle size={22} className="spin" /><span>Förbereder säker inloggning…</span></div>;

  return <div className="mfa-content">
    <div className="auth-heading"><span className="eyebrow">Säker inloggning</span><h1>{mode === "enroll" ? "Ställ in din autentiseringsapp" : "Verifiera att det är du"}</h1><p>{mode === "enroll" ? "Skanna QR-koden med din autentiseringsapp och ange sedan den sexsiffriga koden." : "Ange den sexsiffriga koden från din autentiseringsapp för att fortsätta."}</p></div>
    {mode === "enroll" && qrCode && <div className="mfa-qr"><Image src={qrCode} alt="QR-kod för att ställa in autentiseringsapp" width={220} height={220} unoptimized /><details><summary>Kan du inte skanna QR-koden?</summary><code>{secret}</code></details></div>}
    <form className="auth-form" action={verifyAction}>
      <label htmlFor="code">Sexsiffrig kod</label>
      <input type="hidden" name="factorId" value={factorId} />
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus={mode === "verify"} />
      {(error || verification?.error) && <div className="auth-error" role="alert">{error || verification?.error}</div>}
      <button className="auth-submit" type="submit" disabled={pending || code.length !== 6 || !factorId}>{pending ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{pending ? "Verifierar…" : "Verifiera och fortsätt"}</button>
    </form>
  </div>;
}
