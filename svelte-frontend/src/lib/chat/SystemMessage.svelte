<script>
  let { text = '', isError = false, compact = false, authUrl = null } = $props();
  let copied = $state(false);

  function copyCommand() {
    navigator.clipboard.writeText('claude /login');
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
  }
</script>

<div class="sys-msg" class:error={isError} class:compact>
  <span class="sys-text">
    {#if authUrl}
      OAuth token expired.
      <button class="copy-btn" onclick={copyCommand}>
        {copied ? 'Copied!' : 'Copy: claude /login'}
      </button>
    {:else}
      {text}
    {/if}
  </span>
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

  .copy-btn {
    display: inline-block;
    margin-left: 8px;
    padding: 3px 12px;
    background: var(--accent, #6366f1);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    font-family: monospace;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .copy-btn:hover { opacity: 0.85; }
</style>
