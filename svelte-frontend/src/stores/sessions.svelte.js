// Session list store — manages the list of all sessions from the server.
// No message handling — session-router updates us directly.

import { send } from './ws.svelte.js';
import { openTab } from './tabs.svelte.js';

// Clean up stale localStorage
try { localStorage.removeItem('claude-relay-active-session'); } catch {}

// --- State ---

export let sessionList = $state([]); // full session list from server
export const activeSessionId = $state({ value: null }); // legacy — used by board components
export let homeVisible = $state(true);
export let boardVisible = $state(false);

// Pending new-session request IDs
export let pendingNewSessionRequests = $state(new Set());

// Session search
export const sessionSearchQuery = $state({ value: '' });
export const sessionSearchResults = $state({ value: null }); // null = no search
export const searchSeq = $state({ value: 0 });
let searchDebounce = null;

// --- Derived ---

let _activeSession = $derived(
  sessionList.find(s => s.id === activeSessionId.value) || null
);

export function getActiveSession() { return _activeSession; }

// --- Public API ---

export function switchSession(sessionId) {
  openTab(sessionId, 'Session');
}

export function createSession(accountId, openFullscreen = true, projectPath = null) {
  const requestId = crypto.randomUUID();
  if (openFullscreen) pendingNewSessionRequests.add(requestId);
  const msg = { type: 'new_session', accountId: accountId || undefined, _requestId: requestId };
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
  activeSessionId.value = null;
}

export function searchSessions(query) {
  sessionSearchQuery.value = query;
  if (searchDebounce) clearTimeout(searchDebounce);
  if (!query.trim()) {
    sessionSearchResults.value = null;
    return;
  }
  sessionSearchResults.value = null;
  searchDebounce = setTimeout(() => {
    searchSeq.value++;
    send({ type: 'search_sessions', query: query.trim(), _searchSeq: searchSeq.value });
  }, 200);
}
