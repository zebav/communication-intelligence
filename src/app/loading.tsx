import { LoaderCircle } from "lucide-react";

export default function WorkspaceLoading() {
  return (
    <main className="auth-page">
      <section className="auth-card mfa-card">
        <div className="mfa-loading" role="status" aria-live="polite">
          <LoaderCircle size={22} className="spin" />
          <span>Loading your communication overview…</span>
        </div>
      </section>
    </main>
  );
}
