// Popup store — pure UI state. No message handling.
// Message content lives in session-state.svelte.js.

import { send } from './ws.svelte.js';
import { ensureSession, removeSessionState, sessions as sessionStates } from './session-state.svelte.js';
import { finishAssistantInArray } from './session-state-utils.js';
// Note: circular import with tabs.svelte.js — works via ES module hoisting.
// Uses getTabSessionIds() (lazy function call) to avoid accessing uninitialized exports.
import { getTabSessionIds } from './tabs.svelte.js';

const MAX_POPUPS = 20;
const STORAGE_KEY = 'claude-relay-popups';

// --- Popup UI state ---
// Shape: { [sessionId]: { title, minimized, hasUnread } }
export let popups = $state({});
export let popupOrder = $state([]);

// Suppress leaked untagged messages briefly after popup_message
export const popupMessageInFlight = $state({ value: false });
let popupFlightTimer = null;

// --- Persistence ---

export function saveLayout() {
  try {
    const layout = popupOrder
      .filter(id => popups[id])
      .map(id => ({
        sessionId: id,
        title: popups[id].title,
        minimized: popups[id].minimized,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

// --- Public API ---

export function openPopup(sessionId, title, initialState = null) {
  // Don't open if already a tab
  if (getTabSessionIds().has(sessionId)) return;

  // If already open, just un-minimize
  if (popups[sessionId]) {
    popups[sessionId].minimized = false;
    return;
  }

  // Enforce max
  const ids = Object.keys(popups);
  if (ids.length >= MAX_POPUPS) {
    const toClose = ids.find(id => popups[id].minimized) || ids[0];
    closePopup(toClose);
  }

  // Create session state in unified store
  ensureSession(sessionId, initialState);

  // Create popup UI state
  popups[sessionId] = {
    title: title || 'Session',
    minimized: false,
    hasUnread: false,
  };

  if (!popupOrder.includes(sessionId)) popupOrder.push(sessionId);

  send({ type: 'popup_open', sessionId });
  saveLayout();
}

export function closePopup(sessionId) {
  delete popups[sessionId];
  popupOrder.splice(0, popupOrder.length, ...popupOrder.filter(id => id !== sessionId));
  removeSessionState(sessionId);
  send({ type: 'popup_close', sessionId });
  saveLayout();
}

export function movePopup(sessionId, newIndex) {
  const filtered = popupOrder.filter(id => id !== sessionId);
  filtered.splice(newIndex, 0, sessionId);
  popupOrder.splice(0, popupOrder.length, ...filtered);
  saveLayout();
}

export function minimizeAll() {
  for (const id of Object.keys(popups)) {
    popups[id].minimized = true;
  }
  saveLayout();
}

export function toggleMinimize(sessionId) {
  const popup = popups[sessionId];
  if (!popup) return;
  popup.minimized = !popup.minimized;
  if (!popup.minimized) popup.hasUnread = false;
  saveLayout();
}

export function sendPopupMessage(sessionId, text) {
  if (!text.trim()) return;

  const state = sessionStates[sessionId];
  if (state) {
    // Finalize any in-flight streaming assistant message
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    state.messages.push({ type: 'user', text });
    state.processing = true;
    state.status = 'processing';
    state.thinking = true;
  }

  popupMessageInFlight.value = true;
  if (popupFlightTimer) clearTimeout(popupFlightTimer);
  popupFlightTimer = setTimeout(() => { popupMessageInFlight.value = false; }, 2000);

  send({ type: 'popup_message', sessionId, text });
}

export function sendPopupPermissionResponse(sessionId, requestId, decision) {
  send({ type: 'popup_permission_response', sessionId, requestId, decision });
}

export function stopPopupProcessing(sessionId) {
  send({ type: 'popup_stop', sessionId });
}

export function isPopupOpen(sessionId) {
  return !!popups[sessionId];
}

export function updatePopupTitle(sessionId, title) {
  if (popups[sessionId]) popups[sessionId].title = title;
}

export function getOpenPopupIds() {
  return Object.keys(popups);
}

// --- Rekey helper (called by session-router) ---

export function onPopupRekey(oldId, newId) {
  const popup = popups[oldId];
  if (!popup) return;
  popups[newId] = popup;
  delete popups[oldId];
  popupOrder.splice(0, popupOrder.length, ...popupOrder.map(id => id === oldId ? newId : id));
}

