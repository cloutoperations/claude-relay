# Command Post — Design Document

## Core Concept

One screen. Everything visible. No navigation. The home screen is a live spatial dashboard where all areas, projects, and sessions are visible at once. Three layers of information density — glance, hover, click — zero page transitions.

## The Three Layers

### Layer 1: Glance (always visible)
You open the relay and immediately see every area. Session dots pulse next to their project. You know what's active without reading anything.

### Layer 2: Hover (instant reveal)
Mouse over any area zone → it grows slightly, and a floating detail panel appears showing every project with its sessions listed by name + state. No click needed. Move away → it disappears. This is how you answer "what's happening in chatting right now?" in under a second.

### Layer 3: Click (deep focus)
Click an area zone → it expands in-place to ~70% of the screen. Full TOTE state, all projects with sub-projects, session cards, area document, new session button. Other areas compress to a thin strip. Escape to zoom back out.

```
LAYER 1 — GLANCE                    LAYER 2 — HOVER                     LAYER 3 — CLICK
┌──────────────────┐                ┌──────────────────┐                 ┌──────────────────────────────┐
│ CHATTING    ●○○  │                │ CHATTING    ●○○  │──┐              │ CHATTING                      │
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔   │                │ ▔▔▔▔▔▔▔▔▔▔▔▔▔   │  │              │                               │
│ chatter-playbook │      hover →   │ chatter-playbook │  │ detail       │ Present: $1M+ made...         │
│ influence-design │                │ influence-design │  │ panel        │ Desired: V3 TOTEs built...    │
│ 2 projects       │                │ 2 projects       │  │              │                               │
└──────────────────┘                └──────────────────┘  │              │ ┌─ chatter-playbook ──────┐   │
                                    ┌──────────────────┐  │              │ │  ● Building v3 docs      │   │
                                    │ ● chatter-playbook│  │              │ │  ○ Review structure      │   │
                                    │   Building v3..●  │◀─┘              │ └──────────────────────────┘   │
                                    │   Review struct○  │                 │ ┌─ influence-design ──────┐   │
                                    │ ○ influence-design│                 │ │  (no sessions)           │   │
                                    │   (no sessions)   │                 │ └──────────────────────────┘   │
                                    │ ○ untagged        │                 │                               │
                                    │   Random chat  ○  │                 │ [+ New Session]               │
                                    └──────────────────┘                 └──────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Header                                                       │
├──────┬──────────────────────────────────────────────────────┤
│      │                                                       │
│ Side │  ▸ GATE: $500/day · Build+Scale · Mar 18 · 2●  💬   │ ← Cockpit Strip
│ bar  │  ─────────────────────────────────────────────────── │
│      │                                                       │
│ (keep│  COMMAND POST                                         │
│  as  │                                                       │
│  is) │  ┌─────────────┐  ┌──────────────────┐               │
│      │  │  STRATEGY    │  │  CHATTING         │               │
│      │  │  ▔▔▔▔▔▔▔▔   │  │  ▔▔▔▔▔▔▔▔▔▔▔▔   │               │
│      │  │  relay-board │  │  chatter ●○       │               │
│      │  │  agents  ○   │  │  influence ○      │               │
│      │  └─────────────┘  └──────────────────┘               │
│      │  ┌────────┐ ┌────────┐ ┌─────────────┐               │
│      │  │FINANCE │ │CONTENT │ │  SYSTEM      │               │
│      │  │  ▔▔    │ │  ▔▔    │ │  relay ●     │               │
│      │  └────────┘ └────────┘ └─────────────┘               │
│      │                                                       │
│      │  ┌ Activity Stream ──────────────────────────────┐   │
│      │  │ ● Strategy thinking... 2s  ○ System idle 4m   │   │
│      │  └───────────────────────────────────────────────┘   │
├──────┴──────────────────────────────────────────────────────┤
│ (file panel on right if files open — same split as now)      │
└─────────────────────────────────────────────────────────────┘
```

## What to Build

