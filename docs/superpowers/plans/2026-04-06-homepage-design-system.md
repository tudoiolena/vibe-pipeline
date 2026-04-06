# Home page UX and design-system foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved home dashboard experience: progressive layout (intake-forward when empty, balanced when projects exist), branded hero + feature strip, shared CSS tokens, refreshed intake/projects cards, and per-project repo links when `source_repo_url` is a safe HTTP(S) URL—without GitHub messaging in the hero.

**Architecture:** `app/page.tsx` loads project data once via existing `getProjects()`, composes new presentational components (`PageHero`, `FeatureStrip`, optional `AppSection` wrapper), and applies responsive grid classes for empty vs. non-empty states. Shared tokens live in `globals.css` with dark-mode pairs. A tiny pure helper `isDisplayableHttpUrl` centralizes repo-link visibility rules and is unit-tested with Vitest (new to `apps/web`). `ProjectList` becomes a synchronous server component that receives `ProjectListResult` from the page to avoid duplicate fetches.

**Tech stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4 (`@import "tailwindcss"`, `@theme inline`), existing shadcn-style UI (`Card`, `Button`, `lucide-react`), Vitest (Node environment) for unit tests only.

**Specification:** `docs/superpowers/specs/2026-04-06-homepage-design-system-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `apps/web/app/globals.css` | New semantic CSS variables (radius, section padding/gap, muted hero surface, panel shadow) + `@theme inline` entries needed for Tailwind utilities (if any). |
| `apps/web/lib/repo-display-url.ts` | `isDisplayableHttpUrl()` — pure guard for showing external repo links. |
| `apps/web/lib/repo-display-url.test.ts` | Vitest tests for the guard. |
| `apps/web/vitest.config.ts` | Vitest config (Node, `include: ['**/*.test.ts']`). |
| `apps/web/package.json` | Add `vitest` devDependency and `"test": "vitest run"` script. |
| `apps/web/components/home/page-hero.tsx` | Branded hero: optional eyebrow, title (`h2`), subtitle. |
| `apps/web/components/home/feature-strip.tsx` | 2–3 feature items; responsive grid. |
| `apps/web/components/home/app-section.tsx` | Optional overline + title + description + children (spacing primitive). |
| `apps/web/components/home/index.ts` | Barrel exports for the three components. |
| `apps/web/app/page.tsx` | Async server page: fetch projects, render hero, strip, responsive main grid, pass data to `ProjectList`. |
| `apps/web/features/project-list/ui/project-list.tsx` | Sync component; props: `ProjectListResult`; repo link row UI. |
| `apps/web/features/intake-form/ui/intake-form.tsx` | Copy and hierarchy tweaks; primary submit `Button` uses `size="lg"`. |
| `apps/web/app/layout.tsx` | Product-led header copy (optional but included in same effort). |

---

### Task 1: Repo URL guard (TDD)

**Files:**

- Create: `apps/web/lib/repo-display-url.ts`
- Create: `apps/web/lib/repo-display-url.test.ts`
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add Vitest to the web workspace**

```bash
cd apps/web && npm install -D vitest@^3
```

Add to `apps/web/package.json` inside `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Add `vitest.config.ts`**

Create `apps/web/vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  }
});
```

- [ ] **Step 3: Write the failing test file**

Create `apps/web/lib/repo-display-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDisplayableHttpUrl } from "./repo-display-url";

describe("isDisplayableHttpUrl", () => {
  it("returns false for null, undefined, empty, whitespace", () => {
    expect(isDisplayableHttpUrl(null)).toBe(false);
    expect(isDisplayableHttpUrl(undefined)).toBe(false);
    expect(isDisplayableHttpUrl("")).toBe(false);
    expect(isDisplayableHttpUrl("   ")).toBe(false);
  });

  it("returns false for non-http(s) schemes", () => {
    expect(isDisplayableHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isDisplayableHttpUrl("ftp://example.com/repo")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isDisplayableHttpUrl("not a url")).toBe(false);
  });

  it("returns true for http and https URLs", () => {
    expect(isDisplayableHttpUrl("https://github.com/org/repo")).toBe(true);
    expect(isDisplayableHttpUrl("http://example.com/a")).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests — expect failure**

```bash
cd apps/web && npm run test
```

Expected: FAIL (module `./repo-display-url` missing or function missing).

- [ ] **Step 5: Implement the guard**

Create `apps/web/lib/repo-display-url.ts`:

```ts
/**
 * Returns true when the value is a non-empty string parseable as URL with http: or https: scheme.
 * Used to decide whether to render an external repo link on the home project list.
 */
