<script>
  import { contextData, modelInfo, processing, activity, sessionCost } from '../../stores/chat.js';
  import { connected } from '../../stores/ws.js';
  import { sessions } from '../../stores/sessions.js';

  let activeSessions = $derived($sessions.filter(s => s.isProcessing));
  let contextPercent = $derived(
    $contextData.max > 0
      ? Math.round(($contextData.used / $contextData.max) * 100)
      : $contextData.percent || 0
  );
  let contextLevel = $derived(
    contextPercent >= 85 ? 'danger' : contextPercent >= 60 ? 'warn' : 'ok'
  );

  let costDisplay = $derived(
    $sessionCost > 0
      ? ($sessionCost < 0.01 ? '<$0.01' : '$' + $sessionCost.toFixed(2))
      : null
  );

  let modelShort = $derived(() => {
    const m = $modelInfo.model || '';
    return m.replace('claude-', '').replace(/-\d{8}$/, '').split('-').slice(0, 2).join('-');
  });
</script>

<div class="status-bar" class:disconnected={!$connected}>
  <!-- Left: model + context + cost -->
  <div class="sb-left">
    {#if $modelInfo.model}
      <span class="sb-model" title={$modelInfo.model}>
        {modelShort()}
      </span>
    {/if}
    {#if $contextData.max > 0}
      <div class="sb-context" class:warn={contextLevel === 'warn'} class:danger={contextLevel === 'danger'} title="Context: {$contextData.used?.toLocaleString()} / {$contextData.max?.toLocaleString()} tokens ({contextPercent}%)">
        <div class="context-bar">
          <div class="context-fill" style="width: {contextPercent}%"></div>
        </div>
        <span class="context-label">{contextPercent}%</span>
      </div>
    {/if}
    {#if costDisplay}
      <span class="sb-cost" title="Session cost: ${$sessionCost.toFixed(4)}">{costDisplay}</span>
    {/if}
  </div>

  <!-- Center: activity when processing -->
  <div class="sb-center">
    {#if $processing && $activity}
      <span class="sb-activity">
        <div class="sb-spinner"></div>
        {$activity}
      </span>
    {:else if activeSessions.length > 0}
      <span class="sb-active">
        <span class="active-dot"></span>
        {activeSessions.length} active
      </span>
      {#each activeSessions.slice(0, 3) as s (s.id)}
        <span class="sb-session-chip" title={s.title}>
          {s.title?.substring(0, 20) || s.id.substring(0, 8)}
        </span>
      {/each}
      {#if activeSessions.length > 3}
        <span class="sb-more">+{activeSessions.length - 3}</span>
      {/if}
    {/if}
  </div>

  <!-- Right: connection status -->
  <div class="sb-right">
    {#if !$connected}
      <span class="sb-disconnected">disconnected</span>
    {/if}
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 12px;
    background: #1a1918;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 11px;
    color: #6b6760;
    flex-shrink: 0;
    gap: 12px;
    min-width: 0;
  }

  .status-bar.disconnected {
    border-top-color: rgba(229, 83, 75, 0.3);
  }

  .sb-left, .sb-center, .sb-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .sb-left { flex-shrink: 0; }
  .sb-center { flex: 1; justify-content: center; overflow: hidden; }
  .sb-right { flex-shrink: 0; }

  .sb-model {
    color: #908b81;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 10px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    white-space: nowrap;
  }

  /* Cost */
  .sb-cost {
    color: #908b81;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 10px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    white-space: nowrap;
  }

  /* Context bar */
  .sb-context {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .context-bar {
    width: 48px;
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .context-fill {
    height: 100%;
    background: #57ab5a;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .sb-context.warn .context-fill { background: #c5a13e; }
  .sb-context.danger .context-fill { background: #e5534b; }

  .context-label {
    font-size: 10px;
    color: #6b6760;
    min-width: 24px;
  }

  /* Activity */
  .sb-activity {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #da7756;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 10px;
  }

  .sb-spinner {
    width: 8px;
    height: 8px;
    border: 1.5px solid rgba(218, 119, 86, 0.25);
    border-top-color: #da7756;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  /* Active sessions */
  .sb-active {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #da7756;
    white-space: nowrap;
  }

  .active-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .sb-session-chip {
    padding: 1px 6px;
    background: rgba(218, 119, 86, 0.1);
    border-radius: 4px;
    color: #b0ab9f;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .sb-more {
    color: #908b81;
    font-size: 10px;
  }

  /* Disconnected */
  .sb-disconnected {
    color: #e5534b;
    font-size: 10px;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 600px) {
    .sb-center { display: none; }
    .sb-model { display: none; }
  }
</style>
