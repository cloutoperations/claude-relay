<script>
  let { text = '' } = $props();
  let expanded = $state(false);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thinking" onclick={() => { if (text) expanded = !expanded; }}>
  <div class="thinking-header">
    <span class="thinking-dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </span>
    <span class="thinking-label">Thinking{text ? ' (click to expand)' : '...'}</span>
  </div>
  {#if expanded && text}
    <pre class="thinking-text">{text}</pre>
  {/if}
</div>

<style>
  .thinking {
    margin: 8px 0;
    padding: 8px 12px;
    cursor: pointer;
  }

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .thinking-dots {
    display: flex;
    gap: 3px;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #908b81;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-4px); }
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
  }
</style>
