# Claude Relay Re-Architecture TOTE

## 1. Trigger

The daemon freezes when any browser connects via WebSocket. `project.js` is a 2700-line god file doing sync I/O (`execFileSync`, `readFileSync`) on the same event loop that serves HTTP and WebSocket. One slow git command blocks every client.

## 2. Present State

**Backend (`lib/`):**
- `project.js` (2700 lines) — handles EVERYTHING: WS messages, git ops (sync!), file system, sessions, SDK bridge wiring, terminal management, agent tasks
- `sessions.js` — partially async (history loading), still has sync `ensureHistoryLoaded`
- `sdk-bridge.js` — SDK query lifecycle + tool restrictions (recently added for copilot)
- `server.js` — HTTP/WS server + new dev HTTP port (:2680)
- `daemon.js` — entry point, crashes on EPIPE (now fixed)
- `usage.js` — OAuth usage API (token refresh issues, now fixed)
- All plain JavaScript (CommonJS), no types, no safety

**Blocking calls in `project.js` message handlers:**
- `execFileSync("git", ["status", ...])` — called on every `git_status` message
- `execFileSync("git", ["diff", ...])` — called on diff requests
- `execFileSync("git", ["log", ...])` — called on git log
- `execFileSync("git", ["add/reset/checkout", ...])` — git stage/unstage/discard
- `execFileSync("git", ["show", ...])` — file at commit
- `readFileSync` for file reads (file browser)
- `ensureHistoryLoaded` (sync) still called in 3 places

**Frontend (`svelte-frontend/src/`):**
- Svelte 5 with runes — clean architecture, stores in `.svelte.js` files
- 17 stores, ~45 components across chat, board, layout, files, popup
- Working well — the frontend is NOT the problem

## 3. Desired State

- **Zero sync I/O in message handlers** — all `execFileSync` → `execFile`, all `readFileSync` → `readFile`
- **`project.js` split into modules:**
  - `project.js` — core: WS connection, client tracking, message routing (< 300 lines)
  - `project-git.js` — all git operations (async)
  - `project-files.js` — file tree, file read/write, search (async)
  - `project-sessions.js` — session list, history replay, session management
  - `project-messages.js` — message routing for SDK events, chat messages
- **Daemon never freezes** — HTTP and WebSocket always responsive, even during heavy git ops
- **EPIPE/ECONNRESET handled gracefully** (done)
- **TypeScript** — after architecture is clean, convert module by module
- **Dev browser works** — Chrome CDP on :9200 connecting to :2680 without hanging

## 4. Test Criteria

- [ ] Start daemon, connect Chrome, `curl http://localhost:2680/` returns 200 at all times
- [ ] Open 5 session tabs simultaneously — daemon stays responsive
- [ ] `git status` on 14GB monorepo doesn't block other clients
- [ ] File tree loads without blocking session history
- [ ] No `execFileSync` calls remain in any message handler path
- [ ] `project.js` is under 400 lines
- [ ] All tests pass (once we have them)

## 5. Operations

### Phase 1: Async-ify (stop the bleeding)
1. Replace all `execFileSync` in `project.js` git handlers with `execFile` (callback)
2. Replace remaining sync `ensureHistoryLoaded` calls with async version
3. Replace sync file reads in file browser handlers with `fs.readFile`
4. Test: daemon stays responsive while Chrome is connected

### Phase 2: Split project.js
5. Extract `project-git.js` — all git message handlers
6. Extract `project-files.js` — fs_list, fs_read, fs_search, file watcher
7. Extract `project-sessions.js` — session list, replay, management
8. Extract `project-messages.js` — SDK event routing, chat message handling
9. Slim `project.js` to connection lifecycle + message dispatch only

### Phase 3: TypeScript
10. Add `tsconfig.json` to `lib/`
11. Convert extracted modules one at a time (git → files → sessions → messages → project)
12. Add interfaces for WS message types, session objects, git results

### Phase 4: Dev tooling
13. CDP dev browser connects reliably on :2680
14. Auto-reload on dist/ changes verified working
15. Deep DOM query patterns documented in CLAUDE.md

## 6. Decision Point

After each phase, test:
- Does `curl http://localhost:2680/` return 200 while Chrome is connected?
- Are there any console errors in the browser?
- Can sessions be opened, messages sent, files browsed?

If yes → next phase. If no → debug before continuing.

## 7. Exit

All 4 phases complete. Daemon never hangs. `project.js` < 400 lines. TypeScript compiles. CDP dev browser works. CLAUDE.md is current.

## 8. Resources & Context

- **Repo:** `/Users/backstage/WebstormProjects/clout-operations/code/claude-relay/`
- **Daemon config:** `~/.claude-relay/daemon.json`
- **Sessions:** `~/.claude/projects/` (752 sessions in clout-operations alone)
- **Key constraint:** NEVER disable PIN auth or TLS — relay is exposed over Tailscale
- **Previous work:** Session history loading already async (`ensureHistoryLoadedAsync` in sessions.js), popup replay already chunked
- **Calvin's accounts:** default (calvin@gmail, Brave) + admin (cloutoperations, Chrome)
- **Port allocations:** 2633 HTTPS, 2634 onboarding, 2680 HTTP dev, 9200 CDP, 9222+ scraper
