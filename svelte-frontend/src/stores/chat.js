// Chat message store — manages messages for the active session
import { writable, get } from 'svelte/store';
import { onMessage, send } from './ws.js';
import { activeSessionId, sessionRekeying } from './sessions.js';
import { popupMessageInFlight } from './popups.js';

// Message list for current session
// Each item: { type: 'user'|'assistant'|'system', text, images?, pastes?, uuid?, turn }
export const messages = writable([]);
export const processing = writable(false);
export const activity = writable(null); // null or string like "Thinking..."
export const currentDelta = writable(''); // streaming assistant text
export const thinking = writable({ active: false, text: '' });
export const historyDone = writable(false);

// Context/usage data
export const contextData = writable({ used: 0, max: 200000, model: '', percent: 0 });
export const projectInfo = writable({ name: '', cwd: '', version: '', slug: '', accounts: [], debug: false });
export const clientCount = writable(1);
export const slashCommands = writable([]);
export const modelInfo = writable({ model: '', models: [] });

let turnCounter = 0;
let currentFullText = '';
let isStreaming = false;

const thinkingVerbs = [
  'Thinking', 'Reasoning', 'Analyzing', 'Considering', 'Processing',
  'Evaluating', 'Pondering', 'Exploring', 'Investigating', 'Working'
];

function randomThinkingVerb() {
  return thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
}

function finalizeAssistant() {
  if (!isStreaming) return;
  isStreaming = false;
  const text = currentFullText;
  currentFullText = '';
  currentDelta.set('');
  if (text) {
    messages.update(msgs => {
      // Find the last assistant message and finalize it
      const last = msgs[msgs.length - 1];
      if (last && last.type === 'assistant') {
        return [...msgs.slice(0, -1), { ...last, text, finalized: true }];
      }
      return msgs;
    });
  }
}

function ensureAssistantBlock() {
  if (!isStreaming) {
    isStreaming = true;
    currentFullText = '';
    messages.update(msgs => [...msgs, {
      type: 'assistant',
      text: '',
      turn: turnCounter,
      finalized: false,
    }]);
  }
}

