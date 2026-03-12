// File browser store — manages file tree, file viewer (tabbed), and search
import { writable, derived, get } from 'svelte/store';
import { onMessage, send } from './ws.js';
import { filePanelVisible } from './ui.js';

const TABS_KEY = 'claude-relay-file-tabs';
const ACTIVE_TAB_KEY = 'claude-relay-active-tab';

function loadSavedTabs() {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function loadSavedActiveTab() {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) || null;
  } catch { return null; }
}

function saveTabs(files, activePath) {
  try {
    const paths = files.map(f => f.path);
    localStorage.setItem(TABS_KEY, JSON.stringify(paths));
    localStorage.setItem(ACTIVE_TAB_KEY, activePath || '');
  } catch {}
}

// Tree data: path -> { loaded, children: [{name, type, path}] }
export const treeData = writable({});
export const expandedDirs = writable(new Set());

// Tabbed file viewer
export const openFiles = writable([]);       // [{ path, content, error, binary, imageUrl, size }]
export const activeFilePath = writable(null); // path of currently visible tab

// Derived: the active file object (for backward compat & convenience)
export const activeFile = derived(
  [openFiles, activeFilePath],
  ([$openFiles, $path]) => $openFiles.find(f => f.path === $path) || null
);

// Derived: whether any files are open (used by App.svelte to show file viewer)
export const hasOpenFiles = derived(openFiles, ($f) => $f.length > 0);

export const fileLoading = writable(false);
export const fileSearchResults = writable([]);
export const fileSearchQuery = writable('');

let searchDebounce = null;
// Track pending file reads for timeout handling
const pendingReads = new Map(); // path -> timeoutId

// Only persist after initial restore is done, so we don't overwrite saved state with empty defaults
let persistEnabled = false;
openFiles.subscribe($files => {
  if (persistEnabled) saveTabs($files, get(activeFilePath));
});
activeFilePath.subscribe($path => {
  if (persistEnabled) saveTabs(get(openFiles), $path);
});

// Restore tabs on WS connect
let hasRestored = false;
onMessage((msg) => {
  if (msg.type !== '__ws_open') return;
  if (hasRestored) return;
  hasRestored = true;

  const savedPaths = loadSavedTabs();
  const savedActive = loadSavedActiveTab();
  if (savedPaths.length > 0) {
    const placeholders = savedPaths.map(p => ({ path: p, content: null, loading: true }));
    openFiles.set(placeholders);
    activeFilePath.set(savedActive && savedPaths.includes(savedActive) ? savedActive : savedPaths[0]);
    for (const p of savedPaths) {
      send({ type: 'fs_read', path: p });
      // Timeout for restored tabs too
      pendingReads.set(p, setTimeout(() => {
        pendingReads.delete(p);
        openFiles.update(files => {
          const idx = files.findIndex(f => f.path === p && f.loading);
          if (idx >= 0) {
            const next = [...files];
            next[idx] = { path: p, error: 'Request timed out' };
            return next;
          }
          return files;
        });
      }, 10000));
    }
    if (savedActive) revealInTree(savedActive);
  }
  persistEnabled = true;
});

export function toggleDir(dirPath) {
  const expanded = get(expandedDirs);
  const next = new Set(expanded);
  if (next.has(dirPath)) {
    next.delete(dirPath);
  } else {
    next.add(dirPath);
    const tree = get(treeData);
    if (!tree[dirPath]?.loaded) {
      send({ type: 'fs_list', path: dirPath });
    }
  }
  expandedDirs.set(next);
}

// Auto-expand parent directories so a file is visible in the tree
// File paths are like "src/lib/foo.js", tree root is "."
// Parent dirs: ".", "src", "src/lib"
export function revealInTree(filePath) {
  if (!filePath) return;
  const parts = filePath.split('/');
  const parents = ['.'];
  for (let i = 0; i < parts.length - 1; i++) {
    parents.push(parts.slice(0, i + 1).join('/'));
  }
  const expanded = get(expandedDirs);
  const next = new Set(expanded);
  const tree = get(treeData);
  for (const p of parents) {
    next.add(p);
    if (!tree[p]?.loaded) {
      send({ type: 'fs_list', path: p });
    }
  }
  expandedDirs.set(next);
}

