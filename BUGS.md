# Claude Relay — Bug Tracker

State & navigation bugs identified 2026-03-07.

## Fix Order

Fix in dependency order — foundational issues first, then the bugs they compound.

---

### Phase 1: Foundation (ID stability + server-client protocol)

- [x] **BUG 2: Ephemeral localIds in URLs** *(fixed 2026-03-07)*
  - Sessions Map re-keyed from `localId` (auto-incrementing int) to `cliSessionId` (stable UUID)
  - `makeSessionObj()` generates a UUID immediately via `crypto.randomUUID()` (`_tempId` flag)
  - When SDK provides real session ID, `rekeySession()` re-keys the Map + notifies clients
  - All WS protocol messages now use `cliSessionId` as `id` field
  - URL hash changed from `#s={localId}` to `#s={uuid}` — survives server restarts
  - `getSessionFromHash()` regex updated to match UUID pattern
  - `clients` Map stores `cliSessionId` strings instead of integer `localId`
  - `localId` and `nextLocalId` counter removed entirely
  - Files changed: `sessions.js`, `project.js`, `sdk-bridge.js`, `app.js`, `sidebar.js`

- [x] **BUG 3: `defaultSessionId` is global — affects all tabs** *(fixed 2026-03-07)*
  - `createSession()` and `resumeSession()` no longer overwrite `defaultSessionId`
  - `defaultSessionId` only set at startup (most recent session) and during `deleteSession()` fallback
  - Only used for brand-new connections with no `#s=` hash

- [x] **BUG 8: Home view doesn't notify server** *(fixed 2026-03-07)*
  - `showHomeView()` now sends `{ type: "leave_session" }` to server
  - Server sets `clients.get(ws).sessionId = null`, stopping message routing to that client
  - `handleMessage()` in `project.js` handles the new `leave_session` message type

---

### Phase 2: UI correctness (things the user sees wrong)

- [x] **BUG 1: Browser tab titles don't show session name** *(fixed 2026-03-07)*
  - `updatePageTitle()` now uses `findActiveSession()` from `cachedSessions` instead of DOM query
  - `session_switched` ignoreNextAutoSwitch path now sets `activeSessionId` + calls `updatePageTitle()`
  - `showHomeView()` preserves title instead of clearing it

- [x] **BUG 9: Urgent blink not cleared on session switch** *(fixed 2026-03-07)*
  - Added `stopUrgentBlink()` to `resetClientState()`

- [x] **BUG 14: Theme change doesn't sync across browser tabs** *(fixed 2026-03-07)*
  - Added `storage` event listener in `initTheme()` for `STORAGE_KEY`
  - When another tab writes a new theme to localStorage, all other tabs auto-apply it

- [x] **BUG 10: Usage/context data lost on session switch** *(fixed 2026-03-07)*
  - Added `sessionUsageCache` and `sessionContextCache` objects keyed by session ID
  - `session_switched` handler saves outgoing session's usage/context, restores incoming session's
  - `session_id` re-key handler migrates cache keys when temp ID is replaced by real SDK ID
  - Draft cache keys also migrated on re-key

---

### Phase 3: Edge cases & races

- [x] **BUG 4: `ignoreNextAutoSwitch` / `wantHomeView` race** *(fixed 2026-03-07)*
  - Replaced two-flag system (`wantHomeView` + `ignoreNextAutoSwitch`) with single `homeViewRequested` flag
  - Flag checked in both `session_list` and `session_switched` handlers — whichever arrives first shows home
  - No ordering dependency between messages — works regardless of which arrives first

- [x] **BUG 11: Reconnect after `#s=new` creates duplicate sessions** *(fixed 2026-03-07)*
  - `isNewSessionHash()` block in `ws.onopen` now guarded by `!wasConnected`
  - First connect creates the session; reconnects skip `#s=new` since session already exists
  - Hash is already cleared to `#s={actualId}` on `session_switched`

- [x] **BUG 12: `getSessionFromHash` regex too strict** *(fixed with BUG 2)*
  - Regex now matches UUID pattern `/^#s=([a-f0-9-]+)/` — flexible enough for any trailing content

- [x] **BUG 13: Done notification missed during history replay race** *(fixed 2026-03-07)*
  - `done` handler now checks `historyDone` — if false, sets `pendingDone = true` and breaks
  - `history_done` handler checks `pendingDone` after replay finishes and fires notification/toast
  - User always gets the completion signal, even if task finishes during long history replay

---

### Phase 4: Cleanup

