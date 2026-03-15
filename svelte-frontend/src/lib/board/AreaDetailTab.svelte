<script>
  import { boardData, fetchBoard, fetchBoardFile } from '../../stores/board.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { createSession } from '../../stores/sessions.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';
  import { addTabToPane, findPaneForTab, switchPaneTab, activePaneId } from '../../stores/panes.svelte.js';
  import { onMount } from 'svelte';

  const PROJECT_PREFIX = '__project__:';
  const OPERATION_PREFIX = '__operation__:';

  let { areaName } = $props();

  let docContent = $state(null);
  let docLoading = $state(false);

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });

  let area = $derived.by(() => {
    if (!boardData.value || !areaName) return null;
    return boardData.value.areas.find(a => a.name === areaName) || null;
  });

  // Load area doc
  $effect(() => {
    if (!areaName) return;
    docContent = null;
    loadDoc(areaName + '/' + areaName + '.md');
  });

  async function loadDoc(path) {
    docLoading = true;
    docContent = await fetchBoardFile(path);
    docLoading = false;
  }

  function formatName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function getAllSessions(a) {
    const sessions = [];
    if (a.areaSessions) {
      for (const s of a.areaSessions) sessions.push({ ...s, source: a.name });
    }
    for (const p of a.projects) {
      for (const s of p.sessions) sessions.push({ ...s, source: p.name });
      for (const sub of p.subProjects) {
        if (sub.sessions) {
          for (const s of sub.sessions) sessions.push({ ...s, source: sub.name || sub });
        }
      }
    }
    return sessions;
  }

  function handleSessionClick(e, session) {
    if (e.shiftKey) {
      openTab(session.id, session.title || 'Session');
    } else {
      openTab(session.id, session.title || 'Session');
    }
  }

  function openProjectTab(projectPath) {
    const tabId = PROJECT_PREFIX + projectPath;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }

  function handleNewSession() {
    createSession(null, true, areaName);
    setTimeout(() => fetchBoard(), 1500);
  }

  function openOperationTab(opPath) {
    const tabId = OPERATION_PREFIX + opPath;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }
</script>

