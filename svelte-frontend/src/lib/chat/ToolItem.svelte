<script>
  import DiffView from './DiffView.svelte';
  import CodeView from './CodeView.svelte';

  let { name = '', status = 'running', input = null, output = null, subtitle = '', subTools = null, compact = false } = $props();

  let expanded = $state(false);

  const hiddenTools = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop']);
  let isHidden = $derived(hiddenTools.has(name));

  // Display name: both "Task" and "Agent" are subagent spawners
  let displayName = $derived(name === 'Task' || name === 'Agent' ? 'Agent' : name);

  // Rich rendering: Edit diffs auto-expand
  let hasEditDiff = $derived(
    name === 'Edit' && input && input.old_string && input.new_string && status !== 'running'
  );
  let hasReadOutput = $derived(
    name === 'Read' && output && typeof output === 'string' && input?.file_path && status !== 'running'
  );

  // Auto-expand Edit tools when diff is available
  $effect(() => {
    if (hasEditDiff && !expanded) {
      expanded = true;
    }
  });

  function formatInput(inp) {
    if (!inp) return '';
    if (typeof inp === 'string') return inp;
    // For Edit tools, don't dump old_string/new_string in raw JSON — the diff view handles it
    if (name === 'Edit' && inp.file_path) {
      return inp.file_path + (inp.replace_all ? ' (replace all)' : '');
    }
    try { return JSON.stringify(inp, null, 2); } catch { return String(inp); }
  }

  function cleanOutput(out) {
    if (!out || typeof out !== 'string') return out;
    return out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  }
</script>

{#if !isHidden}
  {#if compact}
    <!-- Compact: clickable tool indicator with expandable rich content -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cp-tool cp-tool-{status}" onclick={() => expanded = !expanded}>
      <div class="cp-tool-indicator">
        {#if status === 'running'}
          <div class="cp-tool-spinner"></div>
        {:else if status === 'error'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {/if}
      </div>
      <span class="cp-tool-name">{displayName}</span>
      {#if subtitle}
        <span class="cp-tool-subtitle">{subtitle}</span>
      {/if}
      {#if status !== 'running' && (hasEditDiff || hasReadOutput || output)}
        <span class="cp-tool-chevron">{expanded ? '▾' : '▸'}</span>
      {/if}
    </div>
    {#if expanded && status !== 'running'}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="cp-tool-details" onclick={e => e.stopPropagation()}>
        {#if hasEditDiff}
          <DiffView oldStr={input.old_string} newStr={input.new_string} filePath={input.file_path} />
        {:else if hasReadOutput}
          <CodeView content={cleanOutput(output)} filePath={input.file_path} />
        {:else if output}
          <pre class="cp-tool-output">{typeof output === 'string' ? cleanOutput(output) : JSON.stringify(output, null, 2)}</pre>
        {/if}
      </div>
    {/if}
    {#if subTools && subTools.length > 0}
      <div class="cp-subtools">
        {#each subTools.slice(-5) as st}
          <div class="cp-subtool-entry">
            <span class="cp-subtool-dot"></span>
            <span class="cp-subtool-name">{st.name}</span>
            {#if st.subtitle}
              <span class="cp-subtool-text">{st.subtitle}</span>
            {/if}
          </div>
        {/each}
        {#if subTools.length > 5}
          <div class="cp-subtool-more">+{subTools.length - 5} more</div>
        {/if}
      </div>
    {/if}
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
        <span class="tool-name">{displayName}</span>
        {#if subtitle}
          <span class="tool-subtitle">{subtitle}</span>
        {/if}
        {#if status === 'running'}
          <span class="tool-running">running</span>
        {/if}
        <span class="tool-expand">{expanded ? '▾' : '▸'}</span>
      </div>

      {#if subTools && subTools.length > 0}
        <div class="subagent-log">
          {#each subTools as st, idx}
            <div class="subagent-entry">
              <span class="subagent-bullet"></span>
              <span class="subagent-tool-name">{st.name}</span>
              {#if st.subtitle}
                <span class="subagent-subtitle">{st.subtitle}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if expanded}
        <div class="tool-details" onclick={e => e.stopPropagation()}>
          {#if hasEditDiff}
            <DiffView oldStr={input.old_string} newStr={input.new_string} filePath={input.file_path} />
          {:else if hasReadOutput}
            <CodeView content={cleanOutput(output)} filePath={input.file_path} />
          {:else}
            {#if input}
              <div class="tool-section">
                <div class="tool-section-label">Input</div>
                <pre class="tool-pre">{formatInput(input)}</pre>
              </div>
            {/if}
            {#if output}
              <div class="tool-section">
                <div class="tool-section-label">Output</div>
                <pre class="tool-pre">{typeof output === 'string' ? cleanOutput(output) : JSON.stringify(output, null, 2)}</pre>
              </div>
            {/if}
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
    flex-shrink: 0;
  }

  .tool-subtitle {
    color: #908b81;
    font-size: 12px;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .tool-running {
    font-size: 11px;
    color: #c5a13e;
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  .tool-expand {
    margin-left: auto;
    color: #6d6860;
    font-size: 11px;
    flex-shrink: 0;
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

  /* ─── Subagent log ─── */
  .subagent-log {
    margin: 0 12px 6px 34px;
    border-left: 2px solid #3e3c37;
    padding-left: 10px;
    max-height: 80px;
    overflow-y: auto;
  }

  .subagent-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 11px;
  }

  .subagent-bullet {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #6d6860;
    flex-shrink: 0;
  }

  .subagent-tool-name {
    color: #908b81;
    font-weight: 600;
    font-size: 11px;
    flex-shrink: 0;
  }

  .subagent-subtitle {
    color: #6d6860;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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

  .cp-tool { cursor: pointer; }
  .cp-tool:hover { background: rgba(255, 255, 255, 0.03); }
  .cp-tool-name { font-weight: 500; flex-shrink: 0; }
  .cp-tool-subtitle {
    color: #4a4843;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .cp-tool-chevron {
    color: #4a4843;
    font-size: 9px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .cp-tool-running { color: #da7756; }
  .cp-tool-done { color: #4a4843; }
  .cp-tool-done .cp-tool-indicator { color: #57AB5A; }
  .cp-tool-error { color: #E5534B; }

  .cp-tool-details {
    margin: 2px 10px 4px 10px;
  }

  .cp-tool-output {
    font-size: 10px;
    color: #908b81;
    background: #1a1918;
    padding: 6px 8px;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
    border: 1px solid #3e3c37;
  }

  /* ─── Compact subtools ─── */
  .cp-subtools {
    margin: 1px 0 2px 24px;
    border-left: 1.5px solid #3e3c37;
    padding-left: 8px;
    max-height: 70px;
    overflow-y: auto;
  }

  .cp-subtool-entry {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 1px 0;
    font-size: 10px;
  }

  .cp-subtool-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #5a5650;
    flex-shrink: 0;
  }

  .cp-subtool-name {
    color: #6d6860;
    font-weight: 600;
    flex-shrink: 0;
  }

  .cp-subtool-text {
    color: #4a4843;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .cp-subtool-more {
    font-size: 9px;
    color: #4a4843;
    padding: 1px 0;
  }

  /* ─── Shared animations ─── */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