export function openFile(filePath) {
  // Ensure file panel is visible when opening a file
  filePanelVisible.set(true);

  const files = get(openFiles);
  const existing = files.find(f => f.path === filePath);
  if (existing) {
    activeFilePath.set(filePath);
    revealInTree(filePath);
    return;
  }
  fileLoading.set(true);
  activeFilePath.set(filePath);
  openFiles.update(f => [...f, { path: filePath, content: null, loading: true }]);
  send({ type: 'fs_read', path: filePath });
  revealInTree(filePath);

  // Timeout: if server doesn't respond in 10s, show error
  if (pendingReads.has(filePath)) clearTimeout(pendingReads.get(filePath));
  pendingReads.set(filePath, setTimeout(() => {
    pendingReads.delete(filePath);
    openFiles.update(files => {
      const idx = files.findIndex(f => f.path === filePath && f.loading);
      if (idx >= 0) {
        const next = [...files];
        next[idx] = { path: filePath, error: 'Request timed out — server did not respond' };
        return next;
      }
      return files;
    });
    fileLoading.set(false);
  }, 10000));
}

export function closeFileTab(filePath) {
  const files = get(openFiles);
  const idx = files.findIndex(f => f.path === filePath);
  if (idx === -1) return;

  const next = files.filter(f => f.path !== filePath);
  openFiles.set(next);

  if (get(activeFilePath) === filePath) {
    if (next.length === 0) {
      activeFilePath.set(null);
    } else {
      const newIdx = Math.min(idx, next.length - 1);
      activeFilePath.set(next[newIdx].path);
    }
  }
}

export function switchTab(filePath) {
  activeFilePath.set(filePath);
  revealInTree(filePath);
}

export function closeFile() {
  openFiles.set([]);
  activeFilePath.set(null);
}

export function searchFiles(query) {
  fileSearchQuery.set(query);
  if (searchDebounce) clearTimeout(searchDebounce);
  if (!query.trim()) {
    fileSearchResults.set([]);
    return;
  }
  searchDebounce = setTimeout(() => {
    send({ type: 'fs_search', query: query.trim() });
  }, 150);
}

export function loadRootDir() {
  send({ type: 'fs_list', path: '.' });
}

// Handle server responses
onMessage((msg) => {
  if (msg.type === 'fs_list_result') {
    treeData.update(t => ({
      ...t,
      [msg.path]: { loaded: true, children: msg.entries || [] }
    }));
    if (msg.path === '.') {
      expandedDirs.update(s => { s.add('.'); return new Set(s); });
    }
  } else if (msg.type === 'fs_read_result') {
    // Clear timeout for this file
    if (pendingReads.has(msg.path)) {
      clearTimeout(pendingReads.get(msg.path));
      pendingReads.delete(msg.path);
    }
    fileLoading.set(false);
    const fileData = msg.error
      ? { path: msg.path, error: msg.error }
      : { path: msg.path, content: msg.content || null, binary: msg.binary || false, imageUrl: msg.imageUrl || null, size: msg.size || 0 };

    openFiles.update(files => {
      const idx = files.findIndex(f => f.path === msg.path);
      if (idx >= 0) {
        const next = [...files];
        next[idx] = fileData;
        return next;
      }
      return files;
    });
  } else if (msg.type === 'fs_search_result') {
    fileSearchResults.set(msg.results || []);
  } else if (msg.type === 'fs_file_changed') {
    openFiles.update(files => {
      const idx = files.findIndex(f => f.path === msg.path);
      if (idx >= 0) {
        const next = [...files];
        next[idx] = { ...next[idx], content: msg.content };
        return next;
      }
      return files;
    });
  }
});
