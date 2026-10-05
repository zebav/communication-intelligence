import type { ReactNode } from "react";
import { CalendarDays, HeartHandshake, MessageCircleMore, Sparkles } from "lucide-react";
import { SolvaniLogo, SolvaniMark } from "@/components/solvani-brand";

type AuthShellProps = {
  children: ReactNode;
  mode?: "login" | "mfa";
};

const capabilities = [
  { icon: MessageCircleMore, label: "Kommunikation" },
  { icon: HeartHandshake, label: "Relationer" },
  { icon: CalendarDays, label: "Tid och planering" },
  { icon: Sparkles, label: "Beslut och åtgärder" },
];

export function AuthShell({ children, mode = "login" }: AuthShellProps) {
  return (
    <main className={`auth-page auth-page--${mode}`}>
      <section className="auth-identity" aria-label="Om Solvani">
        <SolvaniLogo variant="light" />
        <div className="auth-identity-copy">
          <p className="auth-kicker">RELATIONSHIPS. ORGANIZED. OPPORTUNITIES. UNLOCKED.</p>
          <h2>Allt som betyder något.<br />En intelligent arbetsyta.</h2>
          <p>Kommunikation, relationer, tid och beslut – samlat på ett ställe.</p>
        </div>
        <div className="auth-capabilities" aria-label="Solvanis delar">
          {capabilities.map(({ icon: Icon, label }) => <div key={label}><Icon aria-hidden="true" size={18} /><span>{label}</span></div>)}
        </div>
        <div className="auth-ribbon" aria-hidden="true"><SolvaniMark size="lg" label="" /></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-brand"><SolvaniMark size="md" /><span>Solvani</span></div>
          {children}
        </div>
      </section>
    </main>
  );
}