### 1. CommandPost.svelte

Replaces both Workbench and DrilldownView. Single component, no routing.

**State:**
- `focusedArea: string | null` — null = overview, string = zoomed into that area
- Board data comes from existing `boardData` store

**Overview mode (focusedArea = null):**
- CSS grid of AreaZone components
- Smart-sized: areas with more activity get more grid space
- Activity stream at the bottom

**Zoomed mode (focusedArea = 'chatting'):**
- Focused area takes ~70% of space (rendered in expanded AreaZone mode)
- Other areas collapse into a horizontal strip of mini-pills at the top
- Click a pill to switch focus, click focused area header or press Escape to zoom out
- Smooth CSS transitions on all size changes

### 2. AreaZone.svelte

Self-contained area component with three visual modes.

**Props:** `area`, `focused`, `compact`, `onFocus`, `onUnfocus`

**Mode: normal (overview grid)**
- Area name + TOTE progress bar
- Project pills inline, each with session dots clustered next to it
- Session dots: small colored circles (8px), positioned after the project pill
- Dots pulsate if `isProcessing`, dim if idle
- Bottom: activity recency label ("2h ago")
- Hover behavior (see below)

**Mode: hovered (overlay detail)**
- Zone grows slightly (CSS scale or padding increase, ~10%)
- A floating panel appears anchored to the zone (like a popover)
- Panel shows each project with its sessions listed:
  ```
  ● chatter-playbook
    ● Building v3 training docs   (processing)
    ○ Review playbook structure    (idle)
  ● influence-design
    (no sessions)
  ─────
  ○ Untagged
    ○ Random exploration chat      (idle)
  ```
- Sessions are clickable → opens popup
- Panel disappears on mouse leave (with small delay to prevent flicker)
- Panel positioned intelligently: if zone is near right edge, panel goes left, etc.

**Mode: focused (zoomed in)**
- Full expanded view:
  - TOTE section: present state + desired state, full text
  - Projects list: each project as a row with expand/collapse
  - Expanded project shows: sub-projects, all sessions as clickable cards
  - "New Session" button per project (contextual launch, auto-tags)
  - "New Session" button for area (tags to area, no project)
  - Area document preview (fetched from `/api/board/file`, rendered as markdown)
- This replaces the old DrilldownView functionality

**Mode: compact (other areas when one is focused)**
- Tiny pill: just area name + dot count
- Clickable to switch focus

### 3. SessionBubble.svelte

Small dot representing a session.

**Props:** `session`, `size = 'sm' | 'md'`

**Visual:**
- `sm` (8px): used in overview grid, next to project pills
- `md` (10px): used in hover panel
- Color: `#da7756` if processing, `#5b9fd6` if idle, `#6b6760` if old/stale
- Animation: CSS `pulse` keyframe if processing (existing animation)

**Interaction:**
- Hover: native `title` tooltip with session title (fast, no custom tooltip needed for sm)
- Click: opens session popup
- Right-click: opens SessionTagger (existing component)

### 4. ActivityStream.svelte

Thin horizontal strip at the bottom of the command post.

**Data:**
- Listens to WebSocket `session_list` messages
- Tracks processing state changes: when a session goes from idle → processing or back
- Maintains a rolling list of ~20 recent events
- Events: `{ sessionId, title, areaName, event: 'started'|'finished'|'created', timestamp }`

**Display:**
- Single-line scrollable strip, 32px tall
- Each event: colored dot + area name + session title + event + relative time
- Most recent on the left
- Clicking an event opens that session's popup
- Fades out entries older than 30 minutes

### 5. TOTE Progress Bar

Simple visual indicator inside each AreaZone.

**Overview mode:**
- Thin horizontal bar (3px) spanning the zone width
- Left portion colored `#6b6760` (present state exists)
- Right portion colored `#57ab5a` (desired state exists)
- If only present state: bar is all grey
- If both: bar is half grey, half green (not a real percentage — just visual)
- Purely decorative framing

