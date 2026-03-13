# Ghost Operator UI

Phase 5A foundation for the Ghost operator interface.

## Architecture

- `app/`: Next.js App Router entrypoints and API proxy route
- `components/`: reusable UI primitives and feature surfaces
- `lib/`: adapter logic, mock contracts, and utilities
- `app/api/chat/route.ts`: server-side proxy to the live Ghost webhook
- `app/api/operations/task-overview/route.ts`: server-side canonical Task Overview feed
- `lib/server/task-ledger.ts`: durable runtime writes for `tasks`, `task_runs`, and `tool_events`

The app is intentionally isolated under `app/ui` so UI work does not disturb the existing backend, workflow, or identity runtime.

## Run

```bash
cd /home/deicide/dev/ghost-stack/app/ui
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:3000
```

## Environment

Copy `.env.example` to `.env.local` and adjust if needed.

- `GHOST_BACKEND_URL`
  - server-side upstream URL for the Next proxy route
  - default: `http://127.0.0.1:5678/webhook/ghost-chat-v3`
- `NEXT_PUBLIC_GHOST_BACKEND_URL`
  - optional browser-visible mirror of the backend URL
  - kept mainly for debugging and documentation parity
- `GHOST_ENABLE_CHAT_MOCKS`
  - if `true`, the API route returns mocked chat responses
- `NEXT_PUBLIC_GHOST_ENABLE_CHAT_MOCKS`
  - if `true`, the client appends `?mock=1` to `/api/chat`
- `GHOST_POSTGRES_HOST`
- `GHOST_POSTGRES_PORT`
- `GHOST_POSTGRES_USER`
- `GHOST_POSTGRES_PASSWORD`
- `GHOST_POSTGRES_DB`
  - core n8n database, default `ghost_core`
- `GHOST_APP_DB`
  - Ghost app database, default `ghost_app`
- `GHOST_ENABLE_OPERATIONS_MOCKS`
  - if `true`, Task Overview may return a mock payload only when live sources produce no rows

For this local Ghost repo, the Task Overview adapter also falls back to reading `/home/deicide/dev/ghost-stack/base/.env` if those DB vars are not set explicitly in the UI app. Environment variables still take precedence.

## Phase 5A Scope Implemented

- atmospheric landing state centered on the Ghost core
- first-message transition into operational chat without route reload
- persistent bottom dock navigation
- live Task Overview with canonical durable ledger support
- interior shell for System Health, Agent Management, and Analytics
- reusable dark ethereal token layer and glass-panel primitives
- live chat adapter with mock-safe proxy path

## Next Recommended Build Step

## Task Overview Data Path

Phase 5C makes the durable runtime ledger canonical.

Primary source:

1. `ghost_app.tasks`
2. `ghost_app.task_runs`
3. `ghost_app.tool_events`

Write path:

1. `/api/chat` creates a durable `tasks` row and a `task_runs` row before forwarding to Ghost
2. the proxy appends start/completion/failure events into `tool_events`
3. when the Ghost webhook returns, the proxy finalizes task/run status and records result metadata

Fallback source path when the durable ledger is empty or unavailable:

1. `ghost_app.messages` + `ghost_app.conversations`
2. `ghost_core.execution_entity` + `ghost_core.workflow_entity`

## Next Recommended Build Step

Phase 5D should move the durable ledger deeper into the Ghost runtime so non-UI callers and direct webhook traffic also emit canonical `tasks` / `task_runs` / `tool_events`, removing the current UI-proxy-only instrumentation gap.
