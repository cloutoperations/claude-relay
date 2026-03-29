// Session router — single message handler, owns all routing logic.
// Replaces the scattered onMessage() handlers in old tabs.js/popups.js/chat.js/sessions.js/ambient.js.

import { wsState, send, setOnMessage } from './ws.svelte.js';
import { sessionSettings, sendSettings } from './session-settings.svelte.js';
import {
  sessions as sessionStates, resolveSessionId, rekeySession,
  ensureSession, removeSessionState, replayBuffers, staleTabs,
  startHistoryReplay, finishHistoryReplay, routeToSession, prependHistory, restoreFromCache,
} from './session-state.svelte.js';
import { clearCache } from './message-cache.js';
import {
  tabs, activeTabId, tabOrder, getTabSessionIds, onTabRekey,
  saveLayout as saveTabLayout, HOME_TAB, pendingForkRequests, sendTabMessage,
} from './tabs.svelte.js';
import {
  popups, popupOrder, isPopupOpen, onPopupRekey, onWsClose,
  saveLayout as savePopupLayout,
} from './popups.svelte.js';
import { renameTabInPanes, panes as paneList, addTabToPane } from './panes.svelte.js';
import { sessionList, pendingNewSessionRequests, searchSeq, sessionSearchQuery, sessionSearchResults, pendingAutoTag, buildAutoTagPrompt, pendingAreaAnalysis, pendingSessionReview } from './sessions.svelte.js';
import { contextData, sessionCost, projectInfo, clientCount, slashCommands, modelInfo, rateLimitState, configState, accountUsage } from './chat.svelte.js';
import { ambientState } from './ambient.svelte.js';
import { routeFileMessage } from './files.svelte.js';
import { handleAgentList, handleAgentStatus, handleAgentCreated, handleAgentDeleted } from './agents.svelte.js';
import { handleGitStatusResult, handleGitActionResult, handleGitDiffResult, refreshStatus as refreshGitStatus, pendingGitChat, buildGitSummary } from './git.svelte.js';

// staleTabs is imported from session-state.svelte.js to avoid circular deps

// Track the session passed via ?s= in the WS URL — its history arrives untagged
// and must be routed to the correct session state (not dropped).
let initialReplaySession = null;
let initialReplayDone = false;

// --- Main message router ---
setOnMessage(handleIncoming);

