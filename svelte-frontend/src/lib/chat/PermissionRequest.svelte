<script>
  import { send } from '../../stores/ws.svelte.js';
  import { renderMarkdown } from '../../utils/markdown.js';

  let {
    requestId,
    toolName = '',
    input = null,
    inputSummary = '',
    decisionReason = '',
    resolved = false,
    decision = '',
    compact = false,
    onPermissionRespond = null,
  } = $props();

  let respondedWith = $state(null);
  let feedbackText = $state('');

  let isPlanApproval = $derived(toolName === 'ExitPlanMode');

  function respond(d, extra) {
    if (!requestId) return;
    if (respondedWith) return;
    respondedWith = d;
    if (onPermissionRespond) {
      onPermissionRespond(requestId, d);
    } else {
      let msg = { type: 'permission_response', requestId, decision: d };
      if (extra) Object.assign(msg, extra);
      send(msg);
    }
  }

  function respondWithFeedback() {
    if (!requestId || respondedWith || !feedbackText.trim()) return;
    respondedWith = 'deny';
    if (onPermissionRespond) {
      onPermissionRespond(requestId, 'deny');
    } else {
      send({ type: 'permission_response', requestId, decision: 'deny', feedback: feedbackText.trim() });
    }
  }

  function handleFeedbackKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      respondWithFeedback();
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
  <div class="cp-permission-block" class:resolved class:plan-approval={isPlanApproval}>
    <div class="cp-perm-header">
      {#if isPlanApproval}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Plan approval</span>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Permission needed</span>
      {/if}
    </div>
    {#if !isPlanApproval}
      <div class="cp-perm-tool">{toolName}{inputSummary ? ': ' + truncate(inputSummary, 36) : ''}</div>
    {/if}
    {#if decisionReason && !resolved}
      <div class="cp-perm-reason">{decisionReason}</div>
    {/if}
    {#if !resolved}
      <div class="cp-perm-actions">
        {#if isPlanApproval}
          <button class="cp-perm-btn allow" onclick={() => respond('allow')}>Approve</button>
          <button class="cp-perm-btn deny" onclick={() => respond('deny')}>Reject</button>
        {:else}
          <button class="cp-perm-btn allow" onclick={() => respond('allow')}>Allow</button>
          <button class="cp-perm-btn allow-always" onclick={() => respond('allow_always')}>Always</button>
          <button class="cp-perm-btn deny" onclick={() => respond('deny')}>Deny</button>
        {/if}
      </div>
    {:else}
      <div class="cp-perm-resolved">
        {#if decision === 'allow' || decision === 'allow_always'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          {decision === 'allow_always' ? 'Always Allowed' : isPlanApproval ? 'Approved' : 'Allowed'}
        {:else}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {decision === 'deny' ? (isPlanApproval ? 'Rejected' : 'Denied') : 'Cancelled'}
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <!-- Full permission block -->
  <div class="permission-request" class:resolved class:plan-approval={isPlanApproval}>
    <div class="perm-header">
      <span class="perm-icon">
        {#if isPlanApproval}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        {/if}
      </span>
      <span class="perm-title">{isPlanApproval ? 'Plan Approval' : 'Permission requested'}</span>
    </div>

    {#if !isPlanApproval}
      <div class="perm-tool">{toolName}</div>
    {/if}

    {#if isPlanApproval && input?.plan}
      <div class="plan-content md-content">{@html renderMarkdown(input.plan)}</div>
    {/if}

    {#if decisionReason}
      <div class="perm-reason">{decisionReason}</div>
    {/if}

    {#if input && !isPlanApproval}
      <pre class="perm-input">{formatInput(input)}</pre>
    {/if}

    {#if !resolved}
      {#if isPlanApproval}
        <div class="perm-actions plan-actions">
          <button class="perm-btn auto-accept" onclick={() => respond('allow', { acceptEdits: true })}>Auto-accept edits</button>
          <button class="perm-btn allow" onclick={() => respond('allow')}>Manually approve</button>
          <button class="perm-btn deny" onclick={() => respond('deny')}>Reject</button>
        </div>
        <div class="perm-feedback-row">
          <input
            type="text"
            class="perm-feedback-input"
            placeholder="Tell Claude what to change..."
            bind:value={feedbackText}
            onkeydown={handleFeedbackKeydown}
          />
          {#if feedbackText.trim()}
            <button class="perm-feedback-send" onclick={respondWithFeedback}>Send</button>
          {/if}
        </div>
      {:else}
        <div class="perm-actions">
          <button class="perm-btn allow" onclick={() => respond('allow')}>Allow</button>
          <button class="perm-btn allow-always" onclick={() => respond('allow_always')}>Always Allow</button>
          <button class="perm-btn deny" onclick={() => respond('deny')}>Deny</button>
        </div>
      {/if}
    {:else}
      <div class="perm-resolved">
        {#if decision === 'allow_always'}
          Always Allowed
        {:else if decision === 'allow'}
          {isPlanApproval ? 'Approved' : 'Allowed'}
        {:else if decision === 'deny'}
          {isPlanApproval ? 'Rejected' : 'Denied'}
        {:else}
          Cancelled
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* --- Full mode --- */
  .permission-request {
    margin: 8px 0;
    background: var(--bg-alt);
    border: 1px solid var(--warning);
    border-radius: 10px;
    padding: 12px;
    animation: permSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes permSlideIn {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .permission-request.plan-approval {
    border-color: var(--accent);
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
  .plan-approval .perm-icon { color: var(--accent); }

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

  .perm-reason {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
    line-height: 1.4;
    font-style: italic;
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

  .plan-content {
    font-size: 13px;
    color: var(--text);
    padding: 4px 0 10px;
    line-height: 1.6;
    word-break: break-word;
  }

  .plan-content :global(p) { margin: 0.5em 0; }
  .plan-content :global(p:first-child) { margin-top: 0; }
  .plan-content :global(ul), .plan-content :global(ol) { padding-left: 1.4em; margin: 0.4em 0; }
  .plan-content :global(li) { margin: 0.2em 0; }
  .plan-content :global(code) { font-size: 12px; background: var(--bg-deeper); padding: 1px 4px; border-radius: 3px; }
  .plan-content :global(pre) { background: var(--bg-deeper); padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .plan-content :global(strong) { color: var(--text); font-weight: 600; }
  .plan-content :global(h1), .plan-content :global(h2), .plan-content :global(h3) { font-size: 14px; font-weight: 600; margin: 0.8em 0 0.3em; }

  .perm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .plan-actions { margin-bottom: 8px; }

  .perm-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-alt);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .perm-btn.allow { background: var(--success-15); border-color: var(--success); color: var(--success); }
  .perm-btn.allow-always { background: rgba(var(--accent-rgb, 99, 102, 241), 0.1); border-color: var(--accent); color: var(--accent); }
  .perm-btn.auto-accept { background: rgba(var(--accent-rgb, 99, 102, 241), 0.15); border-color: var(--accent); color: var(--accent); font-weight: 500; }
  .perm-btn.deny { background: var(--error-15); border-color: var(--error); color: var(--error); }
  .perm-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
  .perm-btn:active { transform: translateY(0) scale(0.97); }

  .perm-feedback-row {
    display: flex;
    gap: 8px;
  }

  .perm-feedback-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-deeper);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    outline: none;
  }

  .perm-feedback-input:focus {
    border-color: var(--accent);
  }

  .perm-feedback-send {
    padding: 6px 14px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: var(--text-on-accent);
    font-size: 13px;
    cursor: pointer;
  }

  .perm-feedback-send:hover {
    filter: brightness(1.1);
  }

  .perm-resolved {
    font-size: 12px;
    color: var(--text-dimmer);
    font-style: italic;
  }

  /* --- Compact mode --- */
  .cp-permission-block {
    padding: 10px 12px;
    border: 1px solid var(--accent-25);
    border-radius: 10px;
    background: rgba(var(--accent-rgb), 0.04);
    margin: 4px 0;
    animation: permSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cp-permission-block.plan-approval {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.06);
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

  .cp-perm-reason {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
    font-style: italic;
    line-height: 1.3;
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

  .cp-perm-btn.allow { background: var(--success); color: var(--text-on-accent); }
  .cp-perm-btn.allow:hover { background: var(--success); color: var(--text-on-accent); }
  .cp-perm-btn.allow-always { background: var(--accent); color: var(--text-on-accent); }
  .cp-perm-btn.allow-always:hover { background: var(--accent); color: var(--text-on-accent); filter: brightness(1.1); }
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
