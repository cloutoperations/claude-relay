// Unified session state — single source of truth for ALL session content.
// Tabs and popups derive from this. Rekey happens in one place.

import { processBufferedEvent, processLiveEvent, finishAssistantInArray } from './session-state-utils.js';

// Stale tabs — need lazy-replay when user clicks them
export let staleTabs = $state(new Set());

// All session data keyed by sessionId
// Shape: { [sessionId]: SessionState }
export let sessions = $state({});

// Rekey map: oldId → newId (so late-arriving messages route correctly)
export let rekeyMap = $state({});

// Replay buffers: { [sessionId]: { msgs, tasks, isStreaming, currentText } }
export let replayBuffers = $state({});

// --- Session state factory ---

export function createSessionState(sessionId, seedState) {
  return {
    sessionId,
    messages: seedState?.messages || [],
    processing: seedState?.processing || false,
    thinking: seedState?.thinking || false,
    activity: seedState?.activity || null,
    currentText: seedState?.currentText || '',
    isStreaming: seedState?.isStreaming || false,
    tasks: seedState?.tasks || [],
    loadingHistory: !seedState,
    sessionCost: seedState?.sessionCost || 0,
    status: seedState?.processing ? 'processing' : 'idle',
    rateLimited: false,
    rateLimitText: '',
    historyFrom: 0,      // first history index loaded (0 = from beginning)
    historyTotal: 0,     // total history entries on server
    loadingEarlier: false,
  };
}

// --- Resolve session ID through rekey map ---

export function resolveSessionId(id) {
  return rekeyMap[id] || id;
}

// --- Rekey: single atomic operation ---

export function rekeySession(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;

  // Record mapping for late-arriving messages
  rekeyMap[oldId] = newId;

  // Move session state
  const state = sessions[oldId];
  if (state) {
    state.sessionId = newId;
    sessions[newId] = state;
    delete sessions[oldId];
  }

  // Migrate replay buffer
  if (replayBuffers[oldId]) {
    replayBuffers[newId] = replayBuffers[oldId];
    delete replayBuffers[oldId];
  }
}

// --- Ensure session exists ---

export function ensureSession(sessionId, seedState) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = createSessionState(sessionId, seedState);
  }
  return sessions[sessionId];
}

// --- Remove session state ---

export function removeSessionState(sessionId) {
  delete sessions[sessionId];
  delete replayBuffers[sessionId];
  delete rekeyMap[sessionId];
  staleTabs.delete(sessionId);
}

// --- History replay ---

export function startHistoryReplay(sessionId, from, total) {
  replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
  const state = sessions[sessionId];
  if (state) {
    state.messages = [];
    if (typeof from === 'number') state.historyFrom = from;
    if (typeof total === 'number') state.historyTotal = total;
    state.loadingHistory = true;
  }
}

export function finishHistoryReplay(sessionId) {
  const buf = replayBuffers[sessionId];
  const state = sessions[sessionId];

  if (buf && state) {
    // Finalize any pending streaming in buffer
    if (buf.isStreaming && buf.currentText) {
      buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
    }
    state.messages = buf.msgs;
    state.tasks = buf.tasks;
    state.loadingHistory = false;
    state.isStreaming = false;
    state.currentText = '';
    // Don't reset processing/thinking — server sends status:processing after
    // history_done if session is still active. Resetting here causes a flicker
    // where the processing indicator disappears then reappears.
  } else if (state) {
    state.loadingHistory = false;
  }

  delete replayBuffers[sessionId];
}

// --- Prepend earlier history (from load_more_history response) ---

export function prependHistory(sessionId, items, meta) {
  const state = sessions[sessionId];
  if (!state) return;

  // Process items through the buffered event handler to build message objects
  const buf = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
  for (const item of items) {
    processBufferedEvent(buf, item, item.type);
  }
  // Finalize any trailing stream
  if (buf.isStreaming && buf.currentText) {
    buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
  }

  // Prepend to existing messages
  state.messages = [...buf.msgs, ...state.messages];
  state.historyFrom = meta.from;
  state.loadingEarlier = false;
}

// --- Route a single message to the correct session ---

export function routeToSession(sessionId, msg, msgType) {
  const state = sessions[sessionId];
  if (!state) return;

  // During history replay, buffer events
  const buf = replayBuffers[sessionId];
  if (buf) {
    processBufferedEvent(buf, msg, msgType);
    return;
  }

  // Live event — mutate state directly (Svelte 5 tracks it)
  processLiveEvent(state, msg, msgType);
}
