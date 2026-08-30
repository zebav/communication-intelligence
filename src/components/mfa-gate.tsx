"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
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
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const supabase = createClient();
      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance?.currentLevel === "aal2") {
        router.replace("/");
        return;
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (factorsError) {
        setError("MFA setup could not be loaded. Please sign in again.");
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
        friendlyName: "Communication Intelligence",
      });
      if (!active) return;
      if (enrollError || !enrollment.totp) {
        setError("A new authenticator could not be created. Please try again.");
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

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || code.length !== 6) return;
    setPending(true);
    setError("");
    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError("The verification challenge could not be started.");
      setPending(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    if (verifyError) {
      setError("The six-digit code is incorrect or has expired.");
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (mode === "loading") return <div className="mfa-loading"><LoaderCircle size={22} className="spin" /><span>Preparing secure sign-in…</span></div>;

  return <div className="mfa-content">
    <div className="auth-icon"><KeyRound size={22} /></div>
    <span className="eyebrow">Required security step</span>
    <h1>{mode === "enroll" ? "Set up your authenticator" : "Verify it’s you"}</h1>
    <p>{mode === "enroll" ? "Scan this QR code with your authenticator app, then enter its six-digit code." : "Enter the six-digit code from your authenticator app."}</p>
    {mode === "enroll" && qrCode && <div className="mfa-qr"><Image src={qrCode} alt="QR code for authenticator enrollment" width={220} height={220} unoptimized /><details><summary>Can’t scan the QR code?</summary><code>{secret}</code></details></div>}
    <form className="auth-form" onSubmit={verify}>
      <label htmlFor="code">Six-digit code</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus={mode === "verify"} />
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="auth-submit" type="submit" disabled={pending || code.length !== 6 || !factorId}>{pending ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{pending ? "Verifying…" : "Verify and continue"}</button>
    </form>
  </div>;
}
