<script>
  import { boardData, fetchBoard, fetchBoardFile } from '../../stores/board.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { createSession } from '../../stores/sessions.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';
  import { addTabToPane, findPaneForTab, switchPaneTab, activePaneId } from '../../stores/panes.svelte.js';
  import { onMount } from 'svelte';

  let { projectPath } = $props();

  const AREA_PREFIX = '__area__:';

  let docContent = $state(null);
  let docLoading = $state(false);

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });

  // Find the project and its parent area
  let project = $derived.by(() => {
    if (!boardData.value || !projectPath) return null;
    for (const area of boardData.value.areas) {
      const p = area.projects.find(p => p.path === projectPath);
      if (p) return { ...p, areaName: area.name };
      for (const parent of area.projects) {
        const sub = parent.subProjects?.find(s => s.path === projectPath);
        if (sub) return { ...sub, areaName: area.name, parentProject: parent.name, isDir: true, subProjects: sub.subProjects || [] };
      }
    }
    return null;
  });

  // Load project doc
  $effect(() => {
    if (!projectPath || !project) return;
    docContent = null;
    if (project.isDir) {
      const parts = projectPath.split('/');
      const projName = parts[parts.length - 1];
      loadDoc(projectPath + '/' + projName + '.md');
    } else {
      loadDoc(projectPath + '.md');
    }
  });

  async function loadDoc(path) {
    docLoading = true;
    docContent = await fetchBoardFile(path);
    docLoading = false;
  }

  function formatName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function handleSessionClick(e, session) {
    if (e.shiftKey) {
      openTab(session.id, session.title || 'Session');
    } else {
      openTab(session.id, session.title || 'Session');
    }
  }

  function openAreaTab(areaName) {
    const tabId = AREA_PREFIX + areaName;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }

  function handleNewSession() {
    createSession(null, true, projectPath);
    setTimeout(() => fetchBoard(), 1500);
  }
</script>

