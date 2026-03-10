// Chat message store — manages messages for the active session
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';
import { activeSessionId, sessionRekeying } from './sessions.js';
import { popupMessageInFlight } from './popups.js';

// Message list for current session
export const messages = writable([]);
export const processing = writable(false);
export const activity = writable(null);
export const currentDelta = writable('');
export const thinking = writable({ active: false, text: '' });
export const historyDone = writable(false);

// Task tracking (TaskCreate/TaskUpdate → live widget)
export const tasks = writable([]);

// Context/usage data
export const contextData = writable({ used: 0, max: 200000, model: '', percent: 0 });
export const sessionCost = writable(0);
export const projectInfo = writable({ name: '', cwd: '', version: '', slug: '', accounts: [], debug: false });
export const clientCount = writable(1);
export const slashCommands = writable([]);
export const modelInfo = writable({ model: '', models: [] });

let turnCounter = 0;
let currentFullText = '';
let isStreaming = false;

// --- History replay buffering ---
// During history replay, mutations go to local buffers instead of stores.
// This prevents hundreds of re-renders; we flush once at history_done.
let replaying = false;
let replayMsgs = [];
let replayTaskList = [];

function getMsgs() {
  return replaying ? replayMsgs : get(messages);
}

function updateMsgs(fn) {
  if (replaying) {
    replayMsgs = fn(replayMsgs);
  } else {
    messages.update(fn);
  }
}

function updateTaskList(fn) {
  if (replaying) {
    replayTaskList = fn(replayTaskList);
  } else {
    tasks.update(fn);
  }
}

const thinkingVerbs = [
  'Thinking', 'Reasoning', 'Analyzing', 'Considering', 'Processing',
  'Evaluating', 'Pondering', 'Exploring', 'Investigating', 'Working'
];

function randomThinkingVerb() {
  return thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
}

// --- Task tools (hidden from tool list, feed TaskWidget) ---
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite']);

// Tools that spawn subagents (shown as tool items with nested subagent log)
const AGENT_TOOLS = new Set(['Task', 'Agent']);

function handleTaskInput(name, input) {
  if (!input) return;
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    // TodoWrite replaces the full task list
    updateTaskList(() => input.todos.map((t, i) => ({
      id: String(i + 1),
      content: t.content || '',
      status: t.status || 'pending',
      activeForm: t.activeForm || '',
    })));
  } else if (name === 'TaskCreate') {
    const currentTasks = replaying ? replayTaskList : get(tasks);
    const id = String(currentTasks.length + 1);
    updateTaskList(t => [...t, {
      id,
      content: input.subject || input.description || '',
      status: 'pending',
      activeForm: input.activeForm || '',
    }]);
  } else if (name === 'TaskUpdate') {
    if (!input.taskId) return;
    if (input.status === 'deleted') {
      updateTaskList(items => items.filter(t => t.id !== input.taskId));
    } else {
      updateTaskList(items => items.map(t =>
        t.id === input.taskId
          ? {
              ...t,
              status: input.status || t.status,
              content: input.subject || t.content,
              activeForm: input.activeForm || t.activeForm,
            }
          : t
      ));
    }
  }
}

// --- Tool subtitles ---
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

function finalizeAssistant() {
  if (!isStreaming) return;
  isStreaming = false;
  const text = currentFullText;
  currentFullText = '';
  if (!replaying) currentDelta.set('');
  if (text) {
    updateMsgs(msgs => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].type === 'assistant' && !msgs[i].finalized) {
          return [...msgs.slice(0, i), { ...msgs[i], text, finalized: true }, ...msgs.slice(i + 1)];
        }
      }
      return msgs;
    });
  }
}

function ensureAssistantBlock() {
  if (!isStreaming) {
    isStreaming = true;
    currentFullText = '';
    updateMsgs(msgs => [...msgs, {
      type: 'assistant',
      text: '',
      turn: turnCounter,
      finalized: false,
    }]);
  }
}

