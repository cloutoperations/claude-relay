// Tab store — manages IDE-style session tabs
// Uses the popup WS protocol (popup_open/popup_close + _popupSessionId tagging)
// so zero server changes are needed.
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';
import { closePopup, popups } from './popups.js';
import { processBufferedEvent, processLiveEvent, finishAssistantInArray } from './session-state-utils.js';

const STORAGE_KEY = 'claude-relay-tabs';
const HOME_TAB = '__home__';

// Exported set for popups.js to check — avoids circular import
// (popups.js can import just this Set without importing the full tabs store)
export const tabSessionIds = new Set();

// --- Store ---
// Map of sessionId -> tab state
export const tabs = writable({});
export const activeTabId = writable(HOME_TAB);
export const tabOrder = writable([HOME_TAB]); // ordered list of tab IDs

// Keep tabSessionIds in sync
tabs.subscribe(t => {
  tabSessionIds.clear();
  for (const id of Object.keys(t)) {
    tabSessionIds.add(id);
  }
});

// --- Persistence ---
function saveLayout() {
  try {
    const order = get(tabOrder);
    const current = get(tabs);
    const layout = {
      activeTabId: get(activeTabId),
      tabs: order
        .filter(id => id !== HOME_TAB && current[id])
        .map(id => ({
          sessionId: id,
          title: current[id].title,
          draftText: current[id].draftText || '',
        })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// --- Tab state factory ---
function createTabState(sessionId, title, seedState) {
  return {
    sessionId,
    title: title || 'Session',
    messages: seedState?.messages || [],
    processing: seedState?.processing || false,
    thinking: seedState?.thinking || false,
    activity: seedState?.activity || null,
    currentText: seedState?.currentText || '',
    isStreaming: seedState?.isStreaming || false,
    tasks: seedState?.tasks || [],
    loadingHistory: !seedState,
    scrollPosition: 0,
    draftText: seedState?.draftText || '',
    sessionCost: seedState?.sessionCost || 0,
    status: seedState?.processing ? 'processing' : 'idle',
    hasUnread: false,
  };
}

// --- Public API ---

export function openTab(sessionId, title, seedState) {
  const current = get(tabs);

  // If already open as tab, just switch to it
  if (current[sessionId]) {
    activeTabId.set(sessionId);
    saveLayout();
    return;
  }

  // Close popup if open (mutual exclusivity)
  const currentPopups = get(popups);
  if (currentPopups[sessionId]) {
    closePopup(sessionId);
  }

  // Create tab state
  tabs.update(t => ({
    ...t,
    [sessionId]: createTabState(sessionId, title, seedState),
  }));

  // Add to tab order (before updating activeTabId)
  tabOrder.update(order => {
    if (order.includes(sessionId)) return order;
    return [...order, sessionId];
  });

  activeTabId.set(sessionId);

  // Register with server via popup protocol (unless seeded — already has data)
  if (!seedState) {
    send({ type: 'popup_open', sessionId });
  }

  saveLayout();
}

export function closeTab(sessionId) {
  if (sessionId === HOME_TAB) return; // can't close home

  const order = get(tabOrder);
  const currentActive = get(activeTabId);

  // If closing the active tab, switch to adjacent
  if (currentActive === sessionId) {
    const idx = order.indexOf(sessionId);
    const nextId = order[idx + 1] || order[idx - 1] || HOME_TAB;
    activeTabId.set(nextId);
  }

  tabs.update(t => {
    const next = { ...t };
    delete next[sessionId];
    return next;
  });

  tabOrder.update(order => order.filter(id => id !== sessionId));

  // Unregister from server
  send({ type: 'popup_close', sessionId });

  // Clean up replay buffer
  delete replayBuffers[sessionId];

  saveLayout();
}

export function switchTab(sessionId) {
  activeTabId.set(sessionId);
  saveLayout();
}

export function moveTab(sessionId, newIndex) {
  tabOrder.update(order => {
    const filtered = order.filter(id => id !== sessionId);
    filtered.splice(newIndex, 0, sessionId);
    return filtered;
  });
  saveLayout();
}

// Save scroll position for a tab (called when switching away)
export function saveTabScroll(sessionId, scrollTop) {
  tabs.update(t => {
    if (!t[sessionId]) return t;
    return { ...t, [sessionId]: { ...t[sessionId], scrollPosition: scrollTop } };
  });
}

// Save draft text for a tab
export function saveTabDraft(sessionId, text) {
  tabs.update(t => {
    if (!t[sessionId]) return t;
    return { ...t, [sessionId]: { ...t[sessionId], draftText: text } };
  });
}

export function updateTabTitle(sessionId, title) {
  tabs.update(t => {
    if (!t[sessionId]) return t;
    return { ...t, [sessionId]: { ...t[sessionId], title } };
  });
}

// Send message from a tab
export function sendTabMessage(sessionId, text, images, pastes) {
  if (!text && (!images || images.length === 0)) return;

  // Add user message to tab state
  tabs.update(t => {
    const tab = t[sessionId];
    if (!tab) return t;
    // Finalize any streaming assistant
    let msgs = tab.messages;
    if (tab.isStreaming && tab.currentText) {
      msgs = finishAssistantInArray(msgs, tab.currentText);
    }
    return {
      ...t,
      [sessionId]: {
        ...tab,
        messages: [...msgs, { type: 'user', text: text || '', images: images || null, pastes: pastes || null }],
        processing: true,
        thinking: true,
        isStreaming: false,
        currentText: '',
        draftText: '',
      }
    };
  });

  const msg = { type: 'popup_message', sessionId, text };
  if (images && images.length > 0) msg.images = images;
  if (pastes && pastes.length > 0) msg.pastes = pastes;
  send(msg);
}

export function stopTab(sessionId) {
  send({ type: 'popup_stop', sessionId });
}

export function sendTabPermissionResponse(sessionId, requestId, decision) {
  send({ type: 'popup_permission_response', sessionId, requestId, decision });
}

// Promote a popup to a tab
export function promotePopupToTab(sessionId) {
  const currentPopups = get(popups);
  const popup = currentPopups[sessionId];
  if (!popup) return;

  // Snapshot popup state
  const seedState = {
    messages: popup.messages,
    processing: popup.processing,
    thinking: popup.thinking,
    currentText: popup.currentText || '',
    isStreaming: popup.isStreaming || false,
    tasks: popup.tasks || [],
    draftText: '',
  };

  // Close popup (sends popup_close to server)
  closePopup(sessionId);

  // Open as tab with seeded state (sends popup_open to server)
  // We need to re-register since closePopup sent popup_close
  tabs.update(t => ({
    ...t,
    [sessionId]: createTabState(sessionId, popup.title, seedState),
  }));

  tabOrder.update(order => {
    if (order.includes(sessionId)) return order;
    return [...order, sessionId];
  });

  activeTabId.set(sessionId);
  send({ type: 'popup_open', sessionId });
  saveLayout();
}

// Check if a session is open as a tab
export function isTabOpen(sessionId) {
  return !!get(tabs)[sessionId];
}

// --- History replay buffering ---
const replayBuffers = {};

function getReplayBuffer(sessionId) {
  if (!replayBuffers[sessionId]) {
    replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
  }
  return replayBuffers[sessionId];
}

// --- WS message routing ---

onMessage((msg) => {
  // Handle history start/done for tabs
  if (msg.type === 'popup_history_start' || msg.type === 'popup_history_done') {
    const sessionId = msg.sessionId;
    if (!sessionId) return;
    const current = get(tabs);
    if (!current[sessionId]) return; // not our tab

    if (msg.type === 'popup_history_start') {
      replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
      tabs.update(t => {
        const tab = t[sessionId];
        if (!tab) return t;
        return { ...t, [sessionId]: { ...tab, messages: [], loadingHistory: true } };
      });
      return;
    }

    if (msg.type === 'popup_history_done') {
      const buf = replayBuffers[sessionId];
      if (buf) {
        // Finalize any pending streaming
        if (buf.isStreaming && buf.currentText) {
          buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
        }
        tabs.update(t => {
          const tab = t[sessionId];
          if (!tab) return t;
          return {
            ...t,
            [sessionId]: {
              ...tab,
              messages: buf.msgs,
              tasks: buf.tasks,
              loadingHistory: false,
              isStreaming: false,
              currentText: '',
            }
          };
        });
        delete replayBuffers[sessionId];
      } else {
        tabs.update(t => {
          const tab = t[sessionId];
          if (!tab) return t;
          return { ...t, [sessionId]: { ...tab, loadingHistory: false } };
        });
      }
      return;
    }
  }

  // Only handle messages tagged with _popupSessionId
  if (!msg._popupSessionId) return;

  const sessionId = msg._popupSessionId;
  const current = get(tabs);
  if (!current[sessionId]) return; // not our tab — let popups handle it

  const t = msg.type;

  // During history replay, buffer events
  const buf = replayBuffers[sessionId];
  if (buf) {
    processBufferedEvent(buf, msg, t);
    return;
  }

  // Live events — update tab state
  tabs.update(allTabs => {
    const tab = allTabs[sessionId];
    if (!tab) return allTabs;

    // Clone tab state for mutation
    const updated = { ...tab, messages: [...tab.messages] };
    processLiveEvent(updated, msg, t);

    // Mark unread if not the active tab
    if (get(activeTabId) !== sessionId && t === 'done') {
      updated.hasUnread = true;
    }

    return { ...allTabs, [sessionId]: updated };
  });
});

// Session re-key handler (temp ID -> real CLI ID)
onMessage((msg) => {
  if (!msg._popupSessionId || msg.type !== 'session_id') return;
  const sessionId = msg._popupSessionId;
  const newId = msg.cliSessionId;
  if (!newId || newId === sessionId) return;

  const current = get(tabs);
  if (!current[sessionId]) return; // not our tab

  tabs.update(t => {
    const tab = t[sessionId];
    if (!tab) return t;
    const next = { ...t };
    delete next[sessionId];
    next[newId] = { ...tab, sessionId: newId };
    return next;
  });

  tabOrder.update(order => order.map(id => id === sessionId ? newId : id));

  if (get(activeTabId) === sessionId) {
    activeTabId.set(newId);
  }

  saveLayout();
});

// --- Restore tabs on WS connect ---
let hasRestored = false;

onMessage((msg) => {
  if (msg.type !== '__ws_open') return;

  // Clear all replay buffers on reconnect
  for (const key of Object.keys(replayBuffers)) {
    delete replayBuffers[key];
  }

  if (hasRestored) return;
  hasRestored = true;

  const layout = loadLayout();
  if (!layout || !layout.tabs || layout.tabs.length === 0) return;

  setTimeout(() => {
    for (const item of layout.tabs) {
      // Create tab state (will load history from server)
      tabs.update(t => ({
        ...t,
        [item.sessionId]: createTabState(item.sessionId, item.title, null),
      }));

      tabOrder.update(order => {
        if (order.includes(item.sessionId)) return order;
        return [...order, item.sessionId];
      });

      // Register with server
      send({ type: 'popup_open', sessionId: item.sessionId });
    }

    // Restore active tab
    if (layout.activeTabId && layout.activeTabId !== HOME_TAB) {
      const currentTabs = get(tabs);
      if (currentTabs[layout.activeTabId]) {
        activeTabId.set(layout.activeTabId);
      }
    }
  }, 300);
});

// Update tab titles when session list changes
onMessage((msg) => {
  if (msg.type !== 'session_list') return;
  const current = get(tabs);
  const openIds = Object.keys(current);
  if (openIds.length === 0) return;

  for (const s of (msg.sessions || [])) {
    if (openIds.includes(s.id) && s.title) {
      updateTabTitle(s.id, s.title);
    }
  }
});
