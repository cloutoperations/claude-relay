// Chat popup store — manages floating messenger-style session windows
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';

const MAX_POPUPS = 5;
const STORAGE_KEY = 'claude-relay-popups';

// Map of sessionId -> popup state
export const popups = writable({});

// When a popup_message is sent, the server briefly routes untagged messages
// for that session. This flag tells chat.js to suppress those leaked messages.
export const popupMessageInFlight = writable(false);
let popupFlightTimer = null;

// --- Task tools ---
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);

function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
}

function toolActivityText(name, input) {
  if (!input || typeof input !== 'object') return name;
  let detail = '';
  switch (name) {
    case 'Bash': detail = input.description || (input.command || '').substring(0, 60); break;
    case 'Read': detail = input.file_path ? shortPath(input.file_path) : ''; break;
    case 'Edit': detail = input.file_path ? shortPath(input.file_path) : ''; break;
    case 'Write': detail = input.file_path ? shortPath(input.file_path) : ''; break;
    case 'Grep': detail = input.pattern || ''; break;
    case 'Glob': detail = input.pattern || ''; break;
    case 'WebSearch': detail = input.query || ''; break;
    case 'WebFetch': detail = input.url ? input.url.substring(0, 60) : ''; break;
    case 'Task': detail = input.description || ''; break;
    case 'Agent': detail = input.description || ''; break;
    default: detail = '';
  }
  return detail ? name + ' · ' + detail : name;
}

function toolSubtitle(name, input) {
  if (!input || typeof input !== 'object') return '';
  switch (name) {
    case 'Bash': return input.description || (input.command || '').substring(0, 80);
    case 'Read': return shortPath(input.file_path);
    case 'Edit': return shortPath(input.file_path);
    case 'Write': return shortPath(input.file_path);
    case 'Grep': return (input.pattern || '') + (input.path ? ' in ' + shortPath(input.path) : '');
    case 'Glob': return input.pattern || '';
    case 'WebSearch': return input.query || '';
    case 'WebFetch': return input.url || '';
    case 'Agent': return input.description || '';
    case 'Task': return input.description || '';
    case 'ToolSearch': return input.query || '';
    default: return '';
  }
}

function handleTaskInput(popup, name, input) {
  if (!input) return;
  const tasks = popup.tasks || [];
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return input.todos.map((t, i) => ({
      id: String(i + 1),
      content: t.content || '',
      status: t.status || 'pending',
      activeForm: t.activeForm || '',
    }));
  } else if (name === 'TaskCreate') {
    const id = String(tasks.length + 1);
    return [...tasks, {
      id,
      content: input.subject || input.description || '',
      status: 'pending',
      activeForm: input.activeForm || '',
    }];
  } else if (name === 'TaskUpdate') {
    if (!input.taskId) return tasks;
    if (input.status === 'deleted') {
      return tasks.filter(t => t.id !== input.taskId);
    }
    return tasks.map(t =>
      t.id === input.taskId
        ? {
            ...t,
            status: input.status || t.status,
            content: input.subject || t.content,
            activeForm: input.activeForm || t.activeForm,
          }
        : t
    );
  }
  return tasks;
}

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
  if (hasRestored) return;
  hasRestored = true;

  const layout = loadLayout();
  if (layout.length === 0) return;

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

  if (current[sessionId]) {
    popups.update(p => ({
      ...p,
      [sessionId]: { ...p[sessionId], minimized: false }
    }));
    return;
  }

  const ids = Object.keys(current);
  if (ids.length >= MAX_POPUPS) {
    const toClose = ids.find(id => current[id].minimized) || ids[0];
    closePopup(toClose);
  }

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
      activity: null,
      hasUnread: false,
      loadingHistory: !initialState,
      tasks: initialState?.tasks || [],
    }
  }));

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
  const text = popup.currentText;
  // Find last unfinalized assistant and finalize it (handles interleaving with tools)
  const msgs = [...popup.messages];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].type === 'assistant' && msgs[i].streaming) {
      msgs[i] = { ...msgs[i], text, streaming: false, finalized: true };
      break;
    }
  }
  return { ...popup, isStreaming: false, currentText: '', messages: msgs };
}

// History replay buffering per popup
const replayBuffers = {};

function getReplayBuffer(sessionId) {
  if (!replayBuffers[sessionId]) {
    replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
  }
  return replayBuffers[sessionId];
}

