# UI/UX Improvement Checklist

## Phase 1 — Quick Wins ✅

- [x] **1.1** Message width: 900px → `min(1100px, 90%)`
- [x] **1.2** User bubble max-width: 95% → 70%
- [x] **1.3** Tab bar height: 36px → 42px, font 12px → 13px, close/popout buttons 20px hit area
- [x] **1.4** Border opacity: 0.06 → 0.10 for structural borders
- [x] **1.5** Popup height: 480px → 380px, max-height: 50vh (now 80vh with resize)
- [x] **1.6** Popup width: clamp(380px, 25vw, 500px)
- [x] ~~**1.7** Tool item font~~ — already 15px, dropped
- [x] **1.8** Send button: "Send ↵"
- [x] ~~**1.9** Home tab~~ — removed, no longer exists
- [x] **1.10** Turn separator: thin divider line between turns
- [x] **1.11** Sidebar width: 320px → 280px

## Phase 2 — Sidebar Tweaks (small, then Phase 3 does the real work)

- [ ] **2.1** Move "New Session" button to top of sidebar
- [ ] **2.2** Area indicators → "3 active · 50" format (replace cryptic dots with readable counts)
- [ ] **2.3** Empty main area: minimal clean state ("Open a session to get started") instead of CommandPost

## Phase 3 — Area Hover System (the big one)

### Step 1: Backend — expand board API

- [x] **3.1** Serve `operations[]` per area — list subdirs from `02-operations/`, read first paragraph of each operation's main TOTE doc as description
- [x] **3.2** Serve `files[]` per project — list markdown/config files in project directory
- [x] **3.3** Serve `docs[]` per operation — list files in the operation subdirectory
- [x] **3.4** Session cost tracking — include cumulative cost per session in board data (sum `result` entries from JSONL)
- [x] **3.5** Session turn count — count user_message entries per session for board data

### Step 2: Area hover panel (500px, appears on sidebar area hover)

```
┌─────────────────────────────────────────────────────────────────┐
│  CHATTING                                      3 active · 50   │
│  Present: $1M+ across 4 teams, 94 fans at $1K+...              │
│  Desired: V3 TOTEs for all 8 levels...                          │
│                                                                 │
│  PROJECTS                                                       │
│  ┌ v3-architecture-influence-design ──────── 21 sessions ─┐     │
│  │ ◉ Influence Pieces & Training      working    2m ago   │     │
│  │ ● Fan TOTE Spec Review              idle      2h ago   │     │
│  │ ● 19 more...                                           │     │
│  │ Sub: chatter-playbook · copilot · follow-up · 2 more   │     │
│  └────────────────────────────────────────────────────────┘     │
│  ┌ of-platform-tooling ──────────────────── 1 session ────┐     │
│  │ ● Platform Review                    idle     3d ago    │     │
│  │ Sub: api-wrapper · fan-data · list-automation           │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
│  OPERATIONS (standing)                                          │
│  ⟳ training          — Karine + Shalyane active                 │
│  ⟳ influence-design  — Alina learning COSSE                     │
│  ⟳ fan-data          — scraper maintenance                      │
│  ⟳ playbooks         — v3 operational docs                      │
│  ⟳ onboarding        — new chatter pipeline                     │
│  ⟳ chatting-model-v3 — model extraction                         │
│                                                                 │
│  AREA SESSIONS (untagged) ────────────────── 28                 │
│  ● Chatting / Training                idle       5h ago          │
│  ● Fan Relationship Analysis          idle       2d ago          │
│  ● 26 more...                                                   │
│                                                                 │
│  📥 Inbox  ·  📋 Operations                                     │
│  [+ New Session]                           [Open in Tab ↗]      │
└─────────────────────────────────────────────────────────────────┘
```

- [x] **3.6** Panel component: 350px wide, positioned right of sidebar
- [x] **3.7** TOTE summary: present/desired state (truncated to 3 lines each)
- [x] **3.8** Projects as expandable rows: name + session count + top 4 sessions
- [x] **3.9** Operations section: ⟳ icon + name + description snippet
- [x] **3.10** Area sessions (untagged): listed with recency
- [x] **3.11** Session recency formatting: "2m ago", "2h ago", "1d ago"
- [x] **3.12** Active sessions: pulsing dot for processing, static for idle
- [x] **3.13** Quick actions bar: [+ New Session in AreaName]
- [x] **3.14** Inbox/Operations structure badges
- [x] **3.15** 200ms show delay, 300ms hide delay, sticky when moving between panels

### Step 3: Project sub-hover (400px, appears right of area panel)

