<script>
  import { send } from '../../stores/ws.svelte.js';

  let {
    requestId,
    toolName = '',
    input = null,
    inputSummary = '',
    resolved = false,
    decision = '',
    compact = false,
    onPermissionRespond = null,
  } = $props();

  let respondedWith = $state(null);

  function respond(d) {
    if (!requestId) return; // guard against malformed requests
    if (respondedWith) return; // prevent double-click
    respondedWith = d;
    if (onPermissionRespond) {
      onPermissionRespond(requestId, d);
    } else {
      send({ type: 'permission_response', requestId, decision: d });
    }
  }

  function truncate(str, len) {
    return str && str.length > len ? str.substring(0, len) + '\u2026' : str;
  }

  function formatInput(inp) {
    if (!inp) return '';
    if (typeof inp === 'string') return inp;
    try { return JSON.stringify(inp, null, 2); } catch { return String(inp); }
  }
</script>

{#if compact}
  <!-- Compact permission block -->
  <div class="cp-permission-block" class:resolved>
    <div class="cp-perm-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>Permission needed</span>
    </div>
    <div class="cp-perm-tool">{toolName}{inputSummary ? ': ' + truncate(inputSummary, 36) : ''}</div>
    {#if !resolved}
      <div class="cp-perm-actions">
        <button class="cp-perm-btn allow" onclick={() => respond('allow')}>Allow</button>
        <button class="cp-perm-btn deny" onclick={() => respond('deny')}>Deny</button>
      </div>
    {:else}
      <div class="cp-perm-resolved">
        {#if decision === 'allow'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Allowed
        {:else}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {decision === 'deny' ? 'Denied' : 'Cancelled'}
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <!-- Full permission block -->
  <div class="permission-request" class:resolved>
    <div class="perm-header">
      <span class="perm-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </span>
      <span class="perm-title">Permission requested</span>
    </div>
    <div class="perm-tool">{toolName}</div>
    {#if input}
      <pre class="perm-input">{formatInput(input)}</pre>
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
{/if}

<style>
  /* ─── Full mode ─── */
  .permission-request {
    margin: 8px 0;
    background: var(--bg-alt);
    border: 1px solid var(--warning);
    border-radius: 8px;
    padding: 12px;
  }

  .permission-request.resolved {
    border-color: var(--border);
    opacity: 0.7;
  }

  .perm-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .perm-icon { color: var(--warning); display: flex; }

  .perm-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .perm-tool {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    color: var(--accent);
    margin-bottom: 8px;
  }

  .perm-input {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-deeper);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 150px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 8px;
  }

  .perm-actions { display: flex; gap: 8px; }

  .perm-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-alt);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }

  .perm-btn.allow { background: #2d4a2d; border-color: var(--success); color: var(--success); }
  .perm-btn.deny { background: #4a2d2d; border-color: var(--error); color: var(--error); }
  .perm-btn:hover { filter: brightness(1.2); }

  .perm-resolved {
    font-size: 12px;
    color: var(--text-dimmer);
    font-style: italic;
  }

  /* ─── Compact mode ─── */
  .cp-permission-block {
    padding: 10px 12px;
    border: 1px solid var(--accent-25);
    border-radius: 10px;
    background: rgba(var(--accent-rgb), 0.04);
    margin: 4px 0;
  }

  .cp-permission-block.resolved {
    border-color: rgba(var(--overlay-rgb), 0.06);
    background: none;
    opacity: 0.6;
  }

  .cp-perm-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .cp-perm-tool {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', Menlo, monospace;
    background: rgba(var(--overlay-rgb), 0.03);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .cp-perm-actions { display: flex; gap: 8px; }

  .cp-perm-btn {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cp-perm-btn.allow { background: var(--success); color: white; }
  .cp-perm-btn.allow:hover { background: #63bc66; }
  .cp-perm-btn.deny { background: rgba(var(--overlay-rgb), 0.06); color: var(--text-muted); }
  .cp-perm-btn.deny:hover { background: rgba(var(--overlay-rgb), 0.1); color: var(--text-secondary); }

  .cp-perm-resolved {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-dimmer);
    font-weight: 500;
  }
</style>
