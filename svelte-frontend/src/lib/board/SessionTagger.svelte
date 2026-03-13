<script>
  import { onMount } from 'svelte';
  import { boardData, fetchBoard, tagSession } from '../../stores/board.svelte.js';

  let {
    sessionId = '',
    x = 0,
    y = 0,
    onClose = () => {},
  } = $props();

  let menuEl = $state(null);

  onMount(() => {
    if (!boardData.value) fetchBoard();

    function handleClickOutside(e) {
      if (menuEl && !menuEl.contains(e.target)) {
        onClose();
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') onClose();
    }
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }, 10);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  });

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  async function handleTag(projectPath) {
    await tagSession(sessionId, projectPath);
    onClose();
  }

  async function handleUntag() {
    await tagSession(sessionId, null);
    onClose();
  }

  // Position: clamp to viewport
  let style = $derived.by(() => {
    const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - 300 : y;
    return `left: ${Math.min(x, maxX)}px; top: ${Math.min(y, maxY)}px`;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tagger-menu" bind:this={menuEl} style={style}>
  <div class="tagger-header">Tag to project</div>

  {#if boardData.value}
    <div class="tagger-list">
      {#each boardData.value.areas as area (area.name)}
        <button class="tagger-option area-btn" onclick={() => handleTag(area.name)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          {formatAreaName(area.name)}
        </button>
        {#each area.projects as project (project.path)}
          <button class="tagger-option" onclick={() => handleTag(project.path)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              {#if project.isDir}
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              {:else}
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              {/if}
            </svg>
            {project.name}
            {#if project.sessions.some(s => s.id === sessionId)}
              <svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            {/if}
          </button>
          {#each project.subProjects as sub, si (sub.path || si)}
            {#if sub.path}
              <button class="tagger-option sub" onclick={() => handleTag(sub.path)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {sub.name || sub}
                {#if sub.sessions?.some(s => s.id === sessionId)}
                  <svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#57ab5a" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                {/if}
              </button>
            {/if}
          {/each}
        {/each}
      {/each}
    </div>
    <div class="tagger-divider"></div>
    <button class="tagger-option untag" onclick={handleUntag}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      Remove tag
    </button>
  {:else}
    <div class="tagger-loading">Loading...</div>
  {/if}
</div>

<style>
  .tagger-menu {
    position: fixed;
    z-index: 200;
    width: 210px;
    max-height: 320px;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(var(--shadow-rgb), 0.5);
    overflow-y: auto;
    padding: 4px 0;
  }

  .tagger-header {
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tagger-list {
    max-height: 240px;
    overflow-y: auto;
  }

  .tagger-area {
    padding: 6px 12px 2px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .tagger-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px 6px 20px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .tagger-option:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .tagger-option svg {
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .tagger-option .check {
    margin-left: auto;
  }

  .tagger-option.area-btn {
    padding-left: 12px;
    font-weight: 600;
    color: var(--text);
    font-size: 12px;
    margin-top: 4px;
  }

  .tagger-option.area-btn svg {
    color: var(--text-muted);
  }

  .tagger-option.sub {
    padding-left: 32px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .tagger-option.untag {
    padding-left: 12px;
    color: var(--text-muted);
  }

  .tagger-option.untag:hover {
    color: var(--error);
  }

  .tagger-divider {
    height: 1px;
    background: rgba(var(--overlay-rgb), 0.06);
    margin: 4px 0;
  }

  .tagger-loading {
    padding: 12px;
    font-size: 12px;
    color: var(--text-dimmer);
    text-align: center;
  }
</style>
