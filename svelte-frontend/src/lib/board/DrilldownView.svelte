<script>
  import { boardData, drilldownView, navigateHome, navigateToArea, navigateToProject, fetchBoardFile, fetchBoard } from '../../stores/board.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { activeSessionId, leaveSession, createSession } from '../../stores/sessions.svelte.js';
  import { sidebarOpen } from '../../stores/ui.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';

  import { onMount } from 'svelte';

  let docContent = $state(null);
  let docLoading = $state(false);

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });

  let view = $derived(drilldownView.value);
  let area = $derived.by(() => {
    if (!boardData.value || !view) return null;
    if (view.type === 'area') return boardData.value.areas.find(a => a.name === view.name) || null;
    if (view.type === 'project') return boardData.value.areas.find(a => a.name === view.areaName) || null;
    return null;
  });
  let project = $derived.by(() => {
    if (!boardData.value || !view || view.type !== 'project') return null;
    for (const a of boardData.value.areas) {
      const p = a.projects.find(p => p.path === view.path);
      if (p) return p;
      // Check sub-projects
      for (const parent of a.projects) {
        const sub = parent.subProjects?.find(s => s.path === view.path);
        if (sub) return { ...sub, isDir: true, subProjects: [], parentProject: parent.name };
      }
    }
    return null;
  });

  // Load doc when view changes
  $effect(() => {
    docContent = null;
    if (!view) return;
    if (view.type === 'area') {
      loadDoc(view.name + '/' + view.name + '.md');
    } else if (view.type === 'project') {
      if (project?.isDir) {
        // Try project-name/project-name.md inside the dir
        const parts = view.path.split('/');
        const projName = parts[parts.length - 1];
        loadDoc(view.path + '/' + projName + '.md');
      } else {
        loadDoc(view.path + '.md');
      }
    }
  });

  async function loadDoc(path) {
    docLoading = true;
    docContent = await fetchBoardFile(path);
    docLoading = false;
  }

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function handleSessionClick(sessionId, title) {
    if (activeSessionId.value) leaveSession();
    openTab(sessionId, title || 'Session');
    if (window.innerWidth < 1024) sidebarOpen.value = false;
  }

  function handleNewSession() {
    if (!view) return;
    const projectPath = view.type === 'project' ? view.path : null;
    createSession(null, true, projectPath);
    // Refresh board after a short delay to pick up the new session
    setTimeout(() => fetchBoard(), 1500);
  }

  function areaSessionCount(a) {
    let count = 0;
    for (const p of a.projects) {
      count += p.sessions.length;
      for (const sub of (p.subProjects || [])) count += (sub.sessions?.length || 0);
    }
    return count;
  }
</script>