function handleIncoming(msg) {

    const t = msg.type;

    // --- WS lifecycle ---
    if (t === '__ws_open') {
      handleReconnect();
      routeFileMessage(msg);
      // Re-send persisted effort level so server knows our preference
      if (sessionSettings.effort) sendSettings();
      return;
    }
    if (t === '__ws_close') { onWsClose(); return; }

    // --- File system messages ---
    if (t === 'fs_list_result' || t === 'fs_read_result' || t === 'fs_search_result' || t === 'fs_file_changed') {
      routeFileMessage(msg);
      return;
    }

    // --- Global broadcasts (no _popupSessionId) ---
    if (!msg._popupSessionId) {
      routeGlobalMessage(msg, t);

      // Route untagged session events ONLY for the initial replay session
      // (the one passed via ?s= in the WS URL) and only while replay is in progress.
      if (initialReplaySession && !initialReplayDone && sessionStates[initialReplaySession]) {
        const SESSION_EVENTS = ['delta', 'assistant_delta', 'user_message', 'tool_start', 'tool_executing', 'tool_result', 'status', 'result', 'done', 'error', 'thinking_start', 'thinking_delta', 'thinking_stop', 'permission_request', 'permission_request_pending', 'permission_resolved', 'permission_cancel', 'ask_user', 'ask_user_answered', 'rate_limit', 'subagent_activity', 'plan_mode', 'task_create', 'task_update', 'task_list', 'prompt_suggestion'];
        if (SESSION_EVENTS.includes(t)) {
          routeToSession(initialReplaySession, msg, t);
        }
      }
    }

    // --- History start/done ---
    if (t === 'popup_history_start' || t === 'tab_history_start' || t === 'history_meta') {
      // Untagged history_meta → route to initialReplaySession (from ?s= URL param)
      // Tagged → route to msg.sessionId
      const sessionId = msg.sessionId
        ? resolveSessionId(msg.sessionId)
        : initialReplaySession || null;
      if (!sessionId || !sessionStates[sessionId]) {
        // Silent on startup — server sends untagged history for empty session list
        if (!msg.sessionId && !initialReplaySession) return;
        console.warn('[router] history_start dropped — no session state for', msg.sessionId?.substring(0, 12), 'resolved:', sessionId?.substring?.(0, 12));
        return;
      }
      // Suppress skeleton for the ?s= URL replay — history arrives instantly
      const suppress = sessionId === initialReplaySession && !msg.sessionId;
      startHistoryReplay(sessionId, msg.from, msg.total, suppress);
      return;
    }

    if (t === 'popup_history_done' || t === 'tab_history_done' || t === 'history_done') {
      const sessionId = msg.sessionId
        ? resolveSessionId(msg.sessionId)
        : initialReplaySession || null;
      if (!sessionId || !sessionStates[sessionId]) {
        if (!msg.sessionId && !initialReplaySession) return;
        console.warn('[router] history_done dropped — no session state for', msg.sessionId?.substring(0, 12), 'resolved:', sessionId?.substring?.(0, 12));
        return;
      }
      console.log('[router] history_done OK for', sessionId.substring(0, 12));
      finishHistoryReplay(sessionId);

      // Initial replay done — leave primary-viewer mode to prevent future
      // untagged events (live events arrive tagged via tab_subscribe).
      // Keep initialReplaySession set so restoreTabsOnFirstConnect can
      // check it and skip the redundant tab_subscribe.
      if (sessionId === initialReplaySession && !msg.sessionId) {
        send({ type: 'leave_session' });
        initialReplayDone = true;
      }
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
        if (s.title) {
          if (tabs[s.id]) tabs[s.id].title = s.title;
          if (popups[s.id]) popups[s.id].title = s.title;
        }
      }
      return;
    }

    // --- Search results ---
    if (t === 'search_results') {
      console.log('[router] search_results:', msg.query, '→', (msg.results || []).length, 'hits, storeQuery:', sessionSearchQuery.value, 'seq:', msg._searchSeq, 'storeSeq:', searchSeq.value);
      if (msg._searchSeq != null && msg._searchSeq !== searchSeq.value) { console.log('[router] DROPPED: seq mismatch'); return; }
      if (msg.query !== sessionSearchQuery.value) { console.log('[router] DROPPED: query mismatch', JSON.stringify(msg.query), '!==', JSON.stringify(sessionSearchQuery.value)); return; }
      sessionSearchResults.value = msg.results || [];
      console.log('[router] search results SET:', sessionSearchResults.value.length);
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
    case 'config_state':
      Object.assign(configState, {
        model: msg.model || configState.model,
        effort: msg.effort ?? configState.effort,
        fastMode: msg.fastMode ?? configState.fastMode,
        permissionMode: msg.permissionMode || configState.permissionMode,
        boardApiUrl: msg.boardApiUrl ?? configState.boardApiUrl,
      });
      break;
    // --- Agent messages ---
    case 'agent_list':
      handleAgentList(msg.agents || []);
      break;
    case 'agent_status':
      handleAgentStatus(msg);
      break;
    case 'agent_created':
      handleAgentCreated(msg.agent || msg);
      break;
    case 'agent_deleted':
      handleAgentDeleted(msg);
      break;
    // --- Account usage ---
    case 'usage_data':
      accountUsage.accounts = msg.accounts || [];
      accountUsage.timestamp = msg.timestamp || Date.now();
      accountUsage.loading = false;
      break;
    // --- Git messages ---
    case 'git_status_result':
      handleGitStatusResult(msg);
      break;
    case 'git_action_result':
      handleGitActionResult(msg);
      break;
    case 'git_diff_working_result':
      handleGitDiffResult(msg);
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
    // If the server gave us a different session than we asked for with ?s=,
    // abandon the initial replay — the tab_subscribe will load the correct one.
    if (initialReplaySession && msg.id && msg.id !== initialReplaySession) {
      send({ type: 'leave_session' });
      initialReplaySession = null;
      initialReplayDone = true;
    }
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

  // If this was triggered by the git chat button, auto-send the git summary
  if (pendingGitChat.active) {
    pendingGitChat.active = false;
    const summary = buildGitSummary();
    setTimeout(() => {
      sendTabMessage(sessionId, summary);
    }, 500);
  }

  // If this was triggered by auto-tag, send the tagging prompt
  if (pendingAutoTag.active) {
    const prompt = pendingAutoTag.customPrompt || buildAutoTagPrompt();
    pendingAutoTag.active = false;
    pendingAutoTag.customPrompt = null;
    setTimeout(() => {
      sendTabMessage(sessionId, prompt);
    }, 800);
  }

  // If this was triggered by area analysis, send the analysis prompt
  if (pendingAreaAnalysis.active) {
    const prompt = pendingAreaAnalysis.prompt;
    pendingAreaAnalysis.active = false;
    pendingAreaAnalysis.areaName = null;
    pendingAreaAnalysis.prompt = null;
    setTimeout(() => {
      sendTabMessage(sessionId, prompt);
    }, 800);
  }

  // If this was triggered by session review, send the review prompt
  if (pendingSessionReview.active) {
    const prompt = pendingSessionReview.prompt;
    pendingSessionReview.active = false;
    pendingSessionReview.prompt = null;
    setTimeout(() => {
      sendTabMessage(sessionId, prompt);
    }, 800);
  }
}

