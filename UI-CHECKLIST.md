# UI/UX Improvement Checklist

## Phase 1 — Quick Wins (CSS/template only, minimal risk)

- [ ] **1.1** Message width: 900px → `min(1100px, 90%)`
- [ ] **1.2** User bubble max-width: 95% → 75%
- [ ] **1.3** Tab bar height: 36px → 42px, font 12px → 13px, close/popout buttons 20px hit area
- [ ] **1.4** Border opacity: 0.06 → 0.10 for structural borders (sidebar, tab bar, sections)
- [ ] **1.5** Popup height: 480px → 380px, max-height: 50vh
- [ ] **1.6** Popup width: clamp(340px, 18vw, 440px) → clamp(380px, 25vw, 500px)
- [ ] **1.7** Tool item font: 12px → 13px
- [ ] **1.8** Send button: "Send" → "Send ↵"
- [ ] **1.9** Home tab: add "Home" label next to icon
- [ ] **1.10** Turn separator: thin divider line between assistant turns

## Phase 2 — Sidebar & Layout

- [ ] **2.1** Fix empty home screen — dashboard with recent sessions, quick actions, area summary
- [ ] **2.2** Move "New Session" button to top of sidebar
- [ ] **2.3** Area indicators → "3 active · 50" format (replace cryptic dots)
- [ ] **2.4** Sidebar sessions/files: move from collapsed bottom to tabs/segments near top
- [ ] **2.5** Area row height: ~36px with better padding between name and indicators
- [ ] **2.6** Sidebar collapsible to icons-only (48px) on medium screens (1024-1440px)

## Phase 3 — Area Hover System (the big one)

### Step 1: Backend — expand board API

- [ ] **3.1** Serve `operations[]` per area — list subdirs from `02-operations/`, read first paragraph of each operation's main TOTE doc as description
- [ ] **3.2** Serve `files[]` per project — list markdown/config files in project directory
- [ ] **3.3** Serve `docs[]` per operation — list files in the operation subdirectory
- [ ] **3.4** Session cost tracking — include cumulative cost per session in board data (sum `result` entries from JSONL)
- [ ] **3.5** Session turn count — count user_message entries per session for board data

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

- [ ] **3.6** Panel component: 500px wide, positioned right of sidebar
- [ ] **3.7** TOTE summary: present/desired state (truncated to 2 lines each)
- [ ] **3.8** Projects as bordered cards: name + session count + top 2 sessions + subproject list
- [ ] **3.9** Operations section: ⟳ icon + name + description snippet
- [ ] **3.10** Area sessions (untagged): count + top 2 by recency
- [ ] **3.11** Session recency formatting: "2m ago", "2h ago", "yesterday", "3d ago"
- [ ] **3.12** Active sessions: pulsing ◉ for processing, ● for idle
- [ ] **3.13** Quick actions bar: [+ New Session] [Open in Tab ↗]
- [ ] **3.14** Inbox/Operations structure badges
- [ ] **3.15** 200ms show delay, 300ms hide delay, sticky when moving between panels

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

- [ ] **3.16** Panel component: 400px, positioned right of area panel
- [ ] **3.17** Header: project name + total sessions + total cost + last active
- [ ] **3.18** Full session list: sorted by recency, scrollable, show turns + cost per session
- [ ] **3.19** Subprojects: name + session count
- [ ] **3.20** Files: list markdown docs from project folder (click to open in file viewer)
- [ ] **3.21** Quick actions: [+ New Session in project] [Open Folder in file browser]
- [ ] **3.22** Click session → opens as tab in main pane

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

- [ ] **3.23** Panel component: 400px, positioned right of area panel
- [ ] **3.24** Header: operation name + doc count + "Standing operation" label
- [ ] **3.25** Description: first paragraph from operation's main TOTE/markdown doc
- [ ] **3.26** Docs: list all files in operation subdir (click to open in file viewer)
- [ ] **3.27** Related sessions: matched by operation name keywords in session titles
- [ ] **3.28** Quick actions: [+ Session scoped to operation] [Open Doc]

### Step 5: Session tooltips (lightweight, on hover over any session row)

```
┌─────────────────────────────────┐
│ 14 turns · $4.26 · 2h ago      │
│ "check the extraction           │
│  checklist vs case studies"     │
└─────────────────────────────────┘
```

- [ ] **3.29** Small tooltip near cursor, not a full panel
- [ ] **3.30** Content: turn count · cost · relative time
- [ ] **3.31** Last exchange preview: user message truncated to 2 lines
- [ ] **3.32** 300ms show delay, instant dismiss on mouse leave
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

## Phase 5 — Polish & Cleanup

- [ ] **5.1** Light theme contrast: increase hierarchy between bg/bg-alt/bg-raised
- [ ] **5.2** Status indicators: replace tiny dots with pills/badges where needed
- [ ] **5.3** Scrollbar styling: ensure .light-theme class applies correctly
- [ ] **5.4** Tool groups: show tool names in summary ("Read 3 files, Edited 2")
- [ ] **5.5** Processing tab indicator: more visible spinner/badge on active tabs
- [ ] **5.6** Remove old `lib/public/` UI fallback (dead code)
- [ ] **5.7** Clean up test files: remove test-*.mjs from project root
