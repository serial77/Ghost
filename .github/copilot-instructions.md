# Ghost repository instructions for GitHub Copilot

## Core behavior
- Preserve the current Ghost architecture unless explicitly asked to change it.
- Prefer minimal, surgical diffs.
- Do not rewrite, rename, or reorganize unrelated files.
- If uncertain, say what is uncertain instead of guessing.
- Before making broad changes, identify the exact files involved.

## Product and architecture rules
- Ghost is the conversation owner and primary orchestrator.
- Do not default to direct worker dispatch when Ghost-first orchestration is the intended path.
- The Task Board is the orchestration-facing workspace and should evolve toward task creation, assignment visibility, handoffs, planning, activity, deliverables, and sessions.
- The runtime/operator console and the Task Board are distinct surfaces and should not be casually merged.
- Task Overview is the live runtime/ledger-style operational surface, not a replacement for the board-side orchestration workspace.
- Preserve visibility of delegation, task state, and worker activity.

## Conversation and routing rules
- Do not introduce silent model or provider switching inside a user conversation.
- One conversation should have one clear owner agent/model unless explicit delegation is part of the design.
- Worker actions should be explicit, inspectable, and visible in the product where appropriate.

## UI and UX rules
- Preserve the minimal, cinematic Ghost direction.
- Avoid box-heavy dashboard bloat.
- Prefer subtle glass, restrained density, and clear hierarchy.
- Do not introduce loud or overly saturated styling unless explicitly asked.
- Keep the runtime console and Task Board visually and functionally distinct.

## Engineering rules
- Preserve TypeScript correctness.
- Prefer explicit types over loose shortcuts.
- Do not fabricate APIs, routes, tables, or data contracts.
- When changing UI, respect existing component boundaries.
- When changing backend/runtime logic, explain the blast radius and affected surfaces.
- For risky changes, propose the plan before editing.

## Workflow rules
- Treat this repository as human-supervised.
- Keep changes review-friendly.
- When asked for edits, mention the files you intend to touch.
- When asked for analysis, stay read-only unless explicitly told to edit.
