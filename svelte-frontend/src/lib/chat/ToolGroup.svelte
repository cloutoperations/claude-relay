<script>
  import ToolItem from './ToolItem.svelte';

  let { tools = [], compact = false } = $props();

  let expanded = $state(false);

  let allDone = $derived(tools.every(t => t.status === 'done' || t.status === 'error'));
  let hasError = $derived(tools.some(t => t.status === 'error'));
  let anyRunning = $derived(tools.some(t => t.status === 'running'));

  let summary = $derived.by(() => {
    const count = tools.length;
    // Count by tool name
    const counts = {};
    for (const t of tools) {
      counts[t.name] = (counts[t.name] || 0) + 1;
    }
    const uniqueNames = Object.keys(counts);

    if (uniqueNames.length === 1) {
      const name = uniqueNames[0];
      const n = counts[name];
      if (allDone) {
        switch (name) {
          case 'Read': return 'Read ' + n + ' file' + (n > 1 ? 's' : '');
          case 'Edit': return 'Edited ' + n + ' file' + (n > 1 ? 's' : '');
          case 'Write': return 'Wrote ' + n + ' file' + (n > 1 ? 's' : '');
          case 'Bash': return 'Ran ' + n + ' command' + (n > 1 ? 's' : '');
          case 'Grep': return 'Searched ' + n + ' pattern' + (n > 1 ? 's' : '');
          case 'Glob': return 'Found ' + n + ' pattern' + (n > 1 ? 's' : '');
          case 'Agent': return 'Ran ' + n + ' agent' + (n > 1 ? 's' : '');
          case 'Task': return 'Ran ' + n + ' agent' + (n > 1 ? 's' : '');
          case 'WebSearch': return 'Searched ' + n + ' quer' + (n > 1 ? 'ies' : 'y');
          case 'WebFetch': return 'Fetched ' + n + ' URL' + (n > 1 ? 's' : '');
          default: return 'Ran ' + n + ' tool' + (n > 1 ? 's' : '');
        }
      }
      switch (name) {
        case 'Read': return 'Reading ' + n + ' file' + (n > 1 ? 's' : '') + '...';
        case 'Edit': return 'Editing ' + n + ' file' + (n > 1 ? 's' : '') + '...';
        case 'Write': return 'Writing ' + n + ' file' + (n > 1 ? 's' : '') + '...';
        case 'Bash': return 'Running ' + n + ' command' + (n > 1 ? 's' : '') + '...';
        case 'Grep': return 'Searching ' + n + ' pattern' + (n > 1 ? 's' : '') + '...';
        case 'Glob': return 'Finding ' + n + ' pattern' + (n > 1 ? 's' : '') + '...';
        case 'Agent': return 'Running ' + n + ' agent' + (n > 1 ? 's' : '') + '...';
        case 'Task': return 'Running ' + n + ' agent' + (n > 1 ? 's' : '') + '...';
        case 'WebSearch': return 'Searching ' + n + ' quer' + (n > 1 ? 'ies' : 'y') + '...';
        case 'WebFetch': return 'Fetching ' + n + ' URL' + (n > 1 ? 's' : '') + '...';
        default: return 'Running ' + n + ' tool' + (n > 1 ? 's' : '') + '...';
      }
    }

    // Mixed tools
    if (allDone) return 'Ran ' + count + ' tools';
    return 'Running ' + count + ' tools...';
  });
</script>

{#if tools.length === 1}
  <ToolItem
    name={tools[0].name}
    status={tools[0].status}
    input={tools[0].input}
    output={tools[0].output}
    subtitle={tools[0].subtitle}
    subTools={tools[0].subTools}
    {compact}
  />
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#if compact}
    <div class="cp-tool-group" class:done={allDone} onclick={() => expanded = !expanded}>
      <div class="cp-group-header">
        <div class="cp-group-indicator">
          {#if anyRunning}
            <div class="cp-group-spinner"></div>
          {:else if hasError}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {:else}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {/if}
        </div>
        <span class="cp-group-label">{summary}</span>
        <span class="cp-group-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {#if expanded}
        <div class="cp-group-items">
          {#each tools as tool (tool.toolId)}
            <ToolItem name={tool.name} status={tool.status} input={tool.input} output={tool.output} subtitle={tool.subtitle} subTools={tool.subTools} compact={true} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="tool-group" class:done={allDone}>
      <div class="tool-group-header" onclick={() => expanded = !expanded}>
        <span class="tool-group-chevron">{expanded ? '▾' : '▸'}</span>
        <span class="tool-group-bullet" class:running={anyRunning} class:error={hasError}></span>
        <span class="tool-group-label">{summary}</span>
        <span class="tool-group-status">
          {#if anyRunning}
            <div class="tool-group-spinner"></div>
          {:else if hasError}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e5534b" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5cb85c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {/if}
        </span>
      </div>
      {#if expanded}
        <div class="tool-group-items">
          {#each tools as tool (tool.toolId)}
            <ToolItem name={tool.name} status={tool.status} input={tool.input} output={tool.output} subtitle={tool.subtitle} subTools={tool.subTools} {compact} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* ─── Full mode ─── */
  .tool-group {
    margin: 4px 0;
    background: #2a2924;
    border: 1px solid #3e3c37;
    border-radius: 8px;
  }

  .tool-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #d4d0c8;
  }

  .tool-group-header:hover {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
  }

  .tool-group-chevron {
    color: #6d6860;
    font-size: 11px;
    width: 12px;
    flex-shrink: 0;
  }

  .tool-group-bullet {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c5a13e;
    flex-shrink: 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .tool-group-bullet.running {
    background: #c5a13e;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .tool-group-bullet.error {
    background: #e5534b;
    animation: none;
  }

  .tool-group.done .tool-group-bullet {
    background: #5cb85c;
    animation: none;
  }

  .tool-group-label {
    flex: 1;
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .tool-group.done .tool-group-label {
    color: #908b81;
  }

  .tool-group-status {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tool-group-spinner {
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(197, 161, 62, 0.25);
    border-top-color: #c5a13e;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .tool-group-items {
    border-top: 1px solid #3e3c37;
    padding: 4px 8px;
  }

  /* ─── Compact mode ─── */
  .cp-tool-group {
    margin: 2px 0;
  }

  .cp-group-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px;
    font-size: 11px;
    color: #5a5650;
    cursor: pointer;
    border-radius: 6px;
  }

  .cp-group-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .cp-group-indicator {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cp-tool-group.done .cp-group-indicator { color: #57AB5A; }
  .cp-tool-group:not(.done) .cp-group-indicator { color: #c5a13e; }

  .cp-group-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .cp-group-label {
    font-weight: 500;
    flex: 1;
  }

  .cp-tool-group.done .cp-group-label { color: #4a4843; }

  .cp-group-chevron {
    color: #6d6860;
    font-size: 10px;
  }

  .cp-group-items {
    padding-left: 20px;
  }

  /* ─── Shared ─── */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