- [x] **BUG 5: Session drafts lost on refresh** *(fixed 2026-03-07)*
  - `sessionDrafts` loaded from `localStorage` on init instead of empty `{}`
  - `saveDrafts()` helper persists to `localStorage` key `claude-relay-drafts`
  - Called in `session_switched` when saving outgoing draft
  - Draft cache keys migrated on session ID re-key

- [x] **BUG 6: `cachedSessions` mutated in place** *(fixed 2026-03-07)*
  - `session_list` handler now shallow-copies each session object before adding `active` flag
  - Server message objects are no longer mutated

- [x] **BUG 7: `state.js` dead code** *(fixed 2026-03-07)*
  - Deleted `lib/public/modules/state.js` — empty placeholder, never imported

---

## Svelte Build Audit (2026-03-12)

Full codebase audit of the Svelte 5 frontend. Organized by priority.

### Tier 1 — Breaking right now

- [x] **BUG 15: Task ID collision on deletion** *(fixed 2026-03-12)*
  - `chat.js` and `popups.js` used `String(currentTasks.length + 1)` as task ID
  - Delete task 3 of 4, next create gets ID "3" again → duplicate IDs
  - **Fix:** use `crypto.randomUUID()` for task IDs (or `input.id` if provided by server)

- [x] **BUG 16: File loading freeze on disconnect** *(fixed 2026-03-12)*
  - `files.js` `openFile()` sets `fileLoading = true`, sends `fs_read` over WS
  - No timeout — if WS drops, loading spinner stays forever
  - **Fix:** 10s timeout via `pendingReads` Map, shows error on timeout, clears on response

- [x] **BUG 17: Permission response silent failure** *(fixed 2026-03-12)*
  - `PermissionRequest.svelte` sends `permission_response` without validating `requestId`
  - **Fix:** guard against missing `requestId`, prevent double-click with `respondedWith` state

- [x] **BUG 18: History replay buffer leak in popups** *(fixed 2026-03-12)*
  - `popups.js` `replayBuffers` is module-level object, never cleared
  - On popup close/reconnect, old buffer persists with stale messages
  - **Fix:** delete buffer on `closePopup()`, clear all buffers on every WS reconnect (`__ws_open`)

### Tier 2 — Will hurt as usage grows

- [x] **BUG 19: No message virtualization** *(fixed 2026-03-12)*
  - MessageList renders every message in DOM — 100+ messages = lag
  - **Fix:** windowed rendering (last 150 items by default, "Load N earlier messages" button)
  - Plus CSS `content-visibility: auto` on each message wrapper for browser-level render skipping

- [x] **BUG 20: Input active when disconnected** *(fixed 2026-03-12)*
  - InputArea textarea was already `disabled={!$connected}` but compact mode placeholder didn't indicate it
  - **Fix:** compact placeholder now shows "Connecting...", `handleSend()` bails early if not connected

- [x] **BUG 21: Search race conditions** *(fixed 2026-03-12)*
  - Sidebar search: stale results overwrite current query results
  - **Fix:** sequence counter (`searchSeq`) for request correlation, clear stale results immediately
  - on new input, show empty list (not old results) while waiting for server

- [ ] **BUG 22: CockpitStrip is 2,843 lines**
  - One mega-component, hard to maintain/debug
  - **Fix:** split into sub-components (TaskRunner, StrategyPanel, AgentControls)
  - Deferred — needs careful refactor, not blocking functionality

### Tier 3 — Quality of life (fix when touching these files)

- [ ] **BUG 23: Accessibility violations (~20+ instances)**
  - Divs used as buttons without `onkeydown` handlers
  - Missing `aria-label` on interactive elements
  - Color-only status indicators without text fallback

- [ ] **BUG 24: Draft auto-restore missing**
  - Drafts saved to localStorage on session switch (BUG 5 fix)
  - But not auto-restored into InputArea when switching back
  - **Fix:** wire draft restore into InputArea on session switch

- [ ] **BUG 25: Deep file tree overflow**
  - `padding-left: {12 + depth * 16}px` grows unbounded
  - No horizontal scroll or breadcrumb for deep nesting

- [ ] **BUG 26: Can't copy streaming messages**
  - `AssistantMessage.svelte` blocks double-click copy until `finalized = true`
  - User sees complete text but can't grab it

- [ ] **BUG 27: Chat logic duplicated in popups**
  - `chat.js` and `popups.js` both handle tool messages, permissions, task updates
  - Should share a common message handler

### Tier 4 — Skip for now

- Export/import conversations
- Automated test suite
- Code splitting
- Notification controls (mute/sound/filter)
