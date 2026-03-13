<script>
  import { sessionList as sessions, activeSessionId } from '../../stores/sessions.svelte.js';
  import { ambientState } from '../../stores/ambient.svelte.js';
  import { workspaceEnabled } from '../../stores/ui.svelte.js';
  import { send } from '../../stores/ws.svelte.js';
  import { openPopup } from '../../stores/popups.svelte.js';

  // Sort sessions: needs attention first, then processing, then recent
  let sortedSessions = $derived.by(() => {
    const amb = ambientState;
    return [...sessions].sort((a, b) => {
      const aAmb = amb[a.id] || {};
      const bAmb = amb[b.id] || {};

      // Needs attention first
      const aAttn = (aAmb.needsAttention || aAmb.permissionRequest || aAmb.askUser) ? 1 : 0;
      const bAttn = (bAmb.needsAttention || bAmb.permissionRequest || bAmb.askUser) ? 1 : 0;
      if (aAttn !== bAttn) return bAttn - aAttn;

      // Processing next
      const aProc = (a.isProcessing || aAmb.status === 'processing') ? 1 : 0;
      const bProc = (b.isProcessing || bAmb.status === 'processing') ? 1 : 0;
      if (aProc !== bProc) return bProc - aProc;

      // Recent activity
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    });
  });

  function getStatusClass(session) {
    const amb = ambientState[session.id] || {};
    if (amb.permissionRequest) return 'permission';
    if (amb.askUser) return 'question';
    if (session.isProcessing || amb.status === 'processing') return 'processing';
    return 'idle';
  }

  function getStatusText(session) {
    const amb = ambientState[session.id] || {};
    if (amb.permissionRequest) return '';
    if (amb.askUser) return 'needs input';
    if (session.isProcessing || amb.status === 'processing') return 'processing...';
    return '';
  }

  function handleAllow(sessionId, requestId) {
    send({ type: 'permission_response', sessionId, requestId, decision: 'allow' });
  }

  function handleDeny(sessionId, requestId) {
    send({ type: 'permission_response', sessionId, requestId, decision: 'deny' });
  }
</script>

{#if workspaceEnabled.value}
  <aside class="session-rail">
    <div class="rail-header">Sessions</div>

    {#if sortedSessions.length === 0}
      <div class="rail-empty">No sessions yet</div>
    {:else}
      <div class="rail-list">
        {#each sortedSessions as session (session.id)}
          {@const statusClass = getStatusClass(session)}
          {@const statusText = getStatusText(session)}
          {@const amb = ambientState[session.id] || {}}

          <button
            class="rail-item rail-{statusClass}"
            class:active={activeSessionId.value === session.id}
            onclick={() => openPopup(session.id, session.title)}
            title={session.title || 'Untitled'}
          >
            <div class="rail-item-header">
              <span class="rail-dot"></span>
              <span class="rail-title">{session.title || 'Untitled'}</span>
            </div>

            {#if amb.permissionRequest}
              <div class="rail-permission">
                <div class="rail-perm-text">{amb.permissionRequest.toolName || 'tool'}</div>
                <div class="rail-perm-actions">
                  <button
                    class="rail-btn rail-allow"
                    onclick={(e) => { e.stopPropagation(); handleAllow(session.id, amb.permissionRequest.requestId); }}
                  >Allow</button>
                  <button
                    class="rail-btn rail-deny"
                    onclick={(e) => { e.stopPropagation(); handleDeny(session.id, amb.permissionRequest.requestId); }}
                  >Deny</button>
                </div>
              </div>
            {:else if statusText}
              <div class="rail-status">{statusText}</div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .session-rail {
    width: 240px;
    flex-shrink: 0;
    border-left: 1px solid rgba(var(--overlay-rgb), 0.08);
    background: var(--code-bg);
    overflow-y: auto;
    scrollbar-width: thin;
    height: 100%;
  }

  .session-rail::-webkit-scrollbar { width: 6px; }
  .session-rail::-webkit-scrollbar-track { background: transparent; }
  .session-rail::-webkit-scrollbar-thumb { background: rgba(var(--overlay-rgb), 0.1); border-radius: 3px; }

  .rail-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dimmer);
    padding: 12px 12px 8px;
  }

  .rail-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 6px 12px;
  }

  .rail-item {
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s;
    background: none;
    border: none;
    font-family: inherit;
    text-align: left;
    width: 100%;
    color: inherit;
  }

  .rail-item:hover {
    background: var(--border-subtle);
  }

  .rail-item.active {
    background: var(--accent-12);
  }

  .rail-item-header {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .rail-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Status dot colors */
  .rail-idle .rail-dot {
    background: var(--text-dimmer);
  }

  .rail-processing .rail-dot {
    background: var(--accent);
    animation: rail-pulse 1.5s ease-in-out infinite;
  }

  .rail-permission .rail-dot {
    background: var(--error);
    box-shadow: 0 0 4px var(--error);
  }

  .rail-question .rail-dot {
    background: #7B93DB;
    box-shadow: 0 0 4px #7B93DB;
  }

  @keyframes rail-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rail-title {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .rail-status {
    font-size: 10px;
    color: var(--text-dimmer);
    margin-top: 2px;
    padding-left: 13px;
  }

  .rail-processing .rail-status {
    color: var(--accent);
  }

  .rail-question .rail-status {
    color: #7B93DB;
  }

  /* Permission inline actions */
  .rail-permission .rail-permission {
    /* nested selector for the permission detail block inside a permission item */
  }

  .rail-perm-text {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 6px;
    padding-left: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-perm-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    padding-left: 13px;
  }

  .rail-btn {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    transition: all 0.12s;
    font-family: inherit;
  }

  .rail-allow {
    background: var(--success);
    color: white;
  }

  .rail-allow:hover {
    filter: brightness(1.1);
  }

  .rail-deny {
    background: rgba(var(--overlay-rgb), 0.1);
    color: var(--text-secondary);
  }

  .rail-deny:hover {
    background: var(--text-dimmer);
    color: white;
  }

  .rail-empty {
    font-size: 12px;
    color: var(--text-dimmer);
    padding: 20px 12px;
    text-align: center;
    font-style: italic;
  }

  /* Hide rail on small screens */
  @media (max-width: 900px) {
    .session-rail {
      display: none;
    }
  }
</style>