**Focused mode:**
- Full text blocks: "Present State" + "Desired State"
- Same style as current DrilldownView TOTE section

### 6. Smart Sizing

Areas get a weight score that determines grid placement:

```
weight = projects.length * 2
       + totalSessions * 3
       + processingSessions * 5
       + (hasRecentActivity ? 2 : 0)
       + (hasToteContent ? 1 : 0)
```

Weight maps to grid sizing:
- weight 0-3: 1 column span, 1 row span (small)
- weight 4-8: 1 column span, 2 row span (medium)
- weight 9+: 2 column span, 2 row span (large — reserved for very active areas)

Grid: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`

Areas are sorted by weight descending — most active areas appear first.

## Hover Detail Panel — Key UX Details

The hover panel is the most important innovation. It bridges glance and deep focus.

**Timing:**
- Show delay: 200ms (prevents flicker on quick mouse moves)
- Hide delay: 300ms (lets you move from zone to panel without it disappearing)
- If mouse enters the panel itself, it stays open

**Positioning:**
- Anchored to the hovered zone
- Preferred: appears to the right of the zone
- If zone is near right viewport edge: appears to the left
- If zone is near bottom: panel grows upward
- Max height: 60vh, scrollable if needed

**Content:**
- Grouped by project, then sub-project
- Each session: dot + title + state label
- Projects with no sessions still shown (dimmed)
- "Untagged" section if area has loose sessions nearby
- Each session clickable → popup

**Animation:**
- Fade in + slight slide (opacity 0→1, translateY 4px→0)
- 150ms duration

## Cockpit Strip — Strategic Orchestration Layer

### Core Concept

A horizontal strip at the top of the Command Post that surfaces the live strategic picture. It reads from the strategy vault files (`gtd/strategy/`) and merges them with real-time session telemetry. The strategy session is the "write" cycle (review in Obsidian/Claude — weekly to monthly depending on velocity), the cockpit strip is the "read" cycle (always visible in the relay).

This is NOT a new strategic framework — it displays what already exists in `goals.md`, `strategy.md`, and the latest strategic review session summary.

### Data Sources

**From strategy vault (read via `/api/board/file`):**
- `gtd/strategy/goals.md` — THE GATE condition, milestone sequence
- `gtd/strategy/strategy.md` — TOTE, last reviewed date, current projects
- `gtd/strategy/02-operations/sessions/[latest]/session-summary.md` — allocation table, gap analysis, tests, critical path, one-sentence summary
- `gtd/strategy/vision.md` — 3-5 year direction (shown on expand)

**From live telemetry (already available via board store + WebSocket):**
- Which areas have processing sessions right now
- Session counts per area
- Activity stream events (started/finished)

**Strategy session:** a persistent relay session tagged to the strategy area that can read/write strategy files and accepts quick commands from the cockpit UI.

### Two States

**Collapsed (always visible, one line, ~36px tall):**
```
▸ GATE: First chatter $500/day · Build + Scale · Next check: Mar 18 · 3 processing │ 💬
```

Contents:
- The gate condition (from `goals.md`, parsed from `## Current Focus`)
- Selected candidate name (from latest session summary title/selection)
- Next review date (from latest session `Next review:` line)
- Live processing count (computed from board data)
- Chat icon to open/focus the strategy session

