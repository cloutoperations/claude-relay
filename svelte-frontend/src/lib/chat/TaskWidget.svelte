<script>
  import { tasks as globalTasks } from '../../stores/chat.js';

  let { compact = false, items = null } = $props();

  // Use provided items (popup) or fall back to global store (main chat)
  let taskList = $state([]);
  if (items == null) {
    globalTasks.subscribe(v => { taskList = v; });
  }
  // Reactive update when items prop changes
  $effect(() => {
    if (items != null) taskList = items;
  });

  let stats = $derived.by(() => {
    let completed = 0;
    let inProgress = null;
    for (const t of taskList) {
      if (t.status === 'completed') completed++;
      if (!inProgress && t.status === 'in_progress') inProgress = t;
    }
    return {
      completed,
      total: taskList.length,
      pct: taskList.length > 0 ? Math.round(completed / taskList.length * 100) : 0,
      inProgress,
    };
  });

  let sorted = $derived.by(() => {
    const order = { in_progress: 0, pending: 1, completed: 2 };
    return [...taskList].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  });

  let expanded = $state(true);
</script>

{#if taskList.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="task-widget" class:compact onclick={() => expanded = !expanded}>
    <div class="task-header">
      <span class="task-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      </span>
      <span class="task-title">Tasks</span>
      <span class="task-count">{stats.completed}/{stats.total}</span>
      <span class="task-chevron">{expanded ? '▾' : '▸'}</span>
    </div>

    <div class="task-progress">
      <div class="task-progress-bar" class:active={stats.inProgress} style="width: {stats.pct}%"></div>
    </div>

    {#if expanded}
      <div class="task-items">
        {#each sorted as task (task.id)}
          <div class="task-item {task.status}">
            <span class="task-item-icon">
              {#if task.status === 'completed'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {:else if task.status === 'in_progress'}
                <div class="task-spinner"></div>
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>
              {/if}
            </span>
            <span class="task-item-text">
              {task.status === 'in_progress' && task.activeForm ? task.activeForm : task.content}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .task-widget {
    margin: 6px 0;
    background: #2a2924;
    border: 1px solid #3e3c37;
    border-radius: 10px;
    cursor: pointer;
    overflow: hidden;
  }

  .task-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    font-size: 13px;
    color: #d4d0c8;
  }

  .task-icon {
    display: flex;
    color: #5cb85c;
    flex-shrink: 0;
  }

  .task-title {
    font-weight: 600;
    font-size: 13px;
  }

  .task-count {
    margin-left: auto;
    font-size: 12px;
    color: #908b81;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .task-chevron {
    color: #6d6860;
    font-size: 11px;
  }

  .task-progress {
    height: 2px;
    background: #1a1918;
  }

  .task-progress-bar {
    height: 100%;
    background: #5cb85c;
    transition: width 0.3s ease;
    border-radius: 1px;
  }

  .task-progress-bar.active {
    animation: progress-pulse 2s ease-in-out infinite;
  }

  .task-items {
    padding: 4px 0;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    font-size: 13px;
    color: #c8c3b8;
    border-top: 1px solid #2e2c27;
  }

  .task-item:first-child {
    border-top: none;
  }

  .task-item-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .task-item.pending .task-item-icon { color: #6d6860; }
  .task-item.in-progress .task-item-icon { color: #c5a13e; }
  .task-item.completed .task-item-icon { color: #5cb85c; }

  .task-item.completed .task-item-text {
    text-decoration: line-through;
    color: #6d6860;
  }

  .task-item.in-progress .task-item-text {
    color: #e8e5de;
  }

  .task-item-text {
    flex: 1;
    line-height: 1.4;
  }

  .task-spinner {
    width: 14px;
    height: 14px;
    border: 1.5px solid rgba(197, 161, 62, 0.25);
    border-top-color: #c5a13e;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  /* Compact mode */
  .task-widget.compact {
    margin: 4px 0;
    border-radius: 8px;
  }

  .task-widget.compact .task-header {
    padding: 7px 10px;
    font-size: 12px;
  }

  .task-widget.compact .task-item {
    padding: 5px 10px;
    font-size: 12px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes progress-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
