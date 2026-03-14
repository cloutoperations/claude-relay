// Git status store — Svelte 5 runes
// Tracks staged, changed, and untracked files from git status.

import { send } from './ws.svelte.js';
import { addTabToPane, findPaneForTab, switchPaneTab, activePaneId } from './panes.svelte.js';

export const gitStatus = $state({
  staged: [],    // [{ status, path, oldPath }]
  changed: [],   // [{ status, path }]
  untracked: [], // [{ status, path }]
  error: null,
  loading: false,
});

// Derived: total changed count
export function getTotalCount() {
  return gitStatus.staged.length + gitStatus.changed.length + gitStatus.untracked.length;
}

// Derived: status map for file tree badges — path → status letter
export function getStatusMap() {
  const map = new Map();
  for (const f of gitStatus.staged) map.set(f.path, f.status);
  for (const f of gitStatus.changed) map.set(f.path, f.status);
  for (const f of gitStatus.untracked) map.set(f.path, f.status);
  return map;
}

// Derived: set of directories that contain changed files
export function getDirtyDirs() {
  const dirs = new Set();
  const allPaths = [
    ...gitStatus.staged.map(f => f.path),
    ...gitStatus.changed.map(f => f.path),
    ...gitStatus.untracked.map(f => f.path),
  ];
  for (const p of allPaths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return dirs;
}

// --- Route incoming messages ---

export function handleGitStatusResult(msg) {
  gitStatus.staged = msg.staged || [];
  gitStatus.changed = msg.changed || [];
  gitStatus.untracked = msg.untracked || [];
  gitStatus.error = msg.error || null;
  gitStatus.loading = false;
}

export function handleGitActionResult(msg) {
  // After any git action, auto-refresh status
  if (msg.success) {
    refreshStatus();
  }
}

// --- Actions ---

export function refreshStatus() {
  gitStatus.loading = true;
  send({ type: 'git_status' });
}

export function stageFile(filePath) {
  send({ type: 'git_stage', path: filePath });
}

export function stageFiles(paths) {
  send({ type: 'git_stage', paths });
}

export function unstageFile(filePath) {
  send({ type: 'git_unstage', path: filePath });
}

export function discardFile(filePath) {
  send({ type: 'git_discard', path: filePath });
}

// --- Diff state ---

export const activeDiff = $state({
  path: null,
  staged: false,
  diff: null,
  loading: false,
  error: null,
});

export function handleGitDiffResult(msg) {
  if (msg.path === activeDiff.path) {
    activeDiff.diff = msg.diff || '';
    activeDiff.error = msg.error || null;
    activeDiff.loading = false;
  }
}

export function openDiff(filePath, staged) {
  const tabId = '__git_diff__';
  activeDiff.path = filePath;
  activeDiff.staged = !!staged;
  activeDiff.diff = null;
  activeDiff.loading = true;
  activeDiff.error = null;
  send({ type: 'git_diff_working', path: filePath, staged: !!staged });

  const existing = findPaneForTab(tabId);
  if (existing) {
    switchPaneTab(existing, tabId);
    activePaneId.value = existing;
  } else {
    addTabToPane(tabId);
  }
}

export function requestDiff(filePath, staged) {
  send({ type: 'git_diff_working', path: filePath, staged: !!staged });
}

// Git chat: flag to auto-send summary when next session opens
export const pendingGitChat = $state({ active: false });

export function buildGitSummary() {
  const parts = [];
  parts.push('Review my current git changes and help me understand what\'s been modified.\n');
  if (gitStatus.staged.length > 0) {
    parts.push('**Staged (' + gitStatus.staged.length + '):**');
    for (const f of gitStatus.staged) parts.push('  ' + f.status + ' ' + f.path);
  }
  if (gitStatus.changed.length > 0) {
    parts.push('**Changed (' + gitStatus.changed.length + '):**');
    for (const f of gitStatus.changed) parts.push('  ' + f.status + ' ' + f.path);
  }
  if (gitStatus.untracked.length > 0) {
    parts.push('**Untracked (' + gitStatus.untracked.length + '):**');
    for (const f of gitStatus.untracked) parts.push('  ? ' + f.path);
  }
  parts.push('\nRead the changed files and give me a summary of what\'s different. Group by feature/purpose if possible.');
  return parts.join('\n');
}
