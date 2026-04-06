/** Virtual path when copying the handoff pack into a customer repo. */
export const CURSOR_HANDOFF_FILENAME = "docs/CURSOR_HANDOFF.md";

/**
 * Fixed handoff instructions (not LLM-generated) so every export includes
 * Cursor / optional Superpowers setup aligned with project-spec and .cursor/rules.
 */
export const CURSOR_HANDOFF_MARKDOWN = `# Cursor handoff

Use this repo with **Cursor** (or any agent that reads project files). The web app does **not** control your IDE; alignment is **file-based**.

## Source of truth

1. \`project-spec/\` (or the spec files bundled next to this doc) — brief, PRD, scope, tasks, plans.
2. \`.cursor/rules/*.mdc\` — constraints for coding agents generated from the approved pipeline (expected names: \`001-project-context.mdc\` … \`005-output-format.mdc\`).

Work **task-first** from the task breakdown and trace changes to acceptance criteria and PRD sections. Do not invent scope that is not in the approved artifacts.

## Optional: Superpowers (Cursor)

If you use the **Superpowers** plugin in Cursor, it reinforces the same habits: plan multi-step work, test-driven or verification-first flows where appropriate, and confirm evidence before claiming a step is done.

- Superpowers is **optional** and runs only in the editor.
- It does **not** replace \`project-spec/\` or \`.cursor/rules/\`; those files stay authoritative.

## Suggested setup

1. Copy \`project-spec/\` and \`.cursor/rules/\` into your implementation repository (preserve paths).
2. Open the repo in Cursor and let rules apply automatically under \`.cursor/rules\`.
3. Start implementation from the task list, respecting dependencies and acceptance criteria.
4. After the pipeline **review/approve** step in the product, treat exported content as frozen handoff unless you consciously revise specs in-repo.

`;
