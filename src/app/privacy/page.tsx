import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Communication Intelligence",
  description: "How Communication Intelligence handles personal data and connected communication accounts.",
};

const updated = "11 September 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#0a0b0d] px-5 py-12 text-zinc-100 sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-zinc-400 transition hover:text-white">
          ← Communication Intelligence
        </Link>

        <header className="mt-10 border-b border-white/10 pb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-400">
            Privacy
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-zinc-400">Last updated: {updated}</p>
        </header>

        <div className="space-y-10 py-10 text-[15px] leading-7 text-zinc-300">
          <section>
            <h2 className="text-xl font-semibold text-white">What this service does</h2>
            <p className="mt-3">
              Communication Intelligence is a private communication assistant. It can connect to
              communication services selected by the user, organize conversations, identify relevant
              follow-ups, and prepare suggested replies. The user remains in control of connections
              and external actions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Information we process</h2>
            <p className="mt-3">
              Depending on the features and accounts the user chooses to connect, the service may
              process account identifiers, profile information, contact details, message content,
              attachments, conversation metadata, connection tokens, user preferences, suggested
              replies, feedback, and action history.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">How information is used</h2>
            <p className="mt-3">
              Information is used only to provide and secure the requested service: authenticating
              the user, synchronizing connected accounts, displaying and organizing communications,
              producing analysis and reply suggestions, detecting commitments and relevant actions,
              improving the user&apos;s private communication profile, preventing duplicates, and
              diagnosing service errors.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Connected services and AI providers</h2>
            <p className="mt-3">
              When the user connects a third-party account, such as Instagram, Microsoft, or Google,
              relevant information is received through that provider&apos;s authorized API. Selected
              communication content may be sent to contracted infrastructure and AI providers solely
              to perform the requested analysis. We do not sell personal data or use connected
              messages for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Security and access</h2>
            <p className="mt-3">
              Access is restricted to authenticated users. Connection credentials are stored as
              protected secrets, and reasonable technical and organizational safeguards are used to
              protect stored and transmitted information. No online service can guarantee absolute
              security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Retention and deletion</h2>
            <p className="mt-3">
              Information is retained only while needed to provide the service or meet applicable
              legal obligations. Users may disconnect a provider to stop future synchronization and
              may request deletion of connected account data, stored conversations, profiles, and
              account information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Your choices and rights</h2>
            <p className="mt-3">
              Subject to applicable law, users may request access, correction, export, restriction,
              or deletion of their personal data and may withdraw a connected service&apos;s
              authorization through Communication Intelligence or the provider&apos;s own account
              settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Changes to this policy</h2>
            <p className="mt-3">
              This policy may be updated as the service develops. Material changes will be reflected
              on this page together with a revised update date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p className="mt-3">
              Questions or privacy requests can be submitted directly to the operator of
              Communication Intelligence through the established contact channel used for access to
              this private service.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
