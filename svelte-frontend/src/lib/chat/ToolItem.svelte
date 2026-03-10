<script>
  let { name = '', status = 'running', input = null, output = null, compact = false } = $props();

  let expanded = $state(false);

  const hiddenTools = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
  let isHidden = $derived(hiddenTools.has(name));

  function formatInput(inp) {
    if (!inp) return '';
    if (typeof inp === 'string') return inp;
    try { return JSON.stringify(inp, null, 2); } catch { return String(inp); }
  }
</script>

{#if !isHidden}
  {#if compact}
    <!-- Compact: single-line tool indicator -->
    <div class="cp-tool cp-tool-{status}">
      <div class="cp-tool-indicator">
        {#if status === 'running'}
          <div class="cp-tool-spinner"></div>
        {:else if status === 'error'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {/if}
      </div>
      <span class="cp-tool-name">{name}</span>
    </div>
  {:else}
    <!-- Full: expandable tool card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tool-item" class:expanded onclick={() => expanded = !expanded}>
      <div class="tool-header">
        <span class="tool-status" class:running={status === 'running'} class:error={status === 'error'} class:done={status === 'done'}>
          {#if status === 'running'}
            <div class="tool-spinner"></div>
          {:else if status === 'error'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {/if}
        </span>
        <span class="tool-name">{name}</span>
        {#if status === 'running'}
          <span class="tool-running">running</span>
        {/if}
        <span class="tool-expand">{expanded ? '▾' : '▸'}</span>
      </div>

      {#if expanded}
        <div class="tool-details">
          {#if input}
            <div class="tool-section">
              <div class="tool-section-label">Input</div>
              <pre class="tool-pre">{formatInput(input)}</pre>
            </div>
          {/if}
          {#if output}
            <div class="tool-section">
              <div class="tool-section-label">Output</div>
              <pre class="tool-pre">{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* ─── Full mode ─── */
  .tool-item {
    margin: 4px 0;
    background: #2a2924;
    border: 1px solid #3e3c37;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 13px;
  }

  .tool-status {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tool-status.running { color: #c5a13e; }
  .tool-status.error { color: #e5534b; }
  .tool-status.done { color: #5cb85c; }

  .tool-spinner {
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(197, 161, 62, 0.25);
    border-top-color: #c5a13e;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .tool-name {
    color: #d4d0c8;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
  }

  .tool-running {
    font-size: 11px;
    color: #c5a13e;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .tool-expand {
    margin-left: auto;
    color: #6d6860;
    font-size: 11px;
  }

  .tool-details {
    border-top: 1px solid #3e3c37;
    padding: 8px 12px;
  }

  .tool-section { margin: 4px 0; }

  .tool-section-label {
    font-size: 10px;
    color: #6d6860;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .tool-pre {
    font-size: 11px;
    color: #908b81;
    background: #1a1918;
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* ─── Compact mode ─── */
  .cp-tool {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px;
    margin: 1px 0;
    font-size: 11px;
    color: #5a5650;
    border-radius: 6px;
  }

  .cp-tool-indicator {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cp-tool-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .cp-tool-name { font-weight: 500; }
  .cp-tool-running { color: #da7756; }
  .cp-tool-done { color: #4a4843; }
  .cp-tool-done .cp-tool-indicator { color: #57AB5A; }
  .cp-tool-error { color: #E5534B; }

  /* ─── Shared animations ─── */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
