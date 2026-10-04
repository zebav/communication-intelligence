# Solvani UI recovery audit

**Status:** recovery gate — no additional broad visual work may merge until the P0 token migration and the affected user journeys have been verified.

**Scope:** current `phase/stability-ux-remediation-v1`, reviewed against `a80bedd` (Relationship Intelligence baseline) and the current main branch on 4 October 2026. This is a code-level inventory, supplemented by the reported preview regressions. It does not claim that an authenticated end-to-end journey has been visually approved.

## Root cause

The application still declares a dark global theme in `src/app/globals.css`:

- `--bg`, `--panel`, `--panel-2`, `--line`, `--muted` and `--text` resolve to dark-mode values.
- `html, body` use those values and declare `color-scheme: dark`.
- the legacy component library uses these global variables and hard-coded dark/green values.
- the redesign commits (`3f11b6d` through `c6be232`) add page-scoped light overrides after legacy CSS rather than replacing the base system.

Consequently, a component rendered on a new white surface may still inherit `--muted`, `--text`, dark textareas, green intelligence banners, or old card backgrounds. This is the source of the contrast failures and the “two applications” appearance. The current stylesheet also contains more than one generation of `.card`, `.btn`, `.pill`, `.list-row`, `.intel-*`, and Settings styles.

### Required fix

1. Establish a light semantic token layer at the root: app/surface/elevated/subtle backgrounds, primary/secondary/muted/inverse text, subtle border, brand, focus and semantic statuses.
2. Move legacy dark treatment behind an explicit inverse/overlay class. It must not be the default.
3. Migrate shared primitives first: page, card, button, form control, badge, list row, empty/loading/error state, dialog/drawer.
4. Remove each legacy override only after its replacement has migrated every caller. Do not add another compatibility layer.

## Regression-causing commits

| Commit | Intended change | Audit result |
| --- | --- | --- |
| `3f11b6d` | application shell and Inbox | Light shell added without replacing dark root tokens; mixed component inheritance begins. |
| `d760204`, `915f316`, `9923a07`, `f0bb720` | screen-specific visual passes | Increase the number of locally light pages while legacy child components stay dark. |
| `f7d88cb`, `16ae689`, `c6be232` | Notiscenter, Documents, mobile navigation | Continue the same CSS layering pattern. Mobile menu is functional but must be retested after primitives migrate. |
| `a80bedd` → current | Relationship page moved from server-rendered route to client workspace/API | Functional-risk change: data now depends on a separate `/api/relationships` request and MFA API response. Loading/error/empty behavior and rank/card parity must be verified before claiming recovery. |

## Screen inventory

| Screen | Status | Evidence / issue | Recovery requirement |
| --- | --- | --- | --- |
| Login | NEEDS POLISH | Isolated auth styling is newer than global tokens; must be checked against shared controls and focus states. | Keep layout; migrate to semantic tokens and verify mobile. |
| Today / Overview | NEEDS POLISH | Light page override, but generic cards and status labels can inherit legacy styles. | Migrate shared cards and metric strip. |
| Inbox | NEEDS POLISH | New light shell wraps legacy insight and attachment components. | Migrate reader, intelligence drawer, attachments and composer as one journey. |
| Conversation | NEEDS POLISH | Bubble is light, but inherited links/media/meta may remain legacy dark/green. | Verify text, links, media and scheduled-send controls. |
| Solvani Insight | BROKEN | Existing `.intel`, `.reply-section`, textarea and learning styles are dark/green defaults inside a light drawer. | Replace with intelligence surface and shared form primitives. |
| Decision view | BROKEN | Decision/approval components use several status, dark-card and raw technical variants. | Consolidate to light decision cards; reserve green for confirmed outcomes. |
| Notification Center | NEEDS POLISH | Latest CSS improves shell, but child components still rely on legacy styles. | Migrate all task detail and proposal states; test dismissal. |
| Contacts | NEEDS POLISH | Light list/detail overrides exist; remaining editor and toolbar strings are mixed-language. | Migrate filters, editor, summaries and mobile list/detail flow. |
| Contact profile | NEEDS POLISH | Detail inherits mixed legacy form and timeline rules. | Ensure readable fields, contrast, photo action and touch targets. |
| Relationship Intelligence | NEEDS VERIFICATION | Server page was replaced by client fetch/API. Resilient client loading, cancellation and a visible retry path are now covered by a focused component test; authenticated route/API and MFA parity still need preview verification. | Verify authenticated API/MFA flow and ranking parity before visual work. |
| Calendar | NEEDS POLISH | CSS is an additive override rather than migrated primitives. | Audit drawer, controls, event detail and mobile week view. |
| Follow-ups | BROKEN | Still relies on generic dark list/card primitives. | Migrate after shared list row primitive exists. |
| Analyze Conversation | BROKEN | Legacy `.intel-*` design remains dark/green and can sit on light pages. | Migrate with Solvani Insight. |
| Clean Up | BROKEN | Generic list/filter styles inherit dark tokens on light page. | Migrate after common filters/list rows. |
| Settings | BROKEN | Nine horizontal tabs, excessive header and old `PRIVATE WORKSPACE` language; child pages mix systems. | Replace with grouped Settings navigation; remove legacy header copy. |
| Personal Context | BROKEN | Raw dark editor inside light page. | Display readable structured summaries; reveal editor only on Edit. |
| Documents & Media | NEEDS POLISH | Card direction is useful but inherited connection/modal primitives remain legacy. | Standardise height, filters, service chips and preview action. |
| Services & Tools | BROKEN | Large dark connector cards and repeated security copy. | Use compact light service cards with provider/account/status/capabilities/actions. |
| Learning & Memory | BROKEN | Black metric strip, green banners, dark cards, mixed language. | Use “What Solvani has learned” review groups and violet observation styling. |
| Outcomes | BROKEN | Generic dark analytics/card patterns. | Use lightweight outcome cards; move into Learning/Communication Intelligence after IA review. |
| Connections | BROKEN (P0) | Reported invisible text and overflow align with `.list-row` fixed columns and inherited dark colors. | Rebuild responsive connection row; no overflow; compact actions. |
| Operations | BROKEN | Raw diagnostic status is exposed as dense text and old cards. | Structured provider health rows; technical details behind disclosure. |
| Plan & Usage | NEEDS POLISH | Settings tab inherits overloaded horizontal navigation and mixed card styles. | Move to Account group; use semantic status cards. |
| Security | NEEDS POLISH | Security is a Settings sibling but uses legacy terminology/surfaces. | Keep security-specific inverse/status treatment only where meaningful. |

