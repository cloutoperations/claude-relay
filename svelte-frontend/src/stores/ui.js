// UI state store
import { writable } from 'svelte/store';

const SIDEBAR_KEY = 'claude-relay-sidebar-open';
const SIDEBAR_TAB_KEY = 'claude-relay-sidebar-tab';
const FILE_PANEL_KEY = 'claude-relay-file-panel-visible';

function loadBool(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function loadStr(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function persistedBool(key, initial) {
  const store = writable(loadBool(key, initial));
  store.subscribe(v => { try { localStorage.setItem(key, v ? '1' : '0'); } catch {} });
  return store;
}

export const sidebarOpen = persistedBool(SIDEBAR_KEY, true);
export const workspaceEnabled = writable(false);
export const currentView = writable('home'); // 'home' | 'board' | 'session' | 'connect'

// Shared search query — set by Sidebar, consumed by SearchTimeline in chat area
export const chatSearchQuery = writable('');

// File panel visibility toggle (independent of whether files are open)
export const filePanelVisible = persistedBool(FILE_PANEL_KEY, true);

// Active sidebar tab — persisted so it survives refresh
export const activeSidebarTab = writable(loadStr(SIDEBAR_TAB_KEY, 'sessions'));
activeSidebarTab.subscribe(v => { try { localStorage.setItem(SIDEBAR_TAB_KEY, v); } catch {} });
