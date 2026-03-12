# Claude Relay — Feature Roadmap

Captured 2026-03-12. Updated 2026-03-12.

---

### Quick wins — DONE

- [x] **Scrolling too narrow width** — widened + centered at 900px
- [x] **Remove Board tab** — removed from sidebar
- [x] **Chat input above popup windows** — smart overlap detection pushes input up
- [x] **MD preview styling** — improved in both chat messages and file viewer panel
- [x] **More than 5 open windows** — raised to 20, horizontal scroll overflow
- [x] **Persist sidebar/tab state** — sidebar open/closed + active tab survives refresh

---

### Session tabs — IDE-style workspace (next up)

Turn Claude Relay into a tabbed IDE-like workspace. Three tiers of session views:

**Tabs (top bar)**
- Primary workspace — full chat, full input, search timeline, all features
- Click session in sidebar → opens as new tab (replaces current single-session model)
- Multiple tabs open simultaneously, click to switch
- Tabs persist across refresh (localStorage)
- Close tab = closes the view only, session keeps running server-side
- Scroll position and draft text preserved per tab
- 3-6 visible tabs, overflow via scroll or dropdown

**Popups (bottom bar)**
- Compact but fully functional — can send messages, approve permissions, everything
- Used for sessions you want accessible without leaving your current tab
- Minimize to title bar, expand to peek
- Could auto-open when a background session starts processing

**Tab ↔ Popup promotion**
- Double-click popup header → promotes to tab
- Tab context menu → "pop out" to bottom popup
- Clicking a session that's already a popup → opens as tab, closes popup
- Right-click sidebar session → "open as popup" vs "open as tab"

**Command post**
- First/default tab, always present, not closable
- Shows when no session is selected (like today's home view)
- Could be a pinned tab with a home icon

**File viewer (right panel)**
- Independent of tabs — files stay open across tab switches
- Opening a file from any session adds it to the shared file viewer

**Implementation notes:**
- `activeSessionId` becomes `tabs[]` array + `activeTabIndex`
- Each tab holds: sessionId, scrollPosition, draftText, title
- MessageList/InputArea stay the same, instantiated per tab
- Chat store needs to support multiple concurrent session subscriptions
- Sidebar session list becomes a launcher (open into tab), not a view switcher

---

### Medium effort

- [ ] **Light mode linked to PC** — use `prefers-color-scheme` to auto-switch, sync with OS setting
- [ ] **Width selectors for strategy agent** — configurable panel widths in the strategy/cockpit view
- [ ] **Claude subscription overview / session selector** — show which account/subscription each session uses
- [ ] **"What was I working on?"** — context restore, show recent activity summary on connect

### Bigger features

- [ ] **Sessions → areas, projects, progress** — from a session, see which area/project it relates to and progress status
- [ ] **Areas → agents, people, TOTEs, subprojects** — drill down from area overviews into all related entities
- [ ] **Files/operations from area overviews** — link file tree and operations into area views
- [ ] **Inline MD editing** — edit markdown files directly in the UI (Notion-like, as Lorenz suggested), or via agent
- [ ] **PDF export** — export current page/session/view as PDF
- [ ] **Workflow fixes** — audit all workflows end-to-end, fix remaining bugs
- [ ] **API & MCP server inventory** — catalog all connected APIs and MCP servers, show status
- [ ] **Code refactor** — review codebase health, split CockpitStrip (BUG 22), reduce duplication (BUG 27)
- [ ] **Popup chat duplication** — chat.js and popups.js both handle tool messages, permissions, task updates (BUG 27)

### Deferred from bug tracker

- [ ] **BUG 22: CockpitStrip is 2,843 lines** — split into sub-components
- [ ] **BUG 23: Accessibility violations** — divs as buttons, missing aria-labels
- [ ] **BUG 24: Draft auto-restore** — restore drafts into InputArea on session switch
- [ ] **BUG 25: Deep file tree overflow** — unbounded padding-left
- [ ] **BUG 26: Can't copy streaming messages** — blocked until finalized
