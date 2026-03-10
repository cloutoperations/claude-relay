<script>
  let { text = '', isError = false, compact = false } = $props();
</script>

<div class="sys-msg" class:error={isError} class:compact>
  <span class="sys-text">{text}</span>
</div>

<style>
  .sys-msg {
    padding: 6px 12px;
    font-size: 12px;
    color: #908b81;
    text-align: center;
  }

  .sys-msg.compact {
    font-size: 11px;
    color: #5a5650;
    font-style: italic;
    padding: 6px 10px;
  }

  .sys-msg.error {
    color: #e5534b;
  }

  .sys-text {
    background: rgba(255, 255, 255, 0.03);
    padding: 4px 12px;
    border-radius: 12px;
  }

  .compact .sys-text {
    background: none;
    padding: 0;
    border-radius: 0;
  }
</style>
