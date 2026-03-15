<script>
  let { text = '', isError = false, compact = false } = $props();
</script>

<div class="sys-msg" class:error={isError} class:compact>
  <span class="sys-text">{text}</span>
</div>

<style>
  .sys-msg {
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
  }

  .sys-msg.compact {
    font-size: 11px;
    color: var(--text-dimmer);
    font-style: italic;
    padding: 6px 10px;
  }

  .sys-msg.error {
    color: var(--error);
  }

  .sys-text {
    background: rgba(var(--overlay-rgb), 0.03);
    padding: 4px 12px;
    border-radius: 12px;
  }

  .compact .sys-text {
    background: none;
    padding: 0;
    border-radius: 0;
  }
</style>
