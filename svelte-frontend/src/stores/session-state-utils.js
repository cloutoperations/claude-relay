// Shared session state utilities — used by both tabs.js and popups.js
// Extracts duplicated message-processing logic.

import { showToast } from './toasts.svelte.js';

const doneMessages = [
  'Cooked', 'Served', 'Nailed it', 'Done and dusted',
  'Finito', 'Wrapped up', 'All yours', 'Boom, done',
  'Delivered', 'Fresh out the oven', 'Off the press',
  'Mic drop', "That's a wrap", 'Ship it', 'Baked to perfection',
  'Locked in', 'Good to go', 'Sorted', 'Crushed it', 'Voilà',
];

let _msgKeyCounter = 0;
export function nextMsgKey() { return 'mk-' + (++_msgKeyCounter); }

export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite']);
export const AGENT_TOOLS = new Set(['Task', 'Agent']);
export const HIDDEN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode']);

export function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
}

export function toolActivityText(name, input) {
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

export function toolSubtitle(name, input) {
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

export function handleTaskInput(tasks, name, input) {
  if (!input) return tasks;
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return input.todos.map((t) => ({
      id: t.id || crypto.randomUUID(),
      content: t.content || '',
      status: t.status || 'pending',
      activeForm: t.activeForm || '',
    }));
  } else if (name === 'TaskCreate') {
    const id = input.id || crypto.randomUUID();
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

// Finalize a streaming assistant message in a messages array
export function finishAssistantInArray(msgs, currentText) {
  if (!currentText) return msgs;
  const result = [...msgs];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].type === 'assistant' && result[i].streaming) {
      result[i] = { ...result[i], text: currentText, streaming: false, finalized: true };
      return result;
    }
  }
  // No streaming message found — check if already finalized with same text (avoid duplicates)
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].type === 'assistant' && result[i].finalized && result[i].text === currentText) {
      return result; // already finalized — skip duplicate
    }
    if (result[i].type === 'user' || result[i].type === 'turn_meta') break; // stop at turn boundary
  }
  result.push({ type: 'assistant', text: currentText, streaming: false, finalized: true, _key: nextMsgKey() });
  return result;
}

/**
 * Process a session event into a buffer (for history replay).
 * Mutates buf in place: { msgs, tasks, isStreaming, currentText }
 */