export function sendMessage(text, images, pastes) {
  if (!text && (!images || images.length === 0)) return;
  finalizeAssistant();
  turnCounter++;
  updateMsgs(msgs => [...msgs, {
    type: 'user',
    text: text || '',
    images: images || null,
    pastes: pastes || null,
    turn: turnCounter,
  }]);

  processing.set(true);
  thinking.set({ active: true, text: '' });

  const msg = { type: 'message', text };
  if (images && images.length > 0) msg.images = images;
  if (pastes && pastes.length > 0) msg.pastes = pastes;
  send(msg);
}

export function stopProcessing() {
  send({ type: 'stop' });
}

export function resetChat() {
  messages.set([]);
  tasks.set([]);
  processing.set(false);
  activity.set(null);
  currentDelta.set('');
  thinking.set({ active: false, text: '' });
  historyDone.set(false);
  sessionCost.set(0);
  turnCounter = 0;
  currentFullText = '';
  isStreaming = false;
  replaying = false;
  replayMsgs = [];
  replayTaskList = [];
}

let pendingSeed = null;

export function seedChat(state) {
  pendingSeed = state || null;
}

function applyPendingSeed() {
  const state = pendingSeed;
  pendingSeed = null;
  if (!state) return;
  if (state.messages) messages.set(state.messages);
  if (state.tasks) tasks.set(state.tasks);
  if (state.processing) {
    processing.set(true);
    activity.set('Processing...');
  }
  if (state.thinking) thinking.set({ active: true, text: '' });
  if (state.currentText) {
    currentDelta.set(state.currentText);
    currentFullText = state.currentText;
    isStreaming = true;
  }
}

activeSessionId.subscribe(() => {
  if (sessionRekeying) return;
  resetChat();
  applyPendingSeed();
});