onMessage((msg) => {
  if (!msg._popupSessionId && msg.type !== 'popup_history_start' && msg.type !== 'popup_history_done') return;

  const sessionId = msg._popupSessionId || msg.sessionId;
  if (!sessionId) return;

  const t = msg.type;

  // --- History replay buffering ---
  if (t === 'popup_history_start') {
    replayBuffers[sessionId] = { msgs: [], tasks: [], isStreaming: false, currentText: '' };
    popups.update(p => {
      const popup = p[sessionId];
      if (!popup) return p;
      return { ...p, [sessionId]: { ...popup, messages: [], loadingHistory: true } };
    });
    return;
  }

  if (t === 'popup_history_done') {
    const buf = replayBuffers[sessionId];
    if (buf) {
      // Finalize any pending streaming assistant
      if (buf.isStreaming && buf.currentText) {
        for (let i = buf.msgs.length - 1; i >= 0; i--) {
          if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
            buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText, streaming: false, finalized: true };
            break;
          }
        }
      }
      popups.update(p => {
        const popup = p[sessionId];
        if (!popup) return p;
        return {
          ...p,
          [sessionId]: {
            ...popup,
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
      popups.update(p => {
        const popup = p[sessionId];
        if (!popup) return p;
        return { ...p, [sessionId]: { ...finishAssistant(popup), loadingHistory: false } };
      });
    }
    return;
  }

  // During history replay, buffer events
  const buf = replayBuffers[sessionId];
  if (buf) {
    processPopupEvent(buf, msg, t, sessionId);
    return;
  }

  // Live events — update popup store directly
  popups.update(p => {
    const popup = p[sessionId];
    if (!popup) return p;

    let updated = { ...popup };
    processPopupEventLive(updated, msg, t, sessionId);
    return { ...p, [sessionId]: updated };
  });
});

// Process event into a replay buffer (no store updates)
function processPopupEvent(buf, msg, t, sessionId) {
  if (t === 'user_message') {
    // Finalize any streaming assistant
    if (buf.isStreaming && buf.currentText) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText, streaming: false, finalized: true };
          break;
        }
      }
      buf.isStreaming = false;
      buf.currentText = '';
    }
    buf.msgs.push({ type: 'user', text: msg.text || '' });
  } else if (t === 'delta' || t === 'assistant_delta') {
    const delta = msg.text || msg.delta || '';
    if (!buf.isStreaming) {
      buf.isStreaming = true;
      buf.currentText = delta;
      buf.msgs.push({ type: 'assistant', text: delta, streaming: true });
    } else {
      buf.currentText += delta;
      // Update last streaming assistant (scan backwards past tools)
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText };
          break;
        }
      }
    }
  } else if (t === 'tool_start') {
    // Finalize any in-progress assistant text so it appears before this tool
    if (buf.isStreaming && buf.currentText) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText, streaming: false, finalized: true };
          break;
        }
      }
      buf.isStreaming = false;
      buf.currentText = '';
    }
    const name = msg.name || msg.toolName || 'tool';
    buf.msgs.push({
      type: 'tool',
      toolId: msg.id || msg.toolUseId,
      name,
      status: 'running',
      subtitle: '',
      isTaskTool: TASK_TOOLS.has(name),
      isAgent: AGENT_TOOLS.has(name),
      subTools: AGENT_TOOLS.has(name) ? [] : null,
    });
  } else if (t === 'tool_executing') {
    const toolName = msg.name || '';
    const subtitle = toolSubtitle(toolName, msg.input);
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === msg.id) {
        buf.msgs[i] = { ...buf.msgs[i], subtitle };
        break;
      }
    }
    if (TASK_TOOLS.has(toolName)) {
      buf.tasks = handleTaskInput({ tasks: buf.tasks }, toolName, msg.input);
    }
  } else if (t === 'tool_result') {
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === msg.id) {
        buf.msgs[i] = { ...buf.msgs[i], status: msg.is_error ? 'error' : 'done' };
        break;
      }
    }
  } else if (t === 'result') {
    // Finalize assistant
    if (buf.isStreaming && buf.currentText) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText, streaming: false, finalized: true };
          break;
        }
      }
      buf.isStreaming = false;
      buf.currentText = '';
    }
    if (msg.cost != null || msg.duration != null) {
      buf.msgs.push({ type: 'turn_meta', cost: msg.cost, duration: msg.duration });
    }
  } else if (t === 'done') {
    if (buf.isStreaming && buf.currentText) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText, streaming: false, finalized: true };
          break;
        }
      }
      buf.isStreaming = false;
      buf.currentText = '';
    }
  } else if (t === 'subagent_activity') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === pid) {
          buf.msgs[i] = { ...buf.msgs[i], subtitle: msg.text || msg.title || buf.msgs[i].subtitle };
          break;
        }
      }
    }
  } else if (t === 'subagent_tool') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === pid) {
          buf.msgs[i] = {
            ...buf.msgs[i],
            subTools: [...(buf.msgs[i].subTools || []), { name: msg.toolName || '', subtitle: msg.text || '' }],
          };
          break;
        }
      }
    }
  } else if (t === 'subagent_done') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === pid) {
          buf.msgs[i] = { ...buf.msgs[i], status: 'done' };
          break;
        }
      }
    }
  } else if (t === 'permission_request' || t === 'permission_request_pending') {
    const inputSummary = msg.toolInput
      ? (msg.toolInput.command || msg.toolInput.file_path || msg.toolInput.path || '')
      : '';
    buf.msgs.push({
      type: 'permission', requestId: msg.requestId,
      toolName: msg.toolName || 'tool', inputSummary, resolved: false,
    });
  } else if (t === 'permission_resolved' || t === 'permission_cancel') {
    const decision = msg.decision || 'cancel';
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'permission' && buf.msgs[i].requestId === msg.requestId) {
        buf.msgs[i] = { ...buf.msgs[i], resolved: true, decision };
        break;
      }
    }
  } else if (t === 'error') {
    buf.msgs.push({ type: 'system', text: msg.text || msg.message || 'Unknown error', isError: true });
  } else if (t === 'compact_boundary') {
    buf.msgs.push({ type: 'system', text: 'Context compacted' + (msg.preTokens ? ' (was ' + Math.round(msg.preTokens / 1000) + 'K tokens)' : '') });
  } else if (t === 'files_persisted') {
    if (msg.failed && msg.failed.length > 0) {
      buf.msgs.push({ type: 'system', text: 'File save failed: ' + msg.failed.map(f => f.name).join(', '), isError: true });
    }
  } else if (t === 'task_notification') {
    if (msg.status === 'failed') {
      buf.msgs.push({ type: 'system', text: 'Task failed' + (msg.summary ? ': ' + msg.summary : ''), isError: true });
    }
  }
}