<div class="drilldown">
  <!-- Breadcrumb -->
  <div class="drilldown-breadcrumb">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="breadcrumb-item clickable" onclick={navigateHome}>Home</span>
    {#if view?.type === 'area'}
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-item current">{formatAreaName(view.name)}</span>
    {:else if view?.type === 'project'}
      <span class="breadcrumb-sep">/</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="breadcrumb-item clickable" onclick={() => navigateToArea(view.areaName)}>{formatAreaName(view.areaName)}</span>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-item current">{project?.name || view.path.split('/').pop()}</span>
    {/if}
  </div>

  <div class="drilldown-content">
    {#if view?.type === 'area' && area}
      <!-- Area drill-down -->
      <div class="drilldown-header">
        <h2 class="drilldown-title">{formatAreaName(area.name)}</h2>
        <button class="drilldown-action" onclick={handleNewSession}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session
        </button>
      </div>

      <!-- TOTE state -->
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

      <!-- Projects -->
      {#if area.projects.length > 0}
        <div class="section">
          <h3 class="section-title">Projects ({area.projects.length})</h3>
          <div class="project-list">
            {#each area.projects as proj (proj.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="project-card" onclick={() => navigateToProject(proj.path, area.name)}>
                <div class="project-card-main">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    {#if proj.isDir}
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    {:else}
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    {/if}
                  </svg>
                  <span class="project-card-name">{proj.name}</span>
                </div>
                <div class="project-card-meta">
                  {#if proj.subProjects.length > 0}
                    <span class="meta-badge">{proj.subProjects.length} sub</span>
                  {/if}
                  {#if proj.sessions.length > 0}
                    <span class="meta-badge sessions">{proj.sessions.length} sessions</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Area doc -->
      {#if docLoading}
        <div class="doc-loading">Loading document...</div>
      {:else if docContent}
        <div class="section">
          <h3 class="section-title">Area Document</h3>
          <div class="doc-content">{@html renderMarkdown(docContent)}</div>
        </div>
      {/if}

    {:else if view?.type === 'project' && project}
      <!-- Project drill-down -->
      <div class="drilldown-header">
        <h2 class="drilldown-title">{project.name}</h2>
        <button class="drilldown-action" onclick={handleNewSession}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Session in {project.name}
        </button>
      </div>

      <div class="project-path-bar">
        <span class="project-path">{project.path}</span>
      </div>

      <!-- Sub-projects -->
      {#if project.subProjects?.length > 0}
        <div class="section">
          <h3 class="section-title">Sub-projects ({project.subProjects.length})</h3>
          <div class="project-list">
            {#each project.subProjects as sub, si (sub.path || si)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="project-card" onclick={() => { if (sub.path) navigateToProject(sub.path, view.areaName); }}>
                <div class="project-card-main">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span class="project-card-name">{sub.name || sub}</span>
                </div>
                {#if sub.sessions?.length > 0}
                  <div class="project-card-meta">
                    <span class="meta-badge sessions">{sub.sessions.length} sessions</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Sessions -->
      {#if project.sessions.length > 0}
        <div class="section">
          <h3 class="section-title">Sessions ({project.sessions.length})</h3>
          <div class="session-cards">
            {#each project.sessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="session-card" onclick={() => handleSessionClick(session.id, session.title)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="session-card-title">{session.title || 'Untitled'}</span>
                {#if session.isProcessing}
                  <span class="active-dot"></span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Project doc -->
      {#if docLoading}
        <div class="doc-loading">Loading document...</div>
      {:else if docContent}
        <div class="section">
          <h3 class="section-title">Project Document</h3>
          <div class="doc-content">{@html renderMarkdown(docContent)}</div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .drilldown {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .drilldown-breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 24px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.04);
    flex-shrink: 0;
  }

  .breadcrumb-item {
    font-size: 13px;
    color: var(--text-dimmer);
  }

  .breadcrumb-item.clickable {
    cursor: pointer;
    transition: color 0.12s;
  }

  .breadcrumb-item.clickable:hover {
    color: var(--accent);
  }

  .breadcrumb-item.current {
    color: var(--text);
    font-weight: 500;
  }

  .breadcrumb-sep {
    font-size: 12px;
    color: var(--text-dimmer);
  }

  .drilldown-content {
    padding: 20px 32px 40px;
    max-width: min(1100px, 90%);
    margin: 0 auto;
    width: 100%;
  }

  .drilldown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
  }

  .drilldown-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .drilldown-action {
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

  .drilldown-action:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  /* TOTE */
  .tote-section {
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 20px;
  }

  .tote-row {
    margin-bottom: 12px;
  }

  .tote-row:last-child {
    margin-bottom: 0;
  }

  .tote-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dimmer);
    margin-bottom: 4px;
    display: block;
  }

  .tote-label.desired {
    color: var(--success);
  }

  .tote-text {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  /* Sections */
  .section {
    margin-bottom: 24px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Project cards */
  .project-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  }

  .project-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }

  .project-card:hover {
    border-color: var(--accent-20);
    background: var(--bg-alt);
  }

  .project-card-main {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-dimmer);
    min-width: 0;
  }

  .project-card-name {
    font-size: 13px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-card-meta {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .meta-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.04);
    padding: 2px 6px;
    border-radius: 6px;
  }

  .meta-badge.sessions {
    color: #5b9fd6;
    background: rgba(91, 159, 214, 0.1);
  }

  /* Project path */
  .project-path-bar {
    margin-bottom: 16px;
  }

  .project-path {
    font-size: 11px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, monospace;
  }

  /* Sub-projects */
  .sub-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sub-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .sub-item svg {
    color: var(--text-dimmer);
  }

  /* Session cards */
  .session-cards {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .session-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.12s, transform 0.12s;
  }

  .session-card:hover {
    border-color: var(--accent-20);
    transform: translateX(2px);
  }

  .session-card svg {
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .session-card-title {
    flex: 1;
    font-size: 13px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-card:hover .session-card-title {
    color: var(--text);
  }

  .active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* Doc content */
  .doc-loading {
    padding: 16px;
    font-size: 13px;
    color: var(--text-dimmer);
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

  .doc-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .doc-content :global(strong) {
    color: var(--text);
  }

  .doc-content :global(ul), .doc-content :global(ol) {
    padding-left: 20px;
  }

  .doc-content :global(li) {
    margin-bottom: 4px;
  }

  @media (max-width: 640px) {
    .drilldown-content {
      padding: 16px;
    }

    .project-list {
      grid-template-columns: 1fr;
    }
  }
</style>
