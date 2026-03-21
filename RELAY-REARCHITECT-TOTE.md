# Claude Relay Re-Architecture TOTE

## 1. Trigger

The daemon froze when any browser connected via WebSocket. `project.js` was a 2700-line god file doing sync I/O on the event loop. One slow git command blocked every client.

## 2. Present State (2026-03-21)

**Phases 1, 2, 4 COMPLETE. Phases 3, 5, 6 pending.**

**Backend (`lib/`) — after refactor:**
```
lib/
├── project/                    10 modules, 2520 lines total (was 2688 in one file)
│   ├── index.js          430    Hub: dispatch table, client tracking, connection lifecycle
│   ├── http.js           657    All HTTP API endpoints (board, PDF, strategy, files)
│   ├── chat.js           376    Message sending, stop, permissions, rewind
│   ├── files.js          329    File browser, search, per-project watchers + index
│   ├── git.js            279    Git status/stage/unstage/diff/history (all async)
│   ├── sessions.js       232    Session CRUD, popups, tabs, archive
│   ├── utils.js           81    safePath, parseJsonBody, execFileAsync
│   ├── system.js          64    Usage, process stats, heal sessions
│   ├── terminal.js        44    PTY handlers
│   └── constants.js       28    IGNORED_DIRS, BINARY_EXTS, MIME_TYPES
│
├── sdk-bridge.js       1372    SDK query lifecycle, system prompts, event handling ← NEXT TARGET
├── sessions.js          754    Session persistence, JSONL, history loading
├── server.js            654    HTTP/WS server, auth, static files, dev server
├── pages.js             714    HTML templates (PIN, setup, dashboard)
├── agent-tasks.js       403    Agent task runner
├── daemon.js            386    Multi-project daemon, IPC, lifecycle
├── config.js            266    Config I/O, account detection
├── terminal-manager.js  203    PTY multiplexing
├── usage.js             160    OAuth token, API usage
├── push.js              125    Web Push (VAPID)
├── ipc.js               112    Unix socket IPC
├── updater.js            96    Version check, auto-update
└── terminal.js           24    PTY spawn wrapper
```

**What's working:**
- Daemon responsive on HTTPS :2633 + HTTP dev :2680
- Zero sync I/O in WS message handlers
- File tree loads (per-project file managers, not singleton)
- Chat works, git sidebar works, sessions work
- CDP dev browser on :9200, auto-reload on dist/ changes
- Both accounts authed (Calvin + Admin)

**What's still wrong:**
- `sdk-bridge.js` (1372 lines) — second god file. Query lifecycle, system prompts, tool approval, agent skills, error handling, rewind all tangled together
- `sessions.js` startup — 9 sync calls loading session metadata. Slow on 1000+ sessions after reboot
- `http.js` board endpoint — scans entire GTD directory tree on every request. Should be cached
- No TypeScript anywhere — entire backend is untyped JS
- No automated tests — zero unit/integration tests
- Silent `catch {}` blocks hide errors in sessions.js and sdk-bridge.js
- `_loadingHistory` flag never clears on error → stuck spinner

**Frontend (`svelte-frontend/src/`):**
- Svelte 5 with runes — 22 stores, ~45 components
- Clean architecture, no stale patterns
- File tree fix: `fs_list` now sent on WS open (not just onMount)

## 3. Desired State

```
lib/
├── project/                    (DONE) async handler modules
│   ├── index.js                hub + dispatch
│   ├── chat.js                 messages, permissions, rewind
│   ├── files.js                file browser, search, watchers
│   ├── git.js                  git ops (async)
│   ├── sessions.js             session CRUD, popups
│   ├── http.js                 HTTP API endpoints
│   ├── terminal.js             PTY handlers
│   ├── system.js               usage, stats
│   ├── utils.ts                safePath, parseJsonBody, execFileAsync
│   └── constants.ts            shared constants
│
├── sdk/                        (NEW) split from sdk-bridge.js
│   ├── index.ts                createSDKBridge factory, exports
│   ├── query.ts                query lifecycle (start, push, abort, rewind)
│   ├── events.ts               SDK event → WS message mapping
│   ├── tools.ts                tool approval, canUseTool, blocking command detection
│   ├── prompts.ts              system prompt building, agent skills, conversation context
│   └── types.ts                interfaces for SDK events, query options, session shape
│
├── sessions.ts                 (CONVERTED) async startup, ensureHistoryLoadedAsync everywhere
├── server.ts                   (CONVERTED) async appHandler, clean auth
├── daemon.ts                   (CONVERTED) entry point
├── config.ts                   (CONVERTED) typed config
├── terminal-manager.ts         (CONVERTED)
├── usage.ts                    (CONVERTED)
├── push.ts                     (CONVERTED)
├── ipc.ts                      (CONVERTED)
├── updater.ts                  (CONVERTED)
├── pages.ts                    (CONVERTED)
└── agent-tasks.ts              (CONVERTED)
```

