# 00. Project Brief

## Name
Vibe Pipeline Platform

## Summary
A web application that transforms a raw business idea or client brief into a structured, AI-ready delivery pipeline: intake, clarifications, PRD, task decomposition, design sync, and handoff package for Cursor/repository/Linear workflows.

## Problem
- Raw client requests are not reliable inputs for AI-first implementation.
- Solo developers and small studios spend too much time manually structuring requirements.
- There is no single source of truth across brief, tasks, design context, and handoff artifacts.

## Goal
Provide a predictable, repeatable workflow for project preparation in vibe coding:
`Intake -> Clarify -> PRD -> Tasks -> Design Sync -> Handoff`.

## Target Audience
- Solo founder/developer.
- Small studio teams using AI-first development workflows.

## Business Value
- Reduce time from idea to implementation-ready specification.
- Reduce rework caused by missing or unclear requirements.
- Improve handoff quality for coding agents.

## Key User Scenarios
1. Create project and submit intake details.
2. Detect requirement gaps and generate clarifications.
3. Generate and edit PRD.
4. Decompose PRD into epics/tasks/subtasks.
5. Pull Figma context and map it to tasks.
6. Generate implementation pack and export to Cursor/repo/Linear.

## MVP Focus
- Single user, single workspace.
- End-to-end staged pipeline with persisted state.
- Versioned artifacts and review/approve gate before export.

## Mandatory Stack
- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui.
- Backend/orchestration: Next.js server actions/route handlers, LangGraph (or equivalent), Zod.
- Database: Supabase Postgres.
- Integrations: Cursor, Figma MCP, Linear, Playwright, Continue, Snyk, Superpowers.

## MVP Outcome
The system generates and stores a complete artifact package in `project-spec/` and `.cursor/rules/` as the source of truth for AI coding workflows.
