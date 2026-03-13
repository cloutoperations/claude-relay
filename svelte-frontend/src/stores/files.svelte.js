// File browser store — manages file tree, viewer tabs, and search.
// Svelte 5 runes version.

import { wsState, send } from './ws.svelte.js';
import { addTabToPane, onTabClosed } from './panes.svelte.js';

const TABS_KEY = 'claude-relay-file-tabs';
const ACTIVE_TAB_KEY = 'claude-relay-active-tab';

// --- State ---

export let treeData = $state({});
export const expandedDirs = $state({ value: new Set() });
export let openFiles = $state([]);       // [{ path, content, error, binary, imageUrl, size, loading }]
export const activeFilePath = $state({ value: null });
export const fileLoading = $state({ value: false });
export const fileSearchResults = $state({ value: [] });
export const fileSearchQuery = $state({ value: '' });

let searchDebounce = null;
const pendingReads = new Map();
let persistEnabled = false;
let hasRestored = false;

// --- Derived ---

let _activeFile = $derived(openFiles.find(f => f.path === activeFilePath.value) || null);
let _hasOpenFiles = $derived(openFiles.length > 0);

export function getActiveFile() { return _activeFile; }
export function getHasOpenFiles() { return _hasOpenFiles; }

// --- Persistence ---

function saveTabs() {
  if (!persistEnabled) return;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(openFiles.map(f => f.path)));
    localStorage.setItem(ACTIVE_TAB_KEY, activeFilePath.value || '');
  } catch {}
}

// Auto-persist on state change (track paths only, not content)
$effect.root(() => {
  $effect(() => {
    // Build a stable key from file paths to detect tab open/close/reorder
    const _pathKey = openFiles.map(f => f.path).join('\0');
    const _active = activeFilePath.value;
    saveTabs();
  });

  // --- WS message handling ---
  // Handled by routeFileMessage() called from session-router, NOT via $effect on incoming.
  // Having two $effects reading wsState.incoming causes effect_update_depth_exceeded.
});

function handleWsOpen() {
  if (hasRestored) return;
  hasRestored = true;

  try {
    const savedPaths = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    const savedActive = localStorage.getItem(ACTIVE_TAB_KEY) || null;
    if (savedPaths.length > 0) {
      openFiles.splice(0, openFiles.length, ...savedPaths.map(p => ({ path: p, content: null, loading: true })));
      activeFilePath.value = savedActive && savedPaths.includes(savedActive) ? savedActive : savedPaths[0];
      for (const p of savedPaths) {
        send({ type: 'fs_read', path: p });
        pendingReads.set(p, setTimeout(() => {
          pendingReads.delete(p);
          const idx = openFiles.findIndex(f => f.path === p && f.loading);
          if (idx >= 0) openFiles[idx] = { path: p, error: 'Request timed out' };
        }, 10000));
      }
      if (savedActive) revealInTree(savedActive);
    }
  } catch {}
  persistEnabled = true;
}

// Called by session-router for file-related WS messages
export function routeFileMessage(msg) {
  if (msg.type === '__ws_open') {
    handleWsOpen();
    return;
  }
  if (msg.type === 'fs_list_result') {
    treeData[msg.path] = { loaded: true, children: msg.entries || [] };
    if (msg.path === '.') expandedDirs.value.add('.');
  } else if (msg.type === 'fs_read_result') {
    if (pendingReads.has(msg.path)) {
      clearTimeout(pendingReads.get(msg.path));
      pendingReads.delete(msg.path);
    }
    fileLoading.value = false;
    const fileData = msg.error
      ? { path: msg.path, error: msg.error }
      : { path: msg.path, content: msg.content || null, binary: msg.binary || false, imageUrl: msg.imageUrl || null, size: msg.size || 0 };
    const idx = openFiles.findIndex(f => f.path === msg.path);
    if (idx >= 0) openFiles[idx] = fileData;
  } else if (msg.type === 'fs_search_result') {
    fileSearchResults.value = msg.results || [];
  } else if (msg.type === 'fs_file_changed') {
    const idx = openFiles.findIndex(f => f.path === msg.path);
    if (idx >= 0) openFiles[idx] = { ...openFiles[idx], content: msg.content };
  }
}

// --- Public API ---

export function toggleDir(dirPath) {
  if (expandedDirs.value.has(dirPath)) {
    expandedDirs.value.delete(dirPath);
    expandedDirs.value = new Set(expandedDirs.value);
  } else {
    expandedDirs.value.add(dirPath);
    expandedDirs.value = new Set(expandedDirs.value);
    if (!treeData[dirPath]?.loaded) {
      send({ type: 'fs_list', path: dirPath });
    }
  }
}

export function revealInTree(filePath) {
  if (!filePath) return;
  const parts = filePath.split('/');
  const parents = ['.'];
  for (let i = 0; i < parts.length - 1; i++) {
    parents.push(parts.slice(0, i + 1).join('/'));
  }
  let changed = false;
  for (const p of parents) {
    if (!expandedDirs.value.has(p)) { expandedDirs.value.add(p); changed = true; }
    if (!treeData[p]?.loaded) send({ type: 'fs_list', path: p });
  }
  if (changed) expandedDirs.value = new Set(expandedDirs.value);
}

export function openFile(filePath) {
  const fileTabId = '__file__:' + filePath;
  const existing = openFiles.find(f => f.path === filePath);
  if (existing) {
    activeFilePath.value = filePath;
    addTabToPane(fileTabId);
    revealInTree(filePath);
    return;
  }
  fileLoading.value = true;
  activeFilePath.value = filePath;
  openFiles.push({ path: filePath, content: null, loading: true });
  addTabToPane(fileTabId);
  send({ type: 'fs_read', path: filePath });
  revealInTree(filePath);

  if (pendingReads.has(filePath)) clearTimeout(pendingReads.get(filePath));
  pendingReads.set(filePath, setTimeout(() => {
    pendingReads.delete(filePath);
    const idx = openFiles.findIndex(f => f.path === filePath && f.loading);
    if (idx >= 0) openFiles[idx] = { path: filePath, error: 'Request timed out — server did not respond' };
    fileLoading.value = false;
  }, 10000));
}

export function closeFileTab(filePath) {
  const fileTabId = '__file__:' + filePath;
  const idx = openFiles.findIndex(f => f.path === filePath);
  if (idx === -1) return;

  openFiles.splice(idx, 1);
  onTabClosed(fileTabId);

  if (activeFilePath.value === filePath) {
    activeFilePath.value = openFiles.length > 0
      ? openFiles[Math.min(idx, openFiles.length - 1)].path
      : null;
  }
}

export function switchTab(filePath) {
  activeFilePath.value = filePath;
  revealInTree(filePath);
}

export function closeFile() {
  openFiles.length = 0;
  activeFilePath.value = null;
}

export function searchFiles(query) {
  fileSearchQuery.value = query;
  if (searchDebounce) clearTimeout(searchDebounce);
  if (!query.trim()) {
    fileSearchResults.value = [];
    return;
  }
  searchDebounce = setTimeout(() => {
    send({ type: 'fs_search', query: query.trim() });
  }, 150);
}

export function loadRootDir() {
  send({ type: 'fs_list', path: '.' });
}
