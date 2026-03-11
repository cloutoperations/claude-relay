<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard, navigateToArea, navigateToProject } from '../../stores/board.js';
  import { sessions } from '../../stores/sessions.js';
  import { projectInfo } from '../../stores/chat.js';

  onMount(() => {
    if (!$boardData) fetchBoard();
  });

  function areaSessionCount(area) {
    let count = 0;
    for (const p of area.projects) {
      count += p.sessions.length;
      for (const sub of p.subProjects) {
        if (sub.sessions) count += sub.sessions.length;
      }
    }
    return count;
  }

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function activeProjectCount(area) {
    return area.projects.filter(p => p.sessions.length > 0).length;
  }
</script>

<div class="workbench">
  <div class="workbench-header">
    <h1 class="workbench-title">{$projectInfo.name || 'Claude Relay'}</h1>
    <div class="workbench-stats">
      <span class="wb-stat">{$sessions.length} sessions</span>
      {#if $boardData}
        <span class="wb-stat">{$boardData.areas.length} areas</span>
      {/if}
      {#if $projectInfo.version}
        <span class="wb-stat">v{$projectInfo.version}</span>
      {/if}
    </div>
  </div>

  {#if $boardLoading && !$boardData}
    <div class="workbench-loading">Loading workspace...</div>
  {:else if $boardData}
    <div class="area-grid">
      {#each $boardData.areas as area (area.name)}
        {@const sessionCount = areaSessionCount(area)}
        {@const activeProjects = activeProjectCount(area)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="area-card" onclick={() => navigateToArea(area.name)}>
          <div class="area-card-header">
            <span class="area-card-name">{formatAreaName(area.name)}</span>
            <div class="area-card-badges">
              {#if area.projects.length > 0}
                <span class="card-badge projects">{area.projects.length} proj</span>
              {/if}
              {#if sessionCount > 0}
                <span class="card-badge sessions">{sessionCount}</span>
              {/if}
            </div>
          </div>

          {#if area.presentState}
            <div class="area-card-state">
              <span class="state-dot now"></span>
              <span class="state-text">{area.presentState}</span>
            </div>
          {/if}
          {#if area.desiredState}
            <div class="area-card-state">
              <span class="state-dot goal"></span>
              <span class="state-text">{area.desiredState}</span>
            </div>
          {/if}

          {#if area.projects.length > 0}
            <div class="area-card-projects">
              {#each area.projects.slice(0, 4) as project}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="mini-project"
                  class:has-sessions={project.sessions.length > 0}
                  onclick={(e) => { e.stopPropagation(); navigateToProject(project.path, area.name); }}
                >
                  {project.name}
                  {#if project.sessions.length > 0}
                    <span class="mini-count">{project.sessions.length}</span>
                  {/if}
                </span>
              {/each}
              {#if area.projects.length > 4}
                <span class="mini-more">+{area.projects.length - 4} more</span>
              {/if}
            </div>
          {/if}

          <div class="area-card-footer">
            {#if area.hasOperations}
              <span class="card-flag">ops</span>
            {/if}
            {#if area.hasInbox}
              <span class="card-flag">inbox</span>
            {/if}
            {#if activeProjects > 0}
              <span class="card-flag active">{activeProjects} active</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if $boardData.looseSessions?.length > 0}
      <div class="loose-section">
        <span class="loose-label">{$boardData.looseSessions.length} untagged sessions</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .workbench {
    flex: 1;
    overflow-y: auto;
    padding: 32px 40px;
  }

  .workbench-header {
    text-align: center;
    margin-bottom: 32px;
  }

  .workbench-title {
    font-size: 24px;
    font-weight: 600;
    color: #d4d0c8;
    margin-bottom: 8px;
  }

  .workbench-stats {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .wb-stat {
    font-size: 12px;
    color: #6d6860;
    background: #2a2924;
    padding: 4px 12px;
    border-radius: 16px;
  }

  .workbench-loading {
    text-align: center;
    padding: 40px;
    font-size: 14px;
    color: #6b6760;
  }

  .area-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .area-card {
    background: #242320;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s, background 0.15s;
  }

  .area-card:hover {
    border-color: rgba(218, 119, 86, 0.25);
    background: #282724;
    transform: translateY(-1px);
  }

  .area-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .area-card-name {
    font-size: 15px;
    font-weight: 600;
    color: #d4d0c8;
  }

  .area-card-badges {
    display: flex;
    gap: 6px;
  }

  .card-badge {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 8px;
    font-weight: 500;
  }

  .card-badge.projects {
    color: #908b81;
    background: rgba(255, 255, 255, 0.06);
  }

  .card-badge.sessions {
    color: #da7756;
    background: rgba(218, 119, 86, 0.12);
  }

  .area-card-state {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
  }

  .state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .state-dot.now {
    background: #6b6760;
  }

  .state-dot.goal {
    background: #57ab5a;
  }

  .state-text {
    font-size: 11px;
    color: #908b81;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .area-card-projects {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .mini-project {
    font-size: 11px;
    color: #908b81;
    background: rgba(255, 255, 255, 0.04);
    padding: 2px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .mini-project:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #d4d0c8;
  }

  .mini-project.has-sessions {
    color: #b0ab9f;
  }

  .mini-count {
    font-size: 9px;
    color: #5b9fd6;
    margin-left: 3px;
  }

  .mini-more {
    font-size: 11px;
    color: #6b6760;
    padding: 2px 6px;
  }

  .area-card-footer {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }

  .card-flag {
    font-size: 9px;
    color: #6b6760;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-weight: 600;
  }

  .card-flag.active {
    color: #5b9fd6;
  }

  .loose-section {
    text-align: center;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .loose-label {
    font-size: 12px;
    color: #6b6760;
  }

  @media (max-width: 640px) {
    .workbench {
      padding: 20px 16px;
    }

    .area-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