export function sendMessage(text, images, pastes) {
  if (!text && (!images || images.length === 0)) return;
  // Add user message locally (server sends user_message to OTHER viewers, not the sender)
  finalizeAssistant();
  turnCounter++;
  messages.update(msgs => [...msgs, {
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
  processing.set(false);
  activity.set(null);
  currentDelta.set('');
  thinking.set({ active: false, text: '' });
  historyDone.set(false);
  turnCounter = 0;
  currentFullText = '';
  isStreaming = false;
}

// Pending seed state for popup→fullscreen transition.
// Applied after resetChat() when session switches.
let pendingSeed = null;

export function seedChat(state) {
  pendingSeed = state || null;
}

function applyPendingSeed() {
  const state = pendingSeed;
  pendingSeed = null;
  if (!state) return;
  if (state.messages) messages.set(state.messages);
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

// Reset when session switches — but NOT during re-key (temp→real ID swap)
activeSessionId.subscribe(() => {
  if (sessionRekeying) return;
  resetChat();
  applyPendingSeed();
});

// Handle all chat-related WebSocket messages
// IMPORTANT: Skip popup-tagged messages — those go to popups.js
onMessage((msg) => {
  if (msg._popupSessionId) return;
  if (msg.type === 'popup_history_start' || msg.type === 'popup_history_done') return;

  // When a popup_message is in-flight, the server temporarily routes untagged
  // session messages (status, thinking, delta, done) for the popup session.
  // These leak into the main chat and must be suppressed.
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
      // Chat reset happens via activeSessionId subscription
      break;

    case 'history_done':
      // Finalize any pending assistant block from replay
      finalizeAssistant();
      historyDone.set(true);
      break;

    case 'history_meta':
      // Could track pagination here
      break;

    case 'user_message':
      finalizeAssistant();
      turnCounter++;
      messages.update(msgs => [...msgs, {
        type: 'user',
        text: msg.text || '',
        images: msg.images || null,
        pastes: msg.pastes || null,
        turn: turnCounter,
      }]);
      break;

    case 'status':
      if (msg.status === 'processing') {
        processing.set(true);
        activity.set(randomThinkingVerb() + '...');
      }
      break;

    case 'compacting':
      activity.set(msg.active ? 'Compacting conversation...' : randomThinkingVerb() + '...');
      break;

    case 'thinking_start':
      thinking.set({ active: true, text: '' });
      break;

    case 'thinking_delta':
      if (typeof msg.text === 'string') {
        thinking.update(t => ({ ...t, text: t.text + msg.text }));
      }
      break;

    case 'thinking_stop':
      thinking.set({ active: false, text: '' });
      activity.set(randomThinkingVerb() + '...');
      break;

    case 'delta':
      if (typeof msg.text !== 'string') break;
      thinking.set({ active: false, text: '' });
      activity.set(null);
      ensureAssistantBlock();
      currentFullText += msg.text;
      currentDelta.set(currentFullText);
      // Update the last assistant message's text for live rendering
      messages.update(msgs => {
        const last = msgs[msgs.length - 1];
        if (last && last.type === 'assistant' && !last.finalized) {
          return [...msgs.slice(0, -1), { ...last, text: currentFullText }];
        }
        return msgs;
      });
      break;

    case 'result':
      // Cost/usage metadata after response
      if (msg.usage) {
        contextData.update(d => ({
          ...d,
          cost: (d.cost || 0) + (msg.cost || 0),
        }));
      }
      break;

    case 'done':
      finalizeAssistant();
      processing.set(false);
      activity.set(null);
      thinking.set({ active: false, text: '' });
      break;

    case 'error':
      messages.update(msgs => [...msgs, {
        type: 'system',
        text: msg.error || msg.message || 'An error occurred',
        isError: true,
      }]);
      break;

    case 'tool_start':
      thinking.set({ active: false, text: '' });
      ensureAssistantBlock();
      // Add tool entry to messages
      messages.update(msgs => [...msgs, {
        type: 'tool',
        toolId: msg.id,
        name: msg.name,
        status: 'running',
        input: null,
        output: null,
      }]);
      break;

    case 'tool_executing':
      messages.update(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, input: msg.input }
          : m
      ));
      break;

    case 'tool_result':
      messages.update(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, status: msg.is_error ? 'error' : 'done', output: msg.output }
          : m
      ));
      break;

    case 'permission_request':
    case 'permission_request_pending':
      messages.update(msgs => [...msgs, {
        type: 'permission',
        requestId: msg.requestId,
        toolName: msg.toolName,
        input: msg.input || msg.toolInput,
        resolved: false,
      }]);
      break;

    case 'permission_resolved':
      messages.update(msgs => msgs.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision: msg.decision }
          : m
      ));
      break;

    case 'permission_cancel':
      messages.update(msgs => msgs.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision: 'cancelled' }
          : m
      ));
      break;

    case 'ask_user':
      messages.update(msgs => [...msgs, {
        type: 'ask_user',
        requestId: msg.requestId,
        question: msg.question,
        answered: false,
      }]);
      break;

    case 'ask_user_answered':
      messages.update(msgs => msgs.map(m =>
        m.type === 'ask_user' && m.requestId === msg.requestId
          ? { ...m, answered: true }
          : m
      ));
      break;

    case 'subagent_activity':
      thinking.set({ active: false, text: '' });
      ensureAssistantBlock();
      messages.update(msgs => [...msgs, {
        type: 'tool',
        toolId: msg.agentId,
        name: 'Agent: ' + (msg.title || 'subagent'),
        status: 'running',
        input: null,
        output: null,
      }]);
      break;

    case 'subagent_tool':
      // Update subagent with tool info
      messages.update(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.agentId
          ? { ...m, input: msg.toolName || m.input }
          : m
      ));
      break;

    case 'subagent_done':
      messages.update(msgs => msgs.map(m =>
        m.type === 'tool' && m.toolId === msg.agentId
          ? { ...m, status: 'done' }
          : m
      ));
      break;

    case 'slash_command_result':
      messages.update(msgs => [...msgs, {
        type: 'system',
        text: msg.result || msg.output || '',
      }]);
      break;

    case 'rewind_complete':
      messages.update(msgs => [...msgs, {
        type: 'system',
        text: 'Rewind complete',
      }]);
      break;

    case 'rewind_error':
      messages.update(msgs => [...msgs, {
        type: 'system',
        text: 'Rewind failed: ' + (msg.error || 'Unknown error'),
        isError: true,
      }]);
      break;

    case 'message_uuid':
      // Attach UUID to most recent message of matching type
      messages.update(msgs => {
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
