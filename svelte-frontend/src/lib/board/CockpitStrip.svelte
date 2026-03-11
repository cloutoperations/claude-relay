<script>
  import { onMount } from 'svelte';
  import { getBasePath } from '../../stores/ws.js';
  import { boardData } from '../../stores/board.js';
  import { openPopup } from '../../stores/popups.js';
  import { sessions, createSession } from '../../stores/sessions.js';
  import { fetchBoard } from '../../stores/board.js';

  let expanded = $state(false);
  let strategyData = $state(null);
  let cockpitState = $state({ sessionDate: null, testStatus: {}, notes: [] });
  let loading = $state(true);

  // Find existing strategy session (tagged to strategy area)
  let strategySession = $derived.by(() => {
    if (!$boardData) return null;
    const stratArea = $boardData.areas.find(a => a.name === 'strategy');
    if (!stratArea) return null;
    // Look for a session in strategy projects
    for (const proj of stratArea.projects) {
      if (proj.sessions.length > 0) return proj.sessions[0];
      for (const sub of proj.subProjects) {
        if (sub.sessions?.length > 0) return sub.sessions[0];
      }
    }
    return null;
  });

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
        // Reset cockpit state if strategy session changed
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
  function areaSessionCount(areaName) {
    if (!$boardData) return { total: 0, processing: 0 };
    const area = $boardData.areas.find(a => a.name === areaName || formatTrackToArea(a.name) === areaName);
    if (!area) return { total: 0, processing: 0 };
    let total = 0, processing = 0;
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

  function formatTrackToArea(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

  function handleStrategyChat() {
    if (strategySession) {
      // Open existing strategy session as popup
      openPopup(strategySession.id, strategySession.title || 'Strategy');
    } else {
      // Create new session tagged to strategy
      createSession(null, false, 'strategy');
      setTimeout(() => {
        fetchBoard();
        // After board refreshes, the derived will find the new session
        // and next click will open it as popup
      }, 2000);
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && expanded) {
      expanded = false;
    }
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

      <button class="cockpit-chat-btn" onclick={(e) => { e.stopPropagation(); handleStrategyChat(); }} title="Open strategy session">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>

    <!-- Expanded panel -->
    {#if expanded}
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
                  <div class="alloc-row">
                    <div class="alloc-bar-container">
                      <div class="alloc-bar" style="width: {track.percent}%"></div>
                    </div>
                    <span class="alloc-label">{track.track}</span>
                    <span class="alloc-pct">{track.percent}%</span>
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

          <!-- Right: Tests -->
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
  }

  .cockpit.expanded {
    background: #1e1d1a;
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

  /* Expanded panel */
  .cockpit-expanded {
    padding: 4px 16px 16px;
    animation: expandIn 0.15s ease-out;
  }

  @keyframes expandIn {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 600px; }
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

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
