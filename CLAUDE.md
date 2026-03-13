# Claude Relay — Development Guide

## Dev Setup

Two processes needed:

```bash
# Terminal 1: relay backend (port 2633)
cd /Users/backstage/WebstormProjects/clout-operations/code/claude-relay
node lib/daemon.js

# Terminal 2: Vite dev server (port 5173, proxies WS to 2633)
cd svelte-frontend
npm run dev
```

Open `http://localhost:5173` — Vite serves the Svelte app with hot reload, no PIN needed in dev mode.

## UI Testing — Playwright

**Always use Playwright to verify UI changes.** Do not rely on curl or build-passes-so-it-works. The Svelte app can compile fine and crash at runtime.

```bash
# Headless — captures screenshot + console errors to /tmp/relay-test/
node test-ui.mjs

# Headed — browser visible to user, errors captured for Claude
node test-ui.mjs --headed
```

**After every frontend change**, run `node test-ui.mjs` and read:
- `/tmp/relay-test/screenshot.png` — what the user sees
- `/tmp/relay-test/console.log` — runtime errors

## Architecture

- **Backend:** Node.js, `lib/` directory. CommonJS (`require`).
- **Frontend:** Svelte 5 with runes, `svelte-frontend/src/`. ES modules.
- **State:** All stores use `$state`/`$derived`/`$effect` in `.svelte.js` files. Zero `writable`/`derived` from `svelte/store`.
- **Message routing:** Single `$effect.root` in `session-router.svelte.js` handles ALL WS messages. Must be imported by `App.svelte` to activate.
- **Session state:** `session-state.svelte.js` is the single source of truth. Tabs and popups are pure UI state that reference sessions by ID.
- **SDK:** `@anthropic-ai/claude-agent-sdk@0.2.75` — `sdk-bridge.js` processes all SDK events.

## Key Gotchas

- `session-router.svelte.js` must be imported somewhere (App.svelte) or its `$effect` never runs and no messages route.
- Top-level `$effect` in `.svelte.js` modules needs `$effect.root()` wrapper.
- `export let foo = $state(...)` is read-only from importers. Use object wrappers (`$state({ value: ... })`) for cross-module mutation, or mutate object properties in place.
- Server sends `session_switched` without `_requestId` on initial connect — router must handle this to create session state for history replay.
- `pinHash: null` in `daemon.json` disables PIN auth (useful for dev).

## File Layout

```
bin/cli.js              CLI entry point
lib/daemon.js           Background daemon
lib/server.js           HTTP/WS server
lib/project.js          Per-project context, WS handling
lib/sdk-bridge.js       Claude Agent SDK integration
lib/sessions.js         Session persistence (JSONL)
lib/terminal-manager.js PTY multiplexing
svelte-frontend/src/
  stores/*.svelte.js    Runes stores (state layer)
  lib/chat/             Chat components
  lib/layout/           Layout components (TabBar, Sidebar, PaneManager)
  lib/board/            Board/GTD components
  lib/files/            File browser components
  lib/popup/            Popup components
test-ui.mjs             Playwright UI test script
REWORK-CHECKLIST.md     Master task tracker
```