**End state:**
- All TypeScript with interfaces for WS messages, sessions, SDK events, config
- `sdk-bridge.js` split into focused modules (query lifecycle vs events vs tools vs prompts)
- Sessions startup fully async (no event loop blocking on 1000+ files)
- Board endpoint cached (not rescanning GTD tree every request)
- Silent catches replaced with logged warnings
- Tests for critical paths (git parsing, session rekey, file watcher)

## 4. Test Criteria

- [x] Start daemon, connect Chrome, `curl http://localhost:2680/` returns 200 at all times
- [x] Open 5 session tabs simultaneously — daemon stays responsive
- [x] `git status` on 14GB monorepo doesn't block other clients
- [x] File tree loads without blocking session history
- [x] No `execFileSync` calls remain in any message handler path
- [x] `project.js` split into modules (largest is 657 lines)
- [ ] `sdk-bridge.js` split into modules (< 400 lines each)
- [ ] All `.js` files in `lib/` converted to `.ts`
- [ ] `tsconfig.json` compiles with zero errors
- [ ] Sessions startup doesn't block event loop (async metadata loading)
- [ ] Board endpoint responds in < 50ms (cached)
- [ ] `grep -r "catch {}" lib/` returns nothing
- [ ] Unit tests exist for git parsing, session rekey, file watcher
- [ ] All tests pass

## 5. Operations

### Phase 1: Async-ify ✅ DONE (2026-03-21)
- All `execFileSync` → `execFileAsync` in git handlers
- All `readFileSync` → `fs.promises.readFile` in file/HTTP handlers
- `ensureHistoryLoadedAsync` added to sessions.js
- `buildFileIndexAsync` uses `fs.promises.readdir` (fixed home dir freeze)
- Files module converted from singleton to per-project factory

### Phase 2: Split project.js ✅ DONE (2026-03-21)
- 10 modules in `lib/project/`, dispatch table in index.js
- Old `project.js` deleted (was 2688 lines)

### Phase 3: Split sdk-bridge.js ⏳ NEXT
1. Extract `sdk/prompts.ts` — AGENT_SKILLS, BASE_SYSTEM_APPEND, buildSystemPrompt, buildConversationContext
2. Extract `sdk/tools.ts` — handleCanUseTool, BLOCKED_CMD_PATTERNS, isBlockingCommand, permission request flow
3. Extract `sdk/events.ts` — SDK event → WS message mapping (the big switch/case on event types)
4. Extract `sdk/query.ts` — startQuery, pushMessage, warmup, rewind query lifecycle
5. Slim `sdk/index.ts` — createSDKBridge factory, wires everything together

### Phase 4: Dev tooling ✅ DONE (2026-03-21)
- CDP dev browser on :9200 → :2680
- Auto-reload on dist/ changes
- DOM query patterns in CLAUDE.md

### Phase 5: TypeScript conversion
6. Add `tsconfig.json` to root with strict mode
7. Convert leaf modules first: constants.ts, utils.ts, config.ts, ipc.ts, push.ts, updater.ts
8. Convert mid-level: terminal-manager.ts, usage.ts, agent-tasks.ts, pages.ts
9. Convert core: sessions.ts, server.ts, daemon.ts
10. Convert project/ modules: constants → utils → git → files → sessions → chat → terminal → system → http → index
11. Convert sdk/ modules: types → prompts → tools → events → query → index
12. Add interfaces for WS message types, session objects, SDK events, config shape

### Phase 6: Hardening
13. Replace all silent `catch {}` with logged catches
14. Fix `_loadingHistory` flag — clear on error
15. Cache board/areas endpoint (invalidate on GTD dir change)
16. Async session metadata loading at startup
17. Add unit tests: git output parsing, session rekey, file watcher debounce, SDK event mapping
18. Add E2E tests: connect browser, send message, verify response

## 6. Decision Point

After each phase, test:
- Does `curl http://localhost:2680/` return 200 while Chrome is connected?
- Are there any console errors in the browser?
- Can sessions be opened, messages sent, files browsed?

If yes → next phase. If no → debug before continuing.

## 7. Exit

All 6 phases complete. Daemon never hangs. TypeScript compiles. SDK split into focused modules. Tests pass. CLAUDE.md is current.

## 8. Resources & Context

- **Repo:** `/Users/backstage/WebstormProjects/clout-operations/code/claude-relay/`
- **Daemon config:** `~/.claude-relay/daemon.json`
- **Sessions:** `~/.claude/projects/` (752 sessions in clout-operations alone)
- **Key constraint:** NEVER disable PIN auth or TLS — relay is exposed over Tailscale
- **Calvin's accounts:** default (calvin@gmail, Brave) + admin (cloutoperations, Chrome)
- **Port allocations:** 2633 HTTPS, 2634 onboarding, 2680 HTTP dev, 9200 CDP, 9222+ scraper
- **Commit:** `8880840` — Phase 1+2 complete, project.js split + async handlers
