<script>
  import { onMount, onDestroy } from 'svelte';
  import { getBasePath } from '../../stores/ws.js';
  import { boardData, fetchBoard, focusedArea } from '../../stores/board.js';
  import { onMessage, send } from '../../stores/ws.js';
  import { sessions, createSession } from '../../stores/sessions.js';
  import { openPopup } from '../../stores/popups.js';

  // --- Widget state ---
  let minimized = $state(false);
  let activeTab = $state('chat'); // 'chat' | 'strategy' | 'tests'
  let strategyData = $state(null);
  let cockpitState = $state({ sessionDate: null, testStatus: {}, notes: [] });
  let loading = $state(true);

  // --- Drag state ---
  let posX = $state(20);
  let posY = $state(80);
  let dragging = $state(false);
  let dragStart = { x: 0, y: 0, posX: 0, posY: 0 };

  // --- Chat state (independent of popup store) ---
  let chatInput = $state('');
  let chatMessages = $state([]);
  let chatProcessing = $state(false);
  let chatThinking = $state(false);
  let chatActivity = $state(null);
  let chatStreamText = $state('');
  let chatIsStreaming = $state(false);
  let chatSessionLinked = $state(false);
  let inputEl = $state(null);
  let chatEl = $state(null);
  let unsubWs = null;

  // --- Strategy session ---
  let strategySession = $derived.by(() => {
    if (!$boardData) return null;
    const stratArea = $boardData.areas.find(a => a.name === 'strategy');
    if (!stratArea) return null;
    if (stratArea.areaSessions?.length > 0) return stratArea.areaSessions[0];
    for (const proj of stratArea.projects) {
      if (proj.sessions.length > 0) return proj.sessions[0];
      for (const sub of proj.subProjects) {
        if (sub.sessions?.length > 0) return sub.sessions[0];
      }
    }
    return null;
  });

  // Link to WS when strategy session appears
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

  let visibleMessages = $derived(
    chatMessages
      .filter(m => m.type === 'user' || (m.type === 'assistant' && m.text) || m.type === 'system')
      .slice(-20)
  );

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
      minimized = localStorage.getItem('cockpit-widget-min') === '1';
    } catch {}
  }

  function savePosition() {
    try {
      localStorage.setItem('cockpit-widget-pos', JSON.stringify({ x: posX, y: posY }));
    } catch {}
  }

  function saveMinimized() {
    try {
      localStorage.setItem('cockpit-widget-min', minimized ? '1' : '0');
    } catch {}
  }

  // --- Drag handling ---
  function handleDragStart(e) {
    if (e.target.closest('button, input, label, .chat-log, .tab-content')) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, posX, posY };
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    posX = Math.max(0, Math.min(window.innerWidth - 100, dragStart.posX + dx));
    posY = Math.max(0, Math.min(window.innerHeight - 50, dragStart.posY + dy));
  }

  function handleMouseUp() {
    if (dragging) {
      dragging = false;
      savePosition();
    }
  }

  // --- Lifecycle ---
  onMount(() => {
    loadPosition();
    loadStrategy();
    loadCockpitState();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    unsubWs = onMessage((msg) => {
      if (!strategySession) return;
      if (!msg._popupSessionId && msg.type !== 'popup_history_start' && msg.type !== 'popup_history_done') return;
      const sid = msg._popupSessionId || msg.sessionId;
      if (sid !== strategySession.id) return;
      handleWsMessage(msg);
    });
  });

  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (unsubWs) unsubWs();
  });

  // --- WS message handler ---
  function handleWsMessage(msg) {
    const t = msg.type;

    if (t === 'popup_history_start') { chatMessages = []; return; }
    if (t === 'popup_history_done') { finalizeStream(); return; }

    if (t === 'user_message') {
      finalizeStream();
      chatMessages = [...chatMessages, { type: 'user', text: msg.text || '' }];
    } else if (t === 'delta' || t === 'assistant_delta') {
      chatThinking = false;
      chatActivity = null;
      const delta = msg.text || msg.delta || '';
      if (!chatIsStreaming) {
        chatIsStreaming = true;
        chatStreamText = delta;
        chatMessages = [...chatMessages, { type: 'assistant', text: delta, streaming: true }];
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
      scrollChat();
    } else if (t === 'thinking_start') {
      chatThinking = true;
    } else if (t === 'thinking_stop') {
      chatThinking = false;
    } else if (t === 'tool_start') {
      finalizeStream();
      chatThinking = false;
      chatActivity = (msg.name || msg.toolName || 'tool');
    } else if (t === 'tool_executing') {
      const name = msg.name || '';
      const input = msg.input;
      if (input) {
        const detail = input.description || input.command?.substring(0, 50) || input.file_path || input.pattern || '';
        chatActivity = detail ? name + ' · ' + detail : name;
      }
    } else if (t === 'status') {
      chatProcessing = msg.status === 'processing';
    } else if (t === 'result') {
      finalizeStream();
      chatProcessing = false;
    } else if (t === 'done') {
      finalizeStream();
      chatProcessing = false;
      chatThinking = false;
      chatActivity = null;
    } else if (t === 'error') {
      finalizeStream();
      chatMessages = [...chatMessages, { type: 'system', text: msg.text || msg.message || 'Error', isError: true }];
    } else if (t === 'subagent_activity') {
      if (msg.text) chatActivity = msg.text;
    } else if (t === 'subagent_tool') {
      const name = msg.toolName || '';
      const text = msg.text || '';
      chatActivity = name && text ? name + ' · ' + text : text || name || 'Agent working...';
    } else if (t === 'tool_progress') {
      const elapsed = msg.elapsed ? Math.round(msg.elapsed) : 0;
      chatActivity = (msg.toolName || 'tool') + (elapsed > 3 ? ' · ' + elapsed + 's' : '');
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

  function scrollChat() {
    requestAnimationFrame(() => {
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      if (focusedChatEl) focusedChatEl.scrollTop = focusedChatEl.scrollHeight;
    });
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
    createSession(null, false, 'strategy');
    setTimeout(() => fetchBoard(), 2000);
  }

  let isFocused = $derived($focusedArea === 'strategy');

  // Reference for the focused-mode chat log
  let focusedChatEl = $state(null);

  function openInPopup() {
    if (strategySession) openPopup(strategySession.id, strategySession.title || 'Strategy');
  }

  function toggleMinimize() {
    minimized = !minimized;
    saveMinimized();
  }

  function expandFocused() {
    focusedArea.set('strategy');
    minimized = true;
    saveMinimized();
  }

  function collapseFocused() {
    focusedArea.set(null);
    minimized = false;
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

  async function handleChatSend() {
    const text = chatInput.trim();
    if (!text || !strategySession) return;

    chatInput = '';
    chatMessages = [...chatMessages, { type: 'user', text }];
    chatProcessing = true;
    chatThinking = true;
    scrollChat();

    const contextKeywords = ['status', 'update', 'what did', 'what should', 'where am i', 'on track', 'drift', 'focus', 'today', 'this week', 'progress', 'recap'];
    const needsContext = contextKeywords.some(k => text.toLowerCase().includes(k));

    let fullMessage = text;
    if (needsContext) {
      const context = await gatherSessionContext();
      if (context) fullMessage = context + text;
    }

    send({ type: 'popup_message', sessionId: strategySession.id, text: fullMessage });
  }

  function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleChatSend();
    }
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

  function truncate(text, max = 400) {
    if (!text || text.length <= max) return text || '';
    return text.substring(0, max) + '...';
  }
</script>

{#if strategyData}
  <!-- Minimized badge -->
  {#if minimized}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="widget-badge"
      class:processing={chatProcessing}
      class:has-sessions={processingCount > 0}
      style="left: {posX}px; top: {posY}px;"
      onclick={toggleMinimize}
      onmousedown={handleDragStart}
    >
      {#if chatProcessing}
        <span class="badge-dot"></span>
      {/if}
      <span class="badge-label">
        {#if chatProcessing}
          {chatActivity ? chatActivity.substring(0, 20) : 'thinking'}
        {:else}
          S
        {/if}
      </span>
      {#if processingCount > 0}
        <span class="badge-count">{processingCount}</span>
      {/if}
    </div>

  <!-- Expanded widget -->
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="widget"
      class:dragging
      class:processing={chatProcessing}
      style="left: {posX}px; top: {posY}px;"
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
          {/if}
          <button class="hdr-btn" onclick={toggleMinimize} title="Minimize">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="widget-tabs">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span class="tab" class:active={activeTab === 'chat'} role="button" tabindex="0" onclick={() => activeTab = 'chat'}>Chat</span>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span class="tab" class:active={activeTab === 'strategy'} role="button" tabindex="0" onclick={() => activeTab = 'strategy'}>
          Strategy
        </span>
        {#if testsTotal > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span class="tab" class:active={activeTab === 'tests'} role="button" tabindex="0" onclick={() => activeTab = 'tests'}>
            Tests <span class="tab-badge">{testsPassing}/{testsTotal}</span>
          </span>
        {/if}

        <!-- Status in tab bar -->
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

      <!-- Tab content -->
      <div class="tab-content">
        {#if activeTab === 'chat'}
          <!-- Chat tab -->
          <div class="chat-log" bind:this={chatEl}>
            {#if !strategySession}
              <div class="chat-empty">
                <button class="create-btn" onclick={handleCreateSession}>+ New strategy session</button>
              </div>
            {:else if visibleMessages.length === 0}
              <div class="chat-empty">
                <span class="empty-hint">Ask about focus, status, progress...</span>
              </div>
            {:else}
              {#each visibleMessages as msg}
                {#if msg.type === 'system'}
                  <div class="msg system"><span class="msg-pre">!</span><span class="msg-text" class:err={msg.isError}>{msg.text}</span></div>
                {:else}
                  <div class="msg" class:user={msg.type === 'user'} class:assistant={msg.type === 'assistant'}>
                    <span class="msg-pre">{msg.type === 'user' ? '>' : '<'}</span>
                    <span class="msg-text">{truncate(msg.text)}</span>
                  </div>
                {/if}
              {/each}
              {#if chatProcessing && (chatThinking || chatActivity)}
                <div class="msg assistant">
                  <span class="msg-pre">&lt;</span>
                  <span class="msg-text thinking">{chatActivity || 'thinking...'}</span>
                </div>
              {/if}
            {/if}
          </div>

          {#if strategySession}
            <div class="chat-input-row">
              <input
                type="text"
                class="chat-input"
                placeholder="ask strategy agent..."
                disabled={chatProcessing}
                bind:value={chatInput}
                bind:this={inputEl}
                onkeydown={handleChatKeydown}
              />
              {#if chatProcessing}
                <button class="input-btn stop" onclick={handleChatStop} title="Stop">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                </button>
              {:else}
                <button class="input-btn send" onclick={handleChatSend} disabled={!chatInput.trim()} title="Send">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              {/if}
            </div>
          {/if}

        {:else if activeTab === 'strategy'}
          <!-- Strategy tab -->
          <div class="strat-content">
            {#if strategyData.gate}
              <div class="strat-gate">{strategyData.gate}</div>
            {/if}

            {#if strategyData.candidateName}
              <div class="strat-candidate">{strategyData.candidateName}</div>
            {/if}

            {#if strategyData.allocation.length > 0}
              <div class="strat-section">
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
              <div class="strat-section">
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

        {:else if activeTab === 'tests'}
          <!-- Tests tab -->
          <div class="tests-content">
            {#if strategyData.tests.length > 0}
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
        {/if}
      </div>
    </div>
  {/if}
{/if}

<!-- ========= FOCUSED VIEW (replaces command post grid) ========= -->
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

      <!-- Right: Full chat -->
      <div class="focused-right">
        <div class="f-chat-header">
          <span class="f-label">STRATEGY AGENT</span>
          {#if strategySession}
            <button class="f-popup-btn" onclick={openInPopup}>Open in popup</button>
          {/if}
        </div>

        <div class="f-chat-log" bind:this={focusedChatEl}>
          {#if !strategySession}
            <div class="f-chat-empty">
              <button class="create-btn" onclick={handleCreateSession}>+ New strategy session</button>
            </div>
          {:else if visibleMessages.length === 0}
            <div class="f-chat-empty">
              <span class="empty-hint">Ask about focus, status, progress, or give commands to the strategy agent.</span>
            </div>
          {:else}
            {#each visibleMessages as msg}
              {#if msg.type === 'system'}
                <div class="f-msg system"><span class="f-msg-pre">!</span><span class="f-msg-text" class:err={msg.isError}>{msg.text}</span></div>
              {:else}
                <div class="f-msg" class:user={msg.type === 'user'} class:assistant={msg.type === 'assistant'}>
                  <span class="f-msg-pre">{msg.type === 'user' ? '>' : '<'}</span>
                  <span class="f-msg-text">{msg.text}</span>
                </div>
              {/if}
            {/each}
            {#if chatProcessing && (chatThinking || chatActivity)}
              <div class="f-msg assistant">
                <span class="f-msg-pre">&lt;</span>
                <span class="f-msg-text thinking">{chatActivity || 'thinking...'}</span>
              </div>
            {/if}
          {/if}
        </div>

        {#if strategySession}
          <div class="f-chat-input-row">
            <input
              type="text"
              class="f-chat-input"
              placeholder="ask strategy agent..."
              disabled={chatProcessing}
              bind:value={chatInput}
              onkeydown={handleChatKeydown}
            />
            {#if chatProcessing}
              <button class="f-input-btn stop" onclick={handleChatStop} title="Stop">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              </button>
            {:else}
              <button class="f-input-btn send" onclick={handleChatSend} disabled={!chatInput.trim()} title="Send">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            {/if}
          </div>
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
    gap: 5px;
    padding: 8px 18px;
    background: #1a1918;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 22px;
    cursor: grab;
    user-select: none;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    transition: box-shadow 0.3s, border-color 0.3s;
  }

  .widget-badge:hover {
    border-color: rgba(218, 119, 86, 0.3);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
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

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  .badge-label {
    font-size: 13px;
    font-weight: 600;
    color: #da7756;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
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

  /* --- Expanded widget --- */
  .widget {
    position: fixed;
    z-index: 9999;
    width: 420px;
    background: #1a1918;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    transition: box-shadow 0.3s, border-color 0.3s;
  }

  .widget.dragging {
    cursor: grabbing;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
  }

  .widget.processing {
    border-color: rgba(218, 119, 86, 0.25);
  }

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

  /* Tab content */
  .tab-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Chat */
  .chat-log {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 360px;
    min-height: 120px;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
    user-select: text;
  }

  .chat-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 0;
  }

  .empty-hint {
    font-size: 12px;
    color: #4a4640;
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

  .msg {
    display: flex;
    gap: 6px;
    font-size: 13px;
    line-height: 1.5;
  }

  .msg-pre {
    flex-shrink: 0;
    font-family: monospace;
    font-size: 12px;
    width: 12px;
    color: #5a5650;
  }

  .msg.user .msg-pre { color: #5b9fd6; }
  .msg.assistant .msg-pre { color: #da7756; }
  .msg.system .msg-pre { color: #d4a72c; }

  .msg-text {
    color: #b0ab9f;
    word-break: break-word;
    user-select: text;
  }

  .msg.user .msg-text { color: #d4d0c8; }
  .msg.system .msg-text { color: #908b81; font-style: italic; }
  .msg-text.err { color: #e5534b; }
  .msg-text.thinking { color: #5a5650; font-style: italic; animation: pulse 1.5s ease-in-out infinite; }

  .chat-input-row {
    display: flex;
    gap: 6px;
    padding: 8px 12px 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .chat-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 13px;
    color: #d4d0c8;
    outline: none;
    font-family: inherit;
    user-select: text;
    transition: border-color 0.12s;
  }

  .chat-input:focus {
    border-color: rgba(218, 119, 86, 0.25);
  }

  .chat-input::placeholder {
    color: #4a4640;
  }

  .chat-input:disabled {
    opacity: 0.4;
  }

  .input-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .input-btn.send {
    background: rgba(218, 119, 86, 0.12);
    color: #da7756;
  }

  .input-btn.send:hover:not(:disabled) {
    background: rgba(218, 119, 86, 0.25);
  }

  .input-btn.send:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .input-btn.stop {
    background: rgba(229, 83, 75, 0.12);
    color: #e5534b;
  }

  .input-btn.stop:hover {
    background: rgba(229, 83, 75, 0.25);
  }

  /* Strategy tab */
  .strat-content {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 400px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
    user-select: text;
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
  }

  .strat-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
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

  /* Tests tab */
  .tests-content {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 400px;
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
    position: absolute;
    inset: 0;
    z-index: 50;
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
    grid-template-columns: 380px 1fr;
    min-height: 0;
    overflow: hidden;
  }

  @media (max-width: 800px) {
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

  .f-chat-log {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  .f-chat-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
  }

  .f-msg {
    display: flex;
    gap: 8px;
    font-size: 14px;
    line-height: 1.6;
  }

  .f-msg-pre {
    flex-shrink: 0;
    font-family: monospace;
    font-size: 13px;
    width: 14px;
    color: #5a5650;
  }

  .f-msg.user .f-msg-pre { color: #5b9fd6; }
  .f-msg.assistant .f-msg-pre { color: #da7756; }
  .f-msg.system .f-msg-pre { color: #d4a72c; }

  .f-msg-text {
    color: #b0ab9f;
    word-break: break-word;
  }

  .f-msg.user .f-msg-text { color: #d4d0c8; }
  .f-msg.system .f-msg-text { color: #908b81; font-style: italic; }
  .f-msg-text.err { color: #e5534b; }
  .f-msg-text.thinking { color: #5a5650; font-style: italic; animation: pulse 1.5s ease-in-out infinite; }

  .f-chat-input-row {
    display: flex;
    gap: 8px;
    padding: 12px 20px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }

  .f-chat-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 10px 16px;
    font-size: 14px;
    color: #d4d0c8;
    outline: none;
    font-family: inherit;
    transition: border-color 0.12s;
  }

  .f-chat-input:focus {
    border-color: rgba(218, 119, 86, 0.3);
  }

  .f-chat-input::placeholder {
    color: #4a4640;
  }

  .f-chat-input:disabled {
    opacity: 0.4;
  }

  .f-input-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .f-input-btn.send {
    background: rgba(218, 119, 86, 0.12);
    color: #da7756;
  }

  .f-input-btn.send:hover:not(:disabled) {
    background: rgba(218, 119, 86, 0.25);
  }

  .f-input-btn.send:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .f-input-btn.stop {
    background: rgba(229, 83, 75, 0.12);
    color: #e5534b;
  }

  .f-input-btn.stop:hover {
    background: rgba(229, 83, 75, 0.25);
  }
</style>
