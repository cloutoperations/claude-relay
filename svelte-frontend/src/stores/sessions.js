// Session state store
import { writable, derived, get } from 'svelte/store';
import { onMessage, send } from './ws.js';

const STORAGE_KEY = 'claude-relay-active-session';

function loadActiveSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveActiveSession(id) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {}
}

export const sessions = writable([]);           // full session list from server
export const activeSessionId = writable(null);  // currently focused session (full-screen view)
export const homeVisible = writable(true);
export const boardVisible = writable(false);

// Only allow fullscreen when the user explicitly requests it via switchSession().
// The server sends session_switched on connect and on popup_open — we must ignore those.
let expectingSwitch = false;

// Flag to prevent chat reset during session ID re-keying (temp → real ID)
export let sessionRekeying = false;

// Restore fullscreen session on WS connect
let hasRestored = false;
onMessage((msg) => {
  if (msg.type !== '__ws_open') return;
  if (hasRestored) return;
  hasRestored = true;

  const saved = loadActiveSession();
  if (saved) {
    // Re-request the fullscreen switch
    switchSession(saved);
  }
});

// Derived: the active session object
export const activeSession = derived(
  [sessions, activeSessionId],
  ([$sessions, $id]) => $sessions.find(s => s.id === $id) || null
);

// Switch to full-screen view for a session (called from expand button)
export function switchSession(sessionId) {
  expectingSwitch = true;
  send({ type: 'switch_session', id: sessionId });
}

export function createSession(accountId, openFullscreen = true, projectPath = null) {
  if (openFullscreen) expectingSwitch = true;
  const msg = { type: 'new_session', accountId: accountId || undefined };
  if (projectPath) msg.projectPath = projectPath;
  send(msg);
}

export function deleteSession(sessionId) {
  send({ type: 'delete_session', id: sessionId });
}

export function renameSession(sessionId, title) {
  send({ type: 'rename_session', id: sessionId, title });
}

export function leaveSession() {
  send({ type: 'leave_session' });
  activeSessionId.set(null);
  expectingSwitch = false;
  saveActiveSession(null);
}

// Listen for session-related WS messages
onMessage((msg) => {
  if (msg.type === 'session_list') {
    sessions.set(msg.sessions || []);
  } else if (msg.type === 'session_switched') {
    if (!expectingSwitch) {
      // Not a user-initiated switch — ignore (popup_open, connect, etc.)
      return;
    }
    // Consume the expected switch, then re-arm the guard
    expectingSwitch = false;
    activeSessionId.set(msg.id);
    homeVisible.set(false);
    saveActiveSession(msg.id);
  } else if (msg.type === 'session_id') {
    // Session ID re-keyed (temp → real CLI ID)
    // Mark as re-key so chat store doesn't reset
    if (msg.oldId) {
      sessionRekeying = true;
      activeSessionId.update(id => id === msg.oldId ? msg.cliSessionId : id);
      sessions.update(list => list.map(s =>
        s.id === msg.oldId ? { ...s, id: msg.cliSessionId, cliSessionId: msg.cliSessionId } : s
      ));
      sessionRekeying = false;
      saveActiveSession(get(activeSessionId));
    }
  }
});
