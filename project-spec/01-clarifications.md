# 01. Clarifications, Gaps, and Open Questions

## Purpose
This document captures gaps, assumptions, and unresolved questions that must be addressed during `Clarify` and before PRD approval.

## Gap Matrix

| ID | Area | Gap / Uncertainty | Risk | Priority | Status |
|---|---|---|---|---|---|
| CL-001 | Product Type | Exact product category is not fixed (SaaS/internal/client delivery) | Wrong scope and UX model | High | Open |
| CL-002 | User Roles | Role model is incomplete (single user is implied but not explicit) | Incorrect permissions and flows | High | Open |
| CL-003 | Auth | MVP authentication approach is undefined | Blocks e2e and security baseline | High | Open |
| CL-004 | Project Status Model | No formal list of project/stage statuses | Weak pipeline governance | Medium | Open |
| CL-005 | Generation Triggers | Auto vs manual trigger rules are undefined | Unpredictable generation behavior | Medium | Open |
| CL-006 | Versioning Rules | Artifact version increment policy is undefined | Versioning conflicts | High | Open |
| CL-007 | Review Workflow | Review/approve workflow before export is not formalized | Invalid exports possible | High | Open |
| CL-008 | Figma Scope | Depth/limits of Figma pull are not defined | Performance and payload risks | Medium | Open |
| CL-009 | Linear Mapping | Task tree to Linear field mapping is undefined | Data loss on export | High | Open |
| CL-010 | Error Handling | Retry/fallback strategy for AI steps is not defined | Unstable user experience | Medium | Open |
| CL-011 | NFR Targets | No measurable reliability/performance targets | Hard to verify delivery quality | Medium | Open |
| CL-012 | Security Policy | Baseline for secrets/audit/security handling is not explicit | Security/compliance risk | High | Open |

## Assumptions (MVP)
1. The product runs as a single-user workspace.
2. The user has access to the configured repo/Figma/Linear targets.
3. Cursor handoff is file-based only, without direct IDE control.
4. Most generation steps are user-triggered manually.
5. Version history is stored in `artifacts` and `project_sessions`.

## Clarification Questions

### Product & Workflow
1. Confirm primary ICP: solo founder, freelancer, or small studio?
2. Is an explicit sign-off stage required between `Handoff` and `Export`?
3. Which project statuses are mandatory (draft, in_progress, review, approved, exported)?

### Data & Versioning
4. Which versioning strategy should be used: integer, semantic, or timestamp-based?
5. Should approved artifact versions be immutable?
6. Is version diff view required in MVP or post-MVP?

### Integrations
7. Which Linear fields are mandatory (team, project, labels, estimate)?
8. Is Linear integration push-only or bidirectional?
9. What is the minimum required Figma metadata payload?

### Quality Gates
10. Which Continue checks are blocking for export?
11. Should export be blocked on Snyk high/critical findings?
12. Which e2e smoke scenarios are mandatory for Done Definition?

## Clarification Exit Criteria
- All high-priority questions are answered/resolved.
- PRD includes resolved assumptions and constraints.
- Clarification status is `Resolved` before final handoff generation.
