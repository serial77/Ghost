# Ghost AI workspace playbook

## Workspace roles

All three directories are **git worktrees of the same repository** (main worktree at `~/dev/ghost-stack`). They share one `.git` object store and the same `origin`.

- `~/dev/ghost-stack` = **main worktree** — operator review, VS Code, Copilot, merge prep; also holds live `base/.env`, `db/migrations/`, and `backups/`
- `~/dev/ghost-stack-codex` = **development/Claude execution worktree** — canonical home for ops scripts, workflow builder, backend code, and docs authoring; **this is the authoritative development copy**
- `~/dev/ghost-stack-claude` = **UI worktree** — currently on `claude-mission-control-polish`; runs `next dev` for the live UI

### Why ghost-stack-codex is the authoritative development copy
- All development work (ops, scripts, workflows, backend UI changes, docs) should be done here
- Push/merge to main from here
- The `base/docker-compose.yml` is self-contained (uses relative paths — no dependency on `~/dev/ghost-stack/`)
- `base/.env` and `db/migrations/` are gitignored here but should be populated from `~/dev/ghost-stack/base/.env` (see `base/.env.example`)

### To avoid manual mirroring (which caused operational debt)
- Do not manually copy files between worktrees
- Instead: commit UI changes to the appropriate branch in codex, then merge/rebase the UI worktree against main
- When ghost-stack-claude needs updates from main: `git merge main` from inside `~/dev/ghost-stack-claude`

## Branch conventions
- `main` = protected review/merge baseline
- `codex-*` = Codex task branches
- `claude-*` = Claude task branches
- `chore-*` = repo/setup/infra/meta changes
- one branch = one task
- one workspace should not edit the same files as another workspace at the same time

## Tool routing
- Codex: backend/runtime/exact implementation/risky code edits
- Claude: UI/style/polish/design-system/docs/critique
- Copilot: quick local support, tests, bounded edits, overflow when Codex is limited
- ChatGPT: planning, decomposition, review, arbitration, prompts

## Fallback rule
- If Codex is available, use Codex for implementation-heavy work.
- If Codex is rate-limited, continue with Copilot for bounded tasks.
- If the task is UI-heavy, route to Claude.
- If the task is architecture-sensitive and high risk, rescope before handing it to fallback tooling.

## Safety rules
- Prefer minimal diffs.
- Review before merge.
- Do not let two agents edit the same surface concurrently.
- Merge through git, not manual copy-paste between workspaces.

## Task start rule
- New Codex task:
  1. start from `~/dev/ghost-stack-codex`
  2. `git fetch origin`
  3. `git switch main && git pull`
  4. `git switch -c codex-<task-name>`

- New Claude task (backend/ops/docs):
  1. start from `~/dev/ghost-stack-codex` (authoritative development worktree)
  2. `git fetch origin`
  3. `git switch main && git pull`
  4. `git switch -c claude-<task-name>`

- New Claude task (UI/visual/design-system):
  1. start from `~/dev/ghost-stack-claude` (UI worktree, on mission-control-polish or a new branch)
  2. `git fetch origin && git merge main` to get latest backend changes
  3. `git switch -c claude-<task-name>` if a new branch is needed

- Main/operator workspace (`~/dev/ghost-stack`):
  - use for review, diff inspection, merge prep, repo instructions, and safe manual edits
  - holds live secrets (`base/.env`) and DB artifacts — do not delete
  - do not use as the primary execution lane for Codex or Claude

## Merge rule
- Review in `~/dev/ghost-stack` or `~/dev/ghost-stack-codex`
- Merge only after diff inspection and basic validation
- If two agents need overlapping files, stop and rescope before continuing
- Do NOT manually copy files between worktrees — use `git merge main` to update a worktree from main

## Daily screen layout
- Portrait screen:
  - top-left terminal = Claude UI workspace (`~/dev/ghost-stack-claude`, running `next dev`)
  - top-right terminal = Claude/Codex dev workspace (`~/dev/ghost-stack-codex`)
  - bottom = ChatGPT for planning, prompts, review, arbitration

- Main landscape screen:
  - VS Code opened on `~/dev/ghost-stack` by default for review, git inspection, merge prep, and Copilot
  - use VS Code integrated terminal for quick checks/tests in the currently reviewed workspace
  - use Copilot Chat as the fast fallback/helper lane, not as the primary orchestrator

## Daily operating pattern
- Start in ChatGPT to define the task and assign the lane.
- Run Codex only on Codex-scoped tasks.
- Run Claude only on Claude-scoped tasks.
- Use VS Code on the main workspace to inspect diffs before merge.
- If Codex is rate-limited, continue the bounded task in Copilot from VS Code.
- If a task becomes cross-cutting, stop and rescope instead of letting multiple agents collide.

## Copilot operating rule
- Use Copilot primarily inside VS Code on `~/dev/ghost-stack`.
- Default Copilot use:
  - ask codebase questions
  - inspect files
  - review diffs
  - draft tests
  - make small bounded edits
- Use Copilot as fallback when Codex is rate-limited on bounded implementation tasks.
- Do not use Copilot as the primary orchestrator for large architecture-sensitive multi-file work.
- Before asking Copilot to edit, identify the exact file or small file set.
- Prefer "explain first, edit second" when using Copilot on non-trivial code.
- After Copilot edits, inspect the diff in the main workspace before promoting or merging.

## Copilot task size rule
- Good Copilot tasks:
  - wording changes
  - small component tweaks
  - tests
  - helper functions
  - focused bugfixes
  - diff review
- Bad Copilot tasks:
  - broad architecture rewrites
  - ambiguous multi-surface changes
  - silent refactors across many files
  - anything that overlaps active Claude or Codex work

## Flexible lane rule
- Lane ownership is a default, not a permanent identity.
- Codex is the default backend/runtime lane when available.
- Claude is the default UI/product lane when available.
- If Codex is constrained or unavailable, Claude may take over backend/runtime tasks.
- Copilot remains the bounded support lane for search, tests, small edits, and review.

## Codex-down degraded mode
- Do not freeze backend progress just because Codex is unavailable.
- Park or finish the current Claude UI slice, then reassign the blocked backend task to Claude if backend progress is the priority.
- Claude may temporarily become the primary engineering lane until Codex returns.
- Use Copilot in parallel for @workspace file discovery, tests, boilerplate, and bounded support work.
- Keep frontend moving tactically, but do not block the project waiting for backend ownership to return to Codex.

## Task reassignment rule
- Freeze the unavailable lane's branch/worktree, not the project task.
- Reassign the task explicitly with a fresh summary, real file paths, constraints, and current status.
- Prefer a new Claude-owned branch for backend takeover work rather than blindly continuing an abandoned Codex branch.
- Review and merge from `~/dev/ghost-stack`.

## Multi-instance rule
- Multiple agent instances are allowed only when they are working on clearly separate surfaces.
- Never let two active agents edit the same file set or surface concurrently.
- A second Claude session is acceptable only if one session owns UI work and the other owns a separate backend task.

## Copilot support rule in degraded mode
- When Codex is unavailable, Copilot supports the active primary lane rather than trying to replace Codex fully.
- Use Copilot for:
  - `@workspace` repo/file discovery
  - small bounded edits
  - test drafting
  - diff review
  - boilerplate and helper tasks
- Do not assign broad architecture rewrites or ambiguous multi-surface changes to Copilot.
- Copilot should help keep both backend and frontend moving, but ownership stays with the active primary lane.
