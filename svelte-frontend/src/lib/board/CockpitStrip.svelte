<script>
  import { onMount, onDestroy } from 'svelte';
  import { getBasePath } from '../../stores/ws.js';
  import { boardData, fetchBoard } from '../../stores/board.js';
  import { onMessage, send } from '../../stores/ws.js';
  import { sessions, activeSessionId, createSession } from '../../stores/sessions.js';
  import { openPopup } from '../../stores/popups.js';
  import MessageList from '../chat/MessageList.svelte';
  import InputArea from '../chat/InputArea.svelte';

  // --- Widget state ---
  let minimized = $state(false);
  let activeTab = $state('chat'); // 'chat' | 'strategy' | 'tests'
  let strategyData = $state(null);
  let cockpitState = $state({ sessionDate: null, testStatus: {}, notes: [] });
  let loading = $state(true);

  // --- Drag state ---
  let posX = $state(20);
  let posY = $state(80);
  let widgetW = $state(420);
  let widgetH = $state(480);
  let dragging = $state(false);
  let dragStart = { x: 0, y: 0, posX: 0, posY: 0 };

  // --- Resize state ---
  let resizing = $state(false);
  let resizeEdge = $state(null); // 'e' | 'w' | 's' | 'n' | 'se' | 'sw' | 'ne' | 'nw'
  let resizeStart = { x: 0, y: 0, w: 0, h: 0, posX: 0, posY: 0 };
  const MIN_W = 280;
  const MIN_H = 200;
  const MAX_W = 1400;
  const MAX_H = 900;

  // --- Chat state (independent of popup store) ---
  let chatMessages = $state([]);
  let chatProcessing = $state(false);
  let chatThinking = $state(false);
  let chatActivity = $state(null);
  let chatStreamText = $state('');
  let chatIsStreaming = $state(false);
  let chatSessionLinked = $state(false);
  let chatTasks = $state([]);
  let chatLoadingHistory = $state(false);
  let unsubWs = null;
  let msgIdCounter = 0;
  function nextMsgId() { return 'cs-' + (++msgIdCounter); }

  // Tool classification sets (matching popup store)
  const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'TodoWrite']);
  const AGENT_TOOLS = new Set(['Agent']);

  // --- Agent task state ---
  let agentTask = $state(null); // { runId, task, log: [{type, text, tool, ...}], currentTool, done, error, data }
  let agentPopupOpen = $state(false);

  async function runAgentTask(taskName) {
    if (agentMode === 'interactive') {
      injectIntoSession(taskName);
    } else {
      runAutonomous(taskName);
    }
  }

  async function injectIntoSession(taskName) {
    if (!strategySession) {
      // No session — create one, inject after ready
      pendingTaskInject = taskName;
      handleCreateSession();
      return;
    }
    try {
      const res = await fetch(getBasePath() + 'api/agent/task-prompt?task=' + encodeURIComponent(taskName));
      const json = await res.json();
      if (!json.prompt) {
        console.log('[cockpit] No prompt returned for task:', taskName);
        return;
      }
      injectedTask = taskName;
      setTimeout(() => { injectedTask = null; }, 1500);
      // Show full prompt in chat so user sees exactly what's being sent
      chatMessages = [...chatMessages, { type: 'user', text: json.prompt, _key: nextMsgId() }];
      chatProcessing = true;
      chatThinking = true;
      send({ type: 'popup_message', sessionId: strategySession.id, text: json.prompt });
    } catch (e) {
      console.log('[cockpit] Failed to inject task prompt:', e);
    }
  }

  async function runAutonomous(taskName) {
    // If already running, show the dropdown
    if (agentTask && !agentTask.done) {
      agentPopupOpen = true;
      return;
    }
    agentTask = { runId: null, task: taskName, log: [], currentTool: null, textBuf: '', done: false, error: null, data: null };
    agentPopupOpen = true;
    try {
      const res = await fetch(getBasePath() + 'api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: taskName }),
      });
      const json = await res.json();
      if (json.ok) {
        agentTask = { ...agentTask, runId: json.runId };
      } else if (json.error && json.error.includes('already running')) {
        const runningTask = json.error.match(/running: (.+)/);
        agentTask = { ...agentTask, task: runningTask ? runningTask[1] : taskName, runId: '__reconnected', done: false, error: null };
      } else {
        agentTask = { ...agentTask, done: true, error: json.error };
      }
    } catch (e) {
      agentTask = { ...agentTask, done: true, error: e.message };
    }
  }

  // Track which button was just injected (for visual feedback)
  let injectedTask = $state(null);
  // Pending task to inject after session creation
  let pendingTaskInject = $state(null);
  // Agent mode toggle: 'interactive' (inject into session) or 'autonomous' (one-shot popup)
  let agentMode = $state('interactive');

  function dismissAgentTask() {
    agentPopupOpen = false;
    if (agentTask && agentTask.done) agentTask = null;
  }

  function viewLastResult(taskName) {
    const lastRun = cockpitState.lastRuns && cockpitState.lastRuns[taskName];
    if (!lastRun) return;
    agentTask = { runId: null, task: taskName, log: [], currentTool: null, textBuf: '', done: true, error: null, data: lastRun.data };
    agentPopupOpen = true;
  }

  function viewHistoryRun(run) {
    agentTask = { runId: null, task: run.task, log: [], currentTool: null, textBuf: '', done: true, error: null, data: run.data };
    agentPopupOpen = true;
  }

  let showHistory = $state(false);

  // Format relative time
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  // Collapse tool_start + tool_done pairs into single lines
  let agentLogDisplay = $derived.by(() => {
    if (!agentTask || !agentTask.log) return [];
    const raw = agentTask.log;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (entry.type === 'tool_done' && entry.id) {
        // Find matching tool_start by id and replace it
        let merged = false;
        for (let j = out.length - 1; j >= 0; j--) {
          if (out[j].type === 'tool' && out[j].id === entry.id) {
            out[j] = { type: 'tool_done', tool: entry.tool || out[j].tool, detail: entry.detail || out[j].detail, preview: entry.preview };
            merged = true;
            break;
          }
        }
        if (!merged) out.push(entry);
      } else {
        out.push(entry);
      }
    }
    return out.slice(-15);
  });

  // --- Strategy session ---
  // Explicit session ID chosen by the user (persisted)
  let chosenSessionId = $state(null);
  let waitingForNew = $state(false);
  let knownSessionIds = $state(new Set()); // snapshot of IDs before creating new session

  function loadChosenSession() {
    try {
      chosenSessionId = localStorage.getItem('cockpit-strategy-session') || null;
    } catch {}
  }

  function saveChosenSession(id) {
    chosenSessionId = id;
    try {
      if (id) localStorage.setItem('cockpit-strategy-session', id);
      else localStorage.removeItem('cockpit-strategy-session');
    } catch {}
  }

  // All sessions in the strategy area
  let strategySessions = $derived.by(() => {
    if (!$boardData) return [];
    const stratArea = $boardData.areas.find(a => a.name === 'strategy');
    if (!stratArea) return [];
    const all = [];
    if (stratArea.areaSessions) all.push(...stratArea.areaSessions);
    for (const proj of stratArea.projects) {
      all.push(...proj.sessions);
      for (const sub of proj.subProjects) {
        if (sub.sessions) all.push(...sub.sessions);
      }
    }
    return all;
  });

  // The active strategy session — chosen by user, or null
  // Check boardData strategy sessions first, fall back to global sessions store
  let strategySession = $derived.by(() => {
    if (!chosenSessionId) return null;
    return strategySessions.find(s => s.id === chosenSessionId)
      || $sessions.find(s => s.id === chosenSessionId)
      || null;
  });

  // When waiting for a new session, watch $sessions store for the new one
  // (boardData refresh is too slow / may not include the session yet)
  $effect(() => {
    if (!waitingForNew) return;
    const allSessions = $sessions;
    const newSession = allSessions.find(s => !knownSessionIds.has(s.id));
    if (newSession) {
      waitingForNew = false;
      knownSessionIds = new Set();
      selectSession(newSession.id);
      // Also refresh board in background so it appears in the strategy area
      fetchBoard();
      // If a task was pending injection, inject it now
      if (pendingTaskInject) {
        const taskToInject = pendingTaskInject;
        pendingTaskInject = null;
        // Small delay to let the session link establish via WS
        setTimeout(() => { runAgentTask(taskToInject); }, 500);
      }
    }
  });

  // Link to WS when strategy session appears/changes
  $effect(() => {
    if (strategySession && !chatSessionLinked) {
      chatSessionLinked = true;
      send({ type: 'popup_open', sessionId: strategySession.id });
    }
  });

  // Derived stats
  let processingCount = $derived.by(() => {
    if (!$boardData) return 0;
    let count = 0;
    for (const area of $boardData.areas) {
      for (const proj of area.projects) {
        count += proj.sessions.filter(s => s.isProcessing).length;
        for (const sub of proj.subProjects) {
          if (sub.sessions) count += sub.sessions.filter(s => s.isProcessing).length;
        }
      }
    }
    return count;
  });

  let testsPassing = $derived.by(() => {
    if (!strategyData?.tests) return 0;
    return strategyData.tests.filter(t => cockpitState.testStatus[t.label]).length;
  });

  let testsTotal = $derived(strategyData?.tests?.length || 0);

  // Layout mode based on widget width
  // narrow (<480): tabs, one panel at a time
  // strat-wide (480-680): still tabs, but strategy content (alloc+gaps) flows side-by-side
  // dual (680-900): chat + strategy side by side
  // triple (>900): chat + strategy + tests all visible
  let layoutMode = $derived(
    widgetW >= 1150 ? 'triple' : widgetW >= 680 ? 'dual' : 'narrow'
  );
  let stratGridCols = $derived(
    (layoutMode === 'narrow' && widgetW >= 480) ||
    (layoutMode === 'dual' && widgetW >= 900) ||
    (layoutMode === 'triple' && widgetW >= 1300)
  );

  function selectSession(id) {
    // Reset chat state when switching sessions
    chatMessages = [];
    chatProcessing = false;
    chatThinking = false;
    chatActivity = null;
    chatStreamText = '';
    chatIsStreaming = false;
    chatSessionLinked = false;
    chatLoadingHistory = false;
    saveChosenSession(id);
    // Link to new session
    if (id) {
      chatSessionLinked = true;
      send({ type: 'popup_open', sessionId: id });
    }
  }

  // --- Persistence ---
  function loadPosition() {
    try {
      const raw = localStorage.getItem('cockpit-widget-pos');
      if (raw) {
        const p = JSON.parse(raw);
        posX = p.x ?? 20;
        posY = p.y ?? 80;
      }
    } catch {}
    try {
      const raw = localStorage.getItem('cockpit-widget-size');
      if (raw) {
        const s = JSON.parse(raw);
        widgetW = Math.max(MIN_W, Math.min(MAX_W, s.w ?? 420));
        widgetH = Math.max(MIN_H, Math.min(MAX_H, s.h ?? 480));
      }
    } catch {}
    try {
      minimized = localStorage.getItem('cockpit-widget-min') === '1';
    } catch {}
    loadChosenSession();
  }

  function savePosition() {
    try {
      localStorage.setItem('cockpit-widget-pos', JSON.stringify({ x: posX, y: posY }));
    } catch {}
  }

  function saveSize() {
    try {
      localStorage.setItem('cockpit-widget-size', JSON.stringify({ w: widgetW, h: widgetH }));
    } catch {}
  }

  function saveMinimized() {
    try {
      localStorage.setItem('cockpit-widget-min', minimized ? '1' : '0');
    } catch {}
  }

  // --- Drag handling ---
  let didDrag = false;

  function handleDragStart(e) {
    if (e.target.closest('button, input, textarea, label, .tab-content, .resize-handle')) return;
    dragging = true;
    didDrag = false;
    dragStart = { x: e.clientX, y: e.clientY, posX, posY };
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (resizing) {
      handleResizeMove(e);
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    posX = Math.max(0, Math.min(window.innerWidth - 100, dragStart.posX + dx));
    posY = Math.max(0, Math.min(window.innerHeight - 50, dragStart.posY + dy));
  }

  function handleMouseUp() {
    if (dragging) {
      dragging = false;
      savePosition();
    }
    if (resizing) {
      resizing = false;
      resizeEdge = null;
      saveSize();
      savePosition();
    }
  }

  function handleBadgeClick() {
    if (!didDrag) toggleMinimize();
  }

  // --- Resize handling ---
  function handleResizeStart(edge, e) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    resizeEdge = edge;
    resizeStart = { x: e.clientX, y: e.clientY, w: widgetW, h: widgetH, posX, posY };
  }

  function handleResizeMove(e) {
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const edge = resizeEdge;

    let newW = resizeStart.w;
    let newH = resizeStart.h;
    let newX = resizeStart.posX;
    let newY = resizeStart.posY;

    // East edges: grow width rightward
    if (edge.includes('e')) {
      newW = Math.max(MIN_W, Math.min(MAX_W, resizeStart.w + dx));
    }
    // West edges: grow width leftward (move position)
    if (edge.includes('w')) {
      const dw = Math.max(MIN_W, Math.min(MAX_W, resizeStart.w - dx)) - resizeStart.w;
      newW = resizeStart.w + dw;
      newX = resizeStart.posX - dw;
    }
    // South edges: grow height downward
    if (edge.includes('s')) {
      newH = Math.max(MIN_H, Math.min(MAX_H, resizeStart.h + dy));
    }
    // North edges: grow height upward (move position)
    if (edge.includes('n')) {
      const dh = Math.max(MIN_H, Math.min(MAX_H, resizeStart.h - dy)) - resizeStart.h;
      newH = resizeStart.h + dh;
      newY = resizeStart.posY - dh;
    }

    widgetW = newW;
    widgetH = newH;
    posX = Math.max(0, newX);
    posY = Math.max(0, newY);
  }

  // --- Lifecycle ---
  onMount(() => {
    loadPosition();
    loadStrategy();
    loadCockpitState();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    unsubWs = onMessage((msg) => {
      // Handle agent task events (global, not session-specific)
      if (msg.type === 'agent_task_progress' && agentTask && (agentTask.runId === msg.runId || agentTask.runId === '__reconnected')) {
        // Latch onto the real runId on first progress event after reconnect
        if (agentTask.runId === '__reconnected') agentTask = { ...agentTask, runId: msg.runId };
        const evt = msg.event;
        if (!evt) return;
        if (evt.type === 'text') {
          agentTask = { ...agentTask, textBuf: agentTask.textBuf + evt.text };
        } else if (evt.type === 'thinking') {
          // Show latest thinking snippet as activity
          const snippet = evt.text.length > 80 ? evt.text.slice(-80) : evt.text;
          agentTask = { ...agentTask, currentTool: null, log: [...agentTask.log.slice(-30), { type: 'thinking', text: snippet }] };
        } else if (evt.type === 'tool_start') {
          agentTask = { ...agentTask, currentTool: evt.tool, log: [...agentTask.log.slice(-30), { type: 'tool', tool: evt.tool, detail: evt.detail || '', id: evt.id }] };
        } else if (evt.type === 'tool_input') {
          // skip
        } else if (evt.type === 'tool_result') {
          const preview = evt.output ? evt.output.substring(0, 120) : '';
          agentTask = { ...agentTask, currentTool: null, log: [...agentTask.log.slice(-30), { type: 'tool_done', tool: evt.tool || '', detail: evt.detail || '', id: evt.id, preview }] };
        }
        return;
      }
      if (msg.type === 'agent_task_done' && agentTask && (agentTask.runId === msg.runId || agentTask.runId === '__reconnected')) {
        agentTask = { ...agentTask, done: true, data: msg.data, currentTool: null };
        // Refresh dashboard data
        loadStrategy();
        loadCockpitState();
        return;
      }
      if (msg.type === 'agent_task_error' && agentTask && (agentTask.runId === msg.runId || agentTask.runId === '__reconnected')) {
        agentTask = { ...agentTask, done: true, error: msg.error, currentTool: null };
        return;
      }
      if (msg.type === 'agent_task_start' && !agentTask) {
        agentTask = { runId: msg.runId, task: msg.task, log: [], currentTool: null, textBuf: '', done: false, error: null, data: null };
        return;
      }

      if (!strategySession) return;
      // Accept messages that are: popup-tagged for us, history events, or direct session messages matching our session
      const sid = msg._popupSessionId || msg.sessionId;
      const isForUs = sid === strategySession.id;
      const isHistory = msg.type === 'popup_history_start' || msg.type === 'popup_history_done';
      // Also accept un-tagged messages that match known session event types (during popup_message processing, server sends as direct session)
      const isSessionEvent = !sid && ['delta', 'assistant_delta', 'thinking_start', 'thinking_stop', 'tool_start', 'tool_executing', 'tool_result', 'tool_progress', 'status', 'result', 'done', 'error', 'permission_request', 'permission_request_pending', 'permission_resolved', 'permission_cancel', 'subagent_activity', 'subagent_tool', 'subagent_done', 'compacting', 'user_message', 'session_id', 'thinking_delta'].includes(msg.type);
      if (!isForUs && !isHistory && !isSessionEvent) {
        if (['delta','assistant_delta','thinking_start','thinking_stop','tool_start','tool_executing','tool_result','status','result','done','error'].includes(msg.type)) {
          console.log('[cockpit-ws-DROPPED]', msg.type, 'sid:', sid, 'stratSess:', strategySession.id, '_popup:', msg._popupSessionId, 'sessId:', msg.sessionId);
        }
        return;
      }
      console.log('[cockpit-ws-ACCEPT]', msg.type, 'isForUs:', isForUs, 'isHistory:', isHistory, 'isSessionEvent:', isSessionEvent);
      handleWsMessage(msg);
    });
  });

  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (unsubWs) unsubWs();
  });

  // --- WS message handler (builds rich messages matching popup store format) ---
  function toolSubtitle(name, input) {
    if (!input) return '';
    if (name === 'Bash') return input.command?.substring(0, 60) || '';
    if (name === 'Read') return input.file_path || '';
    if (name === 'Write') return input.file_path || '';
    if (name === 'Edit') return input.file_path || '';
    if (name === 'Grep') return input.pattern || '';
    if (name === 'Glob') return input.pattern || '';
    return input.description || input.command?.substring(0, 50) || input.file_path || input.pattern || '';
  }

  function handleWsMessage(msg) {
    const t = msg.type;

    if (t === 'popup_history_start') { chatMessages = []; chatLoadingHistory = true; return; }
    if (t === 'popup_history_done') { finalizeStream(); chatLoadingHistory = false; return; }

    if (t === 'user_message') {
      finalizeStream();
      chatMessages = [...chatMessages, { type: 'user', text: msg.text || '', _key: nextMsgId() }];
    } else if (t === 'delta' || t === 'assistant_delta') {
      chatThinking = false;
      chatActivity = null;
      const delta = msg.text || msg.delta || '';
      if (!chatIsStreaming) {
        chatIsStreaming = true;
        chatStreamText = delta;
        chatMessages = [...chatMessages, { type: 'assistant', text: delta, streaming: true, _key: nextMsgId() }];
      } else {
        chatStreamText += delta;
        const msgs = [...chatMessages];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].type === 'assistant' && msgs[i].streaming) {
            msgs[i] = { ...msgs[i], text: chatStreamText };
            break;
          }
        }
        chatMessages = msgs;
      }
    } else if (t === 'thinking_start') {
      chatThinking = true;
    } else if (t === 'thinking_stop') {
      chatThinking = false;
    } else if (t === 'tool_start') {
      finalizeStream();
      chatThinking = false;
      const name = msg.name || msg.toolName || 'tool';
      chatActivity = name;
      chatMessages = [...chatMessages, {
        type: 'tool',
        toolId: msg.id || msg.toolUseId,
        name,
        status: 'running',
        subtitle: '',
        isTaskTool: TASK_TOOLS.has(name),
        isAgent: AGENT_TOOLS.has(name),
        subTools: AGENT_TOOLS.has(name) ? [] : null,
        _key: 'tool-' + (msg.id || msg.toolUseId || nextMsgId()),
      }];
    } else if (t === 'tool_executing') {
      const name = msg.name || '';
      const subtitle = toolSubtitle(name, msg.input);
      chatActivity = subtitle ? name + ' · ' + subtitle : name;
      chatMessages = chatMessages.map(m =>
        m.type === 'tool' && m.toolId === msg.id ? { ...m, input: msg.input, subtitle } : m
      );
    } else if (t === 'tool_result') {
      chatMessages = chatMessages.map(m =>
        m.type === 'tool' && m.toolId === msg.id
          ? { ...m, status: msg.is_error ? 'error' : 'done', output: msg.content || msg.output }
          : m
      );
    } else if (t === 'permission_request' || t === 'permission_request_pending') {
      finalizeStream();
      const inputSummary = msg.toolInput
        ? (msg.toolInput.command || msg.toolInput.file_path || msg.toolInput.path || '')
        : '';
      chatMessages = [...chatMessages, {
        type: 'permission', requestId: msg.requestId,
        toolName: msg.toolName || 'tool', inputSummary, resolved: false,
        _key: 'perm-' + msg.requestId,
      }];
    } else if (t === 'permission_resolved' || t === 'permission_cancel') {
      const decision = msg.decision || 'cancel';
      chatMessages = chatMessages.map(m =>
        m.type === 'permission' && m.requestId === msg.requestId
          ? { ...m, resolved: true, decision }
          : m
      );
    } else if (t === 'status') {
      chatProcessing = msg.status === 'processing';
    } else if (t === 'result') {
      finalizeStream();
      chatProcessing = false;
      if (msg.cost != null || msg.duration != null) {
        chatMessages = [...chatMessages, { type: 'turn_meta', cost: msg.cost, duration: msg.duration, _key: nextMsgId() }];
      }
    } else if (t === 'done') {
      finalizeStream();
      chatProcessing = false;
      chatThinking = false;
      chatActivity = null;
    } else if (t === 'error') {
      finalizeStream();
      chatMessages = [...chatMessages, { type: 'system', text: msg.text || msg.message || 'Error', isError: true, _key: nextMsgId() }];
    } else if (t === 'subagent_activity') {
      const pid = msg.parentToolId || msg.agentId;
      if (msg.text) chatActivity = msg.text;
      if (pid) {
        chatMessages = chatMessages.map(m =>
          m.type === 'tool' && m.toolId === pid
            ? { ...m, subtitle: msg.text || msg.title || m.subtitle }
            : m
        );
      }
    } else if (t === 'subagent_tool') {
      const pid = msg.parentToolId || msg.agentId;
      const name = msg.toolName || '';
      const text = msg.text || '';
      chatActivity = name && text ? name + ' · ' + text : text || name || 'Agent working...';
      if (pid) {
        chatMessages = chatMessages.map(m =>
          m.type === 'tool' && m.toolId === pid
            ? { ...m, subTools: [...(m.subTools || []), { name, subtitle: text }] }
            : m
        );
      }
    } else if (t === 'subagent_done') {
      const pid = msg.parentToolId || msg.agentId;
      if (pid) {
        chatMessages = chatMessages.map(m =>
          m.type === 'tool' && m.toolId === pid ? { ...m, status: 'done' } : m
        );
      }
    } else if (t === 'tool_progress') {
      const elapsed = msg.elapsed ? Math.round(msg.elapsed) : 0;
      chatActivity = (msg.toolName || 'tool') + (elapsed > 3 ? ' · ' + elapsed + 's' : '');
    } else if (t === 'compacting') {
      chatMessages = [...chatMessages, { type: 'system', text: 'Compacting context...', _key: nextMsgId() }];
    } else if (t === 'session_id') {
      if (msg.cliSessionId && msg.cliSessionId !== strategySession?.id) {
        chatSessionLinked = false;
      }
    }
  }

  function finalizeStream() {
    if (!chatIsStreaming) return;
    const msgs = [...chatMessages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'assistant' && msgs[i].streaming) {
        msgs[i] = { ...msgs[i], text: chatStreamText, streaming: false };
        break;
      }
    }
    chatMessages = msgs;
    chatIsStreaming = false;
    chatStreamText = '';
  }


  // --- Data loading ---
  async function loadStrategy() {
    loading = true;
    try {
      const res = await fetch(getBasePath() + 'api/board/strategy');
      if (res.ok) {
        strategyData = await res.json();
        if (strategyData.sessionDate && cockpitState.sessionDate && cockpitState.sessionDate !== strategyData.sessionDate) {
          cockpitState = { sessionDate: strategyData.sessionDate, testStatus: {}, notes: [] };
          saveCockpitState();
        }
      }
    } catch (e) {}
    loading = false;
  }

  async function loadCockpitState() {
    try {
      const res = await fetch(getBasePath() + 'api/board/cockpit-state');
      if (res.ok) cockpitState = await res.json();
    } catch (e) {}
  }

  async function saveCockpitState() {
    try {
      await fetch(getBasePath() + 'api/board/cockpit-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cockpitState),
      });
    } catch (e) {}
  }

  function toggleTest(label) {
    cockpitState.testStatus[label] = !cockpitState.testStatus[label];
    cockpitState = { ...cockpitState };
    saveCockpitState();
  }

  // --- Actions ---
  function handleCreateSession() {
    // Snapshot ALL current session IDs so we can detect the truly new one
    knownSessionIds = new Set($sessions.map(s => s.id));
    waitingForNew = true;
    createSession(null, false, 'strategy');
  }

  let isFocused = $state(false);


  function openInPopup() {
    if (strategySession) openPopup(strategySession.id, strategySession.title || 'Strategy');
  }

  function toggleMinimize() {
    minimized = !minimized;
    saveMinimized();
  }

  // Track the widget state before entering focus, so we can restore it
  let preMinimized = false;

  function expandFocused() {
    preMinimized = minimized;
    isFocused = true;
  }

  function collapseFocused() {
    isFocused = false;
    minimized = preMinimized;
    saveMinimized();
  }

  async function gatherSessionContext() {
    if (!$boardData) return '';
    const activeSessions = [];
    for (const area of $boardData.areas) {
      for (const proj of area.projects) {
        for (const s of proj.sessions) {
          activeSessions.push({ id: s.id, title: s.title, area: area.name, project: proj.name, processing: s.isProcessing });
        }
        for (const sub of proj.subProjects) {
          if (sub.sessions) {
            for (const s of sub.sessions) {
              activeSessions.push({ id: s.id, title: s.title, area: area.name, project: proj.name + '/' + sub.name, processing: s.isProcessing });
            }
          }
        }
      }
    }

    const fetches = activeSessions.map(async (s) => {
      try {
        const res = await fetch(getBasePath() + `api/sessions/${encodeURIComponent(s.id)}/messages?limit=10`);
        if (!res.ok) return null;
        const data = await res.json();
        return { ...s, messages: data.messages || [] };
      } catch { return null; }
    });

    const results = await Promise.all(fetches);
    const parts = [];
    for (const r of results) {
      if (!r || r.messages.length === 0) continue;
      let part = `--- "${r.title || 'Untitled'}" (${r.area}/${r.project}) ${r.processing ? '[PROCESSING]' : '[idle]'} ---\n`;
      for (const m of r.messages) {
        if (m.type === 'user') part += `User: ${m.text.substring(0, 200)}\n`;
        else if (m.type === 'assistant') part += `Claude: ${m.text.substring(0, 300)}\n`;
        else if (m.type === 'tool') part += `[tool: ${m.name}]\n`;
      }
      parts.push(part);
    }
    if (parts.length === 0) return '';
    return '\n\n[LIVE SESSION CONTEXT]\n\n' + parts.join('\n') + '\n[END CONTEXT]\n\n';
  }

  async function handleChatSend(text) {
    if (!text || !strategySession) return;

    chatMessages = [...chatMessages, { type: 'user', text, _key: nextMsgId() }];
    chatProcessing = true;
    chatThinking = true;

    const contextKeywords = ['status', 'update', 'what did', 'what should', 'where am i', 'on track', 'drift', 'focus', 'today', 'this week', 'progress', 'recap'];
    const needsContext = contextKeywords.some(k => text.toLowerCase().includes(k));

    let fullMessage = text;
    if (needsContext) {
      const context = await gatherSessionContext();
      if (context) fullMessage = context + text;
    }

    send({ type: 'popup_message', sessionId: strategySession.id, text: fullMessage });
  }

  function handleChatStop() {
    if (strategySession) send({ type: 'popup_stop', sessionId: strategySession.id });
  }

  function urgencyColor(urgency) {
    if (!urgency) return '#6b6760';
    const u = urgency.toUpperCase();
    if (u.includes('CRITICAL') || u.includes('HIGHEST')) return '#e5534b';
    if (u.includes('HIGH')) return '#da7756';
    if (u.includes('MEDIUM')) return '#d4a72c';
    return '#6b6760';
  }

  function urgencyBars(urgency) {
    if (!urgency) return 1;
    const u = urgency.toUpperCase();
    if (u.includes('CRITICAL') || u.includes('HIGHEST')) return 4;
    if (u.includes('HIGH')) return 3;
    if (u.includes('MEDIUM')) return 2;
    return 1;
  }

  function areaSessionCount(trackName) {
    if (!$boardData) return { total: 0, processing: 0 };
    const nt = trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const area of $boardData.areas) {
      const na = area.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (nt.includes(na) || na.includes(nt)) {
        let total = (area.areaSessions?.length || 0);
        let processing = (area.areaSessions?.filter(s => s.isProcessing).length || 0);
        for (const p of area.projects) {
          total += p.sessions.length;
          processing += p.sessions.filter(s => s.isProcessing).length;
          for (const sub of p.subProjects) {
            if (sub.sessions) {
              total += sub.sessions.length;
              processing += sub.sessions.filter(s => s.isProcessing).length;
            }
          }
        }
        return { total, processing };
      }
    }
    return { total: 0, processing: 0 };
  }

  function handlePermissionRespond(requestId, decision) {
    if (!strategySession) return;
    send({ type: 'popup_permission_response', sessionId: strategySession.id, requestId, decision });
    chatMessages = chatMessages.map(m =>
      m.type === 'permission' && m.requestId === requestId
        ? { ...m, resolved: true, decision }
        : m
    );
  }
