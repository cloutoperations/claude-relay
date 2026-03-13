# Svelte Rework Checklist

## Phase 1 — Stop the crashes (no store changes)

- [x] **1.1** Harden JSONL parse loop — filter null/undefined entries on load
- [x] **1.2** Null guard in `findTurnBoundary` — already present in source ✓
- [x] **1.3** Daemon `uncaughtException` handler — already present, calls gracefulShutdown() ✓
- [x] **1.4** Daemon startup — detect and remove stale `daemon.sock` — already in ipc.js:11 ✓
- [x] **1.5** `EADDRINUSE` recovery — probe IPC socket, detect orphan vs live daemon, retry once
- [x] **1.6** BUG 26 — copy streaming messages: removed `finalized` gate in `AssistantMessage.svelte`

## Phase 2 — Runes rewrite (the actual fix)

### Server prep (small, do first)

- [x] **2.0** Add `tab_subscribe`/`tab_unsubscribe` message types in `lib/project.js` — aliased to popup_open/popup_close, backward compatible

### New files to create

- [x] **2.1** `stores/session-state.svelte.js` — single `$state` object, rekey, replay buffers, routeToSession
- [x] **2.2** `stores/session-router.svelte.js` — `$effect` on `incoming`, owns all routing, rekey, reconnect staggering
- [x] **2.3** `stores/ws.svelte.js` — `$state` for connected/incoming, no handler array
- [x] **2.4** `stores/tabs.svelte.js` — pure UI state, `$derived` tabSessionIds, delegates to session-state
- [x] **2.5** `stores/popups.svelte.js` — pure UI state, delegates to session-state
- [x] **2.6** `stores/sessions.svelte.js` — `$state` session list, `$derived` activeSession
- [x] **2.7** `stores/chat.svelte.js` — `$state` for global broadcast, updated by session-router
- [x] **2.8** `stores/files.svelte.js` — `$state` + `$effect` on incoming for fs messages
- [x] **2.9** `stores/ambient.svelte.js` — `$state`, updated by session-router
- [x] **2.10** `stores/theme.svelte.js` — re-exports from theme.js (pure functions, no runes needed)
- [x] **2.11** `stores/panes.svelte.js` — `$state` + `$effect` for persistence
- [x] **2.12** `stores/ui.svelte.js` — `$state` + `$effect` for localStorage sync
- [x] **2.12b** `stores/board.svelte.js` — `$state` + `$derived` for board data

### Delete old files

- [x] **2.13** Deleted 12 old `stores/*.js` files. Only `session-state-utils.js` remains (pure functions, not a store).

### Reconnect & rekey fixes (built into new stores)

- [x] **2.14** Staggered replay in `session-router.svelte.js` — only replay active tab, `staleTabs` Set for lazy-load
- [x] **2.15** Rekey in `session-state.svelte.js` — `rekeySession()`, one mutation, everything derives

### Import dependency graph (no circular imports!)

```
ws.svelte.js → session-router.svelte.js → session-state.svelte.js
                                        ↘ chat.svelte.js
tabs.svelte.js    ← derives from → session-state.svelte.js
popups.svelte.js  ← derives from → session-state.svelte.js
components        ← import from  → tabs / popups / session-state / chat / ws
```

## Phase 3 — Update components to use runes stores

