# Git Integration — Feature Checklist

Git status, diffs, and change tracking inside Claude Relay. Designed for the clout-operations monorepo.

## What we want

See which files have been changed, staged, or are untracked — without leaving the relay UI. Know what Claude did. Know what you did. Know what's uncommitted before you forget.

---

## Sidebar: GIT section

New collapsible section in the sidebar between AGENTS and SESSIONS. Shows the output of `git status` grouped into clear buckets.

```
▾ GIT                              12 changed
  Staged (3)
    M  code/claude-relay/lib/project.js
    A  code/claude-relay/lib/agents.js
    A  svelte-frontend/src/stores/agents.svelte.js

  Changed (7)
    M  gtd/chatting/training.md
    M  gtd/strategy/session-2026-03-14.md
    M  code/scraper/server/src/routes.ts
    M  code/claude-relay/svelte-frontend/src/App.svelte
    M  code/claude-relay/CLAY-FEATURES-CHECKLIST.md
    M  code/claude-relay/GIT-INTEGRATION-CHECKLIST.md
    M  code/claude-relay/REWORK-CHECKLIST.md

  Untracked (2)
    ?  code/claude-relay/lib/cron.js
    ?  code/claude-relay/lib/ralph.js
```

### Interactions

- Click a file → opens in the file viewer tab (already exists)
- Right-click → context menu: "View Diff", "Stage", "Unstage", "Discard Changes"
- Stage/unstage sends `git add`/`git reset` to the backend
- Header shows total changed file count as badge
- Refresh button in header (or auto-refresh on file change)

### Items

- [ ] **G.1** Backend: `git_status` WS handler
  - Runs `git status --porcelain -uall` from project cwd
  - Parses output into `{ staged: [], changed: [], untracked: [] }`
  - Each entry: `{ status, path, oldPath (renames) }`
  - Status codes: `M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked
  - Sends as `git_status_result` WS message
  - Performance: cache result for 2s, invalidate on file system events

- [ ] **G.2** Backend: `git_stage` / `git_unstage` / `git_discard` WS handlers
  - `git_stage`: runs `git add <path>` (array of paths supported)
  - `git_unstage`: runs `git reset HEAD <path>`
  - `git_discard`: runs `git checkout -- <path>` (with confirmation required from frontend)
  - Returns updated `git_status_result` after each operation

- [ ] **G.3** Backend: auto-refresh git status
  - Watch `.git/index` for changes (covers commits, staging, rebases)
  - On change, broadcast `git_status_result` to all connected clients
  - Debounce 500ms (`.git/index` can change rapidly during operations)

- [ ] **G.4** Frontend: `stores/git.svelte.js`
  - `$state` for staged, changed, untracked arrays
  - `$derived` total count
  - Request `git_status` on connect and on `__ws_open`
  - Route `git_status_result` in session-router
  - Actions: `stageFile(path)`, `unstageFile(path)`, `discardFile(path)`, `refreshStatus()`

- [ ] **G.5** Frontend: GIT sidebar section in `AreasSidebar.svelte`
  - Collapsible, same pattern as SESSIONS/FILES/AGENTS
  - Three sub-groups: Staged, Changed, Untracked (only show if non-empty)
  - Status letter badge (M/A/D/R/?) + file path
  - Path display: truncate long paths, show filename bold + directory dimmed
  - Click → open in file viewer
  - Right-click → context menu (stage/unstage/discard/view diff)

- [ ] **G.6** Frontend: git section header
  - Badge with total changed count (staged + changed + untracked)
  - Small refresh button (triggers `git_status` request)

---

## File tree: status badges

Small colored badges on files in the existing file tree to show git status at a glance.

```
▾ code/
  ▾ claude-relay/
    ▾ lib/
        agents.js          A
        project.js         M
        cron.js            ?
    ▾ svelte-frontend/
      ▾ src/
          App.svelte       M
