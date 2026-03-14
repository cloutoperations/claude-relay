// Session router — single message handler, owns all routing logic.
// Replaces the scattered onMessage() handlers in old tabs.js/popups.js/chat.js/sessions.js/ambient.js.

import { wsState, send, setOnMessage } from './ws.svelte.js';
import {
  sessions as sessionStates, resolveSessionId, rekeySession,
  ensureSession, removeSessionState, replayBuffers, staleTabs,
  startHistoryReplay, finishHistoryReplay, routeToSession, prependHistory, restoreFromCache,
} from './session-state.svelte.js';
import {
  tabs, activeTabId, tabOrder, getTabSessionIds, onTabRekey,
  saveLayout as saveTabLayout, HOME_TAB, pendingForkRequests,
} from './tabs.svelte.js';
import {
  popups, popupOrder, isPopupOpen, onPopupRekey,
  saveLayout as savePopupLayout,
} from './popups.svelte.js';
import { renameTabInPanes, panes as paneList, addTabToPane } from './panes.svelte.js';
import { sessionList, pendingNewSessionRequests, searchSeq, sessionSearchQuery, sessionSearchResults } from './sessions.svelte.js';
import { contextData, sessionCost, projectInfo, clientCount, slashCommands, modelInfo, rateLimitState } from './chat.svelte.js';
import { ambientState } from './ambient.svelte.js';
import { routeFileMessage } from './files.svelte.js';

// staleTabs is imported from session-state.svelte.js to avoid circular deps

// --- Main message router ---
// This $effect fires on every new incoming message.

// Register as the WS message handler — called directly by ws.svelte.js on every message.
// This replaces $effect on wsState.incoming which caused effect_update_depth_exceeded
// (the effect read incoming AND wrote to tabs/sessions/etc, creating an infinite loop).
setOnMessage(handleIncoming);

function handleIncoming(msg) {

    const t = msg.type;

    // --- WS lifecycle ---
    if (t === '__ws_open') {
      handleReconnect();
      routeFileMessage(msg);
      return;
    }
    if (t === '__ws_close') return;

    // --- File system messages ---
    if (t === 'fs_list_result' || t === 'fs_read_result' || t === 'fs_search_result' || t === 'fs_file_changed') {
      routeFileMessage(msg);
      return;
    }

    // --- Global broadcasts (no _popupSessionId) ---
    if (!msg._popupSessionId) {
      routeGlobalMessage(msg, t);
    }

    // --- History start/done ---
    if (t === 'popup_history_start' || t === 'tab_history_start') {
      const sessionId = resolveSessionId(msg.sessionId);
      if (!sessionId || !sessionStates[sessionId]) {
        console.warn('[router] history_start dropped — no session state for', msg.sessionId?.substring(0, 12), 'resolved:', sessionId?.substring(0, 12));
        return;
      }
      startHistoryReplay(sessionId, msg.from, msg.total);
      return;
    }

    if (t === 'popup_history_done' || t === 'tab_history_done') {
      const sessionId = resolveSessionId(msg.sessionId);
      if (!sessionId || !sessionStates[sessionId]) {
        console.warn('[router] history_done dropped — no session state for', msg.sessionId?.substring(0, 12), 'resolved:', sessionId?.substring(0, 12));
        return;
      }
      console.log('[router] history_done OK for', sessionId.substring(0, 12));
      finishHistoryReplay(sessionId);
      return;
    }

    // --- History prepend (load more earlier messages) ---
    if (t === 'history_prepend') {
      const sessionId = msg.sessionId ? resolveSessionId(msg.sessionId) : null;
      if (sessionId && sessionStates[sessionId] && msg.items) {
        prependHistory(sessionId, msg.items, msg.meta || {});
      }
      return;
    }

    // --- Session-tagged messages ---
    if (msg._popupSessionId) {
      const sessionId = resolveSessionId(msg._popupSessionId);
      if (!sessionStates[sessionId]) return;

      // Route to unified session state
      routeToSession(sessionId, msg, t);

      // Mark unread on tab if not active
      if (tabs[sessionId] && activeTabId.value !== sessionId && t === 'done') {
        tabs[sessionId].hasUnread = true;
      }

      // Mark unread on popup if minimized
      if (popups[sessionId]?.minimized && (t === 'done' || t === 'error' || t === 'permission_request' || t === 'permission_request_pending')) {
        popups[sessionId].hasUnread = true;
      }
    }

    // --- Session rekey ---
    if (t === 'session_id') {
      handleRekey(msg);
      return;
    }

    // --- Session list ---
    if (t === 'session_list') {
      sessionList.length = 0;
      sessionList.push(...(msg.sessions || []));
      // Update tab titles from session list
      for (const s of sessionList) {
        if (tabs[s.id] && s.title) {
          tabs[s.id].title = s.title;
        }
      }
      return;
    }

    // --- Search results ---
    if (t === 'search_results') {
      if (msg._searchSeq != null && msg._searchSeq !== searchSeq.value) return;
      if (msg.query !== sessionSearchQuery.value) return;
      sessionSearchResults.value = msg.results || [];
      return;
    }

    // --- New session created ---
    if (t === 'session_switched') {
      handleSessionSwitched(msg);
      return;
    }

    // --- Ambient events ---
    if (t === 'ambient') {
      const s = ambientState[msg.sessionId] || {};
      if (msg.event.type === 'status') s.status = msg.event.status;
      else if (msg.event.type === 'permission_request') { s.permissionRequest = msg.event; s.needsAttention = true; }
      else if (msg.event.type === 'done') { s.status = 'idle'; s.needsAttention = false; s.permissionRequest = null; s.askUser = null; }
      else if (msg.event.type === 'ask_user') { s.askUser = msg.event; s.needsAttention = true; }
      s.lastEventTime = Date.now();
      ambientState[msg.sessionId] = s;
      return;
    }
}

