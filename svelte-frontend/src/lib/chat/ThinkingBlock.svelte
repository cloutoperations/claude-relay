<script>
  let { text = '', duration = 0, compact = false } = $props();
  let durationStr = $derived(duration > 0 ? (duration / 1000).toFixed(1) + 's' : '');
  let expanded = $state(false);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thinking-block" class:compact class:expanded onclick={() => expanded = !expanded}>
  <div class="thinking-header">
    <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    <span class="thinking-label">Thinking{#if durationStr} <span class="thinking-duration">{durationStr}</span>{/if}</span>
    {#if !expanded}
      <span class="thinking-preview">{text.substring(0, 80)}{text.length > 80 ? '...' : ''}</span>
    {/if}
  </div>
  <div class="thinking-content-wrap" class:open={expanded}>
    <pre class="thinking-text">{text}</pre>
  </div>
</div>

<style>
  .thinking-block {
    margin: 4px 0;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: border-color 0.15s, background 0.15s;
  }

  .thinking-block:hover {
    border-color: rgba(var(--overlay-rgb), 0.06);
    background: rgba(var(--overlay-rgb), 0.02);
  }

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
  }

  .thinking-chevron {
    color: var(--text-dimmer);
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .expanded .thinking-chevron {
    transform: rotate(90deg);
  }

  .thinking-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .thinking-duration {
    font-weight: 400;
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .thinking-preview {
    font-size: 11px;
    color: var(--text-dimmer);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .thinking-content-wrap {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  .thinking-content-wrap.open {
    grid-template-rows: 1fr;
  }

  .thinking-text {
    min-height: 0;
    overflow: hidden;
    margin: 0 8px 8px;
    font-size: 12px;
    color: var(--text-muted);
    background: var(--bg-deeper);
    padding: 10px 12px;
    border-radius: 6px;
    max-height: 300px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  }

  .thinking-content-wrap.open .thinking-text {
    overflow-y: auto;
  }

  .thinking-text::-webkit-scrollbar { width: 5px; }
  .thinking-text::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .compact .thinking-header { padding: 4px 6px; }
  .compact .thinking-label { font-size: 11px; }
  .compact .thinking-preview { font-size: 10px; }
  .compact .thinking-text { font-size: 11px; max-height: 200px; padding: 8px 10px; }
</style>