export function processBufferedEvent(buf, msg, t) {
  if (t === 'user_message') {
    if (buf.isStreaming && buf.currentText) {
      buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
      buf.isStreaming = false;
      buf.currentText = '';
    }
    // Convert imagePaths from history to displayable image objects
    let images = msg.images || null;
    if (!images && msg.imagePaths && msg.imagePaths.length > 0) {
      images = msg.imagePaths.map(p => ({ url: 'api/session-image/' + p, mediaType: 'image/png' }));
    }
    buf.msgs.push({ type: 'user', text: msg.text || '', images, pastes: msg.pastes || null, imageCount: msg.imageCount || 0, documentCount: msg.documentCount || 0, documentNames: msg.documentNames || null, _key: nextMsgKey() });
  } else if (t === 'delta' || t === 'assistant_delta') {
    const delta = msg.text || msg.delta || '';
    if (!buf.isStreaming) {
      buf.isStreaming = true;
      buf.currentText = delta;
      buf.msgs.push({ type: 'assistant', text: delta, streaming: true });
    } else {
      buf.currentText += delta;
      for (let i = buf.msgs.length - 1; i >= 0; i--) {
        if (buf.msgs[i].type === 'assistant' && buf.msgs[i].streaming) {
          buf.msgs[i] = { ...buf.msgs[i], text: buf.currentText };
          break;
        }
      }
    }
  } else if (t === 'tool_start') {
    if (buf.isStreaming && buf.currentText) {
      buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
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
        buf.msgs[i] = { ...buf.msgs[i], input: msg.input, subtitle };
        break;
      }
    }
    if (TASK_TOOLS.has(toolName)) {
      buf.tasks = handleTaskInput(buf.tasks, toolName, msg.input);
    }
    if (toolName === 'EnterPlanMode') {
      buf._planMode = true;
      buf.msgs.push({ type: 'system', text: 'Entered plan mode \u2014 Claude is thinking through the approach before making changes', _key: nextMsgKey() });
    } else if (toolName === 'ExitPlanMode') {
      buf._planMode = false;
      buf.msgs.push({ type: 'system', text: 'Exited plan mode \u2014 resuming normal execution', _key: nextMsgKey() });
    }
  } else if (t === 'tool_result') {
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'tool' && buf.msgs[i].toolId === msg.id) {
        buf.msgs[i] = { ...buf.msgs[i], status: msg.is_error ? 'error' : 'done', output: msg.content || msg.output };
        break;
      }
    }
  } else if (t === 'result' || t === 'done') {
    if (buf.isStreaming && buf.currentText) {
      buf.msgs = finishAssistantInArray(buf.msgs, buf.currentText);
      buf.isStreaming = false;
      buf.currentText = '';
    }
    if (t === 'result' && (msg.cost != null || msg.duration != null)) {
      buf.msgs.push({ type: 'turn_meta', _key: nextMsgKey(), cost: msg.cost, duration: msg.duration, usage: msg.usage || null });
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
          buf.msgs[i] = { ...buf.msgs[i], status: 'done', summary: msg.summary || '', usage: msg.usage || null };
          break;
        }
      }
    }
  } else if (t === 'prompt_suggestion') {
    const items = msg.suggestions || [];
    if (items.length > 0) {
      buf.msgs.push({ type: 'suggestions', items, _key: nextMsgKey() });
    }
  } else if (t === 'permission_request' || t === 'permission_request_pending') {
    const inputSummary = msg.toolInput
      ? (msg.toolInput.command || msg.toolInput.file_path || msg.toolInput.path || '')
      : '';
    buf.msgs.push({
      type: 'permission', requestId: msg.requestId,
      toolName: msg.toolName || 'tool', input: msg.input || msg.toolInput, inputSummary,
      decisionReason: msg.decisionReason || '', resolved: false,
    });
  } else if (t === 'permission_resolved' || t === 'permission_cancel') {
    const decision = msg.decision || 'cancel';
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'permission' && buf.msgs[i].requestId === msg.requestId) {
        buf.msgs[i] = { ...buf.msgs[i], resolved: true, decision };
        break;
      }
    }
  } else if (t === 'ask_user') {
    buf.msgs.push({
      type: 'ask_user', requestId: msg.requestId,
      question: msg.question, questions: msg.questions || null, answered: false,
    });
  } else if (t === 'ask_user_answered') {
    const rid = msg.requestId || msg.toolId;
    for (let i = buf.msgs.length - 1; i >= 0; i--) {
      if (buf.msgs[i].type === 'ask_user' && buf.msgs[i].requestId === rid) {
        buf.msgs[i] = { ...buf.msgs[i], answered: true };
        break;
      }
    }
  } else if (t === 'thinking_start') {
    buf._thinkingText = '';
  } else if (t === 'thinking_delta') {
    buf._thinkingText = (buf._thinkingText || '') + (msg.text || '');
  } else if (t === 'thinking_stop') {
    if (buf._thinkingText) {
      buf.msgs.push({ type: 'thinking', text: buf._thinkingText, duration: msg.duration || 0, _key: nextMsgKey() });
    }
    buf._thinkingText = '';
  } else if (t === 'rate_limit') {
    buf.msgs.push({ type: 'system', _key: nextMsgKey(), text: 'Rate limited: ' + (msg.text || 'API rate limit reached'), isError: true, isRateLimit: true });
  } else if (t === 'error') {
    buf.msgs.push({ type: 'system', _key: nextMsgKey(), text: msg.text || msg.error || msg.message || 'Unknown error', isError: true });
  } else if (t === 'compact_boundary') {
    buf.msgs.push({ type: 'system', _key: nextMsgKey(), text: 'Context compacted' + (msg.preTokens ? ' (was ' + Math.round(msg.preTokens / 1000) + 'K tokens)' : '') });
  } else if (t === 'files_persisted') {
    if (msg.failed && msg.failed.length > 0) {
      buf.msgs.push({ type: 'system', _key: nextMsgKey(), text: 'File save failed: ' + msg.failed.map(f => f.name).join(', '), isError: true });
    }
  } else if (t === 'task_notification') {
    if (msg.status === 'failed') {
      buf.msgs.push({ type: 'system', _key: nextMsgKey(), text: 'Task failed' + (msg.summary ? ': ' + msg.summary : ''), isError: true });
    }
  }
}

/**
 * Process a live session event on a mutable state object.
 * State shape: { messages, processing, thinking, activity, isStreaming, currentText, tasks, ... }
 * Returns updated state (mutates in place for efficiency).
 */
