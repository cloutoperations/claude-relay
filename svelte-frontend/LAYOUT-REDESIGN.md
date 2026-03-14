# Layout Redesign — Full UI Overhaul

Supersedes the three-column command post plan. This is a complete rethink of the relay layout.

## Core Principles

1. **Areas always visible** — you never lose sight of what's happening across the business
2. **One tab system** — sessions and files mixed in a single tab bar
3. **Splittable panes** — drag tabs to create 2-3 side-by-side views
4. **Strategy is the home tab** — full space for GATE, allocation, gaps, tests, agent chat
5. **Minimal chrome** — 36px tab bar, no separate header

## Layout

```
┌─ AREAS SIDEBAR (320px) ───────┬─ ⌂ Strategy ─┬─ Session 1 ─┬─ goals.md ─┬─ Session 2 ─┬── ● ☀ ──┐
│                                │                                                                     │
│  CHATTING ─────────── 48 ●●●●  │  ┌──────────────────────────────┬───────────────────────────────┐   │
│    of-platform-tooling  ●●     │  │                               │                                │   │
│    v3-architecture      ●●●●   │  │   PANE 1                     │   PANE 2                       │   │
│                                │  │                               │                                │   │
│  PERSONAL ────────── 28 ●●     │  │   (any tab: session, file,   │   (any tab: session, file,    │   │
│    milton-model  ●●●           │  │    strategy, area detail)    │    strategy, area detail)     │   │
│                                │  │                               │                                │   │
│  STRATEGY ────────── 15 ●●●●   │  │                               │                                │   │
│    agent-orchestrator          │  │                               │                                │   │
│    relay-workspace  ●●         │  │                               │                                │   │
│    strategy-agent              │  │                               │                                │   │
│    + 4 more                    │  │                               │                                │   │
│                                │  │                               │                                │   │
│  MARKETING ───────── 11 ●●     │  │                               │                                │   │
│    account-recovery            │  │                               │                                │   │
│    reddit-system  ●●●          │  │                               │                                │   │
│                                │  │                               │                                │   │
│  FINANCE ─────────── 3 ●       │  │                               │                                │   │
│  CONTENT ─────────── 5 ●●      │  │                               │                                │   │
│  HIRING ──────────── 5         │  │                               │                                │   │
│                                │  │                               │                                │   │
│  ─────────────────────────     │  │                               │                                │   │
│  ▸ FILES ────────────── 🔍    │  │                               │                                │   │
│    📁 gtd/                     │  │                               │                                │   │
│    📁 code/                    │  └──────────────────────────────┴───────────────────────────────┘   │
│      📁 claude-relay/          │                                                                     │
│                                │  POPUPS:                                                            │
│  [+ New Session]               │  ┌─ Popup 1 ──┐ ┌─ Popup 2 ──┐ ┌─ Popup 3 ──┐ ┌─ Popup 4 ──┐    │
│                                │  │ messages    │ │ messages    │ │ messages    │ │ messages    │    │
│                                │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │
└────────────────────────────────┴─────────────────────────────────────────────────────────────────────┘
```

## Left Sidebar — Areas + Files (320px, always visible)

The sidebar replaces both the old sidebar (sessions/files tabs) and the command post area grid. Areas are always visible regardless of which tab you're on.

### Areas section (top, dominant)

Each area is a compact card:
```
CHATTING ──────────────────── 48 ●●●●●●
  of-platform-tooling  ●●
  v3-architecture-influence-design  ●●●●
```

- Area name + total session count badge + up to 6 session dots
- Below: project names with their session dots
- Projects with no sessions shown dimmed
- Collapsible per area (click area name to expand/collapse projects)
- Processing dots pulse orange, idle = blue, stale = grey

**Interactions:**
- Hover area → existing detail panel pops out to the right (projects + all sessions listed)
- Click area name → opens area detail view as a tab in main content
- Click a session dot → opens as popup
- Right-click session dot → SessionTagger (existing)
- Shift+click session dot → opens as tab

### Files section (bottom, collapsible)

- Collapsed by default: just "FILES 🔍" header
- Click to expand the file tree
- Search icon opens quick-find (Cmd+O also works)
- When expanded, areas section scrolls if needed
- Standard file tree with expand/collapse directories