// --- Global message routing (untagged messages) ---

function routeGlobalMessage(msg, t) {
  switch (t) {
    case 'info':
      if (msg.cwd || msg.slug) {
        Object.assign(projectInfo, {
          name: msg.project || msg.cwd || '',
          cwd: msg.cwd || '',
          version: msg.version || '',
          slug: msg.slug || '',
          accounts: msg.accounts || [],
          debug: msg.debug || false,
          accountLabel: msg.accountLabel || '',
          dangerouslySkipPermissions: msg.dangerouslySkipPermissions || false,
        });
      }
      break;
    case 'client_count':
      clientCount.count = msg.count || 1;
      break;
    case 'slash_commands': {
      const builtins = new Set(['clear', 'rewind', 'context', 'usage', 'status']);
      slashCommands.length = 0;
      slashCommands.push(
        ...(msg.commands || [])
          .map(c => typeof c === 'string' ? { name: c, desc: '' } : c)
          .filter(c => !builtins.has(c.name))
          .map(c => ({ name: c.name, desc: c.desc || 'Command' }))
      );
      break;
    }
    case 'model_info':
      modelInfo.model = msg.model;
      modelInfo.models = msg.models || [];
      break;
    case 'context_usage':
      if (msg.max && msg.used) {
        Object.assign(contextData, { used: msg.used, max: msg.max, model: msg.model || '', percent: msg.percent || 0 });
      }
      break;
    case 'result':
      if (msg.cost != null) {
        sessionCost.total += (msg.cost || 0);
      }
      break;
    case 'rate_limit':
      // Global rate limit indicator for StatusBar
      if (rateLimitState.clearTimer) clearTimeout(rateLimitState.clearTimer);
      rateLimitState.active = true;
      rateLimitState.text = msg.text || 'Rate limited';
      rateLimitState.clearTimer = setTimeout(() => {
        rateLimitState.active = false;
        rateLimitState.text = '';
      }, 60000);
      break;
  }
}

// --- Rekey handler ---

function handleRekey(msg) {
  const oldId = msg._popupSessionId || msg.oldId;
  const newId = msg.cliSessionId;
  if (!oldId || !newId || oldId === newId) return;

  // Rekey unified session state (atomic)
  rekeySession(oldId, newId);

  // Update tab references
  if (tabs[oldId]) {
    onTabRekey(oldId, newId);
    renameTabInPanes(oldId, newId);
    // Re-register with server under new ID
    send({ type: 'tab_subscribe', sessionId: newId, skip_history: true });
    saveTabLayout();
  }

  // Update popup references
  if (popups[oldId]) {
    onPopupRekey(oldId, newId);
    savePopupLayout();
  }

  // Update session list
  for (let i = 0; i < sessionList.length; i++) {
    if (sessionList[i].id === oldId) {
      sessionList[i] = { ...sessionList[i], id: newId, cliSessionId: newId };
    }
  }
}

// --- Session switched (new session created) ---

function handleSessionSwitched(msg) {
  // Server auto-switch on connect (no _requestId) — ensure session state exists
  // so subsequent history replay has somewhere to route messages.
  // Don't open a tab — tab restore from localStorage handles that.
  if (!msg._requestId) {
    if (msg.id) ensureSession(msg.id, null);
    return;
  }
  // Check both regular new-session requests and fork requests
  const isPending = pendingNewSessionRequests.has(msg._requestId);
  const isFork = pendingForkRequests.has(msg._requestId);
  if (!isPending && !isFork) return;
  if (isPending) pendingNewSessionRequests.delete(msg._requestId);
  if (isFork) pendingForkRequests.delete(msg._requestId);

  // Import openTab dynamically to avoid circular dep at module level
  // Actually, we directly manipulate state here
  const sessionId = msg.id;

  // Create session state
  ensureSession(sessionId, { messages: [], processing: false });

  // Create tab
  tabs[sessionId] = {
    title: msg.title || 'New Session',
    scrollPosition: 0,
    draftText: '',
    hasUnread: false,
  };
  if (!tabOrder.includes(sessionId)) tabOrder.push(sessionId);
  activeTabId.value = sessionId;
  addTabToPane(sessionId);

  // Register with server
  send({ type: 'tab_subscribe', sessionId, skip_history: true });
  send({ type: 'leave_session' });
  saveTabLayout();
}

