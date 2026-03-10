// File browser store — manages file tree, file viewer, and search
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';

// Tree data: path -> { loaded, children: [{name, type, path}] }
export const treeData = writable({});
export const expandedDirs = writable(new Set());
export const activeFile = writable(null); // { path, content, error, binary, imageUrl }
export const fileLoading = writable(false);
export const fileSearchResults = writable([]);
export const fileSearchQuery = writable('');

let searchDebounce = null;

export function toggleDir(dirPath) {
  const expanded = get(expandedDirs);
  const next = new Set(expanded);
  if (next.has(dirPath)) {
    next.delete(dirPath);
  } else {
    next.add(dirPath);
    // Request listing if not loaded
    const tree = get(treeData);
    if (!tree[dirPath]?.loaded) {
      send({ type: 'fs_list', path: dirPath });
    }
  }
  expandedDirs.set(next);
}

export function openFile(filePath) {
  fileLoading.set(true);
  activeFile.set(null);
  send({ type: 'fs_read', path: filePath });
}

export function closeFile() {
  activeFile.set(null);
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
    // Auto-expand root
    if (msg.path === '.') {
      expandedDirs.update(s => { s.add('.'); return new Set(s); });
    }
  } else if (msg.type === 'fs_read_result') {
    fileLoading.set(false);
    if (msg.error) {
      activeFile.set({ path: msg.path, error: msg.error });
    } else {
      activeFile.set({
        path: msg.path,
        content: msg.content || null,
        binary: msg.binary || false,
        imageUrl: msg.imageUrl || null,
        size: msg.size || 0,
      });
    }
  } else if (msg.type === 'fs_search_result') {
    fileSearchResults.set(msg.results || []);
  } else if (msg.type === 'fs_file_changed') {
    // Update open file if it matches
    const current = get(activeFile);
    if (current && current.path === msg.path) {
      activeFile.set({ ...current, content: msg.content });
    }
  }
});
