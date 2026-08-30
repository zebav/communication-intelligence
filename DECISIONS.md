# Architecture Decisions

## ADR-001 — Modular monolith

Accepted. Milestone 1 uses one Next.js application with explicit domain, AI, connector, and persistence boundaries. Microservices would add operational risk without product value.

## ADR-002 — Deterministic intelligence prototype

Accepted. Attention scores and recommended actions start as transparent deterministic logic using realistic mock data. This makes the UX testable before private conversation data or model credentials are introduced.

## ADR-003 — Human approval

Accepted. External sending and destructive cleanup actions require explicit approval. The prototype exposes review states but does not execute external actions.

## ADR-004 — Supabase as system of record

Accepted. PostgreSQL, Auth, Storage, and RLS remain within Supabase. No separate vector database is introduced in V1.

## ADR-005 — MFA enforcement at the application and database boundaries

Accepted. The application redirects every authenticated AAL1 session to TOTP verification. RLS additionally rejects application-data access unless the Supabase JWT carries `aal2`, preventing UI bypass from weakening authorization.
