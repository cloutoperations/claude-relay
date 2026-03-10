<script>
  let { text = '', isError = false } = $props();
</script>

<div class="sys-msg" class:error={isError}>
  <span class="sys-text">{text}</span>
</div>

<style>
  .sys-msg {
    padding: 6px 12px;
    font-size: 12px;
    color: #908b81;
    text-align: center;
  }

  .sys-msg.error {
    color: #e5534b;
  }

  .sys-text {
    background: rgba(255, 255, 255, 0.03);
    padding: 4px 12px;
    border-radius: 12px;
  }
</style>