// Process live event directly on popup state
function processPopupEventLive(updated, msg, t, sessionId) {
  if (t === 'user_message') {
    Object.assign(updated, finishAssistant(updated));
    updated.messages = [...updated.messages, { type: 'user', text: msg.text || '' }];
  } else if (t === 'delta' || t === 'assistant_delta') {
    updated.thinking = false;
    updated.activity = null;
    const delta = msg.text || msg.delta || '';
    if (!updated.isStreaming) {
      updated.isStreaming = true;
      updated.currentText = delta;
      updated.messages = [...updated.messages, { type: 'assistant', text: delta, streaming: true }];
    } else {
      updated.currentText += delta;
      // Update last streaming assistant (scan backwards past tools)
      const msgs = [...updated.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].type === 'assistant' && msgs[i].streaming) {
          msgs[i] = { ...msgs[i], text: updated.currentText };
          break;
        }
      }
      updated.messages = msgs;
    }
  } else if (t === 'thinking_start') {
    updated.thinking = true;
  } else if (t === 'thinking_delta') {
    // keep alive
  } else if (t === 'thinking_stop') {
    updated.thinking = false;
  } else if (t === 'tool_start') {
    // Finalize any in-progress assistant text so it appears before this tool
    Object.assign(updated, finishAssistant(updated));
    updated.thinking = false;
    const name = msg.name || msg.toolName || 'tool';
    updated.activity = name;
    updated.messages = [...updated.messages, {
      type: 'tool',
      toolId: msg.id || msg.toolUseId,
      name,
      status: 'running',
      subtitle: '',
      isTaskTool: TASK_TOOLS.has(name),
      isAgent: AGENT_TOOLS.has(name),
      subTools: AGENT_TOOLS.has(name) ? [] : null,
    }];
  } else if (t === 'tool_executing') {
    const toolName = msg.name || '';
    const subtitle = toolSubtitle(toolName, msg.input);
    updated.activity = toolActivityText(toolName, msg.input);
    updated.messages = updated.messages.map(m =>
      m.type === 'tool' && m.toolId === msg.id ? { ...m, subtitle } : m
    );
    if (TASK_TOOLS.has(toolName)) {
      updated.tasks = handleTaskInput(updated, toolName, msg.input);
    }
  } else if (t === 'tool_result') {
    updated.messages = updated.messages.map(m =>
      m.type === 'tool' && m.toolId === msg.id
        ? { ...m, status: msg.is_error ? 'error' : 'done' }
        : m
    );
  } else if (t === 'permission_request' || t === 'permission_request_pending') {
    Object.assign(updated, finishAssistant(updated));
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
    Object.assign(updated, finishAssistant(updated));
    updated.messages = [...updated.messages, {
      type: 'info', text: 'Claude is asking: ' + (msg.question || ''),
    }];
  } else if (t === 'status') {
    updated.processing = msg.status === 'processing';
    updated.status = msg.status;
  } else if (t === 'result') {
    Object.assign(updated, finishAssistant(updated));
    updated.processing = false;
    if (msg.cost != null || msg.duration != null) {
      updated.messages = [...updated.messages, { type: 'turn_meta', cost: msg.cost, duration: msg.duration }];
    }
    if (popupFlightTimer) clearTimeout(popupFlightTimer);
    popupMessageInFlight.set(false);
  } else if (t === 'done') {
    Object.assign(updated, finishAssistant(updated));
    updated.processing = false;
    updated.thinking = false;
    updated.activity = null;
    updated.status = 'idle';
    if (updated.minimized) updated.hasUnread = true;
    if (popupFlightTimer) clearTimeout(popupFlightTimer);
    popupMessageInFlight.set(false);
  } else if (t === 'error') {
    Object.assign(updated, finishAssistant(updated));
    updated.messages = [...updated.messages, {
      type: 'system', text: msg.text || msg.message || 'Unknown error', isError: true,
    }];
    if (updated.minimized) updated.hasUnread = true;
  } else if (t === 'compacting') {
    updated.messages = [...updated.messages, { type: 'system', text: 'Compacting context...' }];
  } else if (t === 'subagent_activity') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      if (msg.text) updated.activity = msg.text;
      updated.messages = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === pid
          ? { ...m, subtitle: msg.text || msg.title || m.subtitle }
          : m
      );
    }
  } else if (t === 'subagent_tool') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      const toolName = msg.toolName || '';
      const text = msg.text || '';
      updated.activity = toolName && text ? toolName + ' · ' + text : text || toolName || 'Agent working...';
      updated.messages = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === pid
          ? { ...m, subTools: [...(m.subTools || []), { name: toolName, subtitle: text }] }
          : m
      );
    }
  } else if (t === 'tool_progress') {
    const elapsed = msg.elapsed ? Math.round(msg.elapsed) : 0;
    const name = msg.toolName || 'tool';
    updated.activity = name + (elapsed > 3 ? ' · ' + elapsed + 's' : '');
  } else if (t === 'hook_event') {
    if (msg.hookName) updated.activity = 'Hook · ' + msg.hookName;
  } else if (t === 'compact_boundary') {
    updated.messages = [...updated.messages, {
      type: 'system',
      text: 'Context compacted' + (msg.preTokens ? ' (was ' + Math.round(msg.preTokens / 1000) + 'K tokens)' : ''),
    }];
  } else if (t === 'files_persisted') {
    if (msg.failed && msg.failed.length > 0) {
      updated.messages = [...updated.messages, {
        type: 'system',
        text: 'File save failed: ' + msg.failed.map(f => f.name).join(', '),
        isError: true,
      }];
    }
  } else if (t === 'auth_status') {
    if (msg.isAuthenticating) {
      updated.activity = 'Authenticating...';
    } else if (msg.error) {
      updated.messages = [...updated.messages, {
        type: 'system', text: 'Auth error: ' + msg.error, isError: true,
      }];
    }
  } else if (t === 'task_notification') {
    if (msg.status === 'failed') {
      updated.messages = [...updated.messages, {
        type: 'system', text: 'Task failed' + (msg.summary ? ': ' + msg.summary : ''), isError: true,
      }];
    }
  } else if (t === 'subagent_done') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      updated.messages = updated.messages.map(m =>
        m.type === 'tool' && m.toolId === pid ? { ...m, status: 'done' } : m
      );
    }
  } else if (t === 'session_id') {
    // handled separately in the caller
  }
}

// Session re-key handler (separate because it modifies the popups map structure)
onMessage((msg) => {
  if (!msg._popupSessionId || msg.type !== 'session_id') return;
  const sessionId = msg._popupSessionId;
  const newId = msg.cliSessionId;
  if (!newId || newId === sessionId) return;

  popups.update(p => {
    const popup = p[sessionId];
    if (!popup) return p;
    const next = { ...p };
    delete next[sessionId];
    next[newId] = { ...popup, sessionId: newId };
    return next;
  });
  saveLayout();
});