### Sidebar controls

- `[+ New Session]` button at bottom
- Sidebar can be collapsed entirely (hamburger toggle or keyboard shortcut)
- When collapsed: thin 48px rail with area icons/dots only (like Slack's workspace rail)

## Tab Bar — Unified (36px, replaces header + old tab bar)

One single bar at the top. No separate header.

```
┌─ ☰ ─┬─ ⌂ ─┬─ Session Title Here ─┬─ 📄 goals.md ─┬─ Chatting (area) ─┬───────── ● Connected ── ☀ ─┐
```

### Contents (left to right):
- **☰** Sidebar toggle (far left)
- **⌂ Home** — always present, not closable. Strategy view.
- **Session tabs** — chat bubble icon + session title. Close button on hover.
- **File tabs** — file icon + filename. Close button on hover.
- **Area tabs** — folder icon + area name. Close button on hover.
- **Spacer**
- **Connection status** — ● Connected (far right)
- **Theme toggle** — ☀/🌙 (far right)

### Tab behavior:
- Middle-click to close
- Drag to reorder
- Drag to edge of content area → splits into new pane
- Right-click context menu: Close, Close Others, Pop Out (→ popup), Split Right, Split Down
- Unread indicator (dot) on tabs with new messages
- Processing indicator (pulse) on tabs with active sessions

## Main Content — Splittable Panes

The content area can be split into 2-3 panes, each with its own mini tab bar.

### Single pane (default):
Active tab fills the entire content area. This is the normal state.

### Creating a split:
- Drag a tab toward the right edge → drop zone appears → creates right pane
- Drag toward the bottom edge → creates bottom pane (for horizontal split)
- Right-click tab → "Split Right" / "Split Down"
- Keyboard shortcut (Cmd+\)

### Split behavior:
- Each pane has its own row of tabs at the top (smaller, 28px)
- Drag the divider between panes to resize
- Pane proportions persist to localStorage
- Close all tabs in a pane → pane closes, other panes expand
- Max 3 panes (to prevent absurd fragmentation)
- Any tab type works in any pane — session, file, strategy, area detail

### What each tab type shows:

**⌂ Strategy tab (home):**
```
┌─ STRATEGY (fluid, ~70%) ───────────────────────────────────────┬─ TESTS & LIVE (280px) ──┐
│                                                                  │                          │
│ THE GATE: Get first chatter operational at $500/day.             │  TESTS 0/13 — Mar 18    │
│ Build + Scale · Next review: Mar 18                              │                          │
│                                                                  │  ☐ Reddit accounts       │
│ ALLOCATION                                                       │    warming?              │
│ Reddit rebuild + agent  ████████████████░░░░  35%                │  ☐ Phone remote working? │
│ OF platform tooling     ████████████░░░░░░░░  25%                │  ...                     │
│ v3 TOTEs                ████████████░░░░░░░░  25%                │                          │
│ Training                ███░░░░░░░░░░░░░░░░░   5%                │  LIVE                    │
│ Background              █████░░░░░░░░░░░░░░░  10%                │  4 sessions open         │
│                                                                  │  0 processing            │
│ GAPS                                                             │                          │
│ ■■■■ Reddit traffic — ~10/day → 100/day                         │                          │
│ ■■■  Reddit scaling — Steven full → Agent                       │                          │
│ ■■■  OF tools — Nothing built → API + data                      │                          │
│ ■■   V3 content — Arch only → 2-3 levels                       │                          │
│ ...                                                              │                          │
│                                                                  │                          │
│ STRATEGY CHAT                                                    │                          │
│ > what should I focus on today?                                  │                          │
│ You've been in system 80%. Reddit is 35% allocated, 0% actual. │                          │
│ ┌──────────────────────────────────────────────────────────┐    │                          │
│ │ Type a command...                                         │    │                          │
│ └──────────────────────────────────────────────────────────┘    │                          │
└──────────────────────────────────────────────────────────────────┴──────────────────────────┘
```

**Session tab:**
Full chat view — message list + input area. Same as current session tab behavior.

**File tab:**
Full file viewer — syntax highlighting, markdown rendering. Same as current file panel but full-width.

**Area detail tab:**
Full area view — TOTE state, all projects, sub-projects, sessions, area document. Same as current focused/zoomed area view but as a tab.

## Popups — Unchanged

440x480px floating windows at bottom-right. They work well. Keep them.

- Click session dot in sidebar → opens popup
- Right-click → "Open as Tab" option
- Double-click popup header → promotes to tab
- Tab context menu → "Pop Out" → demotes to popup

## What's Removed

- **Header bar** — merged into tab bar
- **Separate file panel** — files are tabs now
- **Sidebar session/file tab switcher** — sidebar shows areas + files together
- **Command post area grid** — areas moved to sidebar
- **CockpitStrip docked mode** — strategy content lives in home tab
- **Split file view** — replaced by splittable panes (more flexible)

## What's Kept

- **Popups** — the floating session windows
- **Area hover panels** — pop out from sidebar on hover
- **SessionTagger** — right-click on session dots
- **Quick Open (Cmd+O)** — file search
- **CockpitStrip floating/popup modes** — for when you want strategy visible while in a session
- **Theme system** — dark/light/auto

## Area Hover Panel — Detailed Specification

The most important Layer 2 interaction. Hovering an area in the sidebar reveals a floating panel with full area context — no click needed.

### Layout

```
SIDEBAR (320px)                    HOVER PANEL (350px, floating over content)
┌──────────────────────────┐      ┌──────────────────────────────────────────────┐
│                          │      │  CHATTING                           48 total │
│  CHATTING ───── 48 ●●●●  │─────▶│                                              │
│    of-platform  ●●       │      │  ██████████████████░░░░░░░░░░░░░░░░░░░░░░░  │ ← TOTE bar
│    v3-architect ●●●●     │      │                                              │
│                          │      │  Present: $1M+ made across 4 years,         │
│                          │      │  4 teams. $733K lifetime tracked.            │
│                          │      │  Desired: V3 TOTEs built, chatters trained, │
│                          │      │  $500/day per chatter operational.           │
│                          │      │                                              │
│                          │      │  ─── PROJECTS ────────────────────────────── │
│                          │      │                                              │
│                          │      │  ▸ of-platform-tooling          15 sessions  │
│                          │      │  ▸ v3-architecture              10 sessions  │
│                          │      │  ▸ chatter-playbook              3 sessions  │
│                          │      │    influence-design               0 sessions │
│                          │      │    fan-communication              0 sessions │
│                          │      │                                              │
│                          │      │  ─── AREA SESSIONS ───────────────────────── │
│                          │      │    ○ Chatting / Training          idle        │
│                          │      │    ○ OF pricing research          idle        │
│                          │      │                                              │
│                          │      │  ┌──────────────────────────────────────┐    │
│                          │      │  │  + New Session in Chatting           │    │
│                          │      │  └──────────────────────────────────────┘    │
│                          │      └──────────────────────────────────────────────┘
```

### Hover within the panel — project drill-down (inline expand)

Projects with sessions show a ▸ chevron. Hovering a project row expands it **inline** (accordion-style) — no nested floating panels.

```
  ▾ of-platform-tooling          15 sessions
    ● Fan TOTE Analysis Andy      processing
    ● Fan Timeline Generation     idle
    ○ Extraction Checklist         idle
    ... +12 more sessions

  ▸ v3-architecture              10 sessions
```

- Hover project → expands to show first 3-4 sessions + "+N more" link
- Projects with 0 sessions shown dimmed, no chevron
- Sub-projects listed indented under their parent project
- Expansion is instant (no delay — you're already inside the panel)

### Content sections

**Top section:**
- Area name + total session count
- TOTE progress bar (full width — more visible than sidebar's compact dots)
- Present state + desired state (full text, 2-3 lines each)

**Projects section:**
- Each project: status indicator + name + session count
- ▸ chevron for expandable projects (has sessions)
- On hover-expand: session list with dot + title + state (processing/idle/done)
- If > 4 sessions: show first 3 + "+N more sessions" link

**Area-level sessions:**
- Sessions tagged to the area but not a specific project
- Same format: dot + title + state

**Action:**
- "+ New Session in [Area]" button at bottom
- Creates a session auto-tagged to this area, opens as popup

### Click behavior (from anywhere — sidebar, hover panel, or expanded project)

| Target | Click | Shift+Click | Right-Click |
|--------|-------|-------------|-------------|
| **Area name** (sidebar) | Opens area detail as tab | — | — |
| **Area name** (hover panel header) | Opens area detail as tab | — | — |
| **Project name** | Opens area detail tab, scrolled to project | — | — |
| **Session dot/title** | Opens as popup (quick look) | Opens as full tab | SessionTagger context menu |
| **"+ New Session"** | Creates session → popup | Creates → tab | — |
| **"+N more sessions"** | Opens area detail tab, scrolled to project | — | — |

**Rule: click = commit to Layer 3.** The hover panel closes immediately on any click. Two target types:
- **Session** → popup (click) or full chat tab (shift+click)
- **Everything else** (area name, project name) → opens/scrolls area detail tab

### Positioning

- **Anchor**: Left edge of panel = sidebar right edge + 8px gap
- **Vertical**: Top of panel aligns with top of hovered area card in sidebar
- **Overflow**: If panel would extend below viewport, shift up (but keep at least top 100px visible)
- **Max height**: 70vh, scrollable if content overflows

### Timing

| Event | Delay |
|-------|-------|
| Mouse enters area in sidebar | 200ms before panel appears |
| Mouse leaves area in sidebar | 400ms before panel hides |
| Mouse enters the hover panel | Cancels hide timer — panel stays |
| Mouse leaves the hover panel | 400ms before panel hides |
| Mouse moves to different area | Immediate switch (no close+reopen delay) |

### Animation

- **Show**: Fade in + slide from left (opacity 0→1, translateX(-8px)→0, 150ms ease-out)
- **Hide**: Fade out (opacity 1→0, 100ms ease-in)
- **Switch area**: Crossfade content (no positional animation, just content swap)

### Keyboard

- **Escape**: Closes hover panel
- **Arrow keys**: Navigate sessions within expanded project (stretch goal)

## Build Checklist

### Phase 1: Foundation (do in order)

#### 1.1 — Merge Header into TabBar
- [ ] Add sidebar toggle (☰) to TabBar left edge
- [ ] Add connection status + theme toggle to TabBar right edge
- [ ] Delete Header.svelte
- [ ] Remove header from App.svelte layout
- **Files**: `TabBar.svelte`, `Header.svelte`, `App.svelte`

#### 1.2 — Create AreasSidebar
- [ ] New component: `AreasSidebar.svelte`
- [ ] Top section: area cards (from CommandPost/AreaZone rendering)
  - Area name + session count badge + up to 6 session dots
  - Collapsible projects under each area
  - Processing dots pulse orange, idle = blue, stale = grey
- [ ] Bottom section: collapsible file tree (reuse from current Sidebar)
- [ ] `[+ New Session]` button at bottom
- [ ] Replace current `Sidebar.svelte` usage in `App.svelte`
- **Files**: NEW `AreasSidebar.svelte`, `Sidebar.svelte`, `App.svelte`

#### 1.3 — Area Hover Panel
- [ ] New component: `AreaHoverPanel.svelte`
- [ ] 350px floating panel, appears on area hover (200ms delay, 400ms hide delay)
- [ ] Shows: TOTE bar, present/desired state, project list with session counts
- [ ] Projects expand inline on hover (accordion, show first 3-4 sessions)
- [ ] Click session → popup, shift+click → tab, right-click → SessionTagger
- [ ] Click area/project name → opens area detail tab
- [ ] Fade+slide animation (150ms ease-out)
- **Files**: NEW `AreaHoverPanel.svelte`, `AreasSidebar.svelte`

#### 1.4 — Strategy Home Tab
- [ ] New component: `HomeTab.svelte`
- [ ] Extract strategy content from CockpitStrip (GATE, allocation, gaps, tests, strategy chat)
- [ ] Full-width layout — no split with area grid (areas are in sidebar now)
- [ ] Home tab in TabBar renders HomeTab instead of CommandPost
- [ ] Remove CockpitStrip docked/floating modes (content lives in home tab permanently)
- **Files**: NEW `HomeTab.svelte`, `CockpitStrip.svelte`, `CommandPost.svelte`, `tabs.js`

#### 1.5 — Unified Tabs (files as tabs)
- [ ] Tab types: `home` | `session` | `file` | `area-detail`
- [ ] Files open as tabs in TabBar (📄 icon + filename)
- [ ] FileViewer renders inside the tab content area (not a separate panel)
- [ ] Remove file panel + resize handle from App.svelte
- [ ] Remove `filePanelVisible` from ui.js
- [ ] Tab icons: ⌂ home, 💬 session, 📄 file, 📁 area
- **Files**: `TabBar.svelte`, `tabs.js`, `App.svelte`, `FileViewer.svelte`, `ui.js`

#### 1.6 — Area Detail Tab
- [ ] Click area name (sidebar or hover panel) → opens area detail as tab
- [ ] Full view: TOTE state, all projects with sessions, area document
- [ ] Click project name → opens same tab scrolled to that project
- [ ] Reuse existing AreaZone focused-mode content
- **Files**: `tabs.js`, `TabBar.svelte`, `AreaZone.svelte`

### Phase 2: Split Panes

#### 2.1 — PaneManager
- [x] New component: `PaneManager.svelte`
- [x] Manages 1-3 panes, each with its own tab set
- [x] Drop zones appear on tab drag (right edge → split right, bottom edge → split down)
- [x] Resizable divider between panes (drag to resize)
- [x] Max 3 panes
- **Files**: NEW `PaneManager.svelte`, `App.svelte`, `tabs.js`

#### 2.2 — Single Tab Bar (no per-pane tab bars)

**Rule: one tab bar, always at the top.** Panes are content areas only — no duplicate navigation.

Single pane (normal):
```
┌──────────────────────────────────────────────────────────┐
│ ☰ │ 🏠 │ Tab A ✕ │ Tab B ✕ │ Tab C ✕ │      🌙 Connected │
└──────────────────────────────────────────────────────────┘
│                     active tab content                    │
```

Split, 3 tabs across 2 panes:
```
┌──────────────────────────────────────────────────────────┐
│ ☰ │ 🏠 │ Tab A ✕ │ Tab B ✕ │ Tab C ✕ │      🌙 Connected │
└──────────────────────────────────────────────────────────┘
│       pane 1 (Tab A)      │       pane 2 (Tab B)         │
```

- The main TabBar always shows **all** tabs across all panes
- Clicking a tab activates it in whichever pane owns it (and focuses that pane)
- The active tab indicator shows for the focused pane's active tab
- When split, each tab can optionally show a subtle pane indicator (e.g. underline color)
- Panes below are pure content — no mini tab rows, no close buttons, no tab chrome
- Dragging a tab in the tab bar can reorder; right-click for Split Right/Down/Close
- Tab close in the tab bar also removes it from its pane; if pane becomes empty, pane closes
- **Files**: `TabBar.svelte`, `PaneManager.svelte`, `App.svelte`

#### 2.3 — Pane Persistence
- [x] Save pane layout + tab assignments to localStorage
- [x] Restore on page load
- [x] Pane store synced with tabs.js and files.js (addTabToPane, closePaneTab, renameTabInPanes)
- **Files**: `panes.js`, `tabs.js`, `files.js`

### Phase 3: Polish

#### 3.1 — Collapsed Sidebar Rail
- [x] 48px thin icon-only mode (area initials + active dots)
- [x] Click area → expand sidebar, hover → hover panel from rail
- [x] Hover panel position adjusts (56px from rail vs 328px from sidebar)
- [x] New Session button in rail footer

#### 3.2 — Tab Context Menus
- [x] Right-click tab → Close, Close Others, Pop Out, Split Right, Split Down
- [x] Backdrop for click-outside dismiss
- [x] Pop Out only shown for session tabs

#### 3.3 — Keyboard Shortcuts
- [x] `Cmd+\` — split active tab right
- [x] `Cmd+W` — close tab (already existed)
- [x] `Cmd+1/2/3` — focus pane 1/2/3

#### 3.4 — Smooth Transitions
- [ ] Animate pane creation/destruction
- [ ] Animate tab moves between panes