{#if !area}
  <div class="ad-loading">
    <div class="ad-spinner"></div>
    <span>Loading area...</span>
  </div>
{:else}
  <div class="area-detail">
    <div class="ad-content">
      <!-- Header -->
      <div class="ad-header">
        <h2 class="ad-title">{formatName(area.name)}</h2>
        <button class="ad-action" onclick={handleNewSession}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session
        </button>
      </div>

      <!-- TOTE -->
      {#if area.presentState || area.desiredState}
        <div class="ad-tote">
          {#if area.presentState}
            <div class="ad-tote-row">
              <span class="ad-tote-label">Present State</span>
              <p class="ad-tote-text">{area.presentState}</p>
            </div>
          {/if}
          {#if area.desiredState}
            <div class="ad-tote-row">
              <span class="ad-tote-label desired">Desired State</span>
              <p class="ad-tote-text">{area.desiredState}</p>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Projects -->
      {#if area.projects.length > 0}
        <div class="ad-section">
          <h3 class="ad-section-title">Projects ({area.projects.length})</h3>
          <div class="ad-projects">
            {#each area.projects as proj (proj.path)}
              {@const projSessions = [...proj.sessions, ...proj.subProjects.flatMap(s => s.sessions || [])]}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="ad-project-card" onclick={() => openProjectTab(proj.path)}>
                <div class="ad-project-main">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    {#if proj.isDir}
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    {:else}
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    {/if}
                  </svg>
                  <span class="ad-project-name">{proj.name}</span>
                </div>
                <div class="ad-project-meta">
                  {#if proj.subProjects.length > 0}
                    <span class="ad-badge">{proj.subProjects.length} sub</span>
                  {/if}
                  {#if projSessions.length > 0}
                    <span class="ad-badge sessions">{projSessions.length}</span>
                  {/if}
                </div>
              </div>

              <!-- Sessions under project -->
              {#if projSessions.length > 0}
                <div class="ad-project-sessions">
                  {#each projSessions as session (session.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="ad-session" onclick={(e) => handleSessionClick(e, session)}>
                      <span class="ad-session-dot" class:processing={session.isProcessing}></span>
                      <span class="ad-session-title">{session.title || 'Untitled'}</span>
                      {#if session.isProcessing}
                        <span class="ad-session-status">processing</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- Operations -->
      {#if area.operations?.length > 0}
        <div class="ad-section">
          <h3 class="ad-section-title">Operations ({area.operations.length})</h3>
          <div class="ad-projects">
            {#each area.operations as op (op.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="ad-project-card" onclick={() => openOperationTab(op.path)}>
                <div class="ad-project-main">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                  <span class="ad-project-name">{op.name}</span>
                </div>
                {#if op.description}
                  <div class="ad-op-desc">{op.description.substring(0, 80)}{op.description.length > 80 ? '...' : ''}</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Area-level sessions -->
      {#if area.areaSessions?.length > 0}
        <div class="ad-section">
          <h3 class="ad-section-title">Area Sessions ({area.areaSessions.length})</h3>
          <div class="ad-sessions-list">
            {#each area.areaSessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="ad-session" onclick={(e) => handleSessionClick(e, session)}>
                <span class="ad-session-dot" class:processing={session.isProcessing}></span>
                <span class="ad-session-title">{session.title || 'Untitled'}</span>
                {#if session.isProcessing}
                  <span class="ad-session-status">processing</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Area document -->
      {#if docLoading}
        <div class="ad-doc-loading">Loading document...</div>
      {:else if docContent}
        <div class="ad-section">
          <h3 class="ad-section-title">Document</h3>
          <div class="ad-doc">{@html renderMarkdown(docContent)}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .area-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .ad-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dimmer);
    font-size: 13px;
  }

  .ad-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: adSpin 0.7s linear infinite;
  }

  @keyframes adSpin { to { transform: rotate(360deg); } }

  .ad-content {
    padding: 20px 32px 40px;
    max-width: min(1100px, 90%);
    margin: 0 auto;
    width: 100%;
  }

  .ad-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
  }

  .ad-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .ad-action {
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
    flex-shrink: 0;
  }

  .ad-action:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  /* TOTE */
  .ad-tote {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 20px;
  }

  .ad-tote-row { margin-bottom: 12px; }
  .ad-tote-row:last-child { margin-bottom: 0; }

  .ad-tote-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dimmer);
    margin-bottom: 4px;
    display: block;
  }

  .ad-tote-label.desired { color: var(--success); }

  .ad-tote-text {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  /* Sections */
  .ad-section { margin-bottom: 24px; }

  .ad-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Projects */
  .ad-projects {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ad-project-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .ad-project-card:hover {
    background: rgba(var(--overlay-rgb), 0.04);
    border-color: rgba(var(--overlay-rgb), 0.12);
  }

  .ad-project-main {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-dimmer);
    min-width: 0;
  }

  .ad-project-name {
    font-size: 13px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .ad-op-desc {
    font-size: 11px;
    color: var(--text-dimmer);
    padding: 2px 0 0 22px;
    line-height: 1.4;
  }

  .ad-project-meta {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .ad-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.04);
    padding: 2px 6px;
    border-radius: 6px;
  }

  .ad-badge.sessions {
    color: #5b9fd6;
    background: rgba(91, 159, 214, 0.1);
  }

  /* Sessions under projects */
  .ad-project-sessions {
    padding: 2px 0 8px 28px;
  }

  .ad-sessions-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ad-session {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .ad-session:hover {
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .ad-session-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5b9fd6;
    flex-shrink: 0;
  }

  .ad-session-dot.processing {
    background: var(--accent);
    animation: adPulse 1.5s ease-in-out infinite;
  }

  @keyframes adPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .ad-session-title {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ad-session:hover .ad-session-title { color: var(--text); }

  .ad-session-status {
    font-size: 9px;
    color: var(--accent);
    flex-shrink: 0;
  }

  /* Doc */
  .ad-doc-loading {
    padding: 16px;
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .ad-doc {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 20px 24px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .ad-doc :global(h1), .ad-doc :global(h2), .ad-doc :global(h3) {
    color: var(--text);
    margin-top: 1.2em;
    margin-bottom: 0.4em;
  }

  .ad-doc :global(h1) { font-size: 18px; }
  .ad-doc :global(h2) { font-size: 15px; }
  .ad-doc :global(h3) { font-size: 14px; }

  .ad-doc :global(code) {
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .ad-doc :global(pre) {
    background: var(--code-bg);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
  }

  .ad-doc :global(pre code) { background: none; padding: 0; }
  .ad-doc :global(strong) { color: var(--text); }
  .ad-doc :global(ul), .ad-doc :global(ol) { padding-left: 20px; }
  .ad-doc :global(li) { margin-bottom: 4px; }

  @media (max-width: 640px) {
    .ad-content { padding: 16px; }
  }
</style>
