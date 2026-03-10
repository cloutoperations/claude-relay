<script>
  let { name = '', status = 'running', input = null, output = null } = $props();

  let expanded = $state(false);

  // Hide certain internal tools
  const hiddenTools = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
  const isHidden = hiddenTools.has(name);

  function getStatusIcon() {
    if (status === 'running') return '⟳';
    if (status === 'error') return '✕';
    return '✓';
  }

  function getStatusColor() {
    if (status === 'running') return '#c5a13e';
    if (status === 'error') return '#e5534b';
    return '#5cb85c';
  }

  function formatInput(inp) {
    if (!inp) return '';
    if (typeof inp === 'string') return inp;
    try {
      return JSON.stringify(inp, null, 2);
    } catch { return String(inp); }
  }
</script>

{#if !isHidden}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tool-item" class:expanded onclick={() => expanded = !expanded}>
  <div class="tool-header">
    <span class="tool-status" style="color: {getStatusColor()}">{getStatusIcon()}</span>
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

<style>
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
    font-size: 14px;
    flex-shrink: 0;
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

  .tool-section {
    margin: 4px 0;
  }

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

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