// Handle all chat-related WebSocket messages
onMessage((msg) => {
  if (msg._popupSessionId) return;
  if (msg.type === 'popup_history_start' || msg.type === 'popup_history_done') return;

  if (get(popupMessageInFlight)) {
    const leaked = ['status', 'thinking_start', 'thinking_delta', 'thinking_stop', 'delta', 'done', 'result', 'compacting'];
    if (leaked.includes(msg.type)) return;
  }

  switch (msg.type) {
    case 'info':
      projectInfo.set({
        name: msg.project || msg.cwd || '',
        cwd: msg.cwd || '',
        version: msg.version || '',
        slug: msg.slug || '',
        accounts: msg.accounts || [],
        debug: msg.debug || false,
        accountLabel: msg.accountLabel || '',
        dangerouslySkipPermissions: msg.dangerouslySkipPermissions || false,
      });
      break;

    case 'client_count':
      clientCount.set(msg.count || 1);
      break;

    case 'slash_commands': {
      const builtins = new Set(['clear', 'rewind', 'context', 'usage', 'status']);
      slashCommands.set(
        (msg.commands || [])
          .filter(name => !builtins.has(name))
          .map(name => ({ name, desc: 'Skill' }))
      );
      break;
    }

    case 'model_info':
      modelInfo.set({ model: msg.model, models: msg.models || [] });
      break;

    case 'context_usage':
      if (msg.max && msg.used) {
        contextData.set({ used: msg.used, max: msg.max, model: msg.model || '', percent: msg.percent || 0 });
      }
      break;

    case 'session_switched':
      break;

    case 'history_meta':
      // Start buffering — all events until history_done go to local arrays
      replaying = true;
      replayMsgs = [];
      replayTaskList = [];
      break;

    case 'history_done':
      // Flush buffered history to stores in one shot
      finalizeAssistant();
      if (replaying) {
        replaying = false;
        messages.set(replayMsgs);
        tasks.set(replayTaskList);
        replayMsgs = [];
        replayTaskList = [];
      }
      historyDone.set(true);
      break;

    case 'user_message':
      finalizeAssistant();
      turnCounter++;
      updateMsgs(msgs => [...msgs, {
        type: 'user',
        text: msg.text || '',
        images: msg.images || null,
        pastes: msg.pastes || null,
        turn: turnCounter,
      }]);
      break;

    case 'status':
      if (msg.status === 'processing') {
        if (!replaying) {
          processing.set(true);
          activity.set(randomThinkingVerb() + '...');
        }
      }
      break;

    case 'compacting':
      if (!replaying) {
        activity.set(msg.active ? 'Compacting conversation...' : randomThinkingVerb() + '...');
      }
      break;

    case 'thinking_start':
      if (!replaying) thinking.set({ active: true, text: '' });
      break;

    case 'thinking_delta':
      if (!replaying && typeof msg.text === 'string') {
        thinking.update(t => ({ ...t, text: t.text + msg.text }));
      }
      break;

    case 'thinking_stop':
      if (!replaying) {
        thinking.set({ active: false, text: '' });
        activity.set(randomThinkingVerb() + '...');
      }
      break;

    case 'delta':
      if (typeof msg.text !== 'string') break;
      if (!replaying) {
        thinking.set({ active: false, text: '' });
        activity.set(null);
      }
      ensureAssistantBlock();
      currentFullText += msg.text;
      if (!replaying) {
        currentDelta.set(currentFullText);
      }
      // Update the last unfinalised assistant message's text
      updateMsgs(msgs => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].type === 'assistant' && !msgs[i].finalized) {
            return [...msgs.slice(0, i), { ...msgs[i], text: currentFullText }, ...msgs.slice(i + 1)];
          }
        }
        return msgs;
      });
      break;

    case 'result':
      if (msg.cost != null || msg.duration != null) {
        updateMsgs(msgs => [...msgs, {
          type: 'turn_meta',
          cost: msg.cost,
          duration: msg.duration,
        }]);
      }
      if (msg.cost != null) {
        sessionCost.update(c => c + (msg.cost || 0));
      }
      if (msg.usage) {
        contextData.update(d => ({
          ...d,
          cost: (d.cost || 0) + (msg.cost || 0),
        }));
      }
      break;

    case 'done':
      finalizeAssistant();
      if (!replaying) {
        processing.set(false);
        activity.set(null);
        thinking.set({ active: false, text: '' });
      }
      break;

    case 'error':
      updateMsgs(msgs => [...msgs, {
        type: 'system',
        text: msg.error || msg.message || 'An error occurred',
        isError: true,
      }]);
      break;

    case 'tool_start':
      if (!replaying) {
        thinking.set({ active: false, text: '' });
        activity.set(msg.name || 'tool');
      }
      // Finalize any in-progress assistant text so it appears as a separate
      // message BEFORE this tool, rather than merging all inter-tool text
      // into one big assistant block.
      finalizeAssistant();
      updateMsgs(msgs => [...msgs, {
        type: 'tool',
        toolId: msg.id,
        name: msg.name,
        status: 'running',
        input: null,
        output: null,
        subtitle: '',
        isTaskTool: TASK_TOOLS.has(msg.name),
        isAgent: AGENT_TOOLS.has(msg.name),
        subTools: AGENT_TOOLS.has(msg.name) ? [] : null,
      }]);
      break;

    case 'tool_executing': {
      const currentMsgs = getMsgs();
      const toolMsg = currentMsgs.find(m => m.type === 'tool' && m.toolId === msg.id);
      const toolName = msg.name || (toolMsg && toolMsg.name) || '';
      const subtitle = toolSubtitle(toolName, msg.input);
      if (!replaying) {
        activity.set(toolActivityText(toolName, msg.input));
      }
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, input: msg.input, subtitle }
          : m
      ));
      if (TASK_TOOLS.has(toolName)) {
        handleTaskInput(toolName, msg.input);
      }
      break;
    }

    case 'tool_result':
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, status: msg.is_error ? 'error' : 'done', output: msg.content || msg.output }
          : m
      ));
      break;

    case 'permission_request':
    case 'permission_request_pending':
      updateMsgs(msgs => [...msgs, {
        type: 'permission',
        requestId: msg.requestId,
        toolName: msg.toolName,
        input: msg.input || msg.toolInput,
        resolved: false,
      }]);
      break;

    case 'permission_resolved':
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision: msg.decision }
          : m
      ));
      break;

    case 'permission_cancel':
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision: 'cancelled' }
          : m
      ));
      break;

    case 'ask_user':
      updateMsgs(msgs => [...msgs, {
        type: 'ask_user',
        requestId: msg.requestId,
        question: msg.question,
        answered: false,
      }]);
      break;

    case 'ask_user_answered':
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'ask_user' && m.requestId === msg.requestId
          ? { ...m, answered: true }
          : m
      ));
      break;

    case 'subagent_activity': {
      // Subagent status update — attach to parent tool via parentToolId
      const parentId = msg.parentToolId || msg.agentId;
      if (!parentId) break;
      const actText = msg.text || msg.title || '';
      if (!replaying && actText) {
        activity.set(actText);
      }
      // Update subtitle on parent tool
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === parentId
          ? { ...m, subtitle: actText || m.subtitle }
          : m
      ));
      break;
    }

    case 'subagent_tool': {
      // Nested tool call inside a subagent — attach to parent tool
      const parentId = msg.parentToolId || msg.agentId;
      if (!parentId) break;
      if (!replaying) {
        const toolName = msg.toolName || '';
        const text = msg.text || '';
        activity.set(toolName && text ? toolName + ' · ' + text : text || toolName || 'Agent working...');
      }
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === parentId
          ? {
              ...m,
              subTools: [...(m.subTools || []), {
                name: msg.toolName || '',
                subtitle: msg.text || '',
              }],
            }
          : m
      ));
      break;
    }

    case 'subagent_done': {
      const parentId = msg.parentToolId || msg.agentId;
      if (!parentId) break;
      updateMsgs(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === parentId
          ? { ...m, status: 'done' }
          : m
      ));
      break;
    }

    case 'tool_progress': {
      // Top-level tool taking a while — update activity with elapsed time
      if (!replaying) {
        const elapsed = msg.elapsed ? Math.round(msg.elapsed) : 0;
        const name = msg.toolName || 'tool';
        activity.set(name + (elapsed > 3 ? ' · ' + elapsed + 's' : ''));
      }
      break;
    }

    case 'tool_summary':
      // Human-readable summary of completed tools — no-op for now,
      // the inter-tool assistant text already covers this
      break;

    case 'hook_event':
      if (!replaying && msg.hookName) {
        activity.set('Hook · ' + msg.hookName);
      }
      break;

    case 'compact_boundary':
      // Context compaction happened — show marker in chat
      updateMsgs(msgs => [...msgs, {
        type: 'system',
        text: 'Context compacted' + (msg.preTokens ? ' (was ' + Math.round(msg.preTokens / 1000) + 'K tokens)' : ''),
      }]);
      break;

    case 'files_persisted':
      // File persistence confirmation
      if (msg.failed && msg.failed.length > 0) {
        updateMsgs(msgs => [...msgs, {
          type: 'system',
          text: 'File save failed: ' + msg.failed.map(f => f.name).join(', '),
          isError: true,
        }]);
      }
      break;

    case 'auth_status':
      if (!replaying) {
        if (msg.isAuthenticating) {
          activity.set('Authenticating...');
        } else if (msg.error) {
          updateMsgs(msgs => [...msgs, {
            type: 'system',
            text: 'Auth error: ' + msg.error,
            isError: true,
          }]);
        }
      }
      break;

    case 'task_notification':
      // Task completion — update activity
      if (!replaying && msg.status === 'failed') {
        updateMsgs(msgs => [...msgs, {
          type: 'system',
          text: 'Task failed' + (msg.summary ? ': ' + msg.summary : ''),
          isError: true,
        }]);
      }
      break;

    case 'slash_command_result':
      updateMsgs(msgs => [...msgs, {
        type: 'system',
        text: msg.result || msg.output || '',
      }]);
      break;

    case 'rewind_complete':
      updateMsgs(msgs => [...msgs, {
        type: 'system',
        text: 'Rewind complete',
      }]);
      break;

    case 'rewind_error':
      updateMsgs(msgs => [...msgs, {
        type: 'system',
        text: 'Rewind failed: ' + (msg.error || 'Unknown error'),
        isError: true,
      }]);
      break;

    case 'message_uuid':
      updateMsgs(msgs => {
        const reversed = [...msgs].reverse();
        const target = reversed.find(m =>
          !m.uuid && ((msg.messageType === 'user' && m.type === 'user') ||
                      (msg.messageType === 'assistant' && m.type === 'assistant'))
        );
        if (target) {
          return msgs.map(m => m === target ? { ...m, uuid: msg.uuid } : m);
        }
        return msgs;
      });
      break;
  }
});
