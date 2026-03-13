// Tab store — pure UI state. No message handling.
// Message content lives in session-state.svelte.js.

import { send } from './ws.svelte.js';
import { ensureSession, removeSessionState, sessions as sessionStates, staleTabs } from './session-state.svelte.js';
import { finishAssistantInArray } from './session-state-utils.js';
import { closePopup, isPopupOpen, popups, popupOrder } from './popups.svelte.js';
import { addTabToPane, setPaneTab, onTabClosed, renameTabInPanes, findPaneForTab, pruneStaleTabsFromPanes } from './panes.svelte.js';
import { showToast } from './toasts.svelte.js';

export const HOME_TAB = '__home__';
const STORAGE_KEY = 'claude-relay-tabs';

// --- Tab UI state ---
// Shape: { [sessionId]: { title, scrollPosition, draftText, hasUnread } }
export let tabs = $state({});
export const activeTabId = $state({ value: HOME_TAB });
export let tabOrder = $state([HOME_TAB]);

// Derived set for quick lookups (popups check this to avoid duplicates)
let _tabSessionIds = $derived.by(() => {
  const s = new Set();
  for (const id of Object.keys(tabs)) s.add(id);
  return s;
});

export function getTabSessionIds() { return _tabSessionIds; }

// --- Persistence ---

