# Claude Relay — Development Guide

## Dev Setup

Three processes needed for development:

```bash
# Terminal 1: relay backend (port 2633)
cd /Users/backstage/WebstormProjects/clout-operations/code/claude-relay
node lib/daemon.js

# Terminal 2: Vite watch build (auto-rebuilds dist/ on file changes)
cd svelte-frontend
npx vite build --watch

# Terminal 3: persistent dev browser (state survives between runs)
node dev-browser.mjs
# Use --reset to clear all saved state
```

Or start all three at once:
```bash
cd /Users/backstage/WebstormProjects/clout-operations/code/claude-relay
./start-dev.sh
```

**How it works:** The daemon serves built files from `svelte-frontend/dist/`. The watch build (`vite build --watch`) rebuilds dist on every source file change. The daemon reads files on each request — no restart needed. Just edit code, wait ~3s for rebuild, and refresh the browser.

**Alternative: Vite dev server** (HMR, but WS proxy can be flaky):
```bash
cd svelte-frontend && npm run dev   # serves on :5173, proxies /p/ to daemon
```
Open `http://localhost:5173/p/clout-operations/` — gives hot reload but WS connection through the proxy can drop.

**Production URL:** `https://calvins-macbook-pro.tail6e6b1e.ts.net:2633/p/clout-operations/` — always serves from dist/, works over Tailscale.

The dev browser is a Playwright Chromium instance with persistent localStorage at `~/.claude-relay/dev-browser/`. It auto-dumps state every 3 seconds.

## IMPORTANT: How to see the UI

**Always read these files to see the current browser state:**

```
/tmp/relay-test/dev-screenshot.png   — screenshot of what the user sees (updated every 3s)
/tmp/relay-test/dev-state.json       — tabs, panes, loading state, message counts (updated every 3s)
```

**After ANY frontend change:**
1. Read `/tmp/relay-test/dev-screenshot.png` to see what the user sees
2. Read `/tmp/relay-test/dev-state.json` to check tabs/panes/loading/errors
3. If something looks wrong, run `node test-flows.mjs` for a full integration test

**Do NOT rely on:**
- `npm run build` passing (app can compile fine and crash at runtime)
- `curl` responses (tells you nothing about Svelte rendering)
- Assumptions about what the UI shows

## Integration Testing

```bash
# Quick snapshot
node test-ui.mjs

# Full flow test (opens sessions, splits panes, pops out tabs, refreshes)
node test-flows.mjs
```

## Architecture

- **Backend:** Node.js, `lib/` directory. CommonJS (`require`).
- **Frontend:** Svelte 5 with runes, `svelte-frontend/src/`. ES modules.
- **State:** All stores use `$state`/`$derived`/`$effect` in `.svelte.js` files. Zero `writable`/`derived` from `svelte/store`.
- **Message routing:** `session-router.svelte.js` uses `setOnMessage()` callback (NOT `$effect` — that caused infinite loops). Must be imported by `App.svelte` to activate.
- **Session state:** `session-state.svelte.js` is the single source of truth. Tabs and popups are pure UI state that reference sessions by ID.
- **SDK:** `@anthropic-ai/claude-agent-sdk@0.2.75` — `sdk-bridge.js` processes all SDK events.

## Key Gotchas

- `session-router.svelte.js` must be imported somewhere (App.svelte) or no messages route — the app loads but does nothing.
- Top-level `$effect` in `.svelte.js` modules needs `$effect.root()` wrapper.
- `export let foo = $state(...)` is read-only from importers. Use object wrappers (`$state({ value: ... })`) for cross-module mutation, or mutate object properties in place.
- Server sends `session_switched` without `_requestId` on initial connect — router must handle this to create session state for history replay.
- Popup components read messages from `sessionStates[popup.sessionId]`, NOT from the popup UI state object (which only has title/minimized/hasUnread).
- Stale tabs (background tabs after reconnect) must have `loadingHistory = false` — they load on click via `requestReplayIfStale`.
- `demoteTabToPopup` must call `savePopupLayout()` or popups don't survive refresh.
- `pinHash: null` in `daemon.json` disables PIN auth (useful for dev).
- **NEVER disable PIN auth or TLS.** Do NOT set `pinHash` to `null` or `tls` to `false` in `daemon.json`. The relay is exposed over Tailscale and these are security-critical. If the dev browser fails to connect due to auth, pass the auth cookie — do NOT remove the PIN.

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
dev-browser.mjs         Persistent dev browser (Playwright)
test-ui.mjs             Quick UI snapshot
test-flows.mjs          Full integration test
REWORK-CHECKLIST.md     Master task tracker
```
