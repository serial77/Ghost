# GHOST AI — CURRENT STATE

> **Purpose:** Paste this file first when switching between AI agents (GPT planner, Claude Code executor, Claude architect). Eliminates catch-up overhead.
>
> **Rule:** Update this file after every task completion. Commit it with the task branch.

---

## Last Completed Task

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Task             | TASK-006                                   |
| Description      | Circuit breaker — per-provider Redis state, failure categorization (rate_limited/server_error/overloaded/timeout/unknown), cooldown by failure type (529→60s, 500/429/timeout→300s), trip threshold 3, half-open probe, event emission, router integration |
| Branch           | phase3/3C-circuit-breaker                  |
| Merged to        | not yet (awaiting operator PR review)      |
| Completion date  | 2026-03-15                                 |
| Tests passing    | yes — 169 total (137 pre-existing + 32 new circuit-breaker tests) |

## Next Task

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Task             | TASK-007                                   |
| Description      | Plan sub-workflow interfaces — input/output contracts for 5 sub-workflows (Ghost_Classify, Ghost_Memory, Ghost_Route, Ghost_Approve, Ghost_Delegate) with MCP compatibility notes and A2A Agent Cards |
| Tier / Sprint    | Tier 1                                     |
| Size             | M                                          |
| Dependencies     | TASK-006                                   |
| Workplan ref     | Ghost_Workplan_Amendment_v3_2.md §E        |

## Active Branches

| Branch                        | Status       | Notes                           |
|-------------------------------|--------------|---------------------------------|
| `main`                        | stable       |                                 |
| `phase3/3C-circuit-breaker`   | complete     | CI green, awaiting PR           |

## Architecture Snapshot

- **Stack:** Next.js 15 + TypeScript + Prisma + PostgreSQL + Redis
- **AI layer:** LangGraph orchestrator → worker agents (Claude/GPT)
- **Key patterns:** Router/approval/delegation extracted (TASK-004), signal system (55 tests, 48 signals from TASK-002), circuit breaker (TASK-006)
- **Circuit breaker:** Per-provider, Redis-backed (`ghost:circuit:{provider}`), injectable client for testability, integrated into `selectRoute` via optional `circuit_states` param, `selectRouteWithCircuit` async wrapper
- **Workplan version:** v3.2 (amendment package applied 2026-03-15)
- **Total tasks:** 23 (TASK-001 through TASK-023)
- **Tier progress:** Tier 0 complete (001–003), Tier 1 in progress (004 ✅, 005 ✅, 006 ✅, 007 next)

## Decisions Log

| Date       | Decision                                                    | Made by          |
|------------|-------------------------------------------------------------|------------------|
| 2026-03-15 | Adopted v3.2 amendment: 6 task enhancements + TASK-023 new  | Human + Architect|
| 2026-03-15 | MCP compatibility notes added to TASK-007 (now size M→M)    | Architect        |
| 2026-03-15 | TASK-008 upgraded to size L (A2A Agent Cards, handoff)       | Architect        |
| 2026-03-15 | AG-UI protocol layer added as TASK-023 (Tier 4, P2)         | Architect        |
| 2026-03-15 | Circuit breaker uses injectable Redis client (no new npm deps) | Claude Code    |
| 2026-03-15 | selectRoute kept synchronous; circuit states passed as pre-fetched map | Claude Code |

## Known Issues

| Issue                                    | Severity | Ticket/Note       |
|------------------------------------------|----------|--------------------|
| *(none currently logged)*                |          |                    |

## Key Files for Context

| File                                    | What it contains                          |
|-----------------------------------------|-------------------------------------------|
| `Ghost_Workplan_Amendment_v3_2.md`      | Full task list, acceptance criteria, GPT briefing |
| `Ghost_Claude_Workplan_v3_1_Approved.docx` | Base workplan (v3.1)                   |
| `Ghost_Roadmap_v3.docx`                | 10-phase roadmap                           |
| `docs/status/CURRENT_STATE.md`          | This file                                 |
| `src/runtime/circuit-breaker.ts`        | Circuit breaker module (TASK-006)         |
| `tests/runtime/circuit-breaker.test.ts` | Circuit breaker tests (32 tests)          |

## Agent Roles

| Agent        | Role                  | When to use                                    |
|--------------|-----------------------|------------------------------------------------|
| **GPT**      | Planner               | Write task prompts for Claude Code             |
| **Claude Code** | Executor           | Implement tasks, write code, run tests         |
| **Claude (claude.ai)** | Architect / Reviewer | Strategic reviews, workplan amendments, architecture decisions |

---

*Last updated: 2026-03-15 by Claude Code (TASK-006 completion)*
