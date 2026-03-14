# Claude Relay — Svelte Migration Plan

## Overview

Migrate the vanilla JS frontend (~12K lines JS, ~7.5K lines CSS, ~500 lines HTML) to Svelte + Vite.
The relay server (lib/project.js, lib/sessions.js, lib/sdk-bridge.js) stays untouched.
Build output goes to `dist/` which the relay server serves instead of `lib/public/`.

## Source inventory

### JS modules (11,784 lines)
| Module | Lines | Svelte target | Notes |
|--------|-------|---------------|-------|
| app.js | 2394 | App.svelte + stores | God file — gets split into stores + root component |
| tools.js | 1527 | ToolRenderer.svelte + children | Most complex rendering — tool groups, diffs, permissions, subagents |
| filebrowser.js | 2272 | FileBrowser.svelte + FileViewer.svelte | File tree, tabs, viewer, terminal integration |
| sidebar.js | 837 | Sidebar.svelte | Project switcher, session list, file/session tabs |
| terminal.js | 670 | Terminal.svelte | xterm.js wrapper, tabs, toolbar |
| theme.js | 630 | theme.js store | Keep as plain JS store, no component needed |
| input.js | 584 | InputArea.svelte | Textarea, slash commands, image paste, auto-resize |
| board.js | 549 | Board.svelte | GTD command post, area cards, project detail |
| notifications.js | 512 | notifications.js store | Push, sound, browser alerts — keep as plain JS |
| chatpopup.js | 511 | ChatPopup.svelte | Messenger-style floating windows |
| diff.js | 398 | DiffView.svelte | Inline diff rendering |
| rewind.js | 334 | RewindModal.svelte | Conversation/file rewind UI |
| workspace.js | 186 | SessionRail.svelte | Side rail session browser |
| markdown.js | 149 | markdown.js util | Keep as plain JS, used by multiple components |
| utils.js | 86 | utils.js | Keep as plain JS |
| icons.js | 54 | icons.js | Lucide icon helpers |
| qrcode.js | 70 | QrOverlay.svelte | Share QR code |
| events.js | 21 | Delete | Tiny, inline into stores |

### CSS files (7,569 lines)
Migrate into `<style>` blocks per component. Keep `base.css` as global.
CSS custom properties (--bg, --accent, etc.) stay in base.css.

---

## Architecture

### Stores (reactive state)
```
src/stores/
  ws.js          — WebSocket connection, send(), reconnect logic
  sessions.js    — session list, active session, cached sessions
  ambient.js     — per-session ambient state (processing, permissions, done)
  ui.js          — view state (board visible, home visible, sidebar open)
  theme.js       — theme selection, CSS variable computation
  notifications.js — push/sound/alert preferences
```

### Components
```
src/
  App.svelte              — root layout, view switching
  lib/
    layout/
      Sidebar.svelte      — left sidebar (project switcher, file tree, session list)
      SessionRail.svelte  — right rail session browser
      Header.svelte       — top bar (project name, session title, actions)
    board/
      Board.svelte        — GTD command post
      AreaCard.svelte     — area card in grid
      AreaDetail.svelte   — area drill-down with TOTE sections
    chat/
      MessageList.svelte  — scrollable message container
      UserMessage.svelte  — user bubble
      AssistantMessage.svelte — streamed assistant text
      ChatPopup.svelte    — floating popup window
      ChatPopupManager.svelte — manages multiple popups
    tools/
      ToolGroup.svelte    — collapsible tool group
      ToolItem.svelte     — single tool execution
      PermissionRequest.svelte — allow/deny UI
      AskUser.svelte      — question form
      DiffView.svelte     — inline diff
      PlanCard.svelte     — plan mode banner
    input/
      InputArea.svelte    — textarea + slash menu + attachments
      SlashMenu.svelte    — command palette dropdown
    files/
      FileBrowser.svelte  — file tree panel
      FileViewer.svelte   — code viewer with tabs
      FileSearch.svelte   — file search modal
    terminal/
      Terminal.svelte     — xterm.js wrapper
      TerminalTabs.svelte — terminal tab bar
    modals/
      RewindModal.svelte
      ConfirmModal.svelte
      ResumeModal.svelte
      ImageModal.svelte
      PasteModal.svelte
      QrOverlay.svelte
    shared/
      StatusDot.svelte    — reusable status indicator
      InfoPanel.svelte    — usage/context/status panels
  utils/
    markdown.js           — renderMarkdown, highlightCodeBlocks
    icons.js              — lucide helpers
    utils.js              — escapeHtml, copyToClipboard, etc.
```

---

## Migration sequence

Each phase produces a working app. No big bang — incremental delivery.

### Phase 0: Scaffold ✅
- [x] Vite + Svelte scaffold
- [x] vite.config.js with proxy to relay dev server (TLS, secure:false)
- [x] Folder structure (src/stores, src/lib, src/utils)
- [x] app.css global styles with CSS custom properties
- [x] App.svelte mounting
- [x] `npm run dev` works on :5173

### Phase 1: Core stores + WebSocket ✅
- [x] `ws.js` store — connect, reconnect, send, onMessage dispatch (dev proxy to :2700)
- [x] `sessions.js` store — session list, active session, switch/create/delete, session_switched handler
- [x] `ambient.js` store — per-session ambient state tracking
- [x] `ui.js` store — view state (sidebarOpen, workspaceEnabled, currentView)
- [x] `theme.js` store — theme loading, CSS variable management, 14 themes
- [x] `chat.js` store — message accumulation, delta streaming, tool/permission/thinking state
- [x] Message routing via onMessage handlers in each store

