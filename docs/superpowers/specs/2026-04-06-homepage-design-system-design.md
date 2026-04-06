# Design: Home page UX, CTA, and design-system foundations

**Date:** 2026-04-06  
**Status:** Approved for implementation planning  
**Scope:** `apps/web` home route (`app/page.tsx`), root chrome (`app/layout.tsx`), shared tokens (`app/globals.css`), and new layout/marketing primitives used on the home page first.

## Goals

- Improve **first-use and return-use** experience on the home dashboard.
- Strengthen **call to action** without collapsing the two main paths (intake vs projects).
- Establish **repeatable design-system building blocks** (tokens + a few components/patterns), not a one-off skin.

## Product decisions (from brainstorming)

| Topic | Decision |
|--------|----------|
| Primary intent | **Balanced:** intake and projects are peers; neither is the sole hero narrative. |
| Empty state (0 projects) | **Intake-forward:** more visual weight and space for intake; projects panel is clearly secondary. |
| With projects | Shift toward **balanced** two-column layout on large screens. |
| Mobile order | **Always:** intake block first, then projects (single rule). |
| Design system v1 | **Tokens + layout primitives + branded blocks** (hero band, short feature strip). |
| GitHub on home | **No** hero or co-primary GitHub story. **Per-project** repo link on the home list when criteria below are met. |

## Approach: progressive density

Single home surface (no tabs). Density and column bias change with data:

- **Empty:** hero + feature strip + **intake-dominant** main area; projects card secondary.
- **Has projects:** hero + strip remain (can be slightly more compact vertically if needed) + **balanced** two-column panels on `lg+`.
- **Mobile:** one column; order fixed (intake → projects).

**Rejected alternatives:** tabbed Intake/Projects (hurts dual-path parity); list-first with modal intake (conflicts with empty-state and mobile ordering).

## Page information architecture

Top to bottom:

1. **App chrome** (existing root layout): consider evolving the header from a generic “Dashboard” label to a **product-led** title line; out of scope for mandatory copy in this spec unless implementation touches the same PR.
2. **`PageHero`:** eyebrow, headline, one-line value prop. **No GitHub** messaging or primary actions here.
3. **`FeatureStrip`:** 2–3 short items (title + one line), describing the pipeline or outcomes. Responsive: stacked on small screens, row on `md+`.
4. **Main work area:** **Intake** panel and **Projects** panel.

### Responsive layout

- **`< lg`:** single column; **intake first**, **projects second** (always).
- **`lg+`, 0 projects:** intake panel gets **greater width and/or visual prominence**; projects panel beside or below, visually secondary.
- **`lg+`, ≥1 projects:** **two-column** layout with **near-equal** weight (slight bias toward projects is acceptable if list density requires it).

### CTA hierarchy

- **One primary** action for the page: the intake form’s main submit/continue control (existing behavior), styled as **primary** button variant.
- **Projects:** primary navigation is **row links** to `/projects/[id]`; section title/description clarify “resume work.”
- **Optional** “Jump to projects” link near the hero: **default off**; add only if usability testing shows scroll friction.

## Design tokens and primitives

**File:** extend `apps/web/app/globals.css` and mirror in `@theme inline` for Tailwind v4.

**Tokens to introduce (use only what this slice needs):**

- **Radius:** semantic steps (e.g. small/medium/large) for cards, inputs, and hero container—avoid ad hoc mixed `rounded-*` for the same role.
- **Spacing:** section vertical rhythm and gap between major regions (hero → strip → panels); optional consistent **inner padding** token for primary panels.
- **Surfaces:** a **muted hero background** (semantic variable, not a one-off hex) so the hero reads as a distinct region.
- **Elevation:** optional **subtle shadow** token for primary panels (intake/projects) only; keep the rest of the page comparatively flat.

**Primitives (homepage-first, reusable later):**

- **`AppSection`:** optional overline, title, description, children; standardizes spacing and heading structure below the hero.
- **`PageHero`** and **`FeatureStrip`:** implemented using the tokens above; props kept minimal (text slots + optional minor actions—not GitHub).

**Rule:** New home UI should **consume these tokens**; add new CSS variables only when at least one callsite exists.

## Branded blocks

### `PageHero`

- **Eyebrow** (short, optional): environment or product line.
- **Headline** + **supporting sentence:** outcome-oriented, plain language.
- Constrained line length; spacing from `FeatureStrip` via section tokens.

### `FeatureStrip`

- **2–3 items**, each: short title + single supporting line.
- Order matches the story (left/top = first step in the journey).

### Intake and projects panels

- Keep **card-based** panels consistent with existing `Card` usage; refresh **titles, descriptions, spacing, and hierarchy** to align with the hero.
- **Empty projects copy:** encouraging, points users to intake; avoid a second competing **primary** button unless metrics show confusion.

## GitHub: per-project link on home (no hero)

- **Do not** place GitHub connect or handoff **messaging in `PageHero`** or as a **co-primary** CTA.
- **On each project row** on the home list: show an **external link** to the repository when **`projects.source_repo_url`** is non-empty and is a safe **http(s)** URL.
- **Presentation:** icon + short label (e.g. “Repo” / “Open repo”—finalize in implementation); **`target="_blank"`** + **`rel="noopener noreferrer"`**; accessible name includes the project name.
- **Gating note:** OAuth today is tied to the handoff flow; a populated `source_repo_url` is the durable signal that a repo exists for that project. If the product later adds a user-level “GitHub connected” flag, **and** URLs could exist without user authorization, tighten visibility with that flag in a follow-up.

## Data and boundaries

- **Project list:** continues to use `listProjects` / `ProjectRow`; row UI may read `source_repo_url` for the optional link.
- **Intake form:** behavior unchanged unless small layout wrappers are required; no new API contracts in this design.

## Testing and acceptance (high level)

- **Empty state:** mobile and desktop show intake-forward layout; order is intake then projects on narrow viewports.
- **With projects:** desktop shows balanced columns; mobile order unchanged.
- **GitHub:** rows with `source_repo_url` show the external link; rows without do not; hero has no GitHub CTA.
- **Theming:** light and dark modes remain coherent for new tokens (hero surface, shadows, borders).
- **Accessibility:** heading order logical; external links clearly named; focus states visible (existing `ring` token usage).

## Out of scope

- New marketing landing route separate from the app shell.
- Full design-system documentation site or Storybook (optional follow-up).
- Changing pipeline business logic or GitHub OAuth server behavior beyond what is required to **read** `source_repo_url` for display.

## Next step

After review of this document, produce an implementation plan (`writing-plans` / execution workflow) that lists concrete files, token names, component locations, and any session/query additions for the project list.
