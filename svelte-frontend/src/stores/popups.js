// Chat popup store — manages floating messenger-style session windows
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';
import { renderMarkdown } from '../utils/markdown.js';

const MAX_POPUPS = 5;
const STORAGE_KEY = 'claude-relay-popups';

// Map of sessionId -> popup state
// Each popup: { sessionId, title, minimized, processing, status, messages[], currentText, thinking }
export const popups = writable({});

// When a popup_message is sent, the server briefly routes untagged messages
// for that session. This flag tells chat.js to suppress those leaked messages.
export const popupMessageInFlight = writable(false);
let popupFlightTimer = null;

// --- Persistence ---
function saveLayout() {
  try {
    const current = get(popups);
    const layout = Object.values(current).map(p => ({
      sessionId: p.sessionId,
      title: p.title,
      minimized: p.minimized,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Restore popups when WS connects (page refresh or reconnect)
let hasRestored = false;
onMessage((msg) => {
  if (msg.type !== '__ws_open') return;
  // Only restore once per page load (not on reconnect)
  if (hasRestored) return;
  hasRestored = true;

  const layout = loadLayout();
  if (layout.length === 0) return;

  // Restore each popup after a short delay to let session_list arrive first
  setTimeout(() => {
    for (const item of layout) {
      openPopup(item.sessionId, item.title);
      if (item.minimized) {
        popups.update(p => p[item.sessionId]
          ? { ...p, [item.sessionId]: { ...p[item.sessionId], minimized: true } }
          : p
        );
      }
    }
  }, 500);
});

export function openPopup(sessionId, title, initialState = null) {
  const current = get(popups);

  // Already open? Un-minimize
  if (current[sessionId]) {
    popups.update(p => ({
      ...p,
      [sessionId]: { ...p[sessionId], minimized: false }
    }));
    return;
  }

  // Enforce max — close oldest minimized, or oldest open
  const ids = Object.keys(current);
  if (ids.length >= MAX_POPUPS) {
    const toClose = ids.find(id => current[id].minimized) || ids[0];
    closePopup(toClose);
  }

  // Create new popup state — seed from initialState if provided (e.g. fullscreen→popup)
  popups.update(p => ({
    ...p,
    [sessionId]: {
      sessionId,
      title: title || 'Session',
      minimized: false,
      processing: initialState?.processing || false,
      status: initialState?.processing ? 'processing' : 'idle',
      messages: initialState?.messages || [],
      currentText: initialState?.currentText || '',
      isStreaming: initialState?.isStreaming || false,
      thinking: initialState?.thinking || false,
      hasUnread: false,
      loadingHistory: !initialState, // only show loading if no seed data
    }
  }));

  // Tell server to start streaming this session
  // If we have initial state, server will still replay history —
  // popup_history_start will replace our seeded messages with the full replay
  send({ type: 'popup_open', sessionId });
  saveLayout();
}

export function closePopup(sessionId) {
  popups.update(p => {
    const next = { ...p };
    delete next[sessionId];
    return next;
  });
  send({ type: 'popup_close', sessionId });
  saveLayout();
}

export function minimizeAll() {
  popups.update(p => {
    const next = {};
    for (const id of Object.keys(p)) {
      next[id] = { ...p[id], minimized: true };
    }
    return next;
  });
  saveLayout();
}

export function toggleMinimize(sessionId) {
  popups.update(p => {
    const popup = p[sessionId];
    if (!popup) return p;
    const minimized = !popup.minimized;
    return {
      ...p,
      [sessionId]: {
        ...popup,
        minimized,
        hasUnread: minimized ? popup.hasUnread : false,
      }
    };
  });
  saveLayout();
}

export function sendPopupMessage(sessionId, text) {
  if (!text.trim()) return;

  popups.update(p => {
    const popup = p[sessionId];
    if (!popup) return p;
    return {
      ...p,
      [sessionId]: {
        ...popup,
        messages: [...popup.messages, { type: 'user', text }],
        processing: true,
        status: 'processing',
        thinking: true,
      }
    };
  });

  // Flag that a popup message is in-flight. The server temporarily switches
  // the active session during processing, which causes untagged status/thinking
  // messages to leak to chat.js. This flag suppresses those.
  popupMessageInFlight.set(true);
  if (popupFlightTimer) clearTimeout(popupFlightTimer);
  popupFlightTimer = setTimeout(() => popupMessageInFlight.set(false), 2000);

  send({ type: 'popup_message', sessionId, text });
}

export function sendPopupPermissionResponse(sessionId, requestId, decision) {
  send({ type: 'popup_permission_response', sessionId, requestId, decision });
}

export function stopPopupProcessing(sessionId) {
  send({ type: 'popup_stop', sessionId });
}

export function getOpenPopupIds() {
  return Object.keys(get(popups));
}

export function updatePopupTitle(sessionId, title) {
  popups.update(p => {
    if (!p[sessionId]) return p;
    return { ...p, [sessionId]: { ...p[sessionId], title } };
  });
}

// --- Route incoming WS messages to popups ---

function finishAssistant(popup) {
  if (!popup.isStreaming) return popup;
  return { ...popup, isStreaming: false, currentText: '' };
}

function toolNameLabel(name) {
  const map = {
    Read: 'Reading file', Edit: 'Editing file', Write: 'Writing file',
    Bash: 'Running command', Glob: 'Searching files', Grep: 'Searching code',
    Agent: 'Running agent', WebSearch: 'Searching web', WebFetch: 'Fetching URL',
  };
  return map[name] || name;
}

onMessage((msg) => {
  // Only handle popup-tagged messages
  if (!msg._popupSessionId && msg.type !== 'popup_history_start' && msg.type !== 'popup_history_done') return;

  const sessionId = msg._popupSessionId || msg.sessionId;
  if (!sessionId) return;

  popups.update(p => {
    const popup = p[sessionId];
    if (!popup) return p;

    let updated = { ...popup };
    const t = msg.type;

    if (t === 'popup_history_start') {
      updated.messages = [];
      updated.loadingHistory = true;
    } else if (t === 'popup_history_done') {
      updated.loadingHistory = false;
      updated = finishAssistant(updated);
    } else if (t === 'user_message') {
      updated = finishAssistant(updated);
      updated.messages = [...updated.messages, { type: 'user', text: msg.text || '' }];
    } else if (t === 'delta' || t === 'assistant_delta') {
      updated.thinking = false;
      const delta = msg.text || msg.delta || '';
      if (!updated.isStreaming) {
        updated.isStreaming = true;
        updated.currentText = delta;
        updated.messages = [...updated.messages, { type: 'assistant', text: delta, streaming: true }];
      } else {
        updated.currentText += delta;
        // Update last assistant message
        const msgs = [...updated.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.type === 'assistant' && last.streaming) {
          msgs[msgs.length - 1] = { ...last, text: updated.currentText };
          updated.messages = msgs;
        }
      }
    } else if (t === 'thinking_start') {
      updated.thinking = true;
    } else if (t === 'thinking_delta') {
      // keep alive
    } else if (t === 'thinking_stop') {
      updated.thinking = false;
    } else if (t === 'tool_start') {
      updated.thinking = false;
      updated = finishAssistant(updated);
      updated.messages = [...updated.messages, {
        type: 'tool', name: toolNameLabel(msg.name || msg.toolName || 'tool'),
        status: 'running', toolId: msg.id || msg.toolUseId,
      }];
    } else if (t === 'tool_executing') {
      // update tool
      const msgs = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === msg.id ? { ...m, status: 'running' } : m
      );
      updated.messages = msgs;
    } else if (t === 'tool_result') {
      const msgs = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, status: msg.is_error ? 'error' : 'done' }
          : m
      );
      updated.messages = msgs;
    } else if (t === 'permission_request' || t === 'permission_request_pending') {
      updated = finishAssistant(updated);
      updated.status = 'permission';
      if (updated.minimized) updated.hasUnread = true;
      const inputSummary = msg.toolInput
        ? (msg.toolInput.command || msg.toolInput.file_path || msg.toolInput.path || '')
        : '';
      updated.messages = [...updated.messages, {
        type: 'permission', requestId: msg.requestId,
        toolName: msg.toolName || 'tool', inputSummary, resolved: false,
      }];
    } else if (t === 'permission_resolved' || t === 'permission_cancel') {
      const decision = msg.decision || 'cancel';
      updated.messages = updated.messages.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision }
          : m
      );
      updated.status = updated.processing ? 'processing' : 'idle';
    } else if (t === 'ask_user') {
      updated = finishAssistant(updated);
      updated.messages = [...updated.messages, {
        type: 'info', text: 'Claude is asking: ' + (msg.question || ''),
      }];
    } else if (t === 'status') {
      updated.processing = msg.status === 'processing';
      updated.status = msg.status;
    } else if (t === 'result') {
      updated = finishAssistant(updated);
      updated.processing = false;
      if (popupFlightTimer) clearTimeout(popupFlightTimer);
      popupMessageInFlight.set(false);
    } else if (t === 'done') {
      updated = finishAssistant(updated);
      updated.processing = false;
      updated.thinking = false;
      updated.status = 'idle';
      if (updated.minimized) updated.hasUnread = true;
      // Clear the in-flight flag — response cycle complete
      if (popupFlightTimer) clearTimeout(popupFlightTimer);
      popupMessageInFlight.set(false);
    } else if (t === 'error') {
      updated = finishAssistant(updated);
      updated.messages = [...updated.messages, {
        type: 'info', text: 'Error: ' + (msg.text || msg.message || 'Unknown error'),
      }];
      if (updated.minimized) updated.hasUnread = true;
    } else if (t === 'compacting') {
      updated.messages = [...updated.messages, { type: 'info', text: 'Compacting context...' }];
    } else if (t === 'subagent_activity') {
      updated.messages = [...updated.messages, {
        type: 'tool', name: 'Agent: ' + (msg.title || 'subagent'),
        status: 'running', toolId: msg.agentId,
      }];
    } else if (t === 'subagent_done') {
      updated.messages = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === msg.agentId ? { ...m, status: 'done' } : m
      );
    }
    // Ignore: history_meta, context_usage, message_uuid, session_list, client_count, etc.

    return { ...p, [sessionId]: updated };
  });
});