### Phase 2: Layout shell ✅
- [x] App.svelte — flex layout with sidebar, main content, rail slots
- [x] Header.svelte — project name, session title, client count, connection status
- [x] Sidebar.svelte — sessions/files tabs, date-grouped session list, new session button
- [x] SessionRail.svelte — right rail with ambient status, permission inline actions
- [x] View switching (home, session, connect overlay)
- [x] Mobile responsive (sidebar drawer, rail hidden on small screens)

### Phase 3: Message rendering ✅
- [x] MessageList.svelte — scrollable container, auto-scroll
- [x] UserMessage.svelte — user bubbles with images/pastes support
- [x] AssistantMessage.svelte — streamed markdown with delta, copy handler
- [x] ThinkingIndicator.svelte — bouncing dots, expandable thinking text
- [ ] markdown.js — port renderMarkdown, integrate highlight.js + mermaid
- [ ] StatusDot.svelte — reusable processing/done/permission indicator
- [ ] Test: open a session, see full message history, send a message

### Phase 4: Tool rendering ✅ (basic)
- [x] ToolItem.svelte — individual tool with status (running/done/error), expandable
- [x] PermissionRequest.svelte — allow/deny buttons with resolved state
- [x] AskUser.svelte — question form with text input
- [ ] ToolGroup.svelte — collapsible group with summary (TODO)
- [ ] DiffView.svelte — unified diff with syntax highlighting (TODO)
- [ ] PlanCard.svelte — plan mode banner with content (TODO)
- [ ] Subagent entries (TODO)

### Phase 5: Input area ✅ (basic)
- [x] InputArea.svelte — auto-resizing textarea, send on Enter
- [x] Send/Stop button toggle based on processing state
- [x] Continue mode (send while processing)
- [ ] SlashMenu.svelte — command dropdown with filtering (TODO)
- [ ] Image/paste handling — camera, photos, paste detection (TODO)
- [ ] Input sync (multi-client draft sharing) (TODO)
- [ ] Model selector dropdown (TODO)

### Phase 6: Sidebar internals (half day)
- [ ] Project switcher with dropdown
- [ ] Session list with search, context menus, drag reordering
- [ ] File tree panel (lazy loading, expand/collapse, icons)
- [ ] Sidebar footer (theme, status)
- [ ] Test: switch projects, search sessions, browse files

### Phase 7: File browser + viewer (half day)
- [ ] FileBrowser.svelte — tree component with file icons
- [ ] FileViewer.svelte — tabbed code viewer with syntax highlighting
- [ ] File search modal (Cmd+O)
- [ ] Edit history, rendered markdown toggle, PDF download
- [ ] Split pane resizing
- [ ] Test: open files from tree, switch tabs, search files

### Phase 8: Terminal (2-3 hours)
- [ ] Terminal.svelte — xterm.js mount, fit addon, data streaming
- [ ] TerminalTabs.svelte — create/close/rename tabs
- [ ] Mobile keyboard toolbar
- [ ] Test: open terminal, run commands, multiple tabs

### Phase 9: Board + Workspace (2-3 hours)
- [ ] Board.svelte — GTD area grid, project drill-down, TOTE rendering
- [ ] AreaCard.svelte + AreaDetail.svelte
- [ ] ChatPopup.svelte — floating popup with message stream
- [ ] ChatPopupManager.svelte — manages open popups, max limit
- [ ] Popup ↔ store integration (popup_open/close WS messages)
- [ ] Test: open board, click sessions as popups, send messages

### Phase 10: Modals + polish (2-3 hours)
- [ ] RewindModal.svelte — rewind preview with file diffs
- [ ] ConfirmModal.svelte — delete confirmation
- [ ] ResumeModal.svelte — resume CLI session by ID
- [ ] QrOverlay.svelte — share QR code
- [ ] ImageModal.svelte + PasteModal.svelte
- [ ] MermaidModal.svelte
- [ ] Notifications store — push subscription, sound, alerts
- [ ] InfoPanel.svelte — usage/context/status panels
- [ ] Test: all modals open/close, notifications work

### Phase 11: Integration + server wiring (2-3 hours)
- [ ] Update relay server to serve from `svelte-frontend/dist/`
- [ ] Fallback: serve `lib/public/` if dist doesn't exist
- [ ] Copy static assets (favicon, manifest, apple-touch-icon, sw.js)
- [ ] Verify all CDN dependencies are bundled or imported
- [ ] Production build test (`npm run build`)
- [ ] Test on dev relay (port 2700) end to end

### Phase 12: Cleanup
- [ ] Remove `lib/public/modules/`, `lib/public/css/`, `lib/public/app.js`
- [ ] Keep `lib/public/` for static assets only (favicon, manifest)
- [ ] Update package.json scripts
- [ ] Final test on production relay

---

## Key decisions

1. **CSS strategy**: Component-scoped `<style>` blocks + global `base.css` for variables/reset. No CSS framework.
2. **External libs**: Keep as CDN in index.html (highlight.js, mermaid, xterm, lucide) OR npm install and import. Prefer npm for tree-shaking.
3. **Markdown**: Use `marked` + `DOMPurify` (already used). Import via npm.
4. **Icons**: Switch from lucide CDN to `lucide-svelte` package for proper component icons.
5. **Typing**: No TypeScript for now. Keep it simple JS. Can add later.
6. **Testing**: Manual testing against dev relay on port 2700. No unit tests in v1.

## Dev workflow

```bash
cd svelte-frontend
npm run dev          # Vite dev server on :5173, proxies API/WS to :2700
npm run build        # Outputs to dist/
```

The relay server serves `dist/` in production. During dev, Vite's proxy handles the API/WS forwarding.
