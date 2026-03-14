// Pane store — manages split pane layout. Svelte 5 runes version.

const STORAGE_KEY = 'claude-relay-panes';
const MAX_PANES = 6;

// --- Persistence ---

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.panes?.length) return null;
    for (const p of data.panes) {
      if (!p.tabIds) p.tabIds = p.activeTabId ? [p.activeTabId] : ['__home__'];
    }
    return data;
  } catch { return null; }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      layout: paneLayout,
      panes,
      activePaneId: activePaneId.value,
    }));
  } catch {}
}

// --- State ---

const saved = loadSaved();

export const paneLayout = $state(saved?.layout || { direction: null, ratios: [1] });
export let panes = $state(saved?.panes || [{ id: 'pane-0', activeTabId: '__home__', tabIds: ['__home__'] }]);
export const activePaneId = $state({ value: saved?.activePaneId || 'pane-0' });

let paneCounter = 1;
if (saved?.panes) {
  for (const p of saved.panes) {
    const match = p.id.match(/^pane-(\d+)$/);
    if (match) paneCounter = Math.max(paneCounter, parseInt(match[1]) + 1);
  }
}

export let restoredFromStorage = !!saved;

// Persistence is done explicitly via saveState() calls in each mutation function.
// Do NOT use $effect for persistence — it causes effect_update_depth_exceeded
// when message bursts trigger cascading state updates.

// --- Public API ---

export function addTabToPane(tabId, paneId) {
  const targetPane = paneId || activePaneId.value;
  for (const p of panes) {
    if (p.id !== targetPane) continue;
    if (!p.tabIds.includes(tabId)) p.tabIds.push(tabId);
    p.activeTabId = tabId;
  }
  saveState();
}

export function setPaneTab(tabId, paneId) {
  const targetPane = paneId || activePaneId.value;
  for (const p of panes) {
    if (p.id === targetPane) p.activeTabId = tabId;
  }
  saveState();
}

export function switchPaneTab(paneId, tabId) {
  for (const p of panes) {
    if (p.id === paneId) p.activeTabId = tabId;
  }
  activePaneId.value = paneId;
  // Trigger stale replay if needed (imported lazily to avoid circular dep)
  if (_onPaneTabSwitch) _onPaneTabSwitch(tabId);
  saveState();
}

// Callback for tab switch — set by tabs.svelte.js to trigger stale replay
let _onPaneTabSwitch = null;
export function setOnPaneTabSwitch(fn) { _onPaneTabSwitch = fn; }

export function findPaneForTab(tabId) {
  return panes.find(p => p.tabIds.includes(tabId))?.id || null;
}

export function moveTabToPane(tabId, targetPaneId) {
  for (const p of panes) {
    if (p.id === targetPaneId) {
      if (!p.tabIds.includes(tabId)) p.tabIds.push(tabId);
      p.activeTabId = tabId;
    } else if (p.tabIds.includes(tabId)) {
      p.tabIds = p.tabIds.filter(id => id !== tabId);
      if (p.activeTabId === tabId) {
        p.activeTabId = p.tabIds.filter(id => id !== '__home__').pop() || '__home__';
      }
    }
  }
  activePaneId.value = targetPaneId;
  autoCloseEmptyPanes();
  saveState();
}

export function splitPane(tabId, direction = 'horizontal') {
  if (panes.length >= MAX_PANES) return;

  const newPaneId = 'pane-' + (paneCounter++);

  for (const p of panes) {
    if (!p.tabIds.includes(tabId)) continue;
    p.tabIds = p.tabIds.filter(id => id !== tabId);
    if (p.activeTabId === tabId) {
      p.activeTabId = p.tabIds.filter(id => id !== '__home__').pop() || '__home__';
    }
  }

  panes.push({ id: newPaneId, activeTabId: tabId, tabIds: [tabId] });

  const count = panes.length;
  Object.assign(paneLayout, { direction, ratios: Array(count).fill(1 / count) });
  activePaneId.value = newPaneId;
  autoCloseEmptyPanes();
  saveState();
}

export function closePane(paneId) {
  if (panes.length <= 1) return;

  const closingIdx = panes.findIndex(p => p.id === paneId);
  const mergeIdx = closingIdx > 0 ? closingIdx - 1 : 1;
  const closingPane = panes[closingIdx];
  const mergeTarget = panes[mergeIdx];

  // Merge tabs
  for (const tabId of closingPane.tabIds) {
    if (!mergeTarget.tabIds.includes(tabId)) mergeTarget.tabIds.push(tabId);
  }

  // Remove closing pane
  panes.splice(closingIdx, 1);

  const count = panes.length;
  Object.assign(paneLayout, count <= 1
    ? { direction: null, ratios: [1] }
    : { direction: paneLayout.direction || 'horizontal', ratios: Array(count).fill(1 / count) });

  if (activePaneId.value === paneId) activePaneId.value = mergeTarget.id;
  saveState();
}

export function onTabClosed(tabId) {
  for (const p of panes) {
    if (!p.tabIds.includes(tabId)) continue;
    const oldIdx = p.tabIds.indexOf(tabId);
    p.tabIds = p.tabIds.filter(id => id !== tabId);
    if (p.activeTabId === tabId) {
      const remaining = p.tabIds.filter(id => id !== '__home__');
      p.activeTabId = remaining.length > 0
        ? (p.tabIds[Math.min(oldIdx, p.tabIds.length - 1)] || remaining[0])
        : '__home__';
    }
  }
  autoCloseEmptyPanes();
}

function autoCloseEmptyPanes() {
  if (panes.length <= 1) return;
  const emptyPane = panes.find(p => p.tabIds.filter(id => id !== '__home__').length === 0);
  if (emptyPane) closePane(emptyPane.id);
}

export function pruneStaleTabsFromPanes(validTabIds) {
  let changed = false;
  for (const p of panes) {
    const cleaned = p.tabIds.filter(id => id === '__home__' || validTabIds.has(id));
    if (cleaned.length !== p.tabIds.length) {
      changed = true;
      p.tabIds = cleaned;
      if (!cleaned.includes(p.activeTabId)) {
        p.activeTabId = cleaned.filter(id => id !== '__home__').pop() || '__home__';
      }
    }
  }
  if (changed) autoCloseEmptyPanes();
  saveState();
}

export function renameTabInPanes(oldId, newId) {
  for (const p of panes) {
    p.tabIds = p.tabIds.map(id => id === oldId ? newId : id);
    if (p.activeTabId === oldId) p.activeTabId = newId;
  }
  saveState();
}

export function updateRatios(newRatios) {
  paneLayout.ratios = newRatios;
  saveState();
}

export function resetPanes() {
  panes.length = 0;
  panes.push({ id: 'pane-0', activeTabId: '__home__', tabIds: ['__home__'] });
  Object.assign(paneLayout, { direction: null, ratios: [1] });
  activePaneId.value = 'pane-0';
  saveState();
}
