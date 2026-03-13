// UI state store — Svelte 5 runes version.

const SIDEBAR_KEY = 'claude-relay-sidebar-open';
const SIDEBAR_TAB_KEY = 'claude-relay-sidebar-tab';
const FILE_PANEL_KEY = 'claude-relay-file-panel-visible';

function loadBool(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function loadStr(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

// --- State ---
// Wrapped in objects because exported $state can't be reassigned.
// Components use .value for read/write.

export const sidebarOpen = $state({ value: loadBool(SIDEBAR_KEY, true) });
export const workspaceEnabled = $state({ value: false });
export const currentView = $state({ value: 'home' }); // 'home' | 'board' | 'session' | 'connect'
export const chatSearchQuery = $state({ value: '' });
export const filePanelVisible = $state({ value: loadBool(FILE_PANEL_KEY, true) });
export const activeSidebarTab = $state({ value: loadStr(SIDEBAR_TAB_KEY, 'sessions') });

// --- Persist on change ---

$effect.root(() => {
  $effect(() => { try { localStorage.setItem(SIDEBAR_KEY, sidebarOpen.value ? '1' : '0'); } catch {} });
  $effect(() => { try { localStorage.setItem(FILE_PANEL_KEY, filePanelVisible.value ? '1' : '0'); } catch {} });
  $effect(() => { try { localStorage.setItem(SIDEBAR_TAB_KEY, activeSidebarTab.value); } catch {} });
});