export function isDisplayableHttpUrl(raw: string | null | undefined): raw is string {
  if (raw == null) {
    return false;
  }
  const s = raw.trim();
  if (s.length === 0) {
    return false;
  }
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd apps/web && npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/vitest.config.ts apps/web/lib/repo-display-url.ts apps/web/lib/repo-display-url.test.ts
git commit -m "test(web): add isDisplayableHttpUrl guard with vitest"
```

---

### Task 2: Design tokens in `globals.css`

**Files:**

- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Extend `:root` and `@media (prefers-color-scheme: dark)`**

In `apps/web/app/globals.css`, after the existing `--ring` line inside `:root` (and parallel block in dark mode), add semantic tokens:

**Light `:root` additions:**

```css
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-hero: var(--radius-lg);
  --radius-card: var(--radius-lg);
  --pad-section-x: 1.5rem;
  --pad-section-y: 1.75rem;
  --section-gap: 1.5rem;
  --pad-panel: 1.5rem;
  --surface-muted: oklch(0.96 0.01 250);
  --shadow-panel: 0 1px 2px oklch(0 0 0 / 0.05), 0 1px 3px oklch(0 0 0 / 0.08);
```

**Dark mode** (inside the existing `@media (prefers-color-scheme: dark)` `:root` block):

```css
  --surface-muted: oklch(0.2 0.02 260);
  --shadow-panel: 0 1px 2px oklch(0 0 0 / 0.4), 0 1px 3px oklch(0 0 0 / 0.35);
```

- [ ] **Step 2: Mirror in `@theme inline`**

Add to the existing `@theme inline` block so Tailwind can reference them if you use arbitrary theme keys (optional but keeps one source of truth):

```css
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-hero: var(--radius-hero);
  --radius-card: var(--radius-card);
  --spacing-section-gap: var(--section-gap);
  --color-surface-muted: var(--surface-muted);
```

(If TypeScript or Tailwind complains about unknown keys, keep usage to `var(--...)` inside class strings only and omit redundant `@theme` lines—YAGNI.)

- [ ] **Step 3: Verify build**

```bash
cd /Users/olenatudoi/devit/vibe-pipeline && npm run build --workspace=web
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): add homepage layout and surface design tokens"
```

---

### Task 3: `PageHero`, `FeatureStrip`, `AppSection`

**Files:**

- Create: `apps/web/components/home/page-hero.tsx`
- Create: `apps/web/components/home/feature-strip.tsx`
- Create: `apps/web/components/home/app-section.tsx`
- Create: `apps/web/components/home/index.ts`

- [ ] **Step 1: Implement `PageHero`**

Create `apps/web/components/home/page-hero.tsx`:

```tsx
import { cn } from "@/lib/utils";

export type PageHeroProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  className?: string;
};

export function PageHero({ eyebrow, title, subtitle, className }: PageHeroProps) {
  return (
    <section
      aria-labelledby="home-hero-title"
      className={cn(
        "border border-border bg-[var(--surface-muted)] px-[var(--pad-section-x)] py-[var(--pad-section-y)]",
        "rounded-[var(--radius-hero)]",
        className
      )}
    >
      {eyebrow ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      ) : null}
      <h2 id="home-hero-title" className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-pretty text-base text-muted-foreground">{subtitle}</p>
    </section>
  );
}
```

- [ ] **Step 2: Implement `FeatureStrip`**

Create `apps/web/components/home/feature-strip.tsx`:

```tsx
import { cn } from "@/lib/utils";

