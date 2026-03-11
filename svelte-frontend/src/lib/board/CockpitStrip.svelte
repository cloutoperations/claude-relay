<script>
  import { onMount } from 'svelte';
  import { getBasePath } from '../../stores/ws.js';
  import { boardData } from '../../stores/board.js';
  import { popups, openPopup, sendPopupMessage, stopPopupProcessing } from '../../stores/popups.js';
  import { sessions, createSession } from '../../stores/sessions.js';
  import { fetchBoard } from '../../stores/board.js';

  let expanded = $state(false);
  let strategyData = $state(null);
  let cockpitState = $state({ sessionDate: null, testStatus: {}, notes: [] });
  let loading = $state(true);

  // Mini-chat state
  let chatInput = $state('');
  let chatSending = $state(false);
  let inputEl = $state(null);

  // Find existing strategy session (tagged to strategy area or area-level)
  let strategySession = $derived.by(() => {
    if (!$boardData) return null;
    const stratArea = $boardData.areas.find(a => a.name === 'strategy');
    if (!stratArea) return null;
    // Check area-level sessions first (projectPath === 'strategy')
    if (stratArea.areaSessions?.length > 0) return stratArea.areaSessions[0];
    // Then check project-level sessions
    for (const proj of stratArea.projects) {
      if (proj.sessions.length > 0) return proj.sessions[0];
      for (const sub of proj.subProjects) {
        if (sub.sessions?.length > 0) return sub.sessions[0];
      }
    }
    return null;
  });

  // Strategy session popup data (for inline chat display)
  let strategyPopup = $derived.by(() => {
    if (!strategySession) return null;
    return $popups[strategySession.id] || null;
  });

  // Get the last few chat messages from the strategy popup
  let chatMessages = $derived.by(() => {
    if (!strategyPopup) return [];
    const msgs = strategyPopup.messages || [];
    // Show user, assistant, and system (error) messages, last 8
    return msgs
      .filter(m => m.type === 'user' || (m.type === 'assistant' && m.text) || m.type === 'system')
      .slice(-8);
  });

  let chatProcessing = $derived(strategyPopup?.processing || false);
  let chatThinking = $derived(strategyPopup?.thinking || false);
  let chatActivity = $derived(strategyPopup?.activity || null);
  let chatLoading = $derived(strategyPopup?.loadingHistory || false);

  onMount(() => {
    loadStrategy();
    loadCockpitState();
  });

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
      if (res.ok) {
        cockpitState = await res.json();
      }
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

  // Computed: live processing count
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

  // Computed: tests passing count
  let testsPassing = $derived.by(() => {
    if (!strategyData?.tests) return 0;
    return strategyData.tests.filter(t => cockpitState.testStatus[t.label]).length;
  });

  let testsTotal = $derived(strategyData?.tests?.length || 0);

  // Computed: map allocation tracks to areas for live overlay
  function areaSessionCount(trackName) {
    if (!$boardData) return { total: 0, processing: 0 };
    // Try to match track name to an area name (fuzzy)
    const normalizedTrack = trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const area of $boardData.areas) {
      const normalizedArea = area.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Match if area name is contained in track name or vice versa
      if (normalizedTrack.includes(normalizedArea) || normalizedArea.includes(normalizedTrack)) {
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

  // Ensure the strategy session popup is open (minimized) for chat
  function ensureStrategyPopup() {
    if (!strategySession) return false;
    if (!$popups[strategySession.id]) {
      openPopup(strategySession.id, strategySession.title || 'Strategy');
      // Auto-minimize so it doesn't visually pop up
      // The popup store will handle it
    }
    return true;
  }

  function handleStrategyChat() {
    if (strategySession) {
      openPopup(strategySession.id, strategySession.title || 'Strategy');
    } else {
      createSession(null, false, 'strategy');
      setTimeout(() => {
        fetchBoard();
      }, 2000);
    }
  }

  // Gather live context from all active sessions for the observer agent
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

    // Fetch recent messages from each active session (parallel, max 10 messages each)
    const contextParts = [];
    const fetches = activeSessions.map(async (s) => {
      try {
        const res = await fetch(getBasePath() + `api/sessions/${encodeURIComponent(s.id)}/messages?limit=10`);
        if (!res.ok) return null;
        const data = await res.json();
        return { ...s, messages: data.messages || [] };
      } catch { return null; }
    });

    const results = await Promise.all(fetches);
    for (const r of results) {
      if (!r || r.messages.length === 0) continue;
      let part = `--- Session: "${r.title || 'Untitled'}" (${r.area}/${r.project}) ${r.processing ? '[PROCESSING]' : '[idle]'} ---\n`;
      for (const m of r.messages) {
        if (m.type === 'user') part += `User: ${m.text.substring(0, 200)}\n`;
        else if (m.type === 'assistant') part += `Claude: ${m.text.substring(0, 300)}\n`;
        else if (m.type === 'tool') part += `[tool: ${m.name}]\n`;
      }
      contextParts.push(part);
    }

    if (contextParts.length === 0) return '';
    return '\n\n[LIVE SESSION CONTEXT — You have read access to all active sessions. Here are recent messages:]\n\n' + contextParts.join('\n') + '\n[END SESSION CONTEXT]\n\n';
  }

  // Send message to strategy session with optional context
  async function handleChatSend() {
    const text = chatInput.trim();
    if (!text) return;
    console.log('[cockpit] handleChatSend, strategySession:', strategySession);
    if (!strategySession) {
      console.log('[cockpit] No strategy session found, creating one');
      handleStrategyChat();
      return;
    }

    chatInput = '';
    chatSending = true;

    // Ensure popup is open
    const popupOk = ensureStrategyPopup();
    console.log('[cockpit] ensureStrategyPopup:', popupOk, 'sessionId:', strategySession.id);

    // Wait a tick for popup to initialize
    await new Promise(r => setTimeout(r, 300));

    // Check if this is a status/context query — prepend session context
    const contextKeywords = ['status', 'update', 'what did', 'what should', 'where am i', 'on track', 'drift', 'focus', 'today', 'this week', 'progress', 'recap'];
    const needsContext = contextKeywords.some(k => text.toLowerCase().includes(k));

    let fullMessage = text;
    if (needsContext) {
      const context = await gatherSessionContext();
      if (context) {
        fullMessage = context + text;
      }
    }

    console.log('[cockpit] sendPopupMessage to:', strategySession.id, 'text length:', fullMessage.length, 'popup exists:', !!$popups[strategySession.id]);
    sendPopupMessage(strategySession.id, fullMessage);
    chatSending = false;
  }

  function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleChatSend();
    }
  }

  function handleChatStop() {
    if (strategySession) {
      stopPopupProcessing(strategySession.id);
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
    // When expanding, ensure strategy popup is open for chat
    if (expanded && strategySession) {
      ensureStrategyPopup();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && expanded) {
      expanded = false;
    }
  }

  // Truncate assistant text for inline display
  function truncateText(text, max = 500) {
    if (!text || text.length <= max) return text || '';
    return text.substring(0, max) + '...';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if strategyData && (strategyData.gate || strategyData.allocation.length > 0)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cockpit" class:expanded>
    <!-- Collapsed bar -->
    <div class="cockpit-bar" onclick={toggleExpanded}>
      <span class="cockpit-toggle">{expanded ? '▾' : '▸'}</span>

      {#if strategyData.gate}
        <span class="cockpit-gate">GATE: {strategyData.gate}</span>
      {/if}

      {#if strategyData.candidateName}
        <span class="cockpit-sep">·</span>
        <span class="cockpit-candidate">{strategyData.candidateName}</span>
      {/if}

      {#if strategyData.nextReview}
        <span class="cockpit-sep">·</span>
        <span class="cockpit-next">Check {strategyData.nextReview}</span>
      {/if}

      {#if testsTotal > 0}
        <span class="cockpit-sep">·</span>
        <span class="cockpit-tests">{testsPassing}/{testsTotal} tests</span>
      {/if}

      {#if processingCount > 0}
        <span class="cockpit-sep">·</span>
        <span class="cockpit-processing">{processingCount}<span class="processing-dot"></span></span>
      {/if}

      <button class="cockpit-chat-btn" onclick={(e) => { e.stopPropagation(); handleStrategyChat(); }} title="Open strategy session (full popup)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>

    <!-- Expanded panel (floats over content) -->
    {#if expanded}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="cockpit-backdrop" onclick={toggleExpanded}></div>
      <div class="cockpit-expanded">
        <div class="cockpit-columns">
          <!-- Left: Allocation + Gaps -->
          <div class="cockpit-col">
            {#if strategyData.gate}
              <div class="cockpit-gate-full">THE GATE: {strategyData.gate}</div>
            {/if}

            {#if strategyData.allocation.length > 0}
              <div class="cockpit-section">
                <div class="section-label">ALLOCATION</div>
                {#each strategyData.allocation as track}
                  {@const live = areaSessionCount(track.track)}
                  <div class="alloc-row">
                    <div class="alloc-bar-container">
                      <div class="alloc-bar" style="width: {track.percent}%"></div>
                    </div>
                    <span class="alloc-label">{track.track}</span>
                    <span class="alloc-pct">{track.percent}%</span>
                    {#if live.total > 0}
                      <span class="alloc-live" class:has-processing={live.processing > 0}>
                        {#if live.processing > 0}
                          <span class="alloc-live-dot"></span>{live.processing}
                        {:else}
                          {live.total} sess
                        {/if}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if strategyData.gaps.length > 0}
              <div class="cockpit-section">
                <div class="section-label">GAPS</div>
                {#each strategyData.gaps as gap}
                  <div class="gap-row">
                    <div class="gap-urgency">
                      {#each Array(urgencyBars(gap.urgency)) as _, i}
                        <span class="urgency-bar" style="background: {urgencyColor(gap.urgency)}"></span>
                      {/each}
                      {#each Array(4 - urgencyBars(gap.urgency)) as _, i}
                        <span class="urgency-bar empty"></span>
                      {/each}
                    </div>
                    <span class="gap-area">{gap.area}</span>
                    <span class="gap-detail">({gap.present} → {gap.desired})</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if strategyData.oneSentence}
              <div class="cockpit-sentence">{strategyData.oneSentence}</div>
            {/if}
          </div>

          <!-- Right: Tests + Chat -->
          <div class="cockpit-col">
            {#if strategyData.tests.length > 0}
              <div class="cockpit-section">
                <div class="section-label">TESTS — {strategyData.nextReview || 'TBD'} ({testsPassing} of {testsTotal})</div>
                {#each strategyData.tests as test}
                  <label class="test-row">
                    <input
                      type="checkbox"
                      checked={cockpitState.testStatus[test.label] || false}
                      onchange={() => toggleTest(test.label)}
                    />
                    <span class="test-label" class:done={cockpitState.testStatus[test.label]}>{test.label}</span>
                  </label>
                {/each}
              </div>
            {/if}

            <div class="cockpit-meta">
              {#if strategyData.sessionDate}
                <span class="meta-item">Session: {strategyData.sessionDate}</span>
              {/if}
              {#if strategyData.lastReviewed}
                <span class="meta-item">Last reviewed: {strategyData.lastReviewed}</span>
              {/if}
            </div>

            <!-- Mini-chat for strategy agent -->
            <div class="cockpit-chat">
              <div class="section-label">STRATEGY AGENT</div>

              {#if chatLoading}
                <div class="chat-empty">Loading session history...</div>
              {:else if chatMessages.length > 0}
                <div class="chat-messages">
                  {#each chatMessages as msg}
                    {#if msg.type === 'system'}
                      <div class="chat-msg system">
                        <span class="chat-msg-role">!</span>
                        <span class="chat-msg-text" class:error={msg.isError}>{msg.text}</span>
                      </div>
                    {:else}
                      <div class="chat-msg" class:user={msg.type === 'user'} class:assistant={msg.type === 'assistant'}>
                        <span class="chat-msg-role">{msg.type === 'user' ? '>' : '←'}</span>
                        <span class="chat-msg-text">{truncateText(msg.text)}</span>
                      </div>
                    {/if}
                  {/each}
                  {#if chatProcessing && (chatThinking || chatActivity)}
                    <div class="chat-msg assistant">
                      <span class="chat-msg-role">←</span>
                      <span class="chat-msg-text thinking">{chatActivity || 'Thinking...'}</span>
                    </div>
                  {/if}
                </div>
              {:else if !strategySession}
                <div class="chat-empty">No strategy session. Click the chat icon to create one.</div>
              {:else}
                <div class="chat-empty">Ask about status, focus, progress, or give quick commands.</div>
              {/if}

              <!-- svelte-ignore a11y_autofocus -->
              <div class="chat-input-row">
                <input
                  type="text"
                  class="chat-input"
                  placeholder={strategySession ? 'what should I focus on today?' : 'Create a strategy session first...'}
                  disabled={!strategySession || chatSending}
                  bind:value={chatInput}
                  bind:this={inputEl}
                  onkeydown={handleChatKeydown}
                />
                {#if chatProcessing}
                  <button class="chat-stop-btn" onclick={handleChatStop} title="Stop">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  </button>
                {:else}
                  <button class="chat-send-btn" onclick={handleChatSend} disabled={!strategySession || !chatInput.trim()} title="Send">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .cockpit {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    background: #1e1d1a;
    position: relative;
    z-index: 20;
  }

  /* Collapsed bar */
  .cockpit-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.12s;
    min-height: 36px;
  }

  .cockpit-bar:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .cockpit-toggle {
    font-size: 10px;
    color: #6b6760;
    width: 12px;
    flex-shrink: 0;
  }

  .cockpit-gate {
    font-size: 11px;
    font-weight: 600;
    color: #da7756;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cockpit-sep {
    color: #3e3c37;
    font-size: 10px;
    flex-shrink: 0;
  }

  .cockpit-candidate {
    font-size: 11px;
    color: #b0ab9f;
    white-space: nowrap;
  }

  .cockpit-next {
    font-size: 10px;
    color: #6b6760;
    white-space: nowrap;
  }

  .cockpit-tests {
    font-size: 10px;
    color: #57ab5a;
    white-space: nowrap;
    font-weight: 500;
  }

  .cockpit-processing {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #da7756;
    font-weight: 500;
    white-space: nowrap;
  }

  .processing-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .cockpit-chat-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    color: #6b6760;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .cockpit-chat-btn:hover {
    background: rgba(218, 119, 86, 0.15);
    color: #da7756;
  }

  /* Backdrop to catch clicks outside */
  .cockpit-backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
  }

  /* Expanded panel — floats over content */
  .cockpit-expanded {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    padding: 12px 16px 16px;
    background: #1e1d1a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 21;
    animation: expandIn 0.15s ease-out;
    max-height: 80vh;
    overflow-y: auto;
  }

  @keyframes expandIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .cockpit-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  @media (max-width: 700px) {
    .cockpit-columns {
      grid-template-columns: 1fr;
    }
  }

  .cockpit-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cockpit-gate-full {
    font-size: 13px;
    font-weight: 600;
    color: #da7756;
    padding: 8px 12px;
    background: rgba(218, 119, 86, 0.08);
    border: 1px solid rgba(218, 119, 86, 0.15);
    border-radius: 8px;
  }

  .cockpit-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-label {
    font-size: 9px;
    font-weight: 700;
    color: #6b6760;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 2px;
  }

  /* Allocation bars */
  .alloc-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 20px;
  }

  .alloc-bar-container {
    width: 80px;
    height: 6px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 3px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .alloc-bar {
    height: 100%;
    background: #5b9fd6;
    border-radius: 3px;
    transition: width 0.3s;
  }

  .alloc-label {
    font-size: 11px;
    color: #b0ab9f;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alloc-pct {
    font-size: 10px;
    color: #6b6760;
    font-weight: 500;
    flex-shrink: 0;
  }

  /* Live session overlay on allocation */
  .alloc-live {
    font-size: 9px;
    color: #5b9fd6;
    font-weight: 500;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }

  .alloc-live.has-processing {
    color: #da7756;
  }

  .alloc-live-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* Gaps */
  .gap-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .gap-urgency {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .urgency-bar {
    width: 4px;
    height: 12px;
    border-radius: 1px;
  }

  .urgency-bar.empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .gap-area {
    font-size: 11px;
    color: #b0ab9f;
    font-weight: 500;
    white-space: nowrap;
  }

  .gap-detail {
    font-size: 10px;
    color: #6b6760;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One sentence */
  .cockpit-sentence {
    font-size: 11px;
    color: #908b81;
    line-height: 1.5;
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    font-style: italic;
  }

  /* Tests */
  .test-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    cursor: pointer;
  }

  .test-row input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: #57ab5a;
    cursor: pointer;
    flex-shrink: 0;
  }

  .test-label {
    font-size: 11px;
    color: #b0ab9f;
    transition: color 0.12s;
  }

  .test-label.done {
    color: #57ab5a;
    text-decoration: line-through;
    text-decoration-color: rgba(87, 171, 90, 0.4);
  }

  /* Meta */
  .cockpit-meta {
    display: flex;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .meta-item {
    font-size: 10px;
    color: #5a5650;
  }

  /* Mini-chat */
  .cockpit-chat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .chat-messages {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3e3c37 transparent;
  }

  .chat-msg {
    display: flex;
    gap: 6px;
    font-size: 11px;
    line-height: 1.4;
  }

  .chat-msg-role {
    flex-shrink: 0;
    color: #6b6760;
    font-family: monospace;
    font-size: 10px;
    width: 14px;
    text-align: center;
  }

  .chat-msg.user .chat-msg-role {
    color: #5b9fd6;
  }

  .chat-msg.assistant .chat-msg-role {
    color: #da7756;
  }

  .chat-msg-text {
    color: #b0ab9f;
    word-break: break-word;
  }

  .chat-msg.user .chat-msg-text {
    color: #d4d0c8;
  }

  .chat-msg-text.thinking {
    color: #6b6760;
    font-style: italic;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .chat-msg.system .chat-msg-role {
    color: #d4a72c;
  }

  .chat-msg.system .chat-msg-text {
    color: #908b81;
    font-style: italic;
  }

  .chat-msg-text.error {
    color: #e5534b;
  }

  .chat-empty {
    font-size: 10px;
    color: #5a5650;
    padding: 4px 0;
  }

  .chat-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .chat-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    color: #d4d0c8;
    outline: none;
    font-family: inherit;
    transition: border-color 0.12s;
  }

  .chat-input:focus {
    border-color: rgba(218, 119, 86, 0.3);
  }

  .chat-input::placeholder {
    color: #5a5650;
  }

  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-send-btn, .chat-stop-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }

  .chat-send-btn {
    background: rgba(218, 119, 86, 0.15);
    color: #da7756;
  }

  .chat-send-btn:hover:not(:disabled) {
    background: rgba(218, 119, 86, 0.25);
  }

  .chat-send-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .chat-stop-btn {
    background: rgba(229, 83, 75, 0.15);
    color: #e5534b;
  }

  .chat-stop-btn:hover {
    background: rgba(229, 83, 75, 0.25);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
