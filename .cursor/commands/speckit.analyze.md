---
description: Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Identify inconsistencies, duplications, ambiguities, and underspecified items across the three core artifacts (`spec.md`, `plan.md`, `tasks.md`) before implementation. This command MUST run only after `/speckit.tasks` has successfully produced a complete `tasks.md`.

## Operating Constraints

**STRICTLY READ-ONLY (repository)**: Do **not** modify any repository files. You MAY call read-only **Figma MCP** tools to verify linked files. Output a structured analysis report. Offer an optional remediation plan (user must explicitly approve before any follow-up editing commands would be invoked manually).

**Constitution Authority**: The project constitution (`.specify/memory/constitution.md`) is **non-negotiable** within this analysis scope. Constitution conflicts are automatically CRITICAL and require adjustment of the spec, plan, or tasks—not dilution, reinterpretation, or silent ignoring of the principle. If a principle itself needs to change, that must occur in a separate, explicit constitution update outside `/speckit.analyze`. **Principle VI (Design System Enforcement)** requires MCP-backed validation whenever a Figma URL is in scope; this command’s Figma pass implements that check for analysis (not merely “URL present”).

## Execution Steps

### 1. Initialize Analysis Context

Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` once from repo root and parse JSON for FEATURE_DIR and AVAILABLE_DOCS. Derive absolute paths:

- SPEC = FEATURE_DIR/spec.md
- PLAN = FEATURE_DIR/plan.md
- TASKS = FEATURE_DIR/tasks.md

Abort with an error message if any required file is missing (instruct the user to run missing prerequisite command).
For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

### 2. Load Artifacts (Progressive Disclosure)

Load only the minimal necessary context from each artifact:

**From spec.md:**

- Overview/Context
- Functional Requirements
- Success Criteria (measurable outcomes — e.g., performance, security, availability, user success, business impact)
- User Stories
- Edge Cases (if present)

**From plan.md:**

- Architecture/stack choices
- Data Model references
- Phases
- Technical constraints

**From tasks.md:**

- Task IDs
- Descriptions
- Phase grouping
- Parallel markers [P]
- Referenced file paths

**From constitution:**

- Load `.specify/memory/constitution.md` for principle validation

### 2b. Figma MCP verification (when Figma URLs exist)

**Trigger**: If `spec.md`, `plan.md`, or `tasks.md` contains at least one `figma.com` design URL (design, branch, or equivalent file link), you MUST run this pass. If no Figma URL appears in any artifact, record **Figma MCP: N/A (no URL in scope)** in the report metrics and skip the rest of this subsection.

**Do not** treat “a link string is present” as sufficient. **Old logic (invalid)**: “Is there a Figma link?” **New logic (required)**:

1. **Parse** each URL into `fileKey` and `nodeId` per Figma URL rules (including branch URLs where branch key substitutes for `fileKey`; normalize `node-id` by replacing `-` with `:` in the id segment).
2. **Accessibility & valid nodes**: Use the **Figma MCP** (`plugin-figma-figma` or equivalent enabled server) to confirm the file is reachable and returns structured data.
   - **List pages / document structure**: Prefer `get_metadata` starting from the document or page root (e.g. page id such as `0:1` when appropriate, or the node from the URL) to obtain an XML overview of pages, frames, and node ids. If the tool errors, times out, or returns no usable nodes, treat as a verification failure (see severities below). For **Figma Make** URLs, follow the MCP tool documentation (some read tools are not supported for Make files—use the prescribed alternative without skipping verification).
3. **UI Kit discovery**: From metadata (or equivalent MCP output), determine whether a page or top-level frame/layer **matches “UI Kit”** (case-insensitive substring on layer/page name, e.g. contains `UI Kit`). Record which `nodeId` was identified.
4. **Primary tokens**: If a UI Kit node is found, call `get_variable_defs` with that `fileKey` and a relevant `nodeId` (UI Kit frame/page or file scope per tool constraints) to extract **primary design tokens** (color, typography, spacing variables). If no “UI Kit” named container exists, still attempt variable extraction from the linked `nodeId` or file root context and note the deviation in the report.
5. **Failures**:
   - **CRITICAL**: Link present but MCP proves the file unreachable, `fileKey`/`nodeId` invalid, or constitution-level violation (e.g. URL cited but MCP confirms no valid document nodes).
   - **HIGH**: File reachable and nodes valid, but **primary token extraction fails** (empty variables, MCP error on `get_variable_defs`, or UI Kit expected by spec but not found and tokens cannot be resolved). Label these explicitly as **High Priority Gaps** in the findings table (category **FigmaMCP** or **Constitution Alignment** as appropriate).

If the Figma MCP server is not available in the environment, emit one **HIGH** finding: cannot verify accessibility or tokens; recommend enabling MCP and re-running `/speckit.analyze`.

### 3. Build Semantic Models

Create internal representations (do not include raw artifacts in output):

- **Requirements inventory**: For each Functional Requirement (FR-###) and Success Criterion (SC-###), record a stable key. Use the explicit FR-/SC- identifier as the primary key when present, and optionally also derive an imperative-phrase slug for readability (e.g., "User can upload file" → `user-can-upload-file`). Include only Success Criteria items that require buildable work (e.g., load-testing infrastructure, security audit tooling), and exclude post-launch outcome metrics and business KPIs (e.g., "Reduce support tickets by 50%").
- **User story/action inventory**: Discrete user actions with acceptance criteria
- **Task coverage mapping**: Map each task to one or more requirements or stories (inference by keyword / explicit reference patterns like IDs or key phrases)
- **Constitution rule set**: Extract principle names and MUST/SHOULD normative statements
- **Figma MCP verification record**: For each in-scope URL, store `{ url, fileKey, nodeId, pagesListed, uiKitNodeId|null, tokenExtractionOk, errorSummary }` for the report (no raw MCP dumps—summarize)

### 4. Detection Passes (Token-Efficient Analysis)

Focus on high-signal findings. Limit to 50 findings total; aggregate remainder in overflow summary.

#### A. Duplication Detection

- Identify near-duplicate requirements
- Mark lower-quality phrasing for consolidation

#### B. Ambiguity Detection

- Flag vague adjectives (fast, scalable, secure, intuitive, robust) lacking measurable criteria
- Flag unresolved placeholders (TODO, TKTK, ???, `<placeholder>`, etc.)

#### C. Underspecification

- Requirements with verbs but missing object or measurable outcome
- User stories missing acceptance criteria alignment
- Tasks referencing files or components not defined in spec/plan

#### D. Constitution Alignment

- Any requirement or plan element conflicting with a MUST principle
- Missing mandated sections or quality gates from constitution

#### E. Coverage Gaps

- Requirements with zero associated tasks
- Tasks with no mapped requirement/story
- Success Criteria requiring buildable work (performance, security, availability) not reflected in tasks

#### F. Inconsistency

- Terminology drift (same concept named differently across files)
- Data entities referenced in plan but absent in spec (or vice versa)
- Task ordering contradictions (e.g., integration tasks before foundational setup tasks without dependency note)
- Conflicting requirements (e.g., one requires Next.js while other specifies Vue)

#### G. Figma MCP & design-token gaps

- Cross-check §2b results with spec/plan language: if artifacts promise a UI Kit or token-backed UI but MCP shows missing UI Kit or failed extraction, flag per §2b severities
- Tasks that claim “Figma validated” or “tokens resolved” without a matching MCP verification record in this run → **HIGH** (process gap)

### 5. Severity Assignment

Use this heuristic to prioritize findings:

- **CRITICAL**: Violates constitution MUST, missing core spec artifact, or requirement with zero coverage that blocks baseline functionality; Figma URL in artifacts but MCP confirms file/nodes inaccessible or invalid
- **HIGH**: Duplicate or conflicting requirement, ambiguous security/performance attribute, untestable acceptance criterion; reachable Figma file but **primary token extraction failed** or UI Kit not found when expected; MCP unavailable so verification could not run
- **MEDIUM**: Terminology drift, missing non-functional task coverage, underspecified edge case
- **LOW**: Style/wording improvements, minor redundancy not affecting execution order

### 6. Produce Compact Analysis Report

Output a Markdown report (no file writes) with the following structure:

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| A1 | Duplication | HIGH | spec.md:L120-134 | Two similar requirements ... | Merge phrasing; keep clearer version |

(Add one row per finding; generate stable IDs prefixed by category initial.)

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|

**Constitution Alignment Issues:** (if any)

**Unmapped Tasks:** (if any)

**Figma MCP Verification:** (omit section if N/A—no Figma URL in artifacts)

| URL (short) | fileKey | Accessible | Pages listed | UI Kit found | Tokens extracted | Status |
|-------------|---------|------------|--------------|--------------|------------------|--------|

**Metrics:**

- Total Requirements
- Total Tasks
- Coverage % (requirements with >=1 task)
- Ambiguity Count
- Duplication Count
- Critical Issues Count
- Figma MCP: URLs checked / failures (CRITICAL vs HIGH)

### 7. Provide Next Actions

At end of report, output a concise Next Actions block:

- If CRITICAL issues exist: Recommend resolving before `/speckit.implement`
- If only LOW/MEDIUM: User may proceed, but provide improvement suggestions
- Provide explicit command suggestions: e.g., "Run /speckit.specify with refinement", "Run /speckit.plan to adjust architecture", "Manually edit tasks.md to add coverage for 'performance-metrics'"

### 8. Offer Remediation

Ask the user: "Would you like me to suggest concrete remediation edits for the top N issues?" (Do NOT apply them automatically.)

## Operating Principles

### Context Efficiency

- **Minimal high-signal tokens**: Focus on actionable findings, not exhaustive documentation
- **Progressive disclosure**: Load artifacts incrementally; don't dump all content into analysis
- **Token-efficient output**: Limit findings table to 50 rows; summarize overflow
- **Deterministic results**: Rerunning without changes should produce consistent IDs and counts

### Analysis Guidelines

- **NEVER modify repository files** (this is read-only analysis for the repo); **Figma MCP read tools are allowed** for verification
- **NEVER hallucinate missing sections** (if absent, report them accurately)
- **Prioritize constitution violations** (these are always CRITICAL)
- **Use examples over exhaustive rules** (cite specific instances, not generic patterns)
- **Report zero issues gracefully** (emit success report with coverage statistics)

## Context

$ARGUMENTS
