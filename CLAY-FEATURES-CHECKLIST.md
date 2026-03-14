# Features from Clay (chadbyte/claude-relay) — Adoption Checklist

Features worth stealing from Chad's original Claude Relay (now "Clay" v2.9.3).
All agent types (Ralph, Cron, one-shot) share a unified UI: the **AGENTS** sidebar section + `__agent__:` detail tabs.

---

## UI — Agents Sidebar Section + Detail Tabs

All agent types live in one collapsible sidebar section (same pattern as SESSIONS and FILES).

### Sidebar section

- [ ] **0.1** `stores/agents.svelte.js` — agent state store
  - `$state` list of all agents (ralph loops, cron jobs, one-shots)
  - Each agent: `{ id, type, name, status, config, history, sessionIds }`
  - Status enum: `idle | running | passed | failed | scheduled | stopped`
  - Hydrate from server on connect via `agent_list` WS message
  - Live updates via `agent_status` WS events
- [ ] **0.2** Sidebar AGENTS section in `AreasSidebar.svelte`
  - Collapsible, between Areas and SESSIONS
  - Shows count badge (like SESSIONS 172)
  - Each agent row: icon by type (⟳ ralph, ⏰ cron, ● one-shot) + name + compact status + time
  - Click → opens `__agent__:{id}` tab with detail view
  - `[+ New Agent]` button at bottom of expanded list
- [ ] **0.3** `__agent__:` tab type
  - Register in `TabBar.svelte` `makeTabInfo()` (like `__area__:` and `__project__:`)
  - Register in `PaneManager.svelte` to render `AgentDetailTab.svelte`
- [ ] **0.4** `lib/board/AgentDetailTab.svelte` — detail view (opens as tab)
  - Header: agent name, type badge, status, start/stop button
  - Config section (varies by type — see Ralph and Cron below)
  - Session list: sessions spawned by this agent, clickable → opens session tab
  - History/log section (varies by type)
  - Delete agent button with confirmation
- [ ] **0.5** Agent creation flow
  - Triggered by `[+ New Agent]` in sidebar
  - Inline panel or modal: pick type (Ralph Loop / Scheduled Task / One-shot)
  - Type-specific config form (see below)
  - Assign to project, pick account
  - Create → agent appears in sidebar, detail tab opens

### Shared backend

- [ ] **0.6** `lib/agents.js` — agent registry
  - Agent storage in `~/.claude-relay/agents.json` (persists across restarts)
  - CRUD operations: create, update, delete, list
  - Agent state machine: idle → running → passed/failed/stopped
  - Session creation helper: creates SDK session tagged with `agent: { id, type, name }`
  - Event emitter: `agent_status` events to all WS viewers
- [ ] **0.7** `lib/project.js` — WS handlers
  - `agent_list` — list all agents with status
  - `agent_create` — create new agent (type + config)
  - `agent_update` — modify agent config
  - `agent_delete` — remove agent
  - `agent_start` — start/resume agent
  - `agent_stop` — stop running agent
  - `agent_trigger` — manually trigger (cron: run now, ralph: run one iteration)
- [ ] **0.8** `lib/daemon.js` — agent lifecycle
  - Load agents on daemon start
  - Resume cron schedules and paused ralph loops
  - Clean shutdown: stop running agents gracefully
- [ ] **0.9** Notifications (shared)
  - Push notification on agent completion, failure, or max iterations
  - Toast notification with result summary
  - Reuse existing push infrastructure (VAPID, `lib/push.js`)

---

## Ralph Loop (agent type: `ralph`)

Autonomous coding loop. Task in `PROMPT.md`, success criteria in `JUDGE.md`. Agent codes → commits → judge evaluates diff → PASS/FAIL. On failure, fresh session (no memory, only code persists).

### Backend

- [ ] **1.1** `lib/ralph.js` — Ralph loop engine
  - Reads `PROMPT.md` (task) and `JUDGE.md` (pass/fail criteria) from project root or custom path
  - Creates fresh SDK session per iteration (no conversation memory carried over)
  - After each iteration: auto-commits, runs judge prompt against `git diff` of the commit
  - Judge returns structured PASS/FAIL with reasoning
  - On PASS → stop loop, update agent status, notify
  - On FAIL → start new session with only PROMPT.md (code changes persist in git)
  - Configurable: max iterations (default 10), auto-commit message prefix
- [ ] **1.2** `lib/ralph.js` — iteration tracking
  - Track iteration count, pass/fail history, time per iteration, judge reasoning
  - Emit `agent_status` events with ralph-specific data (iteration #, verdict)
- [ ] **1.3** Register ralph type in `lib/agents.js`
  - `start()`: validate PROMPT.md + JUDGE.md exist, begin loop
  - `stop()`: abort current iteration, stop loop

### Frontend (in AgentDetailTab)

- [ ] **1.4** Ralph config section
  - PROMPT.md and JUDGE.md content (editable inline or link to file viewer)
  - Max iterations setting
  - Start/Stop button
- [ ] **1.5** Ralph iteration log
  - List of attempts: iteration #, pass/fail badge, timestamp, judge reasoning (expandable)
  - Current iteration: elapsed time, link to live session
- [ ] **1.6** Ralph session integration
  - Each iteration creates a visible session in the session list
  - Auto-labeled: "Ralph #3 — {agent-name}"
  - Failed = red badge, passed = green badge

---

## Cron Scheduler (agent type: `cron`)

Scheduled tasks that run autonomously and survive logout/restart. Daemon-managed.

### Backend

- [ ] **2.1** `lib/cron.js` — cron engine
  - Cron expression parser (use `croner` package — lightweight, no deps)
  - On trigger: creates new SDK session via `lib/agents.js`, sends prompt, runs to completion
  - Next run time calculation
- [ ] **2.2** `lib/cron.js` — job lifecycle
  - Enable/disable without deleting
  - Job history: last 10 runs with status (success/error), duration, session ID
  - Error handling: failed runs don't kill the schedule, logged with details
- [ ] **2.3** Register cron type in `lib/agents.js`
  - `start()`: schedule next run via croner
  - `stop()`: cancel scheduled run
  - `trigger()`: run immediately (manual override)

### Frontend (in AgentDetailTab)

- [ ] **2.4** Cron config section
  - Cron expression input with human-readable preview ("Every day at 8:00 AM")
  - Prompt textarea
  - Enable/disable toggle
  - "Run now" button
  - Next run time display
- [ ] **2.5** Cron run history
  - Timeline: success/fail indicators, duration, link to session
  - View output of last run (click → opens session tab)

---

## Maybe Later

| Feature | Notes |
|---|---|
| **Multi-user** | Don't want people on your machine. Revisit only if sandboxed (container/VM per user) |
| **Session joining** | Could be interesting for pair work later, not needed now |
| **QR code connection** | Already have push notifications, low priority |

---

## Implementation Order

1. **Shared infrastructure** (0.1–0.9) — agent store, sidebar section, detail tab shell, backend registry, WS handlers
2. **Ralph Loop** (1.1–1.6) — most unique feature, high impact
3. **Cron Scheduler** (2.1–2.5) — layer on top of shared infra

Build the sidebar section and `__agent__:` tab type first with a dummy agent, then wire up Ralph, then Cron. Each type is a plugin that registers with `lib/agents.js`.