- [x] **3.1** `App.svelte` — imports swapped, onMessage removed, $store refs fixed
- [x] **3.2** `InputArea.svelte` — wsState.connected, slashCommands direct access
- [x] **3.3** `PaneManager.svelte` — wired to sessionStates for messages/processing/activity, tabs for UI only
- [x] **3.4** `PermissionRequest.svelte` — imports updated
- [x] **3.5** `TabBar.svelte` — reads from tabs.svelte.js, panes.svelte.js, activeTabId.value
- [x] **3.6** `ChatPopup.svelte` / `ChatPopupManager.svelte` — reads from popups.svelte.js + sessionStates
- [x] **3.7** `AreasSidebar.svelte` — sessionList as sessions, clientCount.count, .value wrappers
- [x] **3.8** `FileViewer.svelte` / `FileTree.svelte` / `QuickOpen.svelte` — .value wrappers for all file state
- [x] **3.9** `StatusBar.svelte` / `Header.svelte` / `SessionRail.svelte` — all $ refs fixed
- [x] **3.10** All 26 components updated — board/*, chat/*, popup/*, layout/*, files/*. Build passes.

## Phase 4 — Polish

- [x] **4.1** BUG 24 — draft auto-restore: InputArea restores draftText from tab state on sessionId change via $effect
- [x] **4.2** BUG 25 — deep file tree overflow: added .file-tree-scroll wrapper with overflow-x: auto
- [ ] **4.3** BUG 22 — split CockpitStrip into smaller components (optional, skipped)
- [x] **4.4** Deleted 12 old stores/*.js files (2.13)
- [x] **4.5** StatusBar modelShort: $derived(() => ...) → $derived.by(() => ...), removed () call in template
- [x] **4.6** MessageList messagesEl: `let messagesEl` → `let messagesEl = $state(null)` (fixes build warning)
- [x] **4.7** promotePopupToTab / demoteTabToPopup: snapshot logic already correct (verified)

## Phase 5 — Server hardening

### Critical (crash/data loss)

- [x] **5.1** JSONL dedup race — removed fs.unlinkSync calls, keeps longer history in memory only
- [x] **5.2** `parseJsonBody()` size limit — 1MB max + 10s timeout, rejects with 413/408
- [x] **5.3** Atomic session file writes — write-to-temp-then-rename pattern
- [x] **5.4** WS message size limit — `maxPayload: 1MB` on WebSocketServer
- [x] **5.5** Terminal process cleanup — detachAll kills PTY with SIGTERM when all subscribers gone

### High (security/integrity)

- [x] **5.6** SDK session expiry — cleans up queryInstance/messageQueue/abortController, sends explicit error to client
- [x] **5.7** Git input validation — hash must match `/^[0-9a-f]{7,64}$/i`, paths reject `..`
- [x] **5.8** Path traversal hardening — lstatSync symlink check before realpathSync
- [x] **5.9** File watcher limit — MAX_WATCHERS=50 with LRU eviction
- [x] **5.10** Permission request cleanup — handleDisconnection denies pending permissions when no other viewer
- [x] **5.11** Null guards — config.js validates PID is finite positive number, sessions.js guards empty array

### Medium (reliability)

- [x] **5.12** Board markdown parser — null check on date regex match
- [x] **5.13** File index depth limit — MAX_INDEX_DEPTH=20, skips symlink directories
- [x] **5.14** Terminal scrollback cap — SCROLLBACK_CHUNK_MAX=64KB, truncates oversized chunks
- [x] **5.15** Swallowed promise rejections — all HTTP handler catch blocks now log errors
- [x] **5.16** Rewind off-by-one — checks if user message found, bails with error if not

### Cleanup

- [ ] **5.17** Message virtualization — verify MessageList.svelte 150-item window survives the runes migration
- [ ] **5.18** Remove old UI fallback — delete `lib/public/` and fallback in `server.js` once Svelte build is stable

## Phase 6 — SDK & server upgrades

- [x] **6.1** Bumped `@anthropic-ai/claude-agent-sdk` from 0.2.38 → 0.2.75. `query()` API compatible, new exports: `HOOK_EVENTS`, `EXIT_REASONS`, `getSessionInfo`, `listSessions`, `tagSession`, `renameSession`, `unstable_v2_*`
- [ ] **6.2** Audit new SDK features to wire up: rate limit events, session forking, new exports — deferred to Phase 7
- [x] **6.3** Flipped hook filtering to positive match — only rekey on `assistant`, `user`, `result`, `system/init`. Defensive against new hook subtypes.
- [x] **6.4** Per-connection WS session state — added `sessionViewers` reverse index (`sessionId → Set<ws>`), `setClientSession()` helper for atomic updates, `sendToSessionViewers` uses reverse index. Rekey updates index atomically.
- [x] **6.5** Externalized agent skills — `loadAgentSkills(cwd)` reads `.claude-relay/skills/*.md`, falls back to hardcoded `AGENT_SKILLS`

## Phase 7 — New SDK features in the UI

### Rate limiting
- [x] **7.1** Server: detect rate limit errors in result handler, emit `{ type: 'rate_limit' }` to viewers
- [x] **7.2** Frontend: `rateLimited`/`rateLimitText` in session state, `rateLimitState` in chat store, routed in session-router with 60s auto-clear
- [x] **7.3** Frontend: "429" badge in StatusBar with pulsing amber styling when rate limited
- [ ] **7.4** Frontend: queue outgoing messages when rate limited — deferred (indicator is enough for now)

### Session forking
- [x] **7.5** Server: `fork_session` WS handler creates branched session with `_forkFrom`, copies account/project, returns `session_switched`
- [x] **7.6** Frontend: "Fork Session" in tab context menu, `forkTab()` in tabs store, session-router handles fork via `pendingForkRequests`
- [ ] **7.7** Frontend: forked session indicator — deferred (nice to have)

### System prompt control
- [x] **7.8** Server: `set_system_prompt` WS handler sets `session.customPrompt` (10K cap), `buildSystemPrompt()` appends it
- [ ] **7.9** Frontend: system prompt editor panel — deferred (server endpoint ready)
- [ ] **7.10** Frontend: per-area default prompts — deferred (6.5 externalized skills covers the server side)

### Settings control
- [ ] **7.11** Server: expose `settingSources` SDK field — deferred
- [ ] **7.12** Frontend: settings toggle in session creation — deferred
