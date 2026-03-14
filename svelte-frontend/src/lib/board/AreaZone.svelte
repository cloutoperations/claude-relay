<script>
  import { onMount } from 'svelte';
  import SessionBubble from './SessionBubble.svelte';
  import SessionTagger from './SessionTagger.svelte';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { activeSessionId, leaveSession, createSession } from '../../stores/sessions.svelte.js';
  import { fetchBoardFile, fetchBoard } from '../../stores/board.svelte.js';
  import { sidebarOpen } from '../../stores/ui.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';

  let {
    area,
    focused = false,
    compact = false,
    onFocus = () => {},
    onUnfocus = () => {},
  } = $props();

  // Hover state
  let zoneEl = $state(null);
  let hovered = $state(false);
  let hoverPanelVisible = $state(false);
  let showTimer = $state(null);
  let hideTimer = $state(null);

  // Tagger state
  let taggerSessionId = $state(null);
  let taggerX = $state(0);
  let taggerY = $state(0);

  // Focused mode doc
  let docContent = $state(null);
  let docLoading = $state(false);

  // Collect all sessions across projects, sub-projects, and area-level
  let allSessions = $derived.by(() => {
    const sessions = [];
    if (area.areaSessions) {
      for (const s of area.areaSessions) sessions.push({ ...s, projectName: area.name });
    }
    for (const p of area.projects) {
      for (const s of p.sessions) sessions.push({ ...s, projectName: p.name });
      for (const sub of p.subProjects) {
        if (sub.sessions) {
          for (const s of sub.sessions) sessions.push({ ...s, projectName: sub.name || sub });
        }
      }
    }
    return sessions;
  });

  let sessionCount = $derived(allSessions.length);
  let processingCount = $derived(allSessions.filter(s => s.isProcessing).length);

  let weight = $derived.by(() => {
    return area.projects.length * 2
      + sessionCount * 3
      + processingCount * 5
      + (processingCount > 0 ? 2 : 0)
      + ((area.presentState || area.desiredState) ? 1 : 0);
  });

  // TOTE progress
  let hasPresent = $derived(!!area.presentState);
  let hasDesired = $derived(!!area.desiredState);

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Hover timing
  function onMouseEnter() {
    if (focused || compact) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hovered = true;
    showTimer = setTimeout(() => {
      hoverPanelVisible = true;
    }, 200);
  }

  function onMouseLeave() {
    if (focused || compact) return;
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    hovered = false;
    hideTimer = setTimeout(() => {
      hoverPanelVisible = false;
    }, 300);
  }

  function onPanelEnter() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function onPanelLeave() {
    hideTimer = setTimeout(() => {
      hoverPanelVisible = false;
      hovered = false;
    }, 300);
  }

  // Hover panel positioning
  let panelStyle = $derived.by(() => {
    if (!zoneEl || !hoverPanelVisible) return '';
    const rect = zoneEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left, top;

    // Prefer right side
    if (rect.right + 260 < vw) {
      left = rect.right + 8;
    } else {
      left = rect.left - 260;
    }

    top = rect.top;
    // Don't overflow bottom
    if (top + 400 > vh) {
      top = Math.max(8, vh - 400);
    }

    return `left: ${left}px; top: ${top}px`;
  });

  function handleZoneClick() {
    if (compact) {
      onFocus();
    } else if (!focused) {
      hoverPanelVisible = false;
      onFocus();
    }
  }

  function handleSessionClick(e, session) {
    e.stopPropagation();
    if (activeSessionId.value) leaveSession();
    openTab(session.id, session.title || 'Session');
    if (window.innerWidth < 1024) sidebarOpen.value = false;
  }

  function handleContextMenu(e, sessionId) {
    taggerSessionId = sessionId;
    taggerX = e.clientX;
    taggerY = e.clientY;
  }

  function handleNewSession(projectPath = null) {
    createSession(null, true, projectPath);
    setTimeout(() => fetchBoard(), 1500);
  }

  // Load doc when focused
  $effect(() => {
    if (focused && area) {
      docContent = null;
      docLoading = true;
      fetchBoardFile(area.name + '/' + area.name + '.md').then(content => {
        docContent = content;
        docLoading = false;
      });
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->

{#if compact}
  <!-- COMPACT MODE: tiny pill -->
  <div class="zone-compact" onclick={handleZoneClick}>
    <span class="compact-name">{formatAreaName(area.name)}</span>
    {#if sessionCount > 0}
      <span class="compact-dots">
        {#each allSessions.slice(0, 5) as session (session.id)}
          <SessionBubble {session} size="sm" />
        {/each}
        {#if sessionCount > 5}
          <span class="compact-more">+{sessionCount - 5}</span>
        {/if}
      </span>
    {/if}
  </div>

{:else if focused}
  <!-- FOCUSED MODE: expanded view -->
  <div class="zone-focused">
    <div class="focused-header">
      <h2 class="focused-title">{formatAreaName(area.name)}</h2>
      <div class="focused-actions">
        <button class="action-btn" onclick={() => handleNewSession()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session
        </button>
        <button class="action-btn secondary" onclick={onUnfocus}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- TOTE full text -->
    {#if area.presentState || area.desiredState}
      <div class="tote-section">
        {#if area.presentState}
          <div class="tote-row">
            <span class="tote-label">Present State</span>
            <p class="tote-text">{area.presentState}</p>
          </div>
        {/if}
        {#if area.desiredState}
          <div class="tote-row">
            <span class="tote-label desired">Desired State</span>
            <p class="tote-text">{area.desiredState}</p>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Projects list -->
    {#if area.projects.length > 0}
      <div class="focused-projects">
        {#each area.projects as proj (proj.path)}
          <div class="focused-project">
            <div class="focused-project-header">
              <div class="fp-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  {#if proj.isDir}
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  {:else}
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  {/if}
                </svg>
                <span class="fp-name">{proj.name}</span>
                {#if proj.subProjects.length > 0}
                  <span class="fp-badge">{proj.subProjects.length} sub</span>
                {/if}
              </div>
              <button class="action-btn small" onclick={(e) => { e.stopPropagation(); handleNewSession(proj.path); }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>

            <!-- Sub-projects -->
            {#if proj.subProjects.length > 0}
              <div class="sub-projects">
                {#each proj.subProjects as sub, si (sub.path || si)}
                  <div class="sub-project-row">
                    <span class="sub-name">{sub.name || sub}</span>
                    {#if sub.sessions?.length > 0}
                      <div class="sub-sessions">
                        {#each sub.sessions as session (session.id)}
                          <SessionBubble {session} size="sm" onContextMenu={handleContextMenu} />
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Sessions -->
            {#if proj.sessions.length > 0}
              <div class="session-cards">
                {#each proj.sessions as session (session.id)}
                  <div
                    class="session-card"
                    onclick={(e) => handleSessionClick(e, session)}
                    oncontextmenu={(e) => { e.preventDefault(); handleContextMenu(e, session.id); }}
                  >
                    <SessionBubble {session} size="md" />
                    <span class="sc-title">{session.title || 'Untitled'}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="no-sessions">No sessions</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Area doc -->
    {#if docLoading}
      <div class="doc-loading">Loading document...</div>
    {:else if docContent}
      <div class="doc-section">
        <h3 class="section-label">Area Document</h3>
        <div class="doc-content">{@html renderMarkdown(docContent)}</div>
      </div>
    {/if}
  </div>

{:else}
  <!-- NORMAL MODE: overview grid card -->
  <div
    class="zone-normal"
    class:hovered
    bind:this={zoneEl}
    onmouseenter={onMouseEnter}
    onmouseleave={onMouseLeave}
    onclick={handleZoneClick}
  >
    <!-- TOTE progress bar -->
    <div class="tote-bar">
      <div class="tote-bar-present" class:active={hasPresent}></div>
      <div class="tote-bar-desired" class:active={hasDesired}></div>
    </div>

    <div class="zone-header">
      <span class="zone-name">{formatAreaName(area.name)}</span>
      <div class="zone-meta">
        {#if processingCount > 0}
          <span class="meta-badge active">{processingCount} active</span>
        {/if}
        <span class="meta-badge">{sessionCount}</span>
        <div class="zone-dots">
          {#each allSessions.slice(0, 6) as session (session.id)}
            <SessionBubble {session} size="sm" onContextMenu={handleContextMenu} />
          {/each}
        </div>
      </div>
    </div>

    {#if area.projects.length > 0}
      <div class="zone-projects">
        {#each area.projects as proj (proj.path)}
          <span class="project-pill" class:has-sessions={proj.sessions.length > 0}>
            {proj.name}
            {#if proj.sessions.length > 0}
              <span class="pill-dots">
                {#each proj.sessions.slice(0, 3) as session (session.id)}
                  <SessionBubble {session} size="sm" onContextMenu={handleContextMenu} />
                {/each}
                {#if proj.sessions.length > 3}
                  <span class="pill-more">+{proj.sessions.length - 3}</span>
                {/if}
              </span>
            {/if}
          </span>
        {/each}
      </div>
    {/if}

    {#if area.presentState}
      <div class="zone-state">
        <span class="state-text">{area.presentState}</span>
      </div>
    {/if}
  </div>

  <!-- HOVER PANEL -->
  {#if hoverPanelVisible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hover-panel"
      style={panelStyle}
      onmouseenter={onPanelEnter}
      onmouseleave={onPanelLeave}
    >
      <div class="hp-header">{formatAreaName(area.name)}</div>

      {#each area.projects as proj (proj.path)}
        <div class="hp-project">
          <div class="hp-project-name">
            <span class="hp-dot" class:active={proj.sessions.length > 0}></span>
            {proj.name}
          </div>
          {#if proj.sessions.length > 0}
            {#each proj.sessions as session (session.id)}
              <div
                class="hp-session"
                onclick={(e) => handleSessionClick(e, session)}
                oncontextmenu={(e) => { e.preventDefault(); handleContextMenu(e, session.id); }}
              >
                <SessionBubble {session} size="md" />
                <span class="hp-session-title">{session.title || 'Untitled'}</span>
                <span class="hp-session-state">{session.isProcessing ? 'processing' : 'idle'}</span>
              </div>
            {/each}
          {/if}

          <!-- Sub-project sessions in hover -->
          {#each proj.subProjects as sub, si (sub.path || si)}
            {#if sub.sessions?.length > 0}
              <div class="hp-sub-label">{sub.name || sub}</div>
              {#each sub.sessions as session (session.id)}
                <div
                  class="hp-session"
                  onclick={(e) => handleSessionClick(e, session)}
                  oncontextmenu={(e) => { e.preventDefault(); handleContextMenu(e, session.id); }}
                >
                  <SessionBubble {session} size="md" />
                  <span class="hp-session-title">{session.title || 'Untitled'}</span>
                  <span class="hp-session-state">{session.isProcessing ? 'processing' : 'idle'}</span>
                </div>
              {/each}
            {/if}
          {/each}

          {#if proj.sessions.length === 0 && !proj.subProjects.some(s => s.sessions?.length > 0)}
            <div class="hp-no-sessions">(no sessions)</div>
          {/if}
        </div>
      {/each}

      {#if area.projects.length === 0}
        <div class="hp-empty">No projects</div>
      {/if}
    </div>
  {/if}
{/if}

<!-- Session tagger -->
{#if taggerSessionId}
  <SessionTagger
    sessionId={taggerSessionId}
    x={taggerX}
    y={taggerY}
    onClose={() => { taggerSessionId = null; }}
  />
{/if}

<style>
  /* ========== COMPACT MODE ========== */
  .zone-compact {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    white-space: nowrap;
  }

  .zone-compact:hover {
    border-color: var(--accent-25);
    background: var(--bg-alt);
  }

  .compact-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .compact-dots {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .compact-more {
    font-size: 9px;
    color: var(--text-dimmer);
  }

  /* ========== NORMAL MODE ========== */
  .zone-normal {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s, background 0.2s, box-shadow 0.2s;
    position: relative;
    box-shadow: 0 1px 3px rgba(var(--shadow-rgb), 0.25), 0 1px 2px rgba(var(--shadow-rgb), 0.15);
  }

  .zone-normal.hovered {
    border-color: var(--accent-25);
    transform: scale(1.02);
    background: var(--bg-alt);
    box-shadow: 0 4px 12px rgba(var(--shadow-rgb), 0.35), 0 2px 4px rgba(var(--shadow-rgb), 0.2);
  }

  .zone-normal:hover {
    border-color: var(--accent-20);
  }

  /* TOTE bar */
  .tote-bar {
    display: flex;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 12px;
    gap: 2px;
  }

  .tote-bar-present, .tote-bar-desired {
    flex: 1;
    background: rgba(var(--overlay-rgb), 0.06);
    border-radius: 3px;
    transition: background 0.2s;
  }

  .tote-bar-present.active { background: var(--accent); }
  .tote-bar-desired.active { background: var(--success); }

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .zone-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }

  .zone-meta {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .meta-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 1px 7px;
    border-radius: 8px;
    font-weight: 500;
    white-space: nowrap;
  }

  .meta-badge.active {
    color: var(--success);
    background: var(--success-12);
  }

  .zone-dots {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .zone-projects {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }

  .project-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-muted);
    background: rgba(var(--overlay-rgb), 0.04);
    padding: 2px 8px;
    border-radius: 6px;
  }

  .project-pill.has-sessions {
    color: var(--text-secondary);
  }

  .pill-dots {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }

  .pill-more {
    font-size: 9px;
    color: var(--text-dimmer);
  }

  .zone-state {
    margin-top: 6px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.04);
    padding-top: 6px;
  }

  .state-text {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    overflow: hidden;
    max-height: 2.8em; /* 2 lines at 1.4 line-height */
    text-overflow: ellipsis;
  }

  /* ========== HOVER PANEL ========== */
  .hover-panel {
    position: fixed;
    z-index: 100;
    width: 280px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(var(--shadow-rgb), 0.5);
    padding: 12px 0;
    animation: panelIn 0.15s ease-out;
  }

  @keyframes panelIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .hp-header {
    padding: 0 14px 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.06);
    margin-bottom: 4px;
  }

  .hp-project {
    padding: 6px 0;
  }

  .hp-project-name {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 14px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .hp-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dimmer);
    flex-shrink: 0;
  }

  .hp-dot.active { background: #5b9fd6; }

  .hp-session {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px 4px 26px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-session:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-session-title {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hp-session-state {
    font-size: 9px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .hp-sub-label {
    padding: 4px 14px 2px 26px;
    font-size: 10px;
    color: var(--text-dimmer);
    font-weight: 500;
  }

  .hp-no-sessions {
    padding: 2px 14px 2px 26px;
    font-size: 10px;
    color: var(--text-dimmer);
    font-style: italic;
  }

  .hp-empty {
    padding: 8px 14px;
    font-size: 11px;
    color: var(--text-dimmer);
  }

  /* ========== FOCUSED MODE ========== */
  .zone-focused {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px 40px;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
  }

  .focused-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
  }

  .focused-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .focused-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .action-btn:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .action-btn.secondary {
    background: rgba(var(--overlay-rgb), 0.04);
    border-color: rgba(var(--overlay-rgb), 0.1);
    color: var(--text-muted);
    padding: 7px 10px;
  }

  .action-btn.secondary:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

  .action-btn.small {
    padding: 4px 8px;
    font-size: 10px;
    border-radius: 6px;
  }

  /* TOTE */
  .tote-section {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 20px;
  }

  .tote-row { margin-bottom: 12px; }
  .tote-row:last-child { margin-bottom: 0; }

  .tote-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dimmer);
    margin-bottom: 4px;
    display: block;
  }

  .tote-label.desired { color: var(--success); }

  .tote-text {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  /* Focused projects */
  .focused-projects {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }

  .focused-project {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 14px;
  }

  .focused-project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .fp-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-dimmer);
  }

  .fp-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .fp-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.04);
    padding: 2px 6px;
    border-radius: 6px;
  }

  .sub-projects {
    padding-left: 22px;
    margin-bottom: 6px;
  }

  .sub-project-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }

  .sub-name {
    font-size: 12px;
    color: var(--text-muted);
  }

  .sub-sessions {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .session-cards {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .session-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .session-card:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .sc-title {
    font-size: 12px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-card:hover .sc-title {
    color: var(--text);
  }

  .no-sessions {
    font-size: 11px;
    color: var(--text-dimmer);
    font-style: italic;
    padding: 4px 0;
  }

  /* Doc */
  .doc-loading {
    padding: 16px;
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .doc-section {
    margin-top: 24px;
  }

  .doc-content {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 20px 24px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .doc-content :global(h1),
  .doc-content :global(h2),
  .doc-content :global(h3) {
    color: var(--text);
    margin-top: 1.2em;
    margin-bottom: 0.4em;
  }

  .doc-content :global(h1) { font-size: 18px; }
  .doc-content :global(h2) { font-size: 15px; }
  .doc-content :global(h3) { font-size: 14px; }

  .doc-content :global(code) {
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .doc-content :global(pre) {
    background: var(--code-bg);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
  }

  .doc-content :global(pre code) { background: none; padding: 0; }
  .doc-content :global(strong) { color: var(--text); }
  .doc-content :global(ul), .doc-content :global(ol) { padding-left: 20px; }
  .doc-content :global(li) { margin-bottom: 4px; }
</style>
