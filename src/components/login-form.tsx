"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { login } from "@/app/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return <form action={action} className="auth-form">
    <label htmlFor="email">Email</label>
    <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
    <label htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />
    {state?.error && <div className="auth-error" role="alert">{state.error}</div>}
    <button className="auth-submit" type="submit" disabled={pending}>
      {pending ? <LoaderCircle size={15} className="spin" /> : <LockKeyhole size={15} />}
      {pending ? "Signing in…" : "Sign in"}
      {!pending && <ArrowRight size={14} />}
    </button>
  </form>;
}