```
┌──────────────────────────────────────────────────┐
│  📁 v3-architecture-influence-design             │
│  ────────────────────────────────────────────     │
│  21 sessions · $45.20 total · Last active: 2m    │
│                                                  │
│  SESSIONS                                        │
│  ◉ Influence Pieces & Training Check   2m ago    │
│    14 turns · $4.26                              │
│  ● Fan TOTE Spec Review                2h ago    │
│    8 turns · $2.10                               │
│  ● Extraction Checklist vs Case St…    1d ago    │
│    6 turns · $1.85                               │
│  ● Fan Extraction Progress             2d ago    │
│    22 turns · $8.40                              │
│  ● Fan Relationship Analysis           3d ago    │
│    11 turns · $3.90                              │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄     │
│  16 more sessions                                │
│                                                  │
│  SUBPROJECTS                                     │
│  📁 chatter-playbook                   0         │
│  📁 copilot-playbook                   0         │
│  📁 follow-up-reactivation             0         │
│  📁 prospect-research                  0         │
│  📁 reference-implementation           0         │
│                                                  │
│  FILES                                           │
│  📄 v3-architecture.md                           │
│  📄 influence-design-spec.md                     │
│  📄 extraction-checklist.md                      │
│                                                  │
│  ┌────────────┐  ┌──────────────┐                │
│  │ + Session   │  │ Open Folder  │                │
│  └────────────┘  └──────────────┘                │
└──────────────────────────────────────────────────┘
```

- [x] **3.16** Panel component: 350px, positioned right of sidebar
- [x] **3.17** Header: project name + total sessions
- [x] **3.18** Session list: top 6 sorted by recency, scrollable
- [x] **3.19** Subprojects: name + session count + top 3 sessions
- [ ] **3.20** Files: list markdown docs from project folder (click to open in file viewer)
- [x] **3.21** Quick actions: [+ New Session] [Open Detail →]
- [x] **3.22** Click session → opens as tab in main pane

### Step 4: Operation sub-hover (400px, appears right of area panel)

```
┌──────────────────────────────────────────────────┐
│  ⟳ training                                      │
│  ────────────────────────────────────────────     │
│  Standing operation · 7 docs                     │
│                                                  │
│  DESCRIPTION                                     │
│  Karine + Shalyane writing real OF messages       │
│  (Day 3+). Alina coaches. Calvin in supportive   │
│  role (state design, pattern diagnosis, not      │
│  hovering). Training uses v3 model with live     │
│  fan conversations — learning by doing, not      │
│  reading specs.                                  │
│                                                  │
│  DOCS                                            │
│  📄 training.md                                   │
│  📄 training-checklist.md                         │
│  📄 session-notes/                                │
│  📄 progress-tracker.md                           │
│                                                  │
│  RELATED SESSIONS                                │
│  ● Influence Pieces & Training       2m ago      │
│  ● Training Check                    3d ago      │
│  ● Chatting / Training               5h ago      │
│                                                  │
│  ┌─────────────────┐  ┌────────────┐             │
│  │ + Training Sess. │  │  Open Doc  │             │
│  └─────────────────┘  └────────────┘             │
└──────────────────────────────────────────────────┘
```

- [x] **3.23** Panel component: 380px, positioned right of area panel
- [x] **3.24** Header: operation name + doc count + "Standing operation" label
- [x] **3.25** Description: first paragraph from operation's main TOTE/markdown doc
- [x] **3.26** Docs: list all files in operation subdir (click to open in file viewer)
- [x] **3.27** Related sessions: matched by operation name keywords in session titles
- [x] **3.28** Quick actions: [+ Session] [Open Doc →]

### Step 5: Session tooltips (lightweight, on hover over any session row)

```
┌─────────────────────────────────┐
│ 14 turns · $4.26 · 2h ago      │
│ "check the extraction           │
│  checklist vs case studies"     │
└─────────────────────────────────┘
```

- [x] **3.29** Small tooltip near cursor, not a full panel
- [x] **3.30** Content: turn count · cost · relative time
- [x] **3.31** Last exchange preview: user message truncated to 2 lines
- [x] **3.32** 300ms show delay, instant dismiss on mouse leave
- [ ] **3.33** Right-click context menu: Fork, Delete, Rename, Move to project

### Step 6: Session-to-area integration

- [ ] **3.34** Area/project badge on session tabs (small colored pill)
- [ ] **3.35** Session tagging: drag sessions to areas/projects in sidebar
- [ ] **3.36** "What was I working on?" — recent activity dashboard across all areas
- [ ] **3.37** Area default prompts: auto-set system prompt when creating session from area

### Interaction flow

