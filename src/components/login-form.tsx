"use client";

import { useActionState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";
import { login } from "@/app/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return <form action={action} className="auth-form">
    <label htmlFor="email">E-post</label>
    <div className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus /></div>
    <label htmlFor="password">Lösenord</label>
    <div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={8} required /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Dölj lösenord" : "Visa lösenord"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
    {state?.error && <div className="auth-error" role="alert">{state.error}</div>}
    <button className="auth-submit" type="submit" disabled={pending}>
      {pending ? <LoaderCircle size={15} className="spin" /> : <LockKeyhole size={15} />}
      {pending ? "Loggar in…" : "Logga in"}
      {!pending && <ArrowRight size={14} />}
    </button>
  </form>;
}