export function saveLayout() {
  try {
    const layout = {
      activeTabId: activeTabId.value,
      tabs: tabOrder
        .filter(id => id !== HOME_TAB && tabs[id])
        .map(id => ({
          sessionId: id,
          title: tabs[id].title,
          draftText: tabs[id].draftText || '',
        })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

// --- Public API ---

export function openTab(sessionId, title, seedState) {
  // If already open, just switch
  if (tabs[sessionId]) {
    activeTabId.value = sessionId;
    const paneId = findPaneForTab(sessionId);
    if (paneId) setPaneTab(sessionId, paneId);
    else addTabToPane(sessionId);
    saveLayout();
    return;
  }

  // Close popup if open (mutual exclusivity)
  if (isPopupOpen(sessionId)) {
    closePopup(sessionId);
  }

  // Create session state in unified store
  ensureSession(sessionId, seedState);

  // Create tab UI state
  tabs[sessionId] = {
    title: title || 'Session',
    scrollPosition: 0,
    draftText: '',
    hasUnread: false,
  };

  if (!tabOrder.includes(sessionId)) tabOrder.push(sessionId);
  activeTabId.value = sessionId;
  addTabToPane(sessionId);

  // Register with server
  if (seedState) {
    send({ type: 'tab_subscribe', sessionId, skip_history: true });
  } else {
    send({ type: 'tab_subscribe', sessionId });
  }

  // Safety net: clear loadingHistory after 10s
  setTimeout(() => {
    const state = sessionStates[sessionId];
    if (state?.loadingHistory) {
      state.loadingHistory = false;
    }
  }, 10000);

  saveLayout();
}

export function closeTab(sessionId) {
  if (sessionId === HOME_TAB) return;

  // Switch active tab if closing current
  if (activeTabId.value === sessionId) {
    const idx = tabOrder.indexOf(sessionId);
    activeTabId.value = tabOrder[idx + 1] || tabOrder[idx - 1] || HOME_TAB;
  }

  delete tabs[sessionId];
  tabOrder.splice(0, tabOrder.length, ...tabOrder.filter(id => id !== sessionId));
  onTabClosed(sessionId);

  // Unregister from server + clean up session state
  send({ type: 'tab_unsubscribe', sessionId });
  removeSessionState(sessionId);

  saveLayout();
}

export function switchTab(sessionId) {
  activeTabId.value = sessionId;
  if (tabs[sessionId]) tabs[sessionId].hasUnread = false;
  // If this tab was marked stale after reconnect, replay its history now
  if (staleTabs.has(sessionId)) {
    staleTabs.delete(sessionId);
    send({ type: 'tab_subscribe', sessionId });
  }
  saveLayout();
}

export function moveTab(sessionId, newIndex) {
  const filtered = tabOrder.filter(id => id !== sessionId);
  filtered.splice(newIndex, 0, sessionId);
  tabOrder.splice(0, tabOrder.length, ...filtered);
  saveLayout();
}

export function saveTabScroll(sessionId, scrollTop) {
  if (tabs[sessionId]) tabs[sessionId].scrollPosition = scrollTop;
}

export function saveTabDraft(sessionId, text) {
  if (tabs[sessionId]) tabs[sessionId].draftText = text;
}

export function updateTabTitle(sessionId, title) {
  if (tabs[sessionId]) tabs[sessionId].title = title;
}

// Send message from a tab
export function sendTabMessage(sessionId, text, images, pastes) {
  if (!text && (!images || images.length === 0)) return;

  const state = sessionStates[sessionId];
  if (!state) return;

  // Finalize any streaming assistant
  if (state.isStreaming && state.currentText) {
    state.messages = finishAssistantInArray(state.messages, state.currentText);
    state.isStreaming = false;
    state.currentText = '';
  }

  state.messages.push({ type: 'user', text: text || '', images: images || null, pastes: pastes || null });
  state.processing = true;
  state.thinking = true;

  if (tabs[sessionId]) tabs[sessionId].draftText = '';

  const msg = { type: 'popup_message', sessionId, text };
  if (images && images.length > 0) msg.images = images;
  if (pastes && pastes.length > 0) msg.pastes = pastes;
  send(msg);
}

export function stopTab(sessionId) {
  send({ type: 'popup_stop', sessionId });
}

// Pending fork requests — session-router checks this for session_switched
export let pendingForkRequests = $state(new Set());

export function forkTab(sessionId) {
  const requestId = crypto.randomUUID();
  pendingForkRequests.add(requestId);
  send({ type: 'fork_session', sessionId, _requestId: requestId });
}

export function sendTabPermissionResponse(sessionId, requestId, decision) {
  send({ type: 'popup_permission_response', sessionId, requestId, decision });
}

// Check if a session is open as a tab
export function isTabOpen(sessionId) {
  return !!tabs[sessionId];
}

// --- Rekey helper (called by session-router) ---

export function onTabRekey(oldId, newId) {
  const tab = tabs[oldId];
  if (!tab) return;
  tabs[newId] = tab;
  delete tabs[oldId];
  tabOrder.splice(0, tabOrder.length, ...tabOrder.map(id => id === oldId ? newId : id));
  if (activeTabId.value === oldId) activeTabId.value = newId;
}

// --- Promote/demote ---

export function promotePopupToTab(sessionId) {
  const popup = popups[sessionId];
  if (!popup) return;

  const title = popup.title || 'Session';

  // Snapshot session state before closePopup destroys it
  const state = sessionStates[sessionId];
  const snapshot = state ? {
    messages: [...state.messages],
    processing: state.processing,
    thinking: state.thinking,
    currentText: state.currentText,
    isStreaming: state.isStreaming,
    tasks: [...state.tasks],
    sessionCost: state.sessionCost,
  } : { messages: [], processing: false };

  closePopup(sessionId);

  // Restore with snapshot — no server re-download needed
  ensureSession(sessionId, snapshot);

  tabs[sessionId] = {
    title,
    scrollPosition: 0,
    draftText: '',
    hasUnread: false,
  };
  if (!tabOrder.includes(sessionId)) tabOrder.push(sessionId);
  activeTabId.value = sessionId;
  addTabToPane(sessionId);
  send({ type: 'tab_subscribe', sessionId, skip_history: true });
  saveLayout();
  showToast(`"${title}" moved to tab`);
}

export function demoteTabToPopup(sessionId) {
  const tab = tabs[sessionId];
  if (!tab) return;
  const title = tab.title;

  // Snapshot session state before closeTab destroys it
  const state = sessionStates[sessionId];
  const snapshot = state ? {
    messages: [...state.messages],
    processing: state.processing,
    thinking: state.thinking,
    currentText: state.currentText,
    isStreaming: state.isStreaming,
    tasks: [...state.tasks],
    sessionCost: state.sessionCost,
  } : { messages: [], processing: false };

  closeTab(sessionId);

  // Restore with snapshot
  ensureSession(sessionId, snapshot);
  popups[sessionId] = {
    title: title || 'Session',
    minimized: false,
    hasUnread: false,
  };
  if (!popupOrder.includes(sessionId)) popupOrder.push(sessionId);
  send({ type: 'popup_open', sessionId, skip_history: true });
}
