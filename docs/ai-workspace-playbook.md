# Ghost AI workspace playbook

## Workspace roles
- `~/dev/ghost-stack` = main/operator/review workspace
- `~/dev/ghost-stack-codex` = Codex execution workspace
- `~/dev/ghost-stack-claude` = Claude execution workspace

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

- New Claude task:
  1. start from `~/dev/ghost-stack-claude` if it is free, otherwise create a new Claude worktree later
  2. `git fetch origin`
  3. base from the intended upstream branch
  4. `git switch -c claude-<task-name>`

- Main/operator workspace:
  - use for review, diff inspection, merge prep, repo instructions, and safe manual edits
  - do not use as the primary execution lane for Codex or Claude

## Merge rule
- Review in `~/dev/ghost-stack`
- Merge only after diff inspection and basic validation
- If two agents need overlapping files, stop and rescope before continuing

## Daily screen layout
- Portrait screen:
  - top-left terminal = Claude workspace (`~/dev/ghost-stack-claude`)
  - top-right terminal = Codex workspace (`~/dev/ghost-stack-codex`)
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
