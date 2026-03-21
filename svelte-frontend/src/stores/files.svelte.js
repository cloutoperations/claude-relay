// File browser store — manages file tree, viewer tabs, and search.
// Svelte 5 runes version.

import { wsState, send } from './ws.svelte.js';
import { addTabToPane, onTabClosed, panes, paneLayout, activePaneId, findPaneForTab, createPaneRight } from './panes.svelte.js';

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
  // Clear stale timeouts from any previous connection so they don't
  // fire and interfere with new file reads after reconnect (bug 2.10).
  for (const [path, timer] of pendingReads) {
    clearTimeout(timer);
  }
  pendingReads.clear();

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

  // Load root directory now that WS is connected
  if (!treeData['.']?.loaded) {
    send({ type: 'fs_list', path: '.' });
  }
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
    // Match on original requested path; also check pendingReads for decoded variants
    const requestPath = msg.path;
    if (pendingReads.has(requestPath)) {
      clearTimeout(pendingReads.get(requestPath));
      pendingReads.delete(requestPath);
    }
    if (pendingReads.size === 0) fileLoading.value = false;
    const fileData = msg.error
      ? { path: requestPath, error: msg.error }
      : { path: requestPath, resolvedPath: msg.resolvedPath || null, content: msg.content || null, binary: msg.binary || false, imageUrl: msg.imageUrl || null, size: msg.size || 0 };
    const idx = openFiles.findIndex(f => f.path === requestPath);
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

// Find or create a pane for file tabs — split right from the active pane.
function getFilePaneId(filePath) {
  const fileTabId = '__file__:' + filePath;
  console.log('[getFilePaneId]', fileTabId, 'panes:', panes.length, 'active:', activePaneId.value);
  // If THIS specific file is already open in a pane, reuse that pane
  const existingPane = panes.find(p => p.tabIds.includes(fileTabId));
  if (existingPane) { console.log('[getFilePaneId] reuse existing:', existingPane.id); return existingPane.id; }
  // If there's a pane to the right of the active one, use it
  const activeIdx = panes.findIndex(p => p.id === activePaneId.value);
  if (activeIdx >= 0 && activeIdx < panes.length - 1) {
    console.log('[getFilePaneId] use right pane:', panes[activeIdx + 1].id);
    return panes[activeIdx + 1].id;
  }
  // Create a new split pane to the right
  console.log('[getFilePaneId] creating new pane right');
  const newId = createPaneRight();
  console.log('[getFilePaneId] newId:', newId);
  return newId || activePaneId.value;
}

export function openFile(filePath) {
  const fileTabId = '__file__:' + filePath;
  const targetPane = getFilePaneId(filePath);
  window.dispatchEvent(new CustomEvent('relay-expand-files'));
  const existing = openFiles.find(f => f.path === filePath);
  if (existing) {
    activeFilePath.value = filePath;
    addTabToPane(fileTabId, targetPane);
    revealInTree(filePath);
    return;
  }
  fileLoading.value = true;
  activeFilePath.value = filePath;
  openFiles.push({ path: filePath, content: null, loading: true });
  addTabToPane(fileTabId, targetPane);
  send({ type: 'fs_read', path: filePath });
  revealInTree(filePath);

  if (pendingReads.has(filePath)) clearTimeout(pendingReads.get(filePath));
  pendingReads.set(filePath, setTimeout(() => {
    pendingReads.delete(filePath);
    const idx = openFiles.findIndex(f => f.path === filePath && f.loading);
    if (idx >= 0) openFiles[idx] = { path: filePath, error: 'Request timed out — server did not respond' };
    // Only clear global loading if no other files are pending
    if (pendingReads.size === 0) fileLoading.value = false;
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
  // Tell AreasSidebar to expand the FILES section
  window.dispatchEvent(new CustomEvent('relay-expand-files'));
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
  if (!wsState.connected) return; // Wait for WS — handleWsOpen will restore state
  send({ type: 'fs_list', path: '.' });
}
