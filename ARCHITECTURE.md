# Architecture

Communication Intelligence starts as a modular Next.js monolith. The browser surface, server endpoints, domain logic, connector contracts, and AI boundary remain distinct without adding deployment complexity before it is needed.

## Milestone 1

- Next.js App Router, React, TypeScript, Tailwind CSS, and Lucide icons.
- Supabase PostgreSQL, Auth, Storage, and Row Level Security in an EU project.
- Vercel for application and preview deployments.
- Cloudflare Access in front of the private production application.
- Mock data and deterministic intelligence engines for product evaluation.
- `AIService` is the only allowed entry point for model calls. The current implementation is a mock until credentials, retention, and Responses API structured outputs are configured.

## Boundaries

- `src/lib/domain.ts`: source-independent domain types and deterministic policy.
- `src/lib/ai`: provider-independent AI service.
- `src/components`: product surfaces and interaction logic.
- `supabase/migrations`: authoritative database schema and RLS.
- Future connectors must normalize provider data before it reaches domain services.

Incoming data will follow: connector → normalize → deduplicate → resolve identity → persist → classify → summarize → detect commitments → score → recommend → optionally draft.
