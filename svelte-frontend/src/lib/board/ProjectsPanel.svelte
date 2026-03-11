<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, boardError, expandedAreas, expandedProjects, fetchBoard, toggleArea, toggleProject, navigateToArea, navigateToProject } from '../../stores/board.js';
  import { openPopup } from '../../stores/popups.js';
  import { sidebarOpen } from '../../stores/ui.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.js';

  onMount(() => {
    if (!$boardData) fetchBoard();
  });

  function areaSessionCount(area) {
    let count = 0;
    for (const p of area.projects) {
      count += p.sessions.length;
      for (const sub of p.subProjects) count += sub.sessions.length;
    }
    return count;
  }

  function handleSessionClick(sessionId, title) {
    if ($activeSessionId) leaveSession();
    openPopup(sessionId, title || 'Session');
    if (window.innerWidth < 1024) sidebarOpen.set(false);
  }

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
</script>

<div class="projects-panel">
  {#if $boardLoading && !$boardData}
    <div class="board-status">Loading areas...</div>
  {:else if $boardError}
    <div class="board-status error">{$boardError}</div>
    <button class="board-retry" onclick={fetchBoard}>Retry</button>
  {:else if $boardData}
    <div class="board-toolbar">
      <button class="board-refresh" onclick={fetchBoard} title="Refresh">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
    </div>

    <div class="area-list">
      {#each $boardData.areas as area (area.name)}
        {@const expanded = $expandedAreas.has(area.name)}
        {@const sessionCount = areaSessionCount(area)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="area-header" onclick={() => toggleArea(area.name)}>
          <svg class="area-chevron" class:expanded width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="area-name">{formatAreaName(area.name)}</span>
          {#if area.projects.length > 0}
            <span class="area-badge">{area.projects.length}</span>
          {/if}
          {#if sessionCount > 0}
            <span class="area-session-count">{sessionCount}</span>
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="drilldown-btn" onclick={(e) => { e.stopPropagation(); navigateToArea(area.name); }} title="Open area view">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>

        {#if expanded}
          {#if area.presentState}
            <div class="area-state">
              <span class="state-label">Now:</span> {area.presentState}
            </div>
          {/if}
          {#if area.desiredState}
            <div class="area-state desired">
              <span class="state-label">Goal:</span> {area.desiredState}
            </div>
          {/if}

          {#each area.projects as project (project.path)}
            {@const projExpanded = $expandedProjects.has(project.path)}
            {@const hasSessions = project.sessions.length > 0}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="project-item" onclick={() => toggleProject(project.path)}>
              <svg class="project-chevron" class:expanded={projExpanded} class:hidden={!hasSessions && project.subProjects.length === 0} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              <svg class="project-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#if project.isDir}
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                {:else}
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                {/if}
              </svg>
              <span class="project-name">{project.name}</span>
              {#if hasSessions}
                <span class="project-session-count">{project.sessions.length}</span>
              {/if}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="drilldown-btn small" onclick={(e) => { e.stopPropagation(); navigateToProject(project.path, area.name); }} title="Open project view">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
            </div>

            {#if projExpanded && (hasSessions || project.subProjects.length > 0)}
              {#each project.subProjects as sub (sub.path)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="sub-project-item" onclick={(e) => { e.stopPropagation(); navigateToProject(sub.path, area.name); }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span class="sub-name">{sub.name}</span>
                  {#if sub.sessions.length > 0}
                    <span class="project-session-count">{sub.sessions.length}</span>
                  {/if}
                </div>
              {/each}
              {#each project.sessions as session (session.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="project-session" onclick={(e) => { e.stopPropagation(); handleSessionClick(session.id, session.title); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span class="project-session-title">{session.title || 'Untitled'}</span>
                  {#if session.isProcessing}
                    <span class="session-active-dot"></span>
                  {/if}
                </div>
              {/each}
            {/if}
          {/each}

          {#if area.projects.length === 0}
            <div class="area-empty">No projects</div>
          {/if}
        {/if}
      {/each}

      {#if $boardData.looseSessions?.length > 0}
        {@const looseExpanded = $expandedAreas.has('__loose')}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="area-header loose" onclick={() => toggleArea('__loose')}>
          <svg class="area-chevron" class:expanded={looseExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="area-name">Untagged Sessions</span>
          <span class="area-session-count">{$boardData.looseSessions.length}</span>
        </div>
        {#if looseExpanded}
          {#each $boardData.looseSessions as session (session.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="project-session loose" onclick={() => handleSessionClick(session.id, session.title)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="project-session-title">{session.title || 'Untitled'}</span>
              {#if session.isProcessing}
                <span class="session-active-dot"></span>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    {#if $boardData.areas.length === 0}
      <div class="board-status">No gtd/ areas found</div>
    {/if}
  {/if}
</div>

<style>
  .projects-panel {
    padding: 4px 0;
  }

  .board-status {
    padding: 24px 16px;
    text-align: center;
    font-size: 13px;
    color: #6b6760;
    font-style: italic;
  }

  .board-status.error {
    color: #e5534b;
  }

  .board-retry {
    display: block;
    margin: 0 auto;
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid rgba(218, 119, 86, 0.3);
    background: rgba(218, 119, 86, 0.08);
    color: #da7756;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .board-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 12px 2px;
  }

  .board-refresh {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: #6b6760;
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
    transition: all 0.15s;
  }

  .board-refresh:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #b0ab9f;
  }

  .area-list {
    padding: 0 8px;
  }

  /* Area header */
  .area-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px;
    margin-top: 2px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s;
    user-select: none;
  }

  .area-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .area-header.loose {
    margin-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 10px;
    border-radius: 0 0 8px 8px;
  }

  .area-chevron {
    color: #6b6760;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .area-chevron.expanded {
    transform: rotate(90deg);
  }

  .area-name {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: #d4d0c8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .area-badge {
    font-size: 10px;
    color: #908b81;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .area-session-count {
    font-size: 10px;
    color: #da7756;
    background: rgba(218, 119, 86, 0.1);
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  /* Area state (TOTE present/desired) */
  .area-state {
    padding: 3px 12px 3px 30px;
    font-size: 11px;
    color: #908b81;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .area-state .state-label {
    font-weight: 600;
    color: #6b6760;
  }

  .area-state.desired .state-label {
    color: #57ab5a;
  }

  /* Project item */
  .project-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px 5px 22px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s;
    user-select: none;
  }

  .project-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .project-chevron {
    color: #5a5650;
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .project-chevron.expanded {
    transform: rotate(90deg);
  }

  .project-chevron.hidden {
    visibility: hidden;
  }

  .project-icon {
    color: #6b6760;
    flex-shrink: 0;
  }

  .project-name {
    flex: 1;
    font-size: 12px;
    color: #b0ab9f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-session-count {
    font-size: 10px;
    color: #5b9fd6;
    background: rgba(91, 159, 214, 0.1);
    padding: 1px 5px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  /* Sub-projects */
  .sub-project-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px 4px 46px;
    font-size: 11px;
    color: #908b81;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    user-select: none;
  }

  .sub-project-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #b0ab9f;
  }

  .sub-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Sessions under projects */
  .project-session {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 46px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, transform 0.12s;
    user-select: none;
  }

  .project-session.loose {
    padding-left: 30px;
  }

  .project-session:hover {
    background: #353430;
    transform: translateX(2px);
  }

  .project-session svg {
    color: #6b6760;
    flex-shrink: 0;
  }

  .project-session-title {
    flex: 1;
    font-size: 12px;
    color: #b0ab9f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-session:hover .project-session-title {
    color: #d4d0c8;
  }

  .session-active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .drilldown-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: #5a5650;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }

  .area-header:hover .drilldown-btn,
  .project-item:hover .drilldown-btn {
    opacity: 1;
  }

  .drilldown-btn:hover {
    background: rgba(218, 119, 86, 0.15);
    color: #da7756;
  }

  .area-empty {
    padding: 8px 30px;
    font-size: 12px;
    color: #5a5650;
    font-style: italic;
  }
</style>
