// Unified session state — single source of truth for ALL session content.
// Tabs and popups derive from this. Rekey happens in one place.

import { processBufferedEvent, processLiveEvent, finishAssistantInArray } from './session-state-utils.js';
import { cacheSession, getCachedSession, removeCachedSession } from './message-cache.js';

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
    thinkingText: '',
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
    planMode: false,
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

// --- Try restoring from IndexedDB cache ---

export async function restoreFromCache(sessionId) {
  const cached = await getCachedSession(sessionId);
  if (!cached || !cached.messages || cached.messages.length === 0) return false;

  const state = sessions[sessionId];
  if (!state) return false;

  // Don't overwrite if server history replay already loaded messages
  // (the async cache restore can race with the synchronous replay)
  if (state.messages.length > 0 && !state.loadingHistory) return true;

  state.messages = cached.messages;
  state.tasks = cached.tasks || [];
  state.historyFrom = cached.historyFrom || 0;
  state.historyTotal = cached.historyTotal || 0;
  state.loadingHistory = false;
  return true;
}

// --- Remove session state ---

export function removeSessionState(sessionId) {
  delete sessions[sessionId];
  delete replayBuffers[sessionId];
  delete rekeyMap[sessionId];
  removeCachedSession(sessionId);
  staleTabs.delete(sessionId);
  // Cleanup is also needed in ambient store, but it's imported by session-router
  // which calls cleanupAmbient(sessionId) separately to avoid circular deps.
}

// --- History replay ---

export function startHistoryReplay(sessionId, from, total, suppressSkeleton) {
  replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
  const state = sessions[sessionId];
  if (state) {
    if (typeof from === 'number') state.historyFrom = from;
    if (typeof total === 'number') state.historyTotal = total;
    if (suppressSkeleton || state.messages.length > 0) {
      // Keep existing messages visible while replay buffers silently.
      // finishHistoryReplay will swap atomically — no flash.
      state.loadingHistory = false;
    } else {
      state.messages = [];
      state.loadingHistory = true;
    }
  }
  // Safety: if server never sends history_done, clean up buffer after 30s
  const sid = sessionId;
  setTimeout(() => {
    if (replayBuffers[sid]) {
      console.warn('[session-state] replay buffer timeout for', sid.substring(0, 8));
      finishHistoryReplay(sid);
    }
  }, 30000);
}

export function finishHistoryReplay(sessionId) {
  const buf = replayBuffers[sessionId];
  const state = sessions[sessionId];
  if (buf && state) {
    // Finalize any pending streaming in buffer
    if (buf.isStreaming && buf.currentText) {
      buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
    }
    // Finalize any stale "running" tools — if the session isn't actively processing,
    // they must have finished (their done/result event was lost or never recorded)
    if (!state.processing) {
      buf.msgs = buf.msgs.map(m =>
        m.type === 'tool' && m.status === 'running' ? { ...m, status: 'done' } : m
      );
    }
    state.messages = buf.msgs;
    state.tasks = buf.tasks;
    state.planMode = !!buf._planMode;
    state.loadingHistory = false;
    state.isStreaming = false;
    state.currentText = '';
    // Don't reset processing/thinking immediately — server sends status:processing
    // after history_done if session is still active. But if no status arrives within
    // 3s, force-clear to avoid stuck indicators after daemon restart.
    const sid = sessionId;
    setTimeout(() => {
      const s = sessions[sid];
      if (s && s.processing && s.status !== 'processing') {
        s.processing = false;
        s.thinking = false;
        s.activity = null;
        s.status = 'idle';
      }
    }, 3000);
  } else if (state) {
    state.loadingHistory = false;
  }

  delete replayBuffers[sessionId];

  // Cache to IndexedDB for instant restore
  if (state) {
    cacheSession(sessionId, {
      messages: state.messages,
      tasks: state.tasks,
      historyFrom: state.historyFrom,
      historyTotal: state.historyTotal,
    });
  }
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

  // Update cache
  cacheSession(sessionId, {
    messages: state.messages,
    tasks: state.tasks,
    historyFrom: state.historyFrom,
    historyTotal: state.historyTotal,
  });
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