</script>

  {#snippet agentButtonsAndHistory()}
    <div class="agent-section">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="agent-mode-toggle" onclick={() => agentMode = agentMode === 'interactive' ? 'autonomous' : 'interactive'}>
        <span class="mode-indicator" class:active={agentMode === 'interactive'}>Chat</span>
        <span class="mode-switch" class:autonomous={agentMode === 'autonomous'}></span>
        <span class="mode-indicator" class:active={agentMode === 'autonomous'}>Auto</span>
      </div>
      <div class="agent-actions">
        {#each [['status-check', 'Status', 'M22 12h-4l-3 9L9 3l-3 9H2'], ['gate-check', 'Gate', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'], ['drift-check', 'Drift', 'M2 12h4l3-9 6 18 3-9h4'], ['update-dashboard', 'Update', '']] as [taskId, label, iconPath]}
          <div class="agent-btn-wrap">
            <button class="agent-btn"
              class:running={agentTask && !agentTask.done && agentTask.task === taskId}
              class:injected={injectedTask === taskId}
              onclick={() => runAgentTask(taskId)}
              title={agentMode === 'interactive' ? 'Inject into strategy session (interactive)' : 'Run autonomous (results in popup)'}
            >
              {#if agentTask && !agentTask.done && agentTask.task === taskId}<span class="agent-spinner sm"></span>{:else if injectedTask === taskId}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>{:else}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{#if iconPath}<path d={iconPath}/>{:else}<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>{/if}</svg>{/if}
              {label}
            </button>
            {#if cockpitState.lastRuns && cockpitState.lastRuns[taskId]}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="agent-last-run" onclick={() => viewLastResult(taskId)}>{timeAgo(cockpitState.lastRuns[taskId].time)}</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if cockpitState.runHistory && cockpitState.runHistory.length > 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="agent-history-toggle" onclick={() => showHistory = !showHistory}>
          {showHistory ? '▾' : '▸'} Run history ({cockpitState.runHistory.length})
        </div>
        {#if showHistory}
          <div class="agent-history">
            {#each cockpitState.runHistory as run}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="agent-history-row" onclick={() => viewHistoryRun(run)}>
                <span class="agent-history-task">{run.task}</span>
                <span class="agent-history-time">{timeAgo(run.time)}</span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      {#if agentTask && agentPopupOpen}
        <div class="agent-dropdown">
          <div class="agent-dropdown-header">
            <div class="agent-popup-title">
              {#if !agentTask.done}
                <span class="agent-spinner lg"></span>
              {:else if agentTask.error}
                <span class="agent-icon-err">✕</span>
              {:else}
                <span class="agent-icon-ok">✓</span>
              {/if}
              <span>{agentTask.task.replace('-', ' ')}</span>
              {#if agentTask.currentTool}
                <span class="agent-current-tool">{agentTask.currentTool}</span>
              {/if}
            </div>
            <button class="agent-popup-close" onclick={dismissAgentTask}>×</button>
          </div>
          <div class="agent-dropdown-body">
            {#if !agentTask.done && agentTask.log.length > 0}
              <div class="agent-popup-feed">
                {#each agentLogDisplay as entry}
                  <div class="agent-activity-row">
                    {#if entry.type === 'thinking'}
                      <span class="activity-icon think">💭</span>
                      <span class="activity-text">{entry.text}</span>
                    {:else if entry.type === 'tool'}
                      <span class="activity-icon tool">⚡</span>
                      <span class="activity-tool-name">{entry.tool}</span>
                      {#if entry.detail}<span class="activity-detail">{entry.detail}</span>{/if}
                      <span class="activity-running">...</span>
                    {:else if entry.type === 'tool_done'}
                      <span class="activity-icon done">✓</span>
                      <span class="activity-tool-name">{entry.tool}</span>
                      {#if entry.detail}<span class="activity-detail">{entry.detail}</span>{/if}
                      {#if entry.preview}<span class="activity-preview">{entry.preview}</span>{/if}
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if !agentTask.done}
              <div class="agent-popup-waiting">Starting agent...</div>
            {/if}
            {#if agentTask.error}
              <div class="agent-task-error">{agentTask.error}</div>
            {/if}
            {#if agentTask.done && agentTask.data}
              <div class="agent-popup-results">
                {#if agentTask.task === 'status-check' && agentTask.data.areas}
                  <div class="agent-popup-section-label">AREAS</div>
                  {#each agentTask.data.areas as area}
                    <div class="agent-area-row">
                      <span class="agent-dot" class:green={area.status === 'green'} class:yellow={area.status === 'yellow'} class:red={area.status === 'red'}></span>
                      <span class="agent-area-name">{area.name}</span>
                      <span class="agent-area-summary">{area.summary}</span>
                    </div>
                  {/each}
                  {#if agentTask.data.priorities}
                    <div class="agent-popup-section-label" style="margin-top: 8px">PRIORITIES</div>
                    {#each agentTask.data.priorities as p, i}
                      <div class="agent-priority">{i + 1}. {p}</div>
                    {/each}
                  {/if}
                  {#if agentTask.data.driftSignals?.length > 0}
                    <div class="agent-popup-section-label" style="margin-top: 8px">DRIFT SIGNALS</div>
                    {#each agentTask.data.driftSignals as d}
                      <div class="agent-drift">{d}</div>
                    {/each}
                  {/if}
                {:else if agentTask.task === 'gate-check' && agentTask.data.tests}
                  <div class="agent-popup-section-label">GATE TESTS</div>
                  {#each agentTask.data.tests as test}
                    <div class="agent-test-row-lg">
                      <span class="agent-test-badge" class:pass={test.status === 'pass'} class:concern={test.status === 'concern'} class:fail={test.status === 'fail'}>{test.status}</span>
                      <div class="agent-test-info">
                        <span class="agent-test-label-lg">{test.label}</span>
                        {#if test.evidence}<span class="agent-test-evidence">{test.evidence}</span>{/if}
                      </div>
                    </div>
                  {/each}
                {:else}
                  <pre class="agent-json">{JSON.stringify(agentTask.data, null, 2)}</pre>
                {/if}
              </div>
            {/if}
            {#if agentTask.done && agentTask.textBuf}
              <details class="agent-popup-raw">
                <summary>Raw output</summary>
                <pre>{agentTask.textBuf}</pre>
              </details>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/snippet}

{#if strategyData && !isFocused}
  {#snippet chatPanel()}
    {#if !strategySession}
      <div class="session-picker">
        {#if waitingForNew}
          <div class="picker-loading">Starting new session...</div>
        {:else if strategySessions.length > 0}
          <div class="picker-label">Pick a strategy session</div>
          <div class="picker-list">
            {#each strategySessions as s}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="picker-item" class:processing={s.isProcessing} onclick={() => selectSession(s.id)}>
                <span class="picker-title">{s.title || 'Untitled'}</span>
                {#if s.isProcessing}<span class="picker-dot"></span>{/if}
              </div>
            {/each}
          </div>
          <button class="create-btn" onclick={handleCreateSession}>+ New strategy agent</button>
        {:else}
          <button class="create-btn" onclick={handleCreateSession}>+ New strategy agent</button>
        {/if}
      </div>
    {:else}
      <MessageList
        messages={chatMessages}
        processing={chatProcessing}
        activity={chatActivity}
        thinking={{ active: chatThinking, text: '' }}
        loadingHistory={chatLoadingHistory}
        compact={true}
        onPermissionRespond={handlePermissionRespond}
        taskItems={chatTasks}
      />
      <InputArea
        processing={chatProcessing}
        compact={true}
        onSend={handleChatSend}
        onStop={handleChatStop}
      />
    {/if}
  {/snippet}

  {#snippet strategyPanel()}
    <div class="strat-content">
      {#if strategyData.gate || strategyData.candidateName}
        <div class="strat-banner">
          {#if strategyData.gate}
            <div class="strat-gate">{strategyData.gate}</div>
          {/if}
          {#if strategyData.candidateName}
            <div class="strat-candidate">{strategyData.candidateName}</div>
          {/if}
        </div>
      {/if}

      {@render agentButtonsAndHistory()}

      <div class="strat-grid" class:strat-grid-cols={stratGridCols}>
        {#if strategyData.allocation.length > 0}
          <div class="strat-section strat-card">
            <div class="strat-label">ALLOCATION</div>
            {#each strategyData.allocation as track}
              {@const live = areaSessionCount(track.track)}
              <div class="alloc-row">
                <div class="alloc-bar"><div class="alloc-fill" style="width: {track.percent}%"></div></div>
                <span class="alloc-name">{track.track}</span>
                <span class="alloc-pct">{track.percent}%</span>
                {#if live.processing > 0}
                  <span class="alloc-live"><span class="live-dot"></span>{live.processing}</span>
                {:else if live.total > 0}
                  <span class="alloc-live idle">{live.total}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if strategyData.gaps.length > 0}
          <div class="strat-section strat-card">
            <div class="strat-label">GAPS</div>
            {#each strategyData.gaps as gap}
              <div class="gap-row">
                <div class="gap-bars">
                  {#each Array(urgencyBars(gap.urgency)) as _}
                    <span class="gap-bar" style="background: {urgencyColor(gap.urgency)}"></span>
                  {/each}
                  {#each Array(4 - urgencyBars(gap.urgency)) as _}
                    <span class="gap-bar empty"></span>
                  {/each}
                </div>
                <span class="gap-name">{gap.area}</span>
                <span class="gap-arrow">{gap.present} → {gap.desired}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if strategyData.oneSentence}
        <div class="strat-sentence">{strategyData.oneSentence}</div>
      {/if}

      {#if strategyData.sessionDate || strategyData.nextReview}
        <div class="strat-meta">
          {#if strategyData.nextReview}<span>Next: {strategyData.nextReview}</span>{/if}
          {#if strategyData.sessionDate}<span>Session: {strategyData.sessionDate}</span>{/if}
        </div>
      {/if}

    </div>
  {/snippet}

  {#snippet testsPanel()}
    <div class="tests-content">
      {#if strategyData.tests?.length > 0}
        <div class="tests-header">{testsPassing} of {testsTotal} passing — {strategyData.nextReview || 'TBD'}</div>
        {#each strategyData.tests as test}
          <label class="test-row">
            <input
              type="checkbox"
              checked={cockpitState.testStatus[test.label] || false}
              onchange={() => toggleTest(test.label)}
            />
            <span class="test-text" class:done={cockpitState.testStatus[test.label]}>{test.label}</span>
          </label>
        {/each}
      {/if}
    </div>
  {/snippet}

  <!-- Minimized badge -->
  {#if minimized}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="widget-badge"
      class:processing={chatProcessing}
      class:has-sessions={processingCount > 0}
      style="left: {posX}px; top: {posY}px;"
      onclick={handleBadgeClick}
      onmousedown={handleDragStart}
    >
      <span class="badge-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="16" height="16">
          <rect x="5" y="0" width="1" height="1" fill="#E8E5DE"/><rect x="6" y="0" width="1" height="1" fill="#E8E5DE"/>
          <rect x="5" y="1" width="1" height="1" fill="#E8E5DE"/><rect x="6" y="1" width="1" height="1" fill="#E8E5DE"/>
          <rect x="2" y="2" width="8" height="2" fill="#DA7756"/>
          <rect x="2" y="4" width="1" height="2" fill="#DA7756"/><rect x="3" y="4" width="1" height="2" fill="#2F2E2B"/>
          <rect x="4" y="4" width="4" height="2" fill="#DA7756"/><rect x="8" y="4" width="1" height="2" fill="#2F2E2B"/>
          <rect x="9" y="4" width="1" height="2" fill="#DA7756"/>
          <rect x="0" y="6" width="12" height="2" fill="#DA7756"/>
          <rect x="2" y="8" width="8" height="2" fill="#DA7756"/>
          <rect x="2" y="10" width="1" height="2" fill="#DA7756"/><rect x="4" y="10" width="1" height="2" fill="#DA7756"/>
          <rect x="7" y="10" width="1" height="2" fill="#DA7756"/><rect x="9" y="10" width="1" height="2" fill="#DA7756"/>
        </svg>
      </span>
      <span class="badge-label">
        {#if chatProcessing}
          {#if chatActivity}
            {chatActivity.substring(0, 25)}
          {:else}
            thinking...
          {/if}
        {:else}
          Strategy Agent
        {/if}
      </span>
      {#if processingCount > 0}
        <span class="badge-count">{processingCount}</span>
      {/if}
      {#if chatProcessing}
        <span class="badge-spinner"></span>
      {/if}
    </div>

  <!-- Expanded widget -->
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="widget"
      class:dragging
      class:resizing
      class:processing={chatProcessing}
      style="left: {posX}px; top: {posY}px; width: {widgetW}px; height: {widgetH}px;"
      onmousedown={handleDragStart}
    >
      <!-- Header -->
      <div class="widget-header">
        <div class="header-left">
          {#if strategyData.gate}
            <span class="header-gate">{strategyData.gate}</span>
          {:else}
            <span class="header-title">Strategy</span>
          {/if}
          {#if processingCount > 0}
            <span class="header-active">{processingCount}<span class="header-dot"></span></span>
          {/if}
        </div>
        <div class="header-right">
          <button class="hdr-btn" onclick={expandFocused} title="Focus view">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          {#if strategySession}
            <button class="hdr-btn" onclick={openInPopup} title="Open full popup">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
            <button class="hdr-btn" onclick={() => selectSession(null)} title="Switch session">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          {/if}
          <button class="hdr-btn" onclick={toggleMinimize} title="Minimize">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {#if layoutMode === 'narrow'}
        <!-- NARROW: tabs, one panel at a time -->
        <div class="widget-tabs">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span class="tab" class:active={activeTab === 'chat'} role="button" tabindex="0" onclick={() => activeTab = 'chat'}>Chat</span>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span class="tab" class:active={activeTab === 'strategy'} role="button" tabindex="0" onclick={() => activeTab = 'strategy'}>Strategy</span>
          {#if testsTotal > 0}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <span class="tab" class:active={activeTab === 'tests'} role="button" tabindex="0" onclick={() => activeTab = 'tests'}>
              Tests <span class="tab-badge">{testsPassing}/{testsTotal}</span>
            </span>
          {/if}
          {#if chatProcessing}
            <span class="tab-status">
              {#if chatThinking}
                thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>
              {:else if chatActivity}
                {chatActivity.substring(0, 30)}
              {/if}
            </span>
          {/if}
        </div>

        <div class="tab-content">
          {#if activeTab === 'chat'}
            {@render chatPanel()}
          {:else if activeTab === 'strategy'}
            {@render strategyPanel()}
          {:else if activeTab === 'tests'}
            {@render testsPanel()}
          {/if}
        </div>

      {:else if layoutMode === 'dual'}
        <!-- DUAL: chat + strategy side by side -->
        <div class="multi-panel two">
          <div class="panel panel-chat">
            <div class="panel-label">CHAT {#if chatProcessing}<span class="panel-status">{chatActivity ? chatActivity.substring(0, 20) : 'thinking...'}</span>{/if}</div>
            {@render chatPanel()}
          </div>
          <div class="panel panel-strategy">
            <div class="panel-label">STRATEGY</div>
            {@render strategyPanel()}
          </div>
        </div>

      {:else}
        <!-- TRIPLE: chat + strategy + tests -->
        <div class="multi-panel three">
          <div class="panel panel-chat">
            <div class="panel-label">CHAT {#if chatProcessing}<span class="panel-status">{chatActivity ? chatActivity.substring(0, 20) : 'thinking...'}</span>{/if}</div>
            {@render chatPanel()}
          </div>
          <div class="panel panel-strategy">
            <div class="panel-label">STRATEGY</div>
            {@render strategyPanel()}
          </div>
          {#if testsTotal > 0}
            <div class="panel panel-tests">
              <div class="panel-label">TESTS <span class="tab-badge">{testsPassing}/{testsTotal}</span></div>
              {@render testsPanel()}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Resize handles -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-e" onmousedown={(e) => handleResizeStart('e', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-w" onmousedown={(e) => handleResizeStart('w', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-s" onmousedown={(e) => handleResizeStart('s', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-n" onmousedown={(e) => handleResizeStart('n', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-se" onmousedown={(e) => handleResizeStart('se', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-sw" onmousedown={(e) => handleResizeStart('sw', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-ne" onmousedown={(e) => handleResizeStart('ne', e)}></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle rh-nw" onmousedown={(e) => handleResizeStart('nw', e)}></div>
    </div>
  {/if}
{/if}

<!-- ========= FOCUSED VIEW (full screen overlay) ========= -->
{#if isFocused && strategyData}
  <div class="focused-view">
    <!-- Header bar -->
    <div class="focused-header">
      <button class="focused-back" onclick={collapseFocused}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Back
      </button>
      <span class="focused-title">Strategy</span>
      {#if strategyData.gate}
        <span class="focused-gate">{strategyData.gate}</span>
      {/if}
      <div class="focused-header-right">
        {#if chatProcessing}
          <span class="focused-status">
            {#if chatThinking}thinking{:else if chatActivity}{chatActivity.substring(0, 40)}{:else}working{/if}
            <span class="dots"><span>.</span><span>.</span><span>.</span></span>
          </span>
        {/if}
        {#if processingCount > 0}
          <span class="focused-active">{processingCount} active<span class="header-dot"></span></span>
        {/if}
      </div>
    </div>

    <!-- Two-panel layout -->
    <div class="focused-panels">
      <!-- Left: Strategy data -->
      <div class="focused-left">
        {@render agentButtonsAndHistory()}

        {#if strategyData.candidateName}
          <div class="f-candidate">{strategyData.candidateName}</div>
        {/if}

        {#if strategyData.allocation.length > 0}
          <div class="f-section">
            <div class="f-label">ALLOCATION</div>
            {#each strategyData.allocation as track}
              {@const live = areaSessionCount(track.track)}
              <div class="f-alloc-row">
                <div class="f-alloc-bar"><div class="f-alloc-fill" style="width: {track.percent}%"></div></div>
                <span class="f-alloc-name">{track.track}</span>
                <span class="f-alloc-pct">{track.percent}%</span>
                {#if live.processing > 0}
                  <span class="f-alloc-live"><span class="live-dot"></span>{live.processing}</span>
                {:else if live.total > 0}
                  <span class="f-alloc-live idle">{live.total}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if strategyData.gaps.length > 0}
          <div class="f-section">
            <div class="f-label">GAPS</div>
            {#each strategyData.gaps as gap}
              <div class="f-gap-row">
                <div class="gap-bars">
                  {#each Array(urgencyBars(gap.urgency)) as _}
                    <span class="f-gap-bar" style="background: {urgencyColor(gap.urgency)}"></span>
                  {/each}
                  {#each Array(4 - urgencyBars(gap.urgency)) as _}
                    <span class="f-gap-bar empty"></span>
                  {/each}
                </div>
                <span class="f-gap-name">{gap.area}</span>
                <span class="f-gap-detail">{gap.present} → {gap.desired}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if testsTotal > 0}
          <div class="f-section">
            <div class="f-label">TESTS — {strategyData.nextReview || 'TBD'} ({testsPassing}/{testsTotal})</div>
            {#each strategyData.tests as test}
              <label class="f-test-row">
                <input
                  type="checkbox"
                  checked={cockpitState.testStatus[test.label] || false}
                  onchange={() => toggleTest(test.label)}
                />
                <span class="f-test-text" class:done={cockpitState.testStatus[test.label]}>{test.label}</span>
              </label>
            {/each}
          </div>
        {/if}

        {#if strategyData.oneSentence}
          <div class="f-sentence">{strategyData.oneSentence}</div>
        {/if}

        {#if strategyData.sessionDate || strategyData.lastReviewed}
          <div class="f-meta">
            {#if strategyData.nextReview}<span>Next review: {strategyData.nextReview}</span>{/if}
            {#if strategyData.sessionDate}<span>Session: {strategyData.sessionDate}</span>{/if}
            {#if strategyData.lastReviewed}<span>Reviewed: {strategyData.lastReviewed}</span>{/if}
          </div>
        {/if}

      </div>

      <!-- Right: Full chat — uses shared MessageList + InputArea -->
      <div class="focused-right">
        <div class="f-chat-header">
          <span class="f-label">STRATEGY AGENT</span>
          {#if strategySession}
            <button class="f-popup-btn" onclick={openInPopup}>Open in popup</button>
          {/if}
        </div>

        {#if !strategySession}
          <div class="f-chat-empty">
            <button class="create-btn" onclick={handleCreateSession}>+ New strategy session</button>
          </div>
        {:else}
          <MessageList
            messages={chatMessages}
            processing={chatProcessing}
            activity={chatActivity}
            thinking={{ active: chatThinking, text: '' }}
            loadingHistory={chatLoadingHistory}
            compact={true}
            onPermissionRespond={handlePermissionRespond}
            taskItems={chatTasks}
          />
          <InputArea
            processing={chatProcessing}
            compact={true}
            onSend={handleChatSend}
            onStop={handleChatStop}
          />
        {/if}
      </div>
    </div>
  </div>
{/if}


<style>
  /* --- Minimized badge --- */
  .widget-badge {
    position: fixed;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: #1e1d1b;
    border: 1px solid rgba(218, 119, 86, 0.2);
    border-radius: 22px;
    cursor: grab;
    user-select: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 8px rgba(218, 119, 86, 0.08);
    transition: box-shadow 0.3s, border-color 0.3s;
  }

  .widget-badge:hover {
    border-color: rgba(218, 119, 86, 0.4);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 12px rgba(218, 119, 86, 0.15);
  }

  .widget-badge.processing {
    animation: badge-glow 2s ease-in-out infinite;
    border-color: rgba(218, 119, 86, 0.4);
  }

  .widget-badge.has-sessions {
    border-color: rgba(218, 119, 86, 0.2);
  }

  @keyframes badge-glow {
    0%, 100% { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 8px rgba(218, 119, 86, 0.2); }
    50% { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 16px rgba(218, 119, 86, 0.5); }
  }

  .badge-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
  }

  .badge-label {
    font-size: 12px;
    font-weight: 600;
    color: #b0ab9f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .widget-badge.processing .badge-label {
    color: #da7756;
    font-size: 11px;
  }

  .badge-count {
    font-size: 9px;
    font-weight: 700;
    color: #1a1918;
    background: #da7756;
    border-radius: 8px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .badge-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* --- Expanded widget --- */
  .widget {
    position: fixed;
    z-index: 9999;
    background: #1a1918;
    border: 1px solid rgba(218, 119, 86, 0.15);
    border-radius: 14px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(218, 119, 86, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    transition: box-shadow 0.3s, border-color 0.3s;
  }

  .widget.dragging, .widget.resizing {
    cursor: grabbing;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
    transition: none;
  }

  .widget.processing {
    border-color: rgba(218, 119, 86, 0.35);
  }

  /* --- Resize handles --- */
  .resize-handle {
    position: absolute;
    z-index: 10;
  }

  .rh-e { right: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
  .rh-w { left: -3px; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
  .rh-s { bottom: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
  .rh-n { top: -3px; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
  .rh-se { right: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nwse-resize; }
  .rh-sw { left: -3px; bottom: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
  .rh-ne { right: -3px; top: -3px; width: 12px; height: 12px; cursor: nesw-resize; }
  .rh-nw { left: -3px; top: -3px; width: 12px; height: 12px; cursor: nwse-resize; }

  /* Header */
  .widget-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    cursor: grab;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    min-height: 38px;
  }

  .widget.dragging .widget-header {
    cursor: grabbing;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .header-gate {
    font-size: 12px;
    font-weight: 600;
    color: #da7756;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-title {
    font-size: 13px;
    font-weight: 600;
    color: #b0ab9f;
  }

  .header-active {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: #da7756;
    font-weight: 600;
    flex-shrink: 0;
  }

  .header-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .header-right {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: #5a5650;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
  }

  .hdr-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #b0ab9f;
  }

  /* Tabs */
  .widget-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .tab {
    font-size: 12px;
    color: #5a5650;
    padding: 8px 10px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.1s, border-color 0.1s;
    white-space: nowrap;
    user-select: none;
  }

  .tab:hover {
    color: #908b81;
  }

  .tab.active {
    color: #da7756;
    border-bottom-color: #da7756;
  }

  .tab-badge {
    font-size: 10px;
    color: #57ab5a;
    font-weight: 600;
  }

  .tab-status {
    margin-left: auto;
    font-size: 10px;
    color: #5a5650;
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100px;
  }

  .dots {
    display: inline;
  }

  .dots span {
    animation: dotPulse 1.4s ease-in-out infinite;
  }

  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dotPulse {
    0%, 80%, 100% { opacity: 0.2; }
    40% { opacity: 1; }
  }

  /* Tab content (narrow mode) */
  .tab-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }

  /* Multi-panel layout (dual + triple) */
  .multi-panel {
    flex: 1;
    min-height: 0;
    display: grid;
    overflow: hidden;
  }

  .multi-panel.two {
    grid-template-columns: 1fr 1fr;
  }

  .multi-panel.three {
    grid-template-columns: 1fr 1fr minmax(140px, 0.6fr);
  }

  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid rgba(255, 255, 255, 0.04);
  }

  .panel:first-child {
    border-left: none;
  }

  .panel-label {
    font-size: 9px;
    font-weight: 700;
    color: #5a5650;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 12px 4px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .panel-status {
    font-weight: 400;
    color: #da7756;
    font-style: italic;
    text-transform: none;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-chat {
    min-width: 0;
  }

  .panel-strategy {
    min-width: 0;
  }

  .panel-tests {
    min-width: 0;
  }

  /* Session picker */
  .session-picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 14px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .picker-label {
    font-size: 10px;
    font-weight: 700;
    color: #5a5650;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .picker-loading {
    font-size: 12px;
    color: #da7756;
    font-style: italic;
    padding: 20px 0;
    text-align: center;
  }

  .picker-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .picker-item:hover {
    background: rgba(218, 119, 86, 0.08);
    border-color: rgba(218, 119, 86, 0.2);
  }

  .picker-item.processing {
    border-color: rgba(218, 119, 86, 0.25);
  }

  .picker-title {
    font-size: 12px;
    color: #b0ab9f;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  /* Chat empty state */
  .chat-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 0;
    flex: 1;
  }

  .create-btn {
    font-size: 10px;
    color: #6b6760;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .create-btn:hover {
    background: rgba(218, 119, 86, 0.08);
    color: #da7756;
    border-color: rgba(218, 119, 86, 0.2);
  }

  /* Strategy tab */
  .strat-content {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
    user-select: text;
  }

  .strat-banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .strat-gate {
    font-size: 13px;
    font-weight: 600;
    color: #da7756;
    padding: 8px 12px;
    background: rgba(218, 119, 86, 0.06);
    border-left: 2px solid rgba(218, 119, 86, 0.4);
    border-radius: 0 6px 6px 0;
  }

  .strat-candidate {
    font-size: 12px;
    color: #908b81;
    padding: 0 2px;
  }

  /* Responsive grid for allocation + gaps within strategy panel */
  .strat-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .strat-grid.strat-grid-cols {
    flex-direction: row;
  }

  .strat-grid.strat-grid-cols > .strat-card {
    flex: 1;
    min-width: 0;
  }

  .strat-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .strat-card {
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 8px;
  }

  .strat-label {
    font-size: 9px;
    font-weight: 700;
    color: #5a5650;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 3px;
  }

  .alloc-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 20px;
  }

  .alloc-bar {
    width: 70px;
    height: 4px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .alloc-fill {
    height: 100%;
    background: #5b9fd6;
    border-radius: 2px;
  }

  .alloc-name {
    font-size: 12px;
    color: #b0ab9f;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alloc-pct {
    font-size: 11px;
    color: #5a5650;
    flex-shrink: 0;
  }

  .alloc-live {
    font-size: 8px;
    color: #da7756;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .alloc-live.idle {
    color: #5b9fd6;
  }

  .live-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .gap-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 1px 0;
  }

  .gap-bars {
    display: flex;
    gap: 1px;
    flex-shrink: 0;
  }

  .gap-bar {
    width: 3px;
    height: 9px;
    border-radius: 1px;
  }

  .gap-bar.empty {
    background: rgba(255, 255, 255, 0.05);
  }

  .gap-name {
    font-size: 12px;
    color: #b0ab9f;
    font-weight: 500;
  }

  .gap-arrow {
    font-size: 11px;
    color: #5a5650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strat-sentence {
    font-size: 12px;
    color: #6b6760;
    font-style: italic;
    line-height: 1.5;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  .strat-meta {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: #4a4640;
  }

  /* Agent action buttons */
  .agent-actions {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.04);
    margin-top: 6px;
  }
  .agent-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 8px;
    background: rgba(218, 119, 86, 0.08);
    border: 1px solid rgba(218, 119, 86, 0.2);
    border-radius: 6px;
    color: #c4a882;
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .agent-btn:hover:not(:disabled) {
    background: rgba(218, 119, 86, 0.15);
    border-color: rgba(218, 119, 86, 0.4);
    color: #da7756;
  }
  .agent-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .agent-btn.running {
    border-color: rgba(218, 119, 86, 0.4);
    background: rgba(218, 119, 86, 0.12);
    color: #da7756;
    cursor: pointer;
  }
  .agent-btn.injected {
    border-color: rgba(80, 200, 120, 0.5);
    background: rgba(80, 200, 120, 0.15);
    color: #50c878;
    transition: all 0.3s;
  }
  .agent-spinner.sm { width: 8px; height: 8px; border-width: 1.5px; }
  .agent-btn-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }
  .agent-btn-wrap .agent-btn { width: 100%; }
  .agent-last-run {
    font-size: 9px;
    color: #5a5550;
    cursor: pointer;
    transition: color 0.15s;
  }
  .agent-last-run:hover { color: #da7756; }
  .agent-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
  }
  .agent-mode-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    padding: 2px 0;
  }
  .mode-indicator {
    font-size: 10px;
    color: #5a5550;
    transition: color 0.2s;
  }
  .mode-indicator.active {
    color: #c4a882;
    font-weight: 600;
  }
  .mode-switch {
    width: 28px;
    height: 14px;
    border-radius: 7px;
    background: rgba(196, 168, 130, 0.25);
    position: relative;
    transition: background 0.2s;
  }
  .mode-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #c4a882;
    transition: transform 0.2s;
  }
  .mode-switch.autonomous::after {
    transform: translateX(14px);
  }
  .mode-switch.autonomous {
    background: rgba(218, 119, 86, 0.3);
  }
  .mode-switch.autonomous::after {
    background: #da7756;
  }
  .agent-history-toggle {
    font-size: 11px;
    color: #8a8580;
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-top: 2px;
    padding-top: 6px;
  }
  .agent-history-toggle:hover { color: #c4a882; }
  .agent-history {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 150px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }
  .agent-history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.1s;
  }
  .agent-history-row:hover { background: rgba(218, 119, 86, 0.08); }
  .agent-history-task {
    color: #c4a882;
    text-transform: capitalize;
  }
  .agent-history-time {
    color: #5a5550;
    font-size: 10px;
  }

  /* Agent task popup overlay */
  .agent-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #1e1d1b;
    border: 1px solid rgba(218, 119, 86, 0.25);
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6), 0 0 10px rgba(218, 119, 86, 0.06);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: dropdownIn 0.15s ease-out;
    max-height: 350px;
  }
  :global(.focused-view) .agent-dropdown {
    top: auto;
    bottom: 100%;
    margin-top: 0;
    margin-bottom: 4px;
    max-height: 400px;
  }
  @keyframes dropdownIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .agent-dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .agent-dropdown-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }
  .agent-popup-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #c4a882;
    text-transform: capitalize;
  }
  .agent-popup-close {
    background: none;
    border: none;
    color: #6a6560;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .agent-popup-close:hover { color: #c4a882; }
  .agent-popup-waiting {
    color: #6a6560;
    font-size: 13px;
    font-style: italic;
    padding: 20px 0;
    text-align: center;
  }
  .agent-popup-feed {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 400px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }
  .agent-popup-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .agent-popup-section-label {
    font-size: 10px;
    font-weight: 600;
    color: #6a6560;
    letter-spacing: 0.5px;
    margin-top: 4px;
  }
  .agent-popup-raw {
    margin-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.04);
    padding-top: 8px;
  }
  .agent-popup-raw summary {
    font-size: 11px;
    color: #5a5550;
    cursor: pointer;
  }
  .agent-popup-raw pre {
    font-size: 10px;
    color: #6a6560;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    margin: 8px 0 0;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  /* Shared agent UI elements */
  .agent-spinner {
    width: 10px; height: 10px;
    border: 2px solid rgba(218,119,86,0.2);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .agent-spinner.lg { width: 14px; height: 14px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .agent-icon-ok { color: #5a9a5a; font-weight: bold; font-size: 14px; }
  .agent-icon-err { color: #c45; font-weight: bold; font-size: 14px; }
  .agent-current-tool {
    font-size: 11px;
    color: #da7756;
    font-weight: 400;
    margin-left: 4px;
    opacity: 0.7;
  }
  .agent-activity-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    line-height: 1.5;
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .activity-icon {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    font-size: 11px;
    line-height: 1.5;
  }
  .activity-icon.think { opacity: 0.5; }
  .activity-icon.tool { color: #da7756; }
  .activity-icon.done { color: #5a9a5a; }
  .activity-text {
    color: #6a6560;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .activity-tool-name {
    color: #c4a882;
    font-family: monospace;
    font-size: 12px;
  }
  .activity-running {
    color: #da7756;
    font-size: 10px;
    opacity: 0.6;
    animation: pulse 1.5s ease-in-out infinite;
  }
  .activity-detail {
    color: #7a7570;
    font-size: 11px;
    font-family: monospace;
  }
  .activity-preview {
    color: #5a5550;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 250px;
  }
  .agent-task-error {
    color: #c45;
    font-size: 12px;
    padding: 8px;
    background: rgba(204, 68, 85, 0.08);
    border-radius: 6px;
  }
  .agent-area-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #9a9590;
    padding: 3px 0;
  }
  .agent-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .agent-dot.green { background: #5a9a5a; }
  .agent-dot.yellow { background: #c4a832; }
  .agent-dot.red { background: #c45; }
  .agent-area-name { color: #c4a882; min-width: 80px; font-weight: 500; }
  .agent-area-summary { color: #7a7570; }
  .agent-priority {
    font-size: 12px;
    color: #9a9590;
    padding: 2px 0;
  }
  .agent-drift {
    font-size: 12px;
    color: #c4a832;
    padding: 2px 0;
  }
  .agent-test-row-lg {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .agent-test-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    min-width: 55px;
    text-align: center;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .agent-test-badge.pass { color: #5a9a5a; background: rgba(90,154,90,0.12); }
  .agent-test-badge.concern { color: #c4a832; background: rgba(196,168,50,0.12); }
  .agent-test-badge.fail { color: #c45; background: rgba(204,68,85,0.12); }
  .agent-test-info { display: flex; flex-direction: column; gap: 2px; }
  .agent-test-label-lg { color: #c4a882; font-size: 12px; }
  .agent-test-evidence { color: #6a6560; font-size: 11px; }
  .agent-json {
    font-size: 11px;
    color: #7a7570;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
    margin: 0;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  /* Focused view agent actions */
  .f-agent-actions {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }
  .f-agent-actions .agent-actions {
    margin-top: 6px;
    border-top: none;
    padding-top: 0;
  }

  /* Tests tab */
  .tests-content {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  .tests-header {
    font-size: 11px;
    font-weight: 600;
    color: #57ab5a;
    margin-bottom: 4px;
  }

  .test-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    cursor: pointer;
  }

  .test-row input[type="checkbox"] {
    width: 15px;
    height: 15px;
    accent-color: #57ab5a;
    cursor: pointer;
    flex-shrink: 0;
  }

  .test-text {
    font-size: 13px;
    color: #b0ab9f;
  }

  .test-text.done {
    color: #57ab5a;
    text-decoration: line-through;
    text-decoration-color: rgba(87, 171, 90, 0.3);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ========= FOCUSED VIEW ========= */
  .focused-view {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: #1a1918;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .focused-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .focused-back {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #6b6760;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: background 0.1s, color 0.1s;
    flex-shrink: 0;
  }

  .focused-back:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #b0ab9f;
  }

  .focused-title {
    font-size: 14px;
    font-weight: 600;
    color: #b0ab9f;
    flex-shrink: 0;
  }

  .focused-gate {
    font-size: 13px;
    font-weight: 600;
    color: #da7756;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .focused-header-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .focused-status {
    font-size: 11px;
    color: #6b6760;
    font-style: italic;
  }

  .focused-active {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #da7756;
    font-weight: 500;
  }

  /* Two-panel layout */
  .focused-panels {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(380px, 480px) 1fr;
    min-height: 0;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .focused-panels {
      grid-template-columns: 1fr;
    }
  }

  /* Left panel: strategy data */
  .focused-left {
    padding: 20px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    border-right: 1px solid rgba(255, 255, 255, 0.04);
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  .f-candidate {
    font-size: 14px;
    color: #908b81;
  }

  .f-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .f-label {
    font-size: 10px;
    font-weight: 700;
    color: #5a5650;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 4px;
  }

  .f-alloc-row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 26px;
  }

  .f-alloc-bar {
    width: 100px;
    height: 6px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 3px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .f-alloc-fill {
    height: 100%;
    background: #5b9fd6;
    border-radius: 3px;
  }

  .f-alloc-name {
    font-size: 14px;
    color: #b0ab9f;
    flex: 1;
  }

  .f-alloc-pct {
    font-size: 13px;
    color: #6b6760;
    font-weight: 500;
    flex-shrink: 0;
  }

  .f-alloc-live {
    font-size: 10px;
    color: #da7756;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .f-alloc-live.idle {
    color: #5b9fd6;
  }

  .f-gap-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .f-gap-bar {
    width: 4px;
    height: 12px;
    border-radius: 1px;
  }

  .f-gap-bar.empty {
    background: rgba(255, 255, 255, 0.05);
  }

  .f-gap-name {
    font-size: 14px;
    color: #b0ab9f;
    font-weight: 500;
  }

  .f-gap-detail {
    font-size: 12px;
    color: #6b6760;
  }

  .f-test-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    cursor: pointer;
  }

  .f-test-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #57ab5a;
    cursor: pointer;
    flex-shrink: 0;
  }

  .f-test-text {
    font-size: 14px;
    color: #b0ab9f;
  }

  .f-test-text.done {
    color: #57ab5a;
    text-decoration: line-through;
    text-decoration-color: rgba(87, 171, 90, 0.3);
  }

  .f-sentence {
    font-size: 13px;
    color: #6b6760;
    font-style: italic;
    line-height: 1.6;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .f-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: #4a4640;
    flex-wrap: wrap;
  }

  /* Right panel: chat */
  .focused-right {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .f-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }

  .f-popup-btn {
    font-size: 11px;
    color: #5a5650;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .f-popup-btn:hover {
    color: #b0ab9f;
    border-color: rgba(255, 255, 255, 0.15);
  }

  .f-chat-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    flex: 1;
  }
</style>
