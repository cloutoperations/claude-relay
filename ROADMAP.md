# Claude Relay — Feature Roadmap

Captured 2026-03-12.

---

### Quick wins

- [ ] **Scrolling too narrow width** — chat messages area feels cramped, widen max-width or remove constraint
- [ ] **Remove Board tab** — not useful, clutters sidebar
- [ ] **Chat input above popup windows** — when popups are open, input gets buried behind them (z-index)
- [ ] **MD preview styling** — improve markdown rendering so it looks better (spacing, fonts, tables)

### Medium effort

- [ ] **Session tabs on top** — like file tabs, show open sessions as tabs across the top of the chat area
- [ ] **Light mode linked to PC** — use `prefers-color-scheme` to auto-switch, sync with OS setting
- [ ] **Multiple windows / shift-click with state** — open multiple paths with proper memory and state persistence
- [ ] **More than 5 open windows** — lift the popup limit, allow more concurrent session views
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