{#if !project}
  <div class="pd-loading">
    <div class="pd-spinner"></div>
    <span>Loading project...</span>
  </div>
{:else}
  <div class="project-detail">
    <div class="pd-content">
      <!-- Breadcrumb -->
      <div class="pd-breadcrumb">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="pd-crumb clickable" onclick={() => openAreaTab(project.areaName)}>{formatName(project.areaName)}</span>
        <span class="pd-crumb-sep">/</span>
        {#if project.parentProject}
          <span class="pd-crumb dimmed">{project.parentProject}</span>
          <span class="pd-crumb-sep">/</span>
        {/if}
        <span class="pd-crumb current">{project.name}</span>
      </div>

      <!-- Header -->
      <div class="pd-header">
        <h2 class="pd-title">{formatName(project.name)}</h2>
        <button class="pd-action" onclick={handleNewSession}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session
        </button>
      </div>

      <div class="pd-path">{projectPath}</div>

      <!-- Sub-projects -->
      {#if project.subProjects?.length > 0}
        <div class="pd-section">
          <h3 class="pd-section-title">Sub-projects ({project.subProjects.length})</h3>
          <div class="pd-sub-list">
            {#each project.subProjects as sub, si (sub.path || si)}
              <div class="pd-sub-card">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="pd-sub-name">{sub.name || sub}</span>
                {#if sub.sessions?.length > 0}
                  <span class="pd-badge sessions">{sub.sessions.length}</span>
                {/if}
              </div>

              {#if sub.sessions?.length > 0}
                <div class="pd-sub-sessions">
                  {#each sub.sessions as session (session.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="pd-session" onclick={(e) => handleSessionClick(e, session)}>
                      <span class="pd-session-dot" class:processing={session.isProcessing}></span>
                      <span class="pd-session-title">{session.title || 'Untitled'}</span>
                      {#if session.isProcessing}
                        <span class="pd-session-status">processing</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- Sessions -->
      {#if project.sessions?.length > 0}
        <div class="pd-section">
          <h3 class="pd-section-title">Sessions ({project.sessions.length})</h3>
          <div class="pd-sessions-list">
            {#each project.sessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="pd-session" onclick={(e) => handleSessionClick(e, session)}>
                <span class="pd-session-dot" class:processing={session.isProcessing}></span>
                <span class="pd-session-title">{session.title || 'Untitled'}</span>
                {#if session.isProcessing}
                  <span class="pd-session-status">processing</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Document -->
      {#if docLoading}
        <div class="pd-doc-loading">Loading document...</div>
      {:else if docContent}
        <div class="pd-section">
          <h3 class="pd-section-title">Document</h3>
          <div class="pd-doc">{@html renderMarkdown(docContent)}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .project-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .pd-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dimmer);
    font-size: 13px;
  }

  .pd-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: pdSpin 0.7s linear infinite;
  }

  @keyframes pdSpin { to { transform: rotate(360deg); } }

  .pd-content {
    padding: 20px 32px 40px;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
  }

  /* Breadcrumb */
  .pd-breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
  }

  .pd-crumb {
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .pd-crumb.clickable {
    cursor: pointer;
    transition: color 0.12s;
  }

  .pd-crumb.clickable:hover { color: var(--accent); }
  .pd-crumb.current { color: var(--text); font-weight: 500; }
  .pd-crumb.dimmed { color: var(--text-dimmer); }
  .pd-crumb-sep { font-size: 12px; color: var(--text-dimmer); }

  /* Header */
  .pd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 16px;
  }

  .pd-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .pd-action {
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

  .pd-action:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .pd-path {
    font-size: 11px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, monospace;
    margin-bottom: 20px;
  }

  /* Sections */
  .pd-section { margin-bottom: 24px; }

  .pd-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Sub-projects */
  .pd-sub-list { display: flex; flex-direction: column; gap: 2px; }

  .pd-sub-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    color: var(--text-dimmer);
  }

  .pd-sub-name {
    flex: 1;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .pd-sub-sessions { padding: 2px 0 8px 28px; }

  .pd-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.04);
    padding: 2px 6px;
    border-radius: 6px;
  }

  .pd-badge.sessions {
    color: #5b9fd6;
    background: rgba(91, 159, 214, 0.1);
  }

  /* Sessions */
  .pd-sessions-list { display: flex; flex-direction: column; gap: 2px; }

  .pd-session {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .pd-session:hover { background: rgba(var(--overlay-rgb), 0.04); }

  .pd-session-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5b9fd6;
    flex-shrink: 0;
  }

  .pd-session-dot.processing {
    background: var(--accent);
    animation: pdPulse 1.5s ease-in-out infinite;
  }

  @keyframes pdPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .pd-session-title {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pd-session:hover .pd-session-title { color: var(--text); }

  .pd-session-status {
    font-size: 9px;
    color: var(--accent);
    flex-shrink: 0;
  }

  /* Document */
  .pd-doc-loading {
    padding: 16px;
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .pd-doc {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 20px 24px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .pd-doc :global(h1), .pd-doc :global(h2), .pd-doc :global(h3) {
    color: var(--text);
    margin-top: 1.2em;
    margin-bottom: 0.4em;
  }

  .pd-doc :global(h1) { font-size: 18px; }
  .pd-doc :global(h2) { font-size: 15px; }
  .pd-doc :global(h3) { font-size: 14px; }

  .pd-doc :global(code) {
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .pd-doc :global(pre) {
    background: var(--code-bg);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
  }

  .pd-doc :global(pre code) { background: none; padding: 0; }
  .pd-doc :global(strong) { color: var(--text); }
  .pd-doc :global(ul), .pd-doc :global(ol) { padding-left: 20px; }
  .pd-doc :global(li) { margin-bottom: 4px; }

  @media (max-width: 640px) {
    .pd-content { padding: 16px; }
  }
</style>