```
Sidebar              Area Panel (500px)        Sub-Panel (400px)
┌────────────┐      ┌───────────────────┐     ┌──────────────────┐
│            │      │ TOTE summary      │     │                  │
│ CHATTING ──│─────>│                   │     │ Full session     │
│            │ 200ms│ PROJECTS          │     │ list + cost      │
│            │      │ ┌───────────────┐ │     │ + subprojects    │
│            │      │ │ v3-arch  ─────│─│────>│ + files          │
│            │      │ └───────────────┘ │     │ + actions        │
│            │      │ ┌───────────────┐ │     └──────────────────┘
│            │      │ │ of-platf     ││ │
│            │      │ └───────────────┘ │     ┌──────────────────┐
│            │      │                   │     │                  │
│            │      │ OPERATIONS        │     │ TOTE description │
│            │      │ ⟳ training ──────│────>│ + docs list      │
│            │      │ ⟳ influence      │     │ + related sess   │
│            │      │ ⟳ fan-data       │     │ + actions        │
│            │      │                   │     └──────────────────┘
│            │      │ AREA SESSIONS     │
│            │      │ ● session ───────│────> tooltip (turns·cost)
│            │      │                   │
│            │      │ [+New] [Tab ↗]   │
│            │      └───────────────────┘
└────────────┘
```

## Phase 3b — Tab & Popup UX

- [x] **3b.1** Tab loading indicator: spinner on tabs during history replay (slower spin, dimmer color)
- [x] **3b.2** Skeleton loading: grey placeholder blocks (user/assistant pattern) while messages render
- [x] **3b.3** Tab drag smoothing: scale + translateX transitions on drag/drop target
- [x] **3b.4** Popup height resizable: drag top edge, persisted to localStorage
- [x] **3b.5** Popup height affects main chat: padding-bottom adjusts
- [x] **3b.6** Drag popup to tab bar: promote to tab
- [x] **3b.7** Drag popup to pane: promote + split/move
- [x] **3b.8** Drag tab to popup area: drop zone at bottom of screen, demotes to popup

## Phase 4 — Advanced Features

### Content editing
- [ ] **4.1** MD preview: improve styling (better code blocks, tables, headings)
- [ ] **4.2** Edit markdown directly — Notion-like inline editing or split editor/preview
- [ ] **4.3** PDF export of the current page/conversation

### Subscription & settings
- [ ] **4.4** Claude subscription overview — usage/billing dashboard
- [ ] **4.5** Session selector improvements — search, filter by area/account
- [ ] **4.6** Width selectors for strategy agent (narrow/medium/wide)

### Responsiveness
- [ ] **4.7** Mobile sidebar: slide-over with better touch targets
- [ ] **4.8** Tablet range (768-1024px): tighter layout, reduced sidebar
- [ ] **4.9** Popup responsive: intermediate breakpoints at 768px

### Session UX
- [ ] **4.10** Session cost in tab bar — small `$4.26` badge on session tabs
- [ ] **4.11** Bulk session management — multi-select sessions for archive/delete/move
- [ ] **4.12** Pinned sessions — pin important sessions to top of sidebar

### Navigation
- [ ] **4.13** Keyboard shortcuts panel — Cmd+K style quick reference overlay
- [ ] **4.14** Tool group summaries — "Read 3 files, Edited 2" instead of individual tool items

## Phase 4b — Session Archiving

### Server
- [x] **4b.1** Add `archived` flag to session metadata in JSONL
- [x] **4b.2** WS handler: `archive_session` — sets flag, re-saves, re-broadcasts session list
- [x] **4b.3** WS handler: `unarchive_session` — clears flag
- [x] **4b.4** WS handler: `bulk_archive` — archive by age ("older than 7d") or by area
- [x] **4b.5** Archived sessions included in broadcast with `archived` field, filtered in board API
- [ ] **4b.6** WS handler: `list_archived` — returns only archived sessions

### Frontend
- [x] **4b.7** Right-click session → "Archive" / "Unarchive" option in SessionTagger
- [x] **4b.8** Sidebar: "Archived (N)" collapsed section below active sessions
- [x] **4b.9** Archived sessions don't count toward area totals (filtered from board API)
- [x] **4b.10** Unarchive: right-click archived session → "Unarchive" option

### Slash commands
- [ ] **4b.11** `/archive` — archive current session
- [ ] **4b.12** `/archive-old 7d` — bulk archive sessions older than N days
- [ ] **4b.13** Claude auto-suggest: after task completion, offer to archive

## Phase 5 — Polish & Cleanup

- [ ] **5.1** Light theme contrast: increase hierarchy between bg/bg-alt/bg-raised
- [ ] **5.2** Status indicators: replace tiny dots with pills/badges where needed
- [ ] **5.3** Scrollbar styling: ensure .light-theme class applies correctly
- [ ] **5.4** Tool groups: show tool names in summary ("Read 3 files, Edited 2")
- [ ] **5.5** Processing tab indicator: more visible spinner/badge on active tabs
- [ ] **5.6** Remove old `lib/public/` UI fallback (dead code)
- [ ] **5.7** Clean up test files: remove test-*.mjs from project root