// --- Reconnect handler ---

function handleReconnect() {
  // Clear all replay buffers
  for (const key of Object.keys(replayBuffers)) {
    delete replayBuffers[key];
  }

  // Reset replay state so stale values from the previous connection
  // don't cause messages to route to the wrong session (bug 2.11).
  initialReplaySession = null;
  initialReplayDone = false;

  // Determine which session the server is replaying via ?s= URL param.
  // On first connect, the active tab's session was passed in the WS URL,
  // so the server is already replaying it — no need to send tab_subscribe.
  // On reconnect (tabs already exist), we need to re-subscribe explicitly.
  const currentActive = activeTabId.value;
  const hasTabsLoaded = Object.keys(tabs).length > 0;

  if (hasTabsLoaded) {
    // Reconnect — no ?s= in URL, server assigned default session.
    // Leave it immediately and re-subscribe to the active tab.
    send({ type: 'leave_session' });
    if (currentActive && currentActive !== HOME_TAB && tabs[currentActive]) {
      send({ type: 'tab_subscribe', sessionId: currentActive });
    }
  } else {
    // First connect — server is replaying the session from ?s= URL param.
    // Read which session we asked for so we can route untagged events to it.
    try {
      const saved = JSON.parse(localStorage.getItem('claude-relay-tabs') || '{}');
      if (saved.activeTabId && !saved.activeTabId.startsWith('__')) {
        initialReplaySession = saved.activeTabId;
        initialReplayDone = false;
        // Ensure session state exists before history events arrive.
        // Use empty seedState so loadingHistory starts as false (no skeleton flash).
        ensureSession(initialReplaySession, { messages: [], processing: false });
      }
    } catch {}
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

  // Fetch git status on connect
  refreshGitStatus();
}

// --- One-time stale cache purge ---
// v1: Clear stale IndexedDB cache that may have partial data from a bug.
// After first load, fresh caches are written correctly. Safe to remove this
// block once all clients have loaded at least once after this deploy.
const CACHE_VERSION_KEY = 'claude-relay-cache-v';
const CACHE_VERSION = 4;
if (parseInt(localStorage.getItem(CACHE_VERSION_KEY) || '0') < CACHE_VERSION) {
  clearCache().then(() => {
    localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
    console.log('[cache] Purged stale IndexedDB cache (v' + CACHE_VERSION + ')');
  });
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

  // Step 2: Show cached data as placeholder for non-active tabs only.
  // The active tab loads via ?s= in the WS URL (zero-delay server replay),
  // so showing a cache placeholder would cause a visible double-load flash.
  (async () => {
    for (const item of layout.tabs) {
      if (item.sessionId === initialReplaySession) continue; // server is already replaying this one
      try {
        const restored = await restoreFromCache(item.sessionId);
        if (restored) {
          console.log('[restore] Cached placeholder:', item.sessionId.substring(0, 12));
        }
      } catch (err) {
        console.warn('[restore] Failed to restore cache for', item.sessionId.substring(0, 12), err);
      }
    }

    // Step 3: Pane cleanup
    for (const p of paneList) {
      if (p.activeTabId && p.activeTabId !== '__home__' && !p.activeTabId.startsWith('__') && !tabs[p.activeTabId]) {
        const realTab = p.tabIds.find(id => id !== '__home__' && tabs[id]);
        p.activeTabId = realTab || '__home__';
      }
    }

    // Step 4: Request server replay for visible tabs (skip if already replaying via ?s=)
    {
      for (const item of layout.tabs) {
        const sessionId = item.sessionId;

        // Skip the session that's already replaying via ?s= URL param
        if (sessionId === initialReplaySession) {
          // Just register for tagged live updates (no history replay needed)
          send({ type: 'tab_subscribe', sessionId, skip_history: true });
          continue;
        }

        // Check if visible in any pane
        let visible = layout.activeTabId === sessionId;
        try {
          const savedPanes = JSON.parse(localStorage.getItem('claude-relay-panes') || '{}');
          if (savedPanes.panes) visible = visible || savedPanes.panes.some(p => p.activeTabId === sessionId);
        } catch {}

        if (visible) {
          send({ type: 'tab_subscribe', sessionId });
          setTimeout(() => {
            const ss = sessionStates[sessionId];
            if (ss && ss.loadingHistory) ss.loadingHistory = false;
          }, 15000);
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
