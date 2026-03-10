<script>
  import { send } from '../../stores/ws.js';

  let { requestId, toolName = '', input = null, resolved = false, decision = '' } = $props();

  function respond(d) {
    send({ type: 'permission_response', requestId, decision: d });
  }
</script>

<div class="permission-request" class:resolved>
  <div class="perm-header">
    <span class="perm-icon">⚠</span>
    <span class="perm-title">Permission requested</span>
  </div>
  <div class="perm-tool">{toolName}</div>
  {#if input}
    <pre class="perm-input">{typeof input === 'string' ? input : JSON.stringify(input, null, 2)}</pre>
  {/if}
  {#if !resolved}
    <div class="perm-actions">
      <button class="perm-btn allow" onclick={() => respond('allow')}>Allow</button>
      <button class="perm-btn deny" onclick={() => respond('deny')}>Deny</button>
    </div>
  {:else}
    <div class="perm-resolved">
      {decision === 'allow' ? 'Allowed' : decision === 'deny' ? 'Denied' : 'Cancelled'}
    </div>
  {/if}
</div>

<style>
  .permission-request {
    margin: 8px 0;
    background: #2a2924;
    border: 1px solid #c5a13e;
    border-radius: 8px;
    padding: 12px;
  }

  .permission-request.resolved {
    border-color: #3e3c37;
    opacity: 0.7;
  }

  .perm-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .perm-icon {
    color: #c5a13e;
    font-size: 16px;
  }

  .perm-title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e5de;
  }

  .perm-tool {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    color: #da7756;
    margin-bottom: 8px;
  }

  .perm-input {
    font-size: 11px;
    color: #908b81;
    background: #1a1918;
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 150px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 8px;
  }

  .perm-actions {
    display: flex;
    gap: 8px;
  }

  .perm-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid #3e3c37;
    background: #35332f;
    color: #d4d0c8;
    font-size: 13px;
    cursor: pointer;
  }

  .perm-btn.allow {
    background: #2d4a2d;
    border-color: #5cb85c;
    color: #5cb85c;
  }

  .perm-btn.deny {
    background: #4a2d2d;
    border-color: #e5534b;
    color: #e5534b;
  }

  .perm-btn:hover {
    filter: brightness(1.2);
  }

  .perm-resolved {
    font-size: 12px;
    color: #6d6860;
    font-style: italic;
  }
</style>
