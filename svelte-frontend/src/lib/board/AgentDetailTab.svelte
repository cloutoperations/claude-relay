<script>
  import { agents, startAgent, stopAgent, deleteAgent, triggerAgent } from '../../stores/agents.svelte.js';

  let { agentId } = $props();

  let agent = $derived(agents[agentId]);
  let isRunning = $derived(agent?.status === 'running');

  function handleStartStop() {
    if (isRunning) stopAgent(agentId);
    else startAgent(agentId);
  }

  function handleDelete() {
    if (confirm('Delete this agent?')) {
      deleteAgent(agentId);
    }
  }

  function formatTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  function typeLabel(type) {
    if (type === 'ralph') return 'Ralph Loop';
    if (type === 'cron') return 'Cron Job';
    return 'One-shot';
  }
</script>

<div class="agent-detail">
  {#if !agent}
    <div class="agent-empty">Agent not found</div>
  {:else}
    <!-- Header -->
    <div class="agent-header">
      <div class="agent-header-left">
        <span class="agent-type-pill">{typeLabel(agent.type)}</span>
        <h2 class="agent-title">{agent.name || agent.id}</h2>
      </div>
      <div class="agent-header-actions">
        <button class="agent-action-btn" class:stop={isRunning} onclick={handleStartStop}>
          {#if isRunning}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            Stop
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
            Start
          {/if}
        </button>
        {#if agent.type === 'cron' && !isRunning}
          <button class="agent-action-btn secondary" onclick={() => triggerAgent(agentId)}>Run Now</button>
        {/if}
        <button class="agent-action-btn danger" onclick={handleDelete}>Delete</button>
      </div>
    </div>

    <!-- Status -->
    <div class="agent-status-row">
      <span class="agent-status-dot" class:running={isRunning} class:passed={agent.status === 'passed'} class:failed={agent.status === 'failed'}></span>
      <span class="agent-status-text">{agent.status || 'idle'}</span>
      {#if agent.lastActivity}
        <span class="agent-last-active">Last active: {formatTime(agent.lastActivity)}</span>
      {/if}
    </div>

    <!-- Config section (type-specific) -->
    <div class="agent-section">
      <h3 class="agent-section-title">Configuration</h3>
      {#if agent.type === 'ralph'}
        <div class="agent-config-grid">
          <div class="agent-config-item">
            <span class="config-label">PROMPT.md</span>
            <span class="config-value">{agent.config?.promptPath || 'PROMPT.md'}</span>
          </div>
          <div class="agent-config-item">
            <span class="config-label">JUDGE.md</span>
            <span class="config-value">{agent.config?.judgePath || 'JUDGE.md'}</span>
          </div>
          <div class="agent-config-item">
            <span class="config-label">Max iterations</span>
            <span class="config-value">{agent.config?.maxIterations || 10}</span>
          </div>
          {#if agent.iteration != null}
            <div class="agent-config-item">
              <span class="config-label">Current iteration</span>
              <span class="config-value">#{agent.iteration}</span>
            </div>
          {/if}
        </div>
      {:else if agent.type === 'cron'}
        <div class="agent-config-grid">
          <div class="agent-config-item">
            <span class="config-label">Schedule</span>
            <span class="config-value">{agent.config?.expression || '—'}</span>
          </div>
          <div class="agent-config-item">
            <span class="config-label">Prompt</span>
            <span class="config-value prompt-preview">{agent.config?.prompt || '—'}</span>
          </div>
          {#if agent.nextRun}
            <div class="agent-config-item">
              <span class="config-label">Next run</span>
              <span class="config-value">{formatTime(agent.nextRun)}</span>
            </div>
          {/if}
        </div>
      {:else}
        <div class="agent-config-grid">
          <div class="agent-config-item">
            <span class="config-label">Prompt</span>
            <span class="config-value prompt-preview">{agent.config?.prompt || '—'}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- History / iterations -->
    {#if agent.history?.length > 0}
      <div class="agent-section">
        <h3 class="agent-section-title">
          {agent.type === 'ralph' ? 'Iterations' : 'Run History'}
        </h3>
        <div class="agent-history">
          {#each agent.history as entry, i (entry.timestamp || i)}
            <div class="history-entry" class:passed={entry.status === 'passed' || entry.verdict === 'PASS'} class:failed={entry.status === 'failed' || entry.verdict === 'FAIL'}>
              <span class="history-num">#{entry.iteration || i + 1}</span>
              <span class="history-verdict">{entry.verdict || entry.status || '—'}</span>
              {#if entry.reasoning}
                <span class="history-reasoning">{entry.reasoning}</span>
              {/if}
              {#if entry.duration}
                <span class="history-duration">{Math.round(entry.duration / 1000)}s</span>
              {/if}
              {#if entry.sessionId}
                <span class="history-session-link">session</span>
              {/if}
              <span class="history-time">{formatTime(entry.timestamp)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Sessions spawned by this agent -->
    {#if agent.sessionIds?.length > 0}
      <div class="agent-section">
        <h3 class="agent-section-title">Sessions ({agent.sessionIds.length})</h3>
        <div class="agent-sessions">
          {#each agent.sessionIds as sid (sid)}
            <div class="agent-session-row">{sid.substring(0, 12)}...</div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .agent-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 24px;
    overflow-y: auto;
    max-width: 800px;
  }

  .agent-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dimmer);
    font-size: 14px;
  }

  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .agent-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .agent-type-pill {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text-muted);
  }

  .agent-title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
  }

  .agent-header-actions {
    display: flex;
    gap: 8px;
  }

  .agent-action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid rgba(var(--overlay-rgb), 0.15);
    border-radius: 6px;
    background: rgba(var(--overlay-rgb), 0.04);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .agent-action-btn:hover {
    background: rgba(var(--overlay-rgb), 0.1);
  }

  .agent-action-btn.stop {
    color: #e5534b;
    border-color: rgba(229, 83, 75, 0.3);
  }

  .agent-action-btn.secondary {
    color: var(--text-muted);
  }

  .agent-action-btn.danger {
    color: #e5534b;
  }

  .agent-action-btn.danger:hover {
    background: rgba(229, 83, 75, 0.1);
  }

  .agent-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 24px;
    font-size: 13px;
  }

  .agent-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dimmer);
  }

  .agent-status-dot.running {
    background: var(--accent);
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .agent-status-dot.passed { background: #57ab5a; }
  .agent-status-dot.failed { background: #e5534b; }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .agent-status-text {
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .agent-last-active {
    color: var(--text-dimmer);
    margin-left: auto;
  }

  .agent-section {
    margin-bottom: 24px;
  }

  .agent-section-title {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .agent-config-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .agent-config-item {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .config-label {
    font-size: 12px;
    color: var(--text-dimmer);
    min-width: 120px;
    flex-shrink: 0;
  }

  .config-value {
    font-size: 13px;
    color: var(--text);
  }

  .config-value.prompt-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 400px;
  }

  .agent-history {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .history-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12px;
    background: rgba(var(--overlay-rgb), 0.03);
  }

  .history-entry:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .history-num {
    color: var(--text-dimmer);
    font-weight: 600;
    min-width: 28px;
  }

  .history-verdict {
    font-weight: 600;
    min-width: 40px;
  }

  .history-entry.passed .history-verdict { color: #57ab5a; }
  .history-entry.failed .history-verdict { color: #e5534b; }

  .history-reasoning {
    flex: 1;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-duration {
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .history-session-link {
    color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .history-time {
    color: var(--text-dimmer);
    flex-shrink: 0;
    font-size: 11px;
  }

  .agent-sessions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agent-session-row {
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .agent-session-row:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }
</style>