```

### Badge colors

- `M` (modified) — amber/orange
- `A` (added/staged) — green
- `D` (deleted) — red
- `?` (untracked) — grey
- `R` (renamed) — blue

### Propagation

Directories inherit the "most important" status of their children:
- Any modified child → directory shows a dot
- Useful for seeing at a glance which folders have changes

### Items

- [ ] **G.7** Backend: include git status in `fs_list_result`
  - Run `git status --porcelain` scoped to the listed directory
  - Add `gitStatus` field to each entry: `"M"`, `"A"`, `"D"`, `"?"`, or `null`
  - Cache per directory, invalidate with existing dir watcher
  - Parent directories: propagate child status as a dot indicator

- [ ] **G.8** Frontend: render badges in `FileTree.svelte`
  - After `<span class="tree-name">`, add status badge if `entry.gitStatus` set
  - Color-coded: amber M, green A, red D, grey ?
  - Small pill, 10px font, doesn't shift layout
  - Directories: subtle dot if any descendant has changes

---

## Diff viewer

Click "View Diff" on a changed file → see the diff in the file viewer tab.

```
┌─────────────────────────────────────────────────┐
│  lib/project.js                    M  unstaged   │
│  ─────────────────────────────────────────────── │
│  @@ -1086,4 +1086,8 @@                          │
│    name: entry.name,                             │
│    type: entry.isDirectory() ? "dir" : "file",   │
│    path: relPath,                                │
│  + gitStatus: statusMap.get(relPath) || null,    │
│                                                  │
│  @@ -1165,3 +1169,15 @@                         │
│  ...                                             │
│                                                  │
│  [Stage]  [Discard]  [Open File]                 │
└─────────────────────────────────────────────────┘
```

### Items

- [ ] **G.9** Backend: `git_diff` for working tree changes
  - `git diff -- <path>` for unstaged changes
  - `git diff --cached -- <path>` for staged changes
  - Returns unified diff string
  - Already partially exists (file history diff) — extend to support working tree

- [ ] **G.10** Frontend: diff view in `FileViewer.svelte`
  - New render mode: diff (alongside existing text/markdown/image modes)
  - Parse unified diff → render with +/- line highlighting
  - Green background for additions, red for deletions
  - Hunk headers (`@@`) styled as section dividers
  - Action bar at bottom: [Stage] [Discard] [Open File]

- [ ] **G.11** Frontend: "View Diff" entry point
  - From git sidebar: right-click → View Diff
  - From file tree: right-click changed file → View Diff
  - Opens file viewer in diff mode with the file path

---

## Commit from UI (stretch goal)

Quick commit without leaving the relay. Not a full git GUI — just the basics.

- [ ] **G.12** Backend: `git_commit` WS handler
  - Runs `git commit -m "<message>"` with staged files
  - Returns success/error + updated git status
  - Refuses if nothing staged

- [ ] **G.13** Frontend: commit UI
  - Small commit form at top of GIT sidebar section (only visible when files are staged)
  - Commit message input + "Commit" button
  - Shows staged file count: "Commit 3 files"
  - After commit: toast notification, git status refreshes

---

## Monorepo considerations

- The relay server runs from the monorepo root (`clout-operations/`), so `git status` covers everything: gtd/, code/, scripts/
- Paths shown in the sidebar are relative to repo root — same as `git status` output
- `claude-relay` is a submodule: it shows as a single entry in parent repo status. The relay won't run git commands inside the submodule separately unless we want nested git status (skip for now)
- Performance: `git status --porcelain` on the monorepo should be fast (<100ms). If it gets slow, scope to relevant dirs or use `git status --porcelain -- code/ gtd/`

---

## Implementation order

1. **G.1 + G.4 + G.5 + G.6** — Backend git status + store + sidebar section (core loop)
2. **G.7 + G.8** — File tree badges (quick visual win)
3. **G.3** — Auto-refresh on git index changes
4. **G.9 + G.10 + G.11** — Diff viewer
5. **G.2** — Stage/unstage/discard actions
6. **G.12 + G.13** — Commit from UI (stretch)

Steps 1-2 give you 80% of the value. Steps 3-6 are polish.