**Expanded (click the strip to toggle):**
```
▾ COCKPIT — Build + Scale (Mar 5)

  THE GATE: First chatter operational at $500/day

  ALLOCATION                         LIVE
  ██████████░░░░░░░░░░ Reddit 35%    ● 2 processing
  ██████░░░░░░░░░░░░░░ OF Tools 25%  ○ idle
  ██████░░░░░░░░░░░░░░ V3 TOTEs 25%  ● 1 processing
  ██░░░░░░░░░░░░░░░░░░ Training 5%   ○ idle
  ███░░░░░░░░░░░░░░░░░ Background 10%

  GAPS                               URGENCY
  Reddit traffic (10→100/day)        ■■■■ CRITICAL
  OF tools (nothing built)           ■■■  HIGH
  V3 content (arch only)             ■■   MEDIUM
  Training (Alina has it)            ■    LOW

  TESTS — Mar 18                     STATUS
  ☐ Reddit accounts warming?
  ☐ Phone remote working?
  ☐ Reddit agent prototype?
  ☑ Scraper bulletproofed?
  ☐ OF API wrapper started?
  ☐ Fan data flowing?
  ☐ Follow-up surfacing?
  ☐ List system reviewed?
  ☐ V3 TOTEs progressing?
  ☐ TikTok recovery attempted?
  ☐ Finance admin done?
  ☐ Training on track?
  ☐ Mass message sent?

  ┌─ Strategy Session ──────────────────────────────┐
  │ > mark "scraper bulletproofed" done              │
  │ > update reddit allocation to 40%                │
  │ > what should i focus on today?                  │
  └──────────────────────────────────────────────────┘
```

### Strategy Session (The Live Observer Agent)

The cockpit agent is NOT a passive note-taker you manually update. It's a live observer that can read the actual chat messages inside your active sessions. This is the key innovation.

**The problem it solves:**

You have 3-10 sessions running across areas — building the reddit agent, working on OF tools, doing v3 coaching content. The strategy TOTE committed you to specific work (allocation, tests, critical path). But without this agent, you'd have to manually track what you've done vs what you committed to. Things slip — the fun stuff gets done, the annoying admin doesn't. You restart your laptop and lose context. You go to IKEA, open the laptop, and can't remember where you were.

The cockpit agent solves this by having **read access to all active session messages**. It can look inside your reddit session, see what was discussed, see what got built, and give you an accurate read on where you actually are in the strategy TOTE — without you typing a single status update.

**What it can see:**
- All active relay sessions and their chat messages (via existing relay session message access)
- Which sessions are tagged to which areas/projects
- The strategy vault files (goals, allocation, tests, gaps, critical path)
- Board data (areas, projects, session counts)

**What it can do:**

*Live status reads (the killer feature):*
- "Give me a status update" → reads messages from all active sessions, cross-references with strategy tests and allocation, reports: "You've been working reddit 60% this week (allocated 35%). Phone remote is done — the test passes. OF API wrapper not started yet. V3 has one level operational. 5 of 13 tests passing."
- It does this by reading the actual conversation content, not by you telling it what happened

*Quick updates:*
- "mark phone remote done" → updates cockpit-state.json, ticks the test
- "reddit is taking more time than expected, update allocation to 40%" → edits allocation
- "phone remote blocked on WDA issue" → adds note to critical path

*Decision support:*
- "what should I focus on today?" → reads gaps + tests + what you've already done this week (from session messages), suggests the highest-leverage next action
- "prep next review" → summarizes what changed since last strategy session, drafts the "what changed" section for the next review

*Pattern detection:*
- "you've opened 4 sessions in chatting this week but only 1 in marketing — your allocation says 35% marketing"
- "the scraper session has been idle for 3 days — is it blocked?"
- "you committed to calling Telenet (background batch) but haven't done it in 6 days"