export type FeatureStripItem = {
  title: string;
  description: string;
};

export type FeatureStripProps = {
  items: FeatureStripItem[];
  className?: string;
};

export function FeatureStrip({ items, className }: FeatureStripProps) {
  return (
    <section aria-label="How it works" className={cn(className)}>
      <ul className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-[var(--radius-card)] border border-border bg-card p-[var(--pad-panel)] shadow-[var(--shadow-panel)]"
          >
            <h3 className="text-sm font-semibold leading-none">{item.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Implement `AppSection`**

Create `apps/web/components/home/app-section.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AppSectionProps = {
  overline?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function AppSection({ overline, title, description, children, className }: AppSectionProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {overline ? (
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{overline}</p>
      ) : null}
      {title ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : null}
      {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Barrel file**

Create `apps/web/components/home/index.ts`:

```ts
export { AppSection, type AppSectionProps } from "./app-section";
export { FeatureStrip, type FeatureStripItem, type FeatureStripProps } from "./feature-strip";
export { PageHero, type PageHeroProps } from "./page-hero";
```

- [ ] **Step 5: Lint**

```bash
cd /Users/olenatudoi/devit/vibe-pipeline && npm run lint --workspace=web
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/home/
git commit -m "feat(web): add PageHero, FeatureStrip, and AppSection"
```

---

### Task 4: Home page composition and single fetch

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/features/project-list/ui/project-list.tsx`

- [ ] **Step 1: Change `ProjectList` to sync props**

Replace the body of `apps/web/features/project-list/ui/project-list.tsx` so it:

1. Imports `ProjectListResult` from `../model/get-projects`.
2. Exports `export function ProjectList({ projects, errorMessage }: ProjectListResult)` (remove `async`).
3. Removes the internal `getProjects()` call.

Keep existing error and empty states; enhance copy per Step 2 below.

- [ ] **Step 2: Refresh projects panel copy and repo link**

Inside the `projects.map` row, after the description paragraph (or in the top flex row), add a repo link when `isDisplayableHttpUrl(project.source_repo_url)`:

```tsx
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { isDisplayableHttpUrl } from "@/lib/repo-display-url";
```

Example placement in the list item (adjust layout to match existing flex):

```tsx
<div className="flex flex-wrap items-center gap-3">
  <Link href={`/projects/${project.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
    {project.name}
  </Link>
  {isDisplayableHttpUrl(project.source_repo_url) ? (
    <a
      href={project.source_repo_url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      aria-label={`Open repository for ${project.name}`}
    >
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      Repo
    </a>
  ) : null}
</div>
```

Update `CardTitle` to `Your projects` and `CardDescription` to something like: `Open a project to continue the pipeline, or start another intake below.`

Empty state copy example: `No projects yet. Add a brief on the left to create your first pipeline session.`

- [ ] **Step 3: Rewrite `app/page.tsx`**

Replace `apps/web/app/page.tsx` with:

```tsx
import { FeatureStrip, PageHero } from "@/components/home";
import { IntakeForm } from "@/features/intake-form";
import { ProjectList } from "@/features/project-list";
import { getProjects } from "@/features/project-list/model/get-projects";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FEATURE_ITEMS = [
  {
    title: "Capture the brief",
    description: "Drop in goals, constraints, and links so the pipeline has real context."
  },
  {
    title: "Shape the plan",
    description: "Move through clarification, PRD, and tasks with reviewable outputs."
  },
  {
    title: "Hand off cleanly",
    description: "When you are ready, push structured artifacts to your repository."
  }
] as const;

export default async function Home() {
  const list = await getProjects();
  const hasProjects = list.projects.length > 0;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHero
        eyebrow="Vibe Pipeline"
        title="Turn a client brief into an executable plan"
        subtitle="Run intake, structured documents, and handoff from one workspace—without losing context between steps."
      />
      <FeatureStrip items={[...FEATURE_ITEMS]} />
      <div
        className={cn(
          "grid gap-6",
          hasProjects ? "lg:grid-cols-2 lg:items-start" : "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] lg:items-start"
        )}
      >
        <div className="min-w-0">
          <IntakeForm />
        </div>
        <div className="min-w-0">
          <ProjectList projects={list.projects} errorMessage={list.errorMessage} />
        </div>
      </div>
    </div>
  );
}
```

Note: On all breakpoints the DOM order is intake then projects, satisfying mobile ordering. On `lg+`, empty state uses a wider first column for intake-forward layout.

- [ ] **Step 4: Run tests, lint, build**

```bash
cd apps/web && npm run test
cd /Users/olenatudoi/devit/vibe-pipeline && npm run lint --workspace=web && npm run build --workspace=web
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx apps/web/features/project-list/ui/project-list.tsx
git commit -m "feat(web): compose home dashboard with progressive layout and repo links"
```

---

### Task 5: Intake card hierarchy and primary CTA

**Files:**

- Modify: `apps/web/features/intake-form/ui/intake-form.tsx`

- [ ] **Step 1: Update card title and description** (only for the default new-project branch; keep revision copy as-is)

In `CardHeader`, for the non-revision case use stronger framing, for example:

- Title: `Start a new pipeline`
- Description: `Paste or structure the brief. We will normalize it and kick off the next stages when you submit.`

Leave `isProjectRevision` titles/descriptions unchanged.

- [ ] **Step 2: Promote submit button size**

Change the submit `Button` to:

```tsx
<Button type="submit" size="lg" disabled={isSubmitting}>
```

(`size="lg"` already exists on `Button`.)

- [ ] **Step 3: Lint and build**

```bash
npm run lint --workspace=web && npm run build --workspace=web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/intake-form/ui/intake-form.tsx
git commit -m "feat(web): strengthen intake card copy and primary CTA"
```

---

### Task 6: Root layout header copy

**Files:**

- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Product-led header**

In the `<header>`, replace the inner block so the product name reads as the primary line and the page context as secondary, for example:

```tsx
<header className="mb-8 flex items-center justify-between border-b border-border pb-4">
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Vibe Pipeline</h1>
    <p className="mt-1 text-sm text-muted-foreground">Workspace</p>
  </div>
</header>
```

This removes a duplicate “Vibe Pipeline” small label + “Dashboard” `h1` pattern in favor of one clear `h1` (matches accessibility: one main heading per page shell; home content hero remains `h2`).

- [ ] **Step 2: Lint and build**

```bash
npm run lint --workspace=web && npm run build --workspace=web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(web): clarify product-led app header"
```

---

## Manual acceptance checklist (after all tasks)

1. **Empty database / no projects:** Desktop `lg+` — intake column visibly wider than projects; mobile — intake appears first.
2. **With ≥1 project:** Desktop — two balanced columns; mobile — intake still first.
3. **Repo link:** Project with valid `https://` `source_repo_url` shows “Repo” link with icon; invalid or empty URL — no link; `javascript:` — no link.
4. **Hero:** No GitHub connect or handoff CTA in hero text.
5. **Dark mode:** Hero surface and cards readable; shadows not overpowering.

---

## Plan self-review

**Spec coverage:** Progressive density, mobile order, tokens, `PageHero` / `FeatureStrip`, `AppSection`, intake/projects refresh, per-project repo link with HTTP(S) guard, no hero GitHub — all mapped to Tasks 1–6. Optional “Jump to projects” link — explicitly omitted (spec default off).

**Placeholder scan:** No TBD/TODO left; commands and file paths are concrete.

**Type consistency:** `ProjectList` receives `ProjectListResult` (`projects`, `errorMessage`) matching `getProjects()` return type; `source_repo_url` read from `ProjectRow` (database row type).

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-06-homepage-design-system.md`. Two execution options:**

**1. Subagent-driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. **Required sub-skill:** superpowers:subagent-driven-development.

**2. Inline execution** — Run tasks in this session using executing-plans, batch execution with checkpoints. **Required sub-skill:** superpowers:executing-plans.

**Which approach do you want?**
