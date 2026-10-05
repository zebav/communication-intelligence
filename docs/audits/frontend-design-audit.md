# Solvani frontend design audit — October 2026

## Current product map

Primary workspace: Overview, Inbox (including source channels and Sent), Calendar, Notification Centre, Relationships and Contacts. Secondary functionality currently lives in Settings: Personal Context, Documents & Media, Services, Connections, Learning and Operations.

## Findings

1. Navigation mixes owner-facing work (Inbox, Calendar, Notiscenter) with administrative tools (Connections, diagnostics, setup). On mobile, only the five daily surfaces should be persistent.
2. Attachment presentation is repeated in Inbox, channel conversations, Notiscenter and Documents & Media. The prior implementation treated a retained asset as a prerequisite for opening it and used different open behaviours.
3. The UI contains several generations of green, dark-card styling and raw technical states. Primary actions, spacing and modal patterns are inconsistent.
4. Desktop three-column Inbox is useful, but must collapse into a deliberate message → details flow on small screens. This exists partially, but overlays and viewers need the same mobile treatment.
5. Long-lived components duplicate local card, badge, overlay, avatar and status patterns. We should consolidate only high-traffic primitives, not introduce a large design framework.

## Target information architecture

**Daily:** Today, Inbox, Decisions, Calendar, Contacts.

**Secondary:** Documents & Media, Places and Travel, Learning, Operations, Connections, Settings. Relationships remains a Contacts sub-area and direct page, never a duplicate person record.

## Design-system gaps and migration sequence

1. Establish semantic color, radius and shadow tokens; add production SVG brand assets. **In progress.**
2. Consolidate the attachment viewer and use it from every retained-asset surface. **In progress.**
3. Separate attachment retrieval, analysis and retention status in data and owner-facing diagnostics.
4. Add shared Button, Status badge, Empty/Loading/Error and Sheet primitives where repeated patterns genuinely exist.
5. Move daily navigation to a clear five-item mobile bar; place configuration in a secondary sheet.
6. Migrate high-frequency screens first: Inbox, Decisions, Calendar, Contacts and Documents. Validate at 320, 360, 375, 390 and 430 px before wider cosmetic work.

## Accessibility and verification

All new overlays require an accessible name, close action and keyboard escape behaviour. Every status needs readable text in addition to color. Visual completion is not acceptance: Gmail, Outlook, WhatsApp and Instagram attachment retrieval must be verified separately with real provider media before claiming end-to-end support.
# Authentication — Solvani reference screen

## Current problems addressed

The former login used the old internal-security-dashboard treatment: a generic bolt/shield brand icon, green focus and primary action colors, `Private workspace` language and the obsolete “communication command center” positioning. It did not represent Solvani’s broader product or its future mobile experience.

## Approved implementation

Authentication now uses the reusable Solvani S mark and wordmark, semantic `--solvani-*` design tokens and a blue primary action. Desktop uses a quiet split brand/authentication composition; mobile switches to a dedicated single-column layout rather than compressing the split view. The form remains e-mail, password and mandatory MFA only—no public registration and no unsupported OAuth controls were introduced.

## Components and assets

- `SolvaniMark` and `SolvaniLogo` are shared components backed by canonical SVG files in `public/brand`.
- `AuthShell` is shared by credential and MFA screens, so the security transition stays visually continuous.
- `src/app/icon.svg`, `src/app/apple-icon.svg` and `public/manifest.webmanifest` use the mark without wordmark text.

## Accessibility and mobile behavior

Inputs retain browser/password-manager autocomplete, visible blue focus, keyboard submission and correctly associated errors. The password visibility control has an accessible label. At 860px and below, brand content becomes a compact mobile header, touch targets remain at least 48px for the primary action, and the form has no nested desktop-card layout.