## Legacy inventory

| Area | Classification | Migration plan |
| --- | --- | --- |
| Dark root variables and `color-scheme: dark` | REPLACE | Make light semantic token set the default; explicit inverse surface only. |
| Generic `.card`, `.btn`, `.pill`, `.list`, `.list-row`, `.filter` | REPLACE | Convert to primitives with semantic tokens, then migrate callers. |
| `.intel-*`, `.reply-section`, `.deep-*`, green suggestion blocks | REPLACE | New blue/violet intelligence surface. Keep green only for confirmed success. |
| Inbox shell and responsive list/reader flow | KEEP AND MIGRATE | Preserve behavior; rebase all child styles on primitives. |
| Attachment viewer | KEEP AND MIGRATE | It is a useful shared component; migrate overlay, text and media surfaces. |
| Contact / relationship ranking cards | KEEP AND MIGRATE | Preserve data and contact links; migrate typography and state styles. |
| Page-specific appended visual overrides | DELETE AFTER MIGRATION | Remove in the same change as their primitive replacement to prevent ordering-dependent styling. |

## Verification gate

Before another broad UI merge:

1. Run automated contrast checks for primary, secondary and muted text, links, buttons, badges, placeholders, focus and disabled states. Normal text must meet 4.5:1; large text 3:1.
2. Visual-check every screen above at 320, 360, 375, 390 and 430px, plus desktop.
3. Run functionality checks for Inbox reply/scheduled send, Notification Center dismiss, Contacts edit/photo, relationship ranking/backfill, Calendar edit, document viewer, connector management and Settings navigation.
4. Test direct `/relationships` route and the in-workspace Relationships view under MFA; test API failure/retry and empty data.
5. Only then present a single, focused preview for owner review. No production promotion is implied by this audit.

## P0 repair update — 4 October 2026

The current branch now establishes the approved light semantic token system at the
root and explicitly scopes the inverse treatment to the application shell. Shared
surfaces, controls, form fields, badges, progress indicators and Settings panels
use semantic tokens. Settings is now grouped into Personal, Data, Integrations,
System and Account; Outcomes is presented inside Learning & Memory rather than as
a top-level destination. Connections has responsive, wrap-safe rows and keeps
provider/account/status/capability/action information readable at narrow widths.

Relationship Intelligence was also checked against the real production schema
without reading message contents. The observed state is not a zero-data result:
a durable historical backfill job is queued with no processed people and no
relationship snapshots. The production schema is also behind the branch's
observability migration. The UI now reports a queued/indeterminate state rather
than showing invented `0 / ?` progress, Operations can read the legacy job shape,
and creation falls back safely during a staged migration. Actual historical
ranking remains blocked until a controlled production release applies the existing
observability migration and schedules the already-present backfill worker.

Automated verification for this repair: typecheck, 544 tests, lint, build and
diff whitespace validation. Authenticated visual review remains a release gate;
it cannot be claimed from an unauthenticated preview.