// --- Reconnect handler ---

function handleReconnect() {
  // Clear all replay buffers
  for (const key of Object.keys(replayBuffers)) {
    delete replayBuffers[key];
  }

  // Re-register active tab with full replay
  const currentActive = activeTabId.value;
  if (currentActive && currentActive !== HOME_TAB && tabs[currentActive]) {
    send({ type: 'tab_subscribe', sessionId: currentActive });
  }

  // Mark all other tabs as stale (lazy-reload on click)
  for (const sessionId of Object.keys(tabs)) {
    if (sessionId !== currentActive) {
      staleTabs.add(sessionId);
    }
  }

  // Re-register all popups (skip history — they're background)
  for (const sessionId of Object.keys(popups)) {
    send({ type: 'popup_open', sessionId, skip_history: true });
  }

  // Restore tabs from localStorage on first connect
  restoreTabsOnFirstConnect();
  restorePopupsOnFirstConnect();
}

// --- First-connect restore ---

let hasRestoredTabs = false;
let hasRestoredPopups = false;

function restoreTabsOnFirstConnect() {
  if (hasRestoredTabs) return;
  hasRestoredTabs = true;

  const { loadTabLayout } = getTabPersistence();
  const layout = loadTabLayout();
  if (!layout || !layout.tabs || layout.tabs.length === 0) return;

  // Step 1: Create tab UI state immediately (no delay)
  for (const item of layout.tabs) {
    const sessionId = item.sessionId;
    ensureSession(sessionId, null);
    tabs[sessionId] = {
      title: item.title || 'Session',
      scrollPosition: 0,
      draftText: item.draftText || '',
      hasUnread: false,
    };
    if (!tabOrder.includes(sessionId)) tabOrder.push(sessionId);
  }

  if (layout.activeTabId && layout.activeTabId !== HOME_TAB && tabs[layout.activeTabId]) {
    activeTabId.value = layout.activeTabId;
  }

  // Step 2: Try IndexedDB cache immediately (async but fast — no server round-trip)
  (async () => {
    const uncached = [];

    for (const item of layout.tabs) {
      const restored = await restoreFromCache(item.sessionId);
      if (restored) {
        console.log('[restore] Cached:', item.sessionId.substring(0, 12));
        // Register with server for live updates only (skip history replay)
        send({ type: 'tab_subscribe', sessionId: item.sessionId, skip_history: true });
      } else {
        uncached.push(item.sessionId);
      }
    }

    // Step 3: Pane cleanup
    for (const p of paneList) {
      if (p.activeTabId && p.activeTabId !== '__home__' && !p.activeTabId.startsWith('__') && !tabs[p.activeTabId]) {
        const realTab = p.tabIds.find(id => id !== '__home__' && tabs[id]);
        p.activeTabId = realTab || '__home__';
      }
    }

    // Step 4: Server replay for uncached tabs only
    if (uncached.length > 0) {
      let delay = 0;
      for (const sessionId of uncached) {
        // Check if visible in any pane
        let visible = layout.activeTabId === sessionId;
        try {
          const savedPanes = JSON.parse(localStorage.getItem('claude-relay-panes') || '{}');
          if (savedPanes.panes) visible = visible || savedPanes.panes.some(p => p.tabIds && p.tabIds.includes(sessionId));
        } catch {}

        if (visible) {
          setTimeout(() => {
            send({ type: 'tab_subscribe', sessionId });
            setTimeout(() => {
              const ss = sessionStates[sessionId];
              if (ss && ss.loadingHistory) ss.loadingHistory = false;
            }, 15000);
          }, delay);
          delay += 2000;
        } else {
          staleTabs.add(sessionId);
          const ss = sessionStates[sessionId];
          if (ss) ss.loadingHistory = false;
        }
      }
    }
  })();
}

function restorePopupsOnFirstConnect() {
  if (hasRestoredPopups) return;
  hasRestoredPopups = true;

  setTimeout(() => {
    const { loadPopupLayout } = getPopupPersistence();
    const layout = loadPopupLayout();
    if (!layout || layout.length === 0) return;

    for (const item of layout) {
      if (getTabSessionIds().has(item.sessionId)) continue;
      const sessionId = item.sessionId;
      ensureSession(sessionId, null);
      popups[sessionId] = {
        title: item.title || 'Session',
        minimized: item.minimized || false,
        hasUnread: false,
      };
      if (!popupOrder.includes(sessionId)) popupOrder.push(sessionId);
      send({ type: 'popup_open', sessionId });
    }
  }, 500);
}

// --- Lazy import helpers to break circular deps ---

function getTabPersistence() {
  return {
    loadTabLayout() {
      try {
        const raw = localStorage.getItem('claude-relay-tabs');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
  };
}

function getPopupPersistence() {
  return {
    loadPopupLayout() {
      try {
        const raw = localStorage.getItem('claude-relay-popups');
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    }
  };
}