**What it cannot do (by design):**
- Change the gate condition (that's a full strategic review decision)
- Rewrite the gap analysis from scratch (needs the full 6-step TOTE process)
- Make strategic decisions for you (it surfaces data and patterns, you decide)
- Run autonomously / initiate on its own (it responds to your input — you're the orchestrator)

**How it works technically:**
- A persistent relay session with `projectPath` set to the strategy area
- System prompt includes: goals.md, latest session summary, strategy.md, purpose.md (principles)
- Has access to read other sessions' messages via the relay backend (new endpoint or existing session message access)
- When you type in the cockpit mini-chat, it sends to this session
- It has file write access to `gtd/strategy/` to update tests, allocation, notes
- Responses appear inline in the cockpit strip (compact, not a full popup window)

**Key interaction patterns:**

1. **Morning startup:** Open relay. Cockpit shows "5 of 13 tests passing, next check in 5 days." Type "what's my status?" Agent reads all recent sessions, reports: "Phone remote done yesterday. Reddit agent prototype started but not posting yet. OF API not started. You should probably start on the API wrapper today — it's blocking fan data pipeline which blocks follow-up surfacing."

2. **Mid-work check-in:** You've been grinding in a chatting session for 3 hours building v3 TOTEs. Glance at cockpit. Type "update." Agent looks at your chatting session messages, sees you built L4 and L5 operational TOTEs. Reports: "V3 test progressing — 2 levels now operational. Nice. But you haven't touched reddit or OF tools today and both are higher urgency."

3. **End of day:** Type "what did I get done today?" Agent reads all sessions from today, cross-references with tests: "Worked on: v3 TOTEs (2 levels), phone remote debugging (resolved), reddit account warming (3 accounts created). Tests updated: phone remote ☑, reddit warming ☑. Still open: OF API, fan data, follow-up surfacing. Recommendation: start OF API wrapper tomorrow — it's the gateway to 3 other tests."

4. **Device switch:** Go to IKEA with laptop. Open relay. Everything is exactly where you left it — sessions are there, cockpit shows current status, strategy context is live. No context lost.

5. **Strategy drift detection:** You've been having fun building the relay UI for 2 days. Type "am I on track?" Agent: "You've spent 80% of time on system/strategy this week. Your allocation says 35% reddit, 25% OF tools. Zero sessions in marketing or chatting areas. You're drifting into build-mode on tooling instead of executing the committed plan."

6. **Live iteration:** Based on feedback from a session, you realize the critical path needs updating. Type "scraper bulletproofing is done but the DOM changed — need another audit session. Add to critical path." Agent updates the strategy files.

### The Bigger Picture

This cockpit + agent pattern is where human operators live when orchestrating multiple parallel workstreams with AI assistance. The sessions are the workers (human + Claude pairs). The cockpit is the command center. The strategy agent is the executive assistant who watches everything and keeps you honest about what you committed to.

As autonomous agents come online (reddit posting agent, phone farm agent, etc.), they'll plug into the same system. Their sessions appear as dots on the command post. The cockpit agent can read their output too. When an autonomous agent needs human eyeballs (approval, edge case, quality check), it surfaces in the cockpit. The human operator sees "reddit agent needs review on account X" right next to "OF API wrapper: 3 endpoints done, 66 remaining."

The relay becomes the operating system for running a business through a mix of human sessions and autonomous agents, with the strategy TOTE as the meta-loop that keeps everything pointed at the gate condition.

```
                    ┌─────────────────────┐
                    │   STRATEGY TOTE      │
                    │   (as needed — weekly │
                    │    to monthly based   │
                    │    on velocity)       │
                    └──────────┬──────────┘
                               │ commits to
                    ┌──────────▼──────────┐
                    │   COCKPIT AGENT      │
                    │   (live observer)    │
                    │   reads ↕ updates    │
                    └──────────┬──────────┘
                               │ watches
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
     │ AREA: Reddit   │ │ AREA: Chat   │ │ AREA: Finance│
     │ ● agent session│ │ ● v3 session │ │ ○ idle       │
     │ ● phone setup  │ │ ● coaching   │ │              │
     │ ○ content      │ │ ○ copilot    │ │ (ACERTA call │
     └────────────────┘ └──────────────┘ │  not done)   │
                                          └──────────────┘
     ● = active session (human + Claude)
     ○ = planned but not started
     Cockpit agent reads messages from ALL active sessions
```

### Parsing Strategy Files

The session summary is already structured with markdown tables. Parsing approach:

**Allocation table:**
```
| Track | % | What |
|-------|---|------|
| **Reddit rebuild + agent** | **35%** | ... |
```
→ Regex: `/\*\*(\d+)%\*\*/` per row, track name from first column

**Tests table:**
```
| Check | Evidence |
|-------|----------|
| Reddit accounts warming? | At least 3-4 new accounts... |
```
→ Each row becomes a checkbox. Status is stored separately (in a `cockpit-state.json` or as frontmatter additions to the session summary).

**Gap analysis table:**
```
| Area | Present | Desired | Gap | Urgency |
```
→ Parse urgency column: HIGHEST/HIGH/MEDIUM/LOW → color coding

**One-sentence version:**
→ Regex: content after `## The one-sentence version` heading

**Next review date:**
→ Regex: `Next review:` or `Next check:` line

**Latest session detection:**
→ Read `gtd/strategy/02-operations/sessions/`, sort directories by name (date-prefixed), take the last one, read `session-summary.md`

### New Backend Endpoint

`GET /api/board/strategy` — returns parsed strategy data:

```json
{
  "gate": "First chatter operational at $500/day",
  "candidateName": "Build + Scale",
  "sessionDate": "2026-03-05",
  "nextReview": "2026-03-18",
  "allocation": [
    { "track": "Reddit rebuild + agent", "percent": 35 },
    { "track": "OF platform tooling", "percent": 25 },
    { "track": "v3 TOTEs", "percent": 25 },
    { "track": "Training", "percent": 5 },
    { "track": "Background", "percent": 10 }
  ],
  "gaps": [
    { "area": "Reddit traffic", "present": "~10 fans/day", "desired": "100 fans/day", "urgency": "CRITICAL" },
    { "area": "OF tools", "present": "Nothing built", "desired": "API + fan data + follow-up", "urgency": "HIGH" }
  ],
  "tests": [
    { "label": "Reddit accounts warming?", "evidence": "At least 3-4 new accounts created" },
    { "label": "Phone remote working?", "evidence": "Can control an iPhone from browser" }
  ],
  "oneSentence": "Rebuild Reddit traffic with phones and an AI posting agent...",
  "vision": "...",
  "purpose": "Build systems and train people to create freedom"
}
```

Test status (checked/unchecked) stored in `gtd/strategy/cockpit-state.json`:
```json
{
  "sessionDate": "2026-03-05",
  "testStatus": {
    "Reddit accounts warming?": false,
    "Phone remote working?": false,
    "Scraper bulletproofed?": true
  },
  "allocationOverrides": null,
  "notes": []
}
```

This file gets reset when a new strategy session is detected (different date prefix in sessions folder).

### Components

**7. CockpitStrip.svelte**

Top strip of the Command Post. Reads strategy data, displays collapsed/expanded views, contains mini-chat for strategy session.

**Props:** none (reads from stores/API)

**State:**
- `expanded: boolean` — collapsed vs expanded
- `strategyData: object` — parsed from `/api/board/strategy`
- `testStatus: object` — from `cockpit-state.json`
- `strategySessionId: string | null` — the persistent strategy session

**Collapsed bar:**
- One line: gate + candidate + next review + live processing count + chat icon
- Click anywhere to expand
- Chat icon opens/focuses strategy session inline

**Expanded panel:**
- Allocation bars (percentage bars with live session overlay)
- Gap list with urgency color coding
- Test checklist (checkable — updates `cockpit-state.json` via API, or tells strategy agent)
- Mini-chat input for strategy session at the bottom
- Click header or press Escape to collapse

### Files to Create/Modify

**Create:**
- `src/lib/board/CockpitStrip.svelte` — the orchestration strip component

**Modify:**
- `src/lib/board/CommandPost.svelte` — add CockpitStrip at top
- Backend `lib/project.js` — add `GET /api/board/strategy` endpoint, add `GET/POST /api/board/cockpit-state` endpoint

**New file in gtd/:**
- `gtd/strategy/cockpit-state.json` — persisted test status and notes (auto-created)

### Interaction Flow (with Cockpit)

1. **Open relay** → Cockpit strip visible at top: "GATE: First chatter $500/day · Build + Scale · Next check: Mar 18 · 2 processing"
2. **Glance** → You know the strategic posture without reading anything else
3. **Click strip** → Expands. You see allocation bars, 3 of 13 tests passing, reddit gap is CRITICAL
4. **Check a test** → "Scraper bulletproofed? ☑" → saved to cockpit-state.json
5. **Type in mini-chat** → "phone remote done, mark it" → strategy agent updates the file
6. **Type** → "what should I do today?" → agent reads gaps, tests, allocation, suggests focus
7. **Collapse strip** → back to one-line summary, area grid below
8. **Work in sessions** → cockpit strip stays visible at top, you glance at it between sessions
9. **End of day** → strip shows "5 of 13 tests passing" — progress visible at a glance

## What NOT to Build

- No drag-and-drop area rearrangement (complexity, not needed yet)
- No persistent area positioning/layout (let the grid + weight handle it)
- No real-time WebSocket for board data (fetch on load + manual refresh is fine)
- No area creation/deletion from the UI (managed via filesystem)
- No edit-in-place for TOTE state (that's an Obsidian job)
- No custom tooltip component for session bubbles — native `title` is fine for small dots

## Files to Create/Modify

**Create:**
- `src/lib/board/CommandPost.svelte` — grid layout, zoom state, activity stream container ✅ BUILT
- `src/lib/board/AreaZone.svelte` — area zone with normal/hovered/focused/compact modes ✅ BUILT
- `src/lib/board/SessionBubble.svelte` — session dot component ✅ BUILT
- `src/lib/board/ActivityStream.svelte` — bottom event strip ✅ BUILT
- `src/lib/board/CockpitStrip.svelte` — strategic orchestration strip with mini-chat

**Modify:**
- `src/App.svelte` — replace `<Workbench />` and `<DrilldownView />` with `<CommandPost />` ✅ DONE
- `src/stores/board.js` — add `focusedArea` writable store, keep `drilldownView` for now (deprecated) ✅ DONE
- Backend `lib/project.js` — add `GET /api/board/strategy` endpoint (parses strategy vault files), add `GET/POST /api/board/cockpit-state` endpoint

**Keep as-is:**
- Sidebar (sessions tab, files tab, board tab) — keep for tree-style browsing
- Session popups — the "do" layer
- File panel split — stays on the right
- Header — unchanged
- SessionTagger — reused on right-click
- All existing stores

## Interaction Flow

1. **Open relay** → Command Post. All areas visible. Strategy has a pulsing dot. System is quiet.
2. **Hover Strategy** → zone grows slightly. Panel appears: "relay-workspace-board: ● Building board UI (processing)". You see what's happening without clicking.
3. **Click the pulsing dot** → session popup opens. You're working. Close popup → back at Command Post.
4. **Hover Chatting** → panel shows 5 sub-projects under 2 projects. No sessions yet. You see the landscape.
5. **Click Chatting zone** → it zooms in. Full TOTE state. All projects with sub-projects listed. "New Session in chatter-playbook" button.
6. **Click "New Session"** → session created, auto-tagged to chatter-playbook, popup opens.
7. **Press Escape** → back to overview. Now Chatting has a new dot next to chatter-playbook.
8. **Glance at activity stream** → "Finance session finished 3m ago". Click it → popup opens.
9. **Right-click a loose session dot** → SessionTagger menu → tag it to a project → dot moves.

## Visual Language

All existing colors, no new palette:

- Background: `#1a1918`
- Zone background: `#242320`
- Zone border: `rgba(255,255,255,0.06)`
- Zone hover: slight grow + `rgba(218,119,86,0.15)` border
- Zone focused: `rgba(218,119,86,0.25)` border glow
- Processing dot: `#da7756` with pulse animation
- Idle dot: `#5b9fd6`
- Stale dot: `#6b6760`
- TOTE present: `#6b6760`
- TOTE desired: `#57ab5a`
- Text: `#d4d0c8` → `#b0ab9f` → `#908b81` → `#6b6760` (hierarchy)
- Hover panel: `#2a2924` with `rgba(255,255,255,0.1)` border, box-shadow
