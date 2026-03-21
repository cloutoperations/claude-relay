# Claude Relay — Development Guide

## Dev Setup

Three processes needed for development:

```bash
# Terminal 1: relay backend (port 2633 HTTPS + 2680 HTTP dev)
cd /Users/backstage/WebstormProjects/clout-operations/code/claude-relay
node lib/daemon.js

# Terminal 2: Vite watch build (auto-rebuilds dist/ on file changes)
cd svelte-frontend
npx vite build --watch

# Terminal 3: Chrome CDP dev browser (connects to :2680 HTTP, auto-reloads on dist/ changes)
node dev-browser.mjs
# Use --attach to connect to already-running Chrome on :9200
```

Or start all three at once:
```bash
cd /Users/backstage/WebstormProjects/clout-operations/code/claude-relay
./start-dev.sh
```

**How it works:** The daemon serves built files from `svelte-frontend/dist/` on two ports: HTTPS `:2633` (production) and HTTP `:2680` (local dev). The watch build (`vite build --watch`) rebuilds dist on every source file change. The CDP dev-browser watches `dist/` and auto-reloads Chrome when files change. Just edit code → Vite rebuilds (~3s) → Chrome auto-reloads.

**IMPORTANT: Never connect Chrome directly to `https://localhost:2633`.** Chrome + self-signed TLS = daemon hangs (stale TLS connections block Node's event loop). Always use `http://localhost:2680` for local dev.

**Production URL:** `https://calvins-macbook-pro.tail6e6b1e.ts.net:2633/p/clout-operations/` — HTTPS with proper Tailscale cert, no issues.

The dev browser uses Chrome DevTools Protocol (CDP) via real Chrome on **port 9200** at `~/.claude-relay/chrome-dev/`. It dumps DOM state, network requests, and console logs every 3 seconds, and auto-reloads on dist/ changes. NO screenshots. Port 9200 is chosen to avoid conflict with the Electron scraper which uses 9222+.

## IMPORTANT: How to see the UI

**Query the DOM directly via CDP.** Chrome runs with `--remote-debugging-port=9200`. To read the page:

```bash
# From the claude-relay directory (needs ws module):
node -e "
const WebSocket = require('ws');
const http = require('http');
http.get('http://127.0.0.1:9200/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const target = JSON.parse(data).find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: 'document.body.innerText',
        returnByValue: true
      }}));
      ws.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.id === 1) { console.log(msg.result?.result?.value); ws.close(); }
      });
    });
  });
});
"
```

You can evaluate ANY JavaScript in the page via `Runtime.evaluate`. Use this to:
- Read DOM state, visible text, element counts
- Click buttons, fill inputs, navigate
- Check Svelte store state via `window.__debug` if exposed
- Trigger page reload via `Page.reload`

**No state dump files. No screenshots. Query the DOM directly when you need it.**

**Do NOT rely on:**
- `npm run build` passing (app can compile fine and crash at runtime)
- `curl` responses (tells you nothing about Svelte rendering)
- Assumptions about what the UI shows

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

## Claude Accounts & Sessions

The daemon auto-discovers Claude accounts by looking for `~/.claude` and `~/.claude-N` directories:

| Account | Email | Config dir | Sessions dir |
|---------|-------|-----------|-------------|
| default | calvin.swinnen@gmail.com | `~/.claude` | `~/.claude/projects/` |
| 2 | admin@cloutoperations.com | `~/.claude-2` | `~/.claude-2/projects/` |

Sessions are JSONL files stored per-project under each account's `projects/` dir. The relay reads these to list and replay session history.

### OAuth Token Refresh (after reboot / token expiry)

The relay reads OAuth tokens from the macOS Keychain to fetch account usage data. Tokens expire and must be refreshed by running `claude auth login`. **Each account must log in through the browser where that account is signed into claude.ai:**

```bash
# Calvin → Brave (where calvin.swinnen@gmail.com is signed in)
BROWSER="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" claude auth login

# Admin → Chrome (where admin@cloutoperations.com is signed in)
BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login
```

**Symptoms of expired tokens:** Account Usage cards in the relay UI show "Token expired" or "Rate limited" errors. The relay itself (sessions, chat) still works — only the usage API needs fresh tokens.

**Keychain note:** Claude Code writes credentials with `-a <username>` (e.g. `-a backstage`). The relay tries this first, then falls back to bare service name lookup for older entries.

## Git Integration

The relay exposes a git sidebar that shows working tree status for the project directory. It reads `git status`, `git diff`, and renders changed/staged/untracked files. The git store is in `svelte-frontend/src/stores/git.svelte.js`, with server-side handling in `lib/project.js`.

The relay's own repo is a **git submodule** of `clout-operations` at `code/claude-relay/`. Push to `main` directly — no PRs.

## Port Allocations

| Port | Service |
|------|---------|
| 2633 | Relay daemon (HTTPS — production/Tailscale only) |
| 2634 | Relay onboarding HTTP |
| 2680 | Relay dev HTTP (local Chrome — **use this for dev**) |
| 9200 | Relay Chrome CDP dev browser |
| 9222+ | Electron scraper (OF) dev server |

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
dev-browser.mjs         Chrome CDP dev browser (DOM/network/console state)
REWORK-CHECKLIST.md     Master task tracker
```
