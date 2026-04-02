# Feature Specification: PRD-stage Figma UI Kit specification

**Feature Branch**: `001-prd-figma-ui-kit`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "(The PRD Stage) When the user triggers /specify, the AI must follow discovery → targeting → extraction against the linked Figma file, then generate `project-spec/06-ui-kit.md` with CSS-oriented token names grounded in that file."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Grounded UI kit from Figma (Priority: P1)

A product lead runs the specify stage for a feature that includes a Figma file link in intake. They receive
`project-spec/06-ui-kit.md` that reflects colors, typography, and recurring UI patterns taken from that file—not
generic placeholders—so downstream design and engineering share one source of truth.

**Why this priority**: Wrong or invented tokens cause rework and visual drift; this story delivers the core value
of the PRD stage for design-led work.

**Independent Test**: With a known Figma file that contains named UI Kit (or equivalent) content, run specify and
confirm `06-ui-kit.md` lists colors and text styles that match the file, with project CSS variable names assigned.

**Acceptance Scenarios**:

1. **Given** intake includes a reachable Figma file URL, **When** specify completes, **Then** `06-ui-kit.md` exists
   under `project-spec/` and documents colors (as hex), typography (family, weight, size), and identifiable
   repeating UI patterns (e.g. buttons, cards, inputs) derived from the file.
2. **Given** the same file, **When** a reviewer compares the document to Figma, **Then** documented solid fills and
   text styles correspond to content on the targeted page without `TBD` for values the file exposes.

---

### User Story 2 - Sensible page targeting when no “UI Kit” page (Priority: P2)

The linked file has no page whose name clearly indicates a kit or token library. The workflow still produces a
useful `06-ui-kit.md` by targeting the primary product canvas so the team is not blocked.

**Why this priority**: Many files use “Main” or “Desktop” instead of “UI Kit”; fallback keeps the pipeline usable.

**Independent Test**: Use a fixture file with only “Main” and “Desktop” pages, no “UI Kit”; confirm extraction runs
against the fallback page and the spec states which page was used.

**Acceptance Scenarios**:

1. **Given** no page name matches the discovery pattern (see FR-002), **When** specify runs, **Then** the workflow
   selects a page named “Main” or, if absent, “Desktop” (case-insensitive), and records that choice in
   `06-ui-kit.md` or traceable spec notes.

---

### User Story 3 - Explicit handling of failures (Priority: P3)

When the file cannot be read or expected content is missing, the user sees a clear outcome instead of a silent or
fabricated kit.

**Why this priority**: Trust in the PRD stage depends on honest failure modes.

**Independent Test**: Simulate missing link, unreadable file, or empty targeted page; confirm specify surfaces an
   explicit gap or error path rather than inventing tokens.

**Acceptance Scenarios**:

1. **Given** no Figma URL in intake, **When** specify runs, **Then** the workflow does not claim Figma-grounded
   content in `06-ui-kit.md` without stating that no link was provided (or defers that file per project rules).
2. **Given** the file is unreachable or returns no valid nodes for the targeted page, **When** specify runs, **Then**
   the run documents the failure and does not fill `06-ui-kit.md` with guessed hex or type scales.

---

### Edge Cases

- Intake includes multiple Figma URLs: the workflow MUST define which link governs `06-ui-kit.md` (default: first
  design file URL in intake order unless product rules say otherwise).
- Figma Make or FigJam links: read capabilities may differ; the workflow MUST follow the supported read path for
  that link type and must not assert full parity with standard design files.
- File has UI Kit page but no variables or few components: document what was found; omit sections only when empty
  after extraction, with a short note.
- Duplicate page names: prefer the first depth-1 match in stable listing order; if ambiguous, note ambiguity in the
  output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Discovery)**: When intake includes a Figma design file URL, the specify-stage workflow MUST obtain a
  **complete depth-1 list of pages** in that file through the project’s authorized Figma read path, and MUST record
  which read method was used when writing `06-ui-kit.md`.
- **FR-002 (Page match)**: From that listing, the workflow MUST search for a page whose name matches
  `/(ui\s*kit|design\s*system|styles|tokens)/i` (case-insensitive). The first matching page becomes the primary
  target for extraction unless a later FR overrides.
- **FR-003 (Targeting)**: If FR-002 finds a match, the workflow MUST load the full node tree for that page. If no
  match is found, the workflow MUST load nodes for a page named **Main**, or if absent **Desktop** (case-insensitive).
  If none of these exist, the workflow MUST document the gap and MUST NOT invent page content.
- **FR-004 (Colors)**: From the targeted node tree, the workflow MUST collect **all solid fills**, normalize them to
  **hex**, deduplicate sensibly, and map them to project CSS custom property names (e.g. `--primary`, semantic
  aliases) with a short rationale or source label where helpful.
