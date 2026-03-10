<script>
  let { text = '', compact = false } = $props();
  let expanded = $state(false);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thinking" class:compact onclick={() => { if (text && !compact) expanded = !expanded; }}>
  <div class="thinking-dots">
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
  </div>
  {#if !compact}
    <span class="thinking-label">Thinking{text ? ' (click to expand)' : '...'}</span>
  {/if}
  {#if expanded && text}
    <pre class="thinking-text">{text}</pre>
  {/if}
</div>

<style>
  .thinking {
    margin: 8px 0;
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .thinking.compact {
    padding: 4px 0;
    margin: 0;
    cursor: default;
  }

  .thinking-dots {
    display: flex;
    gap: 3px;
  }

  .compact .thinking-dots {
    gap: 4px;
    padding: 6px 12px;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #908b81;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .compact .dot {
    width: 6px;
    height: 6px;
    background: #5a5650;
    animation: cp-bounce 1.4s ease-in-out infinite;
  }

  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  .compact .dot:nth-child(2) { animation-delay: 0.16s; }
  .compact .dot:nth-child(3) { animation-delay: 0.32s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-4px); }
  }

  @keyframes cp-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

  .thinking-label {
    font-size: 12px;
    color: #6d6860;
  }

  .thinking-text {
    margin-top: 8px;
    font-size: 12px;
    color: #908b81;
    background: #1a1918;
    padding: 8px 12px;
    border-radius: 6px;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    width: 100%;
  }
</style>