export function processLiveEvent(state, msg, t) {
  if (t === 'user_message') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    // Skip if this user message was already added locally (from sendTabMessage).
    // Search backwards — assistant deltas or tool events may have arrived between
    // the local push and the server echo.
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m.type === 'user' && m._local && m.text === (msg.text || '')) {
        delete m._local;
        return state;
      }
      // Stop searching at the previous turn boundary (non-local user or turn_meta)
      if ((m.type === 'user' && !m._local) || m.type === 'turn_meta') break;
    }
    // Convert imagePaths from history to displayable image objects
    let liveImages = msg.images || null;
    if (!liveImages && msg.imagePaths && msg.imagePaths.length > 0) {
      liveImages = msg.imagePaths.map(p => ({ url: 'api/session-image/' + p, mediaType: 'image/png' }));
    }
    state.messages = [...state.messages, { type: 'user', text: msg.text || '', images: liveImages, pastes: msg.pastes || null, documents: msg.documents || null, imageCount: msg.imageCount || 0, documentCount: msg.documentCount || 0, documentNames: msg.documentNames || null, _key: nextMsgKey() }];
  } else if (t === 'delta' || t === 'assistant_delta') {
    state.thinking = false;
    state.activity = null;
    const delta = msg.text || msg.delta || '';
    if (!state.isStreaming) {
      state.isStreaming = true;
      state.currentText = delta;
      const newMsg = { type: 'assistant', text: delta, streaming: true, _key: nextMsgKey() };
      state.messages = [...state.messages, newMsg];
      // Cache the proxied reference (last element of the reactive array),
      // NOT the plain newMsg object. Svelte 5 only tracks mutations through proxies.
      state._streamingMsg = state.messages[state.messages.length - 1];
    } else {
      state.currentText += delta;
      // Mutate the proxied message reference in-place — Svelte 5 tracks this
      // because _streamingMsg points to the proxy inside state.messages (not a plain object).
      // No array copy needed. This is the streaming hot path.
      if (state._streamingMsg) {
        state._streamingMsg.text = state.currentText;
      }
    }
  } else if (t === 'thinking_start') {
    state.thinking = true;
    state.thinkingText = '';
  } else if (t === 'thinking_delta') {
    state.thinkingText = (state.thinkingText || '') + (msg.text || '');
  } else if (t === 'thinking_stop') {
    // Persist the thinking block into messages if there's content
    if (state.thinkingText) {
      state.messages = [...state.messages, {
        type: 'thinking', text: state.thinkingText, duration: msg.duration || 0, _key: nextMsgKey(),
      }];
    }
    state.thinking = false;
    state.thinkingText = '';
  } else if (t === 'tool_start') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    state.thinking = false;
    const name = msg.name || msg.toolName || 'tool';
    state.activity = name;
    state.messages = [...state.messages, {
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
    state.activity = toolActivityText(toolName, msg.input);
    state.messages = state.messages.map(m =>
      m.type === 'tool' && m.toolId === msg.id ? { ...m, input: msg.input, subtitle } : m
    );
    if (TASK_TOOLS.has(toolName)) {
      state.tasks = handleTaskInput(state.tasks || [], toolName, msg.input);
    }
    if (toolName === 'EnterPlanMode') {
      state.planMode = true;
      state.messages = [...state.messages, { type: 'system', text: 'Entered plan mode \u2014 Claude is thinking through the approach before making changes', _key: nextMsgKey() }];
    } else if (toolName === 'ExitPlanMode') {
      state.planMode = false;
      state.messages = [...state.messages, { type: 'system', text: 'Exited plan mode \u2014 resuming normal execution', _key: nextMsgKey() }];
    }
  } else if (t === 'tool_result') {
    state.messages = state.messages.map(m =>
      m.type === 'tool' && m.toolId === msg.id
        ? { ...m, status: msg.is_error ? 'error' : 'done', output: msg.content || msg.output }
        : m
    );
  } else if (t === 'status') {
    state.processing = msg.status === 'processing';
    state.status = msg.status;
  } else if (t === 'result') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
    }
    state.isStreaming = false;
    state.currentText = '';
    state.processing = false;
    if (msg.cost != null || msg.duration != null) {
      state.messages = [...state.messages, { type: 'turn_meta', _key: nextMsgKey(), cost: msg.cost, duration: msg.duration, usage: msg.usage || null }];
    }
    if (msg.cost != null) {
      state.sessionCost = (state.sessionCost || 0) + (msg.cost || 0);
    }
    showToast(doneMessages[Math.floor(Math.random() * doneMessages.length)]);
  } else if (t === 'done') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
    }
    // Always clear streaming state on done
    state.isStreaming = false;
    state.currentText = '';
    state.processing = false;
    state.thinking = false;
    state.thinkingText = '';
    state.activity = null;
    state.status = 'idle';
    state.planMode = false;
  } else if (t === 'permission_request' || t === 'permission_request_pending') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    state.status = 'permission';
    const inputSummary = msg.toolInput
      ? (msg.toolInput.command || msg.toolInput.file_path || msg.toolInput.path || '')
      : '';
    state.messages = [...state.messages, {
      type: 'permission', requestId: msg.requestId,
      toolName: msg.toolName || 'tool', input: msg.input || msg.toolInput, inputSummary,
      decisionReason: msg.decisionReason || '', resolved: false,
    }];
  } else if (t === 'permission_resolved' || t === 'permission_cancel') {
    const decision = msg.decision || 'cancel';
    state.messages = state.messages.map(m =>
      m.type === 'permission' && m.requestId === msg.requestId
        ? { ...m, resolved: true, decision }
        : m
    );
    state.status = state.processing ? 'processing' : 'idle';
  } else if (t === 'ask_user') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    state.messages = [...state.messages, {
      type: 'ask_user', requestId: msg.requestId,
      question: msg.question, questions: msg.questions || null, answered: false,
    }];
  } else if (t === 'ask_user_answered') {
    const rid = msg.requestId || msg.toolId;
    state.messages = state.messages.map(m =>
      m.type === 'ask_user' && m.requestId === rid
        ? { ...m, answered: true }
        : m
    );
  } else if (t === 'rate_limit') {
    state.rateLimited = true;
    state.rateLimitText = msg.text || 'API rate limit reached';
    state.messages = [...state.messages, {
      type: 'system', text: 'Rate limited: ' + (msg.text || 'API rate limit reached'), isError: true, isRateLimit: true,
    }];
    // Auto-clear rate limit indicator after 60s
    setTimeout(() => { state.rateLimited = false; state.rateLimitText = ''; }, 60000);
  } else if (t === 'error') {
    if (state.isStreaming && state.currentText) {
      state.messages = finishAssistantInArray(state.messages, state.currentText);
      state.isStreaming = false;
      state.currentText = '';
    }
    state.messages = [...state.messages, {
      type: 'system', text: msg.text || msg.error || msg.message || 'Unknown error', isError: true,
    }];
  } else if (t === 'subagent_activity') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      if (msg.text) state.activity = msg.text;
      state.messages = state.messages.map(m =>
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
      state.activity = toolName && text ? toolName + ' · ' + text : text || toolName || 'Agent working...';
      state.messages = state.messages.map(m =>
        m.type === 'tool' && m.toolId === pid
          ? { ...m, subTools: [...(m.subTools || []), { name: toolName, subtitle: text }] }
          : m
      );
    }
  } else if (t === 'subagent_done') {
    const pid = msg.parentToolId || msg.agentId;
    if (pid) {
      state.messages = state.messages.map(m =>
        m.type === 'tool' && m.toolId === pid ? { ...m, status: 'done', summary: msg.summary || '', usage: msg.usage || null } : m
      );
    }
  } else if (t === 'prompt_suggestion') {
    const items = msg.suggestions || [];
    if (items.length > 0) {
      state.messages = [...state.messages, { type: 'suggestions', items, _key: nextMsgKey() }];
    }
  } else if (t === 'tool_progress') {
    const elapsed = msg.elapsed ? Math.round(msg.elapsed) : 0;
    const name = msg.toolName || 'tool';
    state.activity = name + (elapsed > 3 ? ' · ' + elapsed + 's' : '');
  } else if (t === 'hook_event') {
    if (msg.hookName) state.activity = 'Hook · ' + msg.hookName;
  } else if (t === 'compacting') {
    state.activity = msg.active ? 'Compacting conversation...' : null;
  } else if (t === 'compact_boundary') {
    state.messages = [...state.messages, {
      type: 'system',
      text: 'Context compacted' + (msg.preTokens ? ' (was ' + Math.round(msg.preTokens / 1000) + 'K tokens)' : ''),
    }];
  } else if (t === 'files_persisted') {
    if (msg.failed && msg.failed.length > 0) {
      state.messages = [...state.messages, {
        type: 'system', text: 'File save failed: ' + msg.failed.map(f => f.name).join(', '), isError: true,
      }];
    }
  } else if (t === 'auth_status') {
    if (msg.isAuthenticating) {
      state.activity = 'Authenticating...';
    } else if (msg.error) {
      state.messages = [...state.messages, {
        type: 'system', text: 'Auth error: ' + msg.error, isError: true,
      }];
    }
  } else if (t === 'task_notification') {
    if (msg.status === 'failed') {
      state.messages = [...state.messages, {
        type: 'system', text: 'Task failed' + (msg.summary ? ': ' + msg.summary : ''), isError: true,
      }];
    }
  } else if (t === 'slash_command_result') {
    state.messages = [...state.messages, { type: 'system', _key: nextMsgKey(), text: msg.result || msg.output || '' }];
  } else if (t === 'rewind_complete') {
    state.messages = [...state.messages, { type: 'system', _key: nextMsgKey(), text: 'Rewind complete' }];
  } else if (t === 'rewind_error') {
    state.messages = [...state.messages, { type: 'system', _key: nextMsgKey(), text: 'Rewind failed: ' + (msg.error || 'Unknown error'), isError: true }];
  }

  return state;
}