- **FR-005 (Typography)**: The workflow MUST extract **text styles** as used in the file: font family, weight, and
  size (and line height when explicitly available), mapped to names such as `--font-main` / scale tokens consistent
  with project naming conventions.
- **FR-006 (Components / patterns)**: The workflow MUST identify **repeating frames or components** representative of
  common UI (buttons, cards, inputs) by name and structure hints, and list them in `06-ui-kit.md` without claiming
  implementation—only design inventory.
- **FR-007 (Output)**: The workflow MUST write or update **`project-spec/06-ui-kit.md`** using only data observed via
  the above steps plus explicit mappings; values that cannot be read MUST be called out as gaps, not `TBD` when the
  file could supply them (per constitutional CC-006).
- **FR-008 (Traceability)**: `06-ui-kit.md` MUST state the source Figma URL (redacted if policy requires), targeted
  page name, and timestamp or run id sufficient for audit.

### Specify-stage agent procedure *(normative for implementers)*

When `/speckit.specify` (or equivalent) runs with a Figma link in intake, the executing agent MUST apply this sequence
(MCP tool names refer to the connected Figma MCP; use documented equivalents if a name differs):

1. **Discovery**: Call **`get_file` with `depth=1`** to list all pages. Search page names with
   `/(ui\s*kit|design\s*system|styles|tokens)/i`.
2. **Targeting**: If matched, fetch nodes for that **page id**. If not matched, fetch nodes for **Main**, else
   **Desktop** (case-insensitive page names).
3. **Extraction**: Parse nodes for **solid fills** (hex), **text styles** (family, weight, size), and **repeating
   frames/components** (buttons, cards, inputs).
4. **Result**: Emit **`project-spec/06-ui-kit.md`** from observed data, mapping to project CSS variables (e.g.
   `--primary`, `--font-main`). If `get_file` is unavailable, use the official substitute that preserves steps 1–3
   semantics (`get_metadata` / `get_design_context` / `get_variable_defs` as required by the server).

### Constitutional Constraints *(mandatory)*

- **CC-001**: Requirements for this feature MUST be captured in `project-spec/` numbered files before implementation
  starts.
- **CC-002**: Implementation paths MUST map to `apps/web` or `packages/{schema, ai, database, integrations, ui}`.
- **CC-003**: Runtime data validation MUST use Zod schemas (prefer shared schemas from `packages/schema`).
- **CC-004**: AI workflow steps MUST use LangGraph with persisted workflow state in Supabase.
- **CC-005**: Figma/Linear usage MUST be isolated to `@vibe/integrations` (`packages/integrations`).
- **CC-006**: When intake provides a Figma URL and the feature includes a UI Kit or UI specification, agents MUST
  validate via Figma MCP (`get_variable_defs`, and `get_metadata` or `get_design_context` as needed). `TBD` MUST NOT
  be used for color, typography, or spacing values that MCP can resolve from the linked file.

### Key Entities *(include if feature involves data)*

- **Figma file reference**: URL, file key, and resolved page and node identifiers used for extraction.
- **UI Kit specification (`06-ui-kit.md`)**: Human-readable contract listing tokens and pattern inventory for the
  feature’s design baseline.
- **Color token**: Hex value plus semantic CSS variable name assigned by mapping rules.
- **Typography token**: Family, weight, size (and optional line height) plus CSS-oriented name.
- **Component pattern**: Named frame/component category (button, card, input, etc.) as observed in Figma.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For at least three representative design files that include a UI Kit (or pattern-matched) page, 100% of
  runs produce `06-ui-kit.md` whose solid color hex codes and text style sizes match a manual spot-check against
  Figma for the targeted page.
- **SC-002**: For files without a pattern-matched page but with “Main” or “Desktop”, 100% of runs document the
  fallback page used and include at least one section populated from that page when any extractable styles exist.
- **SC-003**: When the file is unreadable or the targeted page has no extractable solids or text styles, 100% of runs
  produce an explicit documented outcome (no silent `TBD` for values the tooling could have read).
- **SC-004**: Reviewers rate the generated `06-ui-kit.md` as “usable without redesign guesswork” for at least 90% of
  pilot features (survey or review checklist within the team).

## Assumptions

- The specify command is executed in an environment where Figma MCP is authenticated when a link is present; otherwise
  FR-001–FR-007 degrade to documented failure per User Story 3.
- “Project CSS variable names” follow existing repo conventions documented elsewhere; default semantic names include
  `--primary` and `--font-main` when mapping is otherwise ambiguous.
- The **Specify-stage agent procedure** section is the authoritative binding for automation; tool availability is
  subject to the enabled Figma MCP catalog.
