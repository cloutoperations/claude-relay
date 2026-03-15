# Claude Relay — Validated Audit Checklist

Consolidated from two independent audit sessions (March 2026), then validated against actual code. Overblown/wrong items removed.

---

## Tier 1: Bugs That Break Things

- [ ] **1.14** History loading stuck forever on error — `_loadingHistory` never clears (`sessions.js:115`)
- [ ] **1.3** No `unhandledRejection` handler — daemon crashes silently (`daemon.js`)
- [ ] **2.15** Async tab restoration — one failure kills all tab restore (`session-router.svelte.js:498`)
- [ ] **2.11** Stale replay state on reconnect — can replay wrong session (`session-router.svelte.js:394`)
- [ ] **2.10** File read timeouts fire after reconnect — stale callbacks (`files.svelte.js:44`)
- [x] **2.17** Streaming proxy fix — `_streamingMsg` points to Svelte 5 proxy `[uncommitted]`
- [x] **2.18** Operation/agent/git-diff tab close — TabBar handles all `__` prefixes `[committed]`
- [x] **QuickOpen** File search index stale after new files — async rebuild + dir watcher invalidation `[uncommitted]`

---

## Tier 2: Real Quality Issues

- [ ] **1.13** Silent `catch {}` masks bugs — replace with `catch(e) { console.warn() }` across codebase (`sdk-bridge.js:355`, `sessions.js:102`, others)
- [ ] **1.11** WebSocket auth failures not logged — add logging (`server.js:477`)
- [ ] **1.4/1.6** No size limits on uploads and POST bodies — disk exhaustion risk (`project.js:1658`, `server.js:165`)
- [ ] **6.5** Session search sorts O(n log n) on every keystroke — needs debounce (`AreasSidebar.svelte:75`)
- [ ] **6.1** `puppeteer` in frontend dependencies — move to devDependencies (`package.json`)
- [ ] **6.6** Git status polls every 10s — increase to 30s or pause when tab not visible

---

## Tier 3: Polish (When Touching the Area)

- [ ] **4.3** Z-index chaos — 37 declarations, 15 arbitrary values — define a scale
- [ ] **3.1** Zero `prefers-reduced-motion` support — add global `@media` rule
- [ ] **2.1** Popup flight timer leak — clear on close
- [ ] **2.3** Toast timeout accumulation — add dedup
- [ ] **5.1** Someday/Maybe invisible — `someday/` skipped in board API, add toggle
- [ ] **5.13** OperationDetailTab misleading — shows area sessions, not operation-specific
- [ ] **5.9** Board doesn't auto-refresh on GTD vault changes — add watcher on `gtd/`

---

## Feature Parity (Not Bugs — New Work)

### Clay Features (0%)
- [ ] Shared agent infrastructure (CLAY-FEATURES 0.1–0.9)
- [ ] Ralph Loop (1.1–1.6)
- [ ] Cron Scheduler (2.1–2.5)
- [ ] Agent Overview dashboard

### Git Integration (0%)
- [ ] Git sidebar (G.1–G.6)
- [ ] Diff viewer in pane
- [ ] Stage/unstage/discard from UI

### SDK Parity (90%)
- [ ] Session forking UI
- [ ] System prompt editor

### UI Checklist Gaps
- [ ] Phase 4 — NotionEditor / inline file editing
- [ ] Phase 5 — polish pass

---

## Done (This Session)

- [x] Chunk-based streaming reveal buffer with skeleton placeholders
- [x] ResizeObserver auto-scroll respecting user scroll position
- [x] Svelte 5 `_streamingMsg` proxy fix
- [x] Vite proxy target fixed to `https://` for TLS daemon
- [x] Home navigation via sidebar project name click
- [x] Operation/agent tab close handling in TabBar
- [x] QuickOpen file index: async rebuild on search, dir watcher invalidation, TTL 15s

---

*Total: ~17 real bugs/issues + ~12 feature items. Down from ~100 inflated items.*
