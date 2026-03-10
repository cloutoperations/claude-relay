<script>
  import { sidebarOpen } from '../../stores/ui.js';
  import { connected } from '../../stores/ws.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.js';
  import { openPopup } from '../../stores/popups.js';

  let {
    projectName = 'Claude Relay',
    sessionTitle = '',
    clientCount = 0
  } = $props();

  let displayTitle = $derived(sessionTitle || 'Claude Relay');

  function popOutToPopup() {
    const id = $activeSessionId;
    const title = sessionTitle;
    if (!id) return;
    leaveSession();
    openPopup(id, title || 'Session');
  }
</script>

<header class="header">
  <!-- Left: sidebar toggle + project name -->
  <div class="header-left">
    <button class="hamburger-btn" onclick={() => sidebarOpen.update(v => !v)} title="Toggle sidebar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
    <span class="header-project">{projectName}</span>
  </div>

  <!-- Center: active session title -->
  <div class="header-center">
    <span class="header-title">{displayTitle}</span>
    {#if $activeSessionId}
      <button class="popout-btn" onclick={popOutToPopup} title="Pop out to chat window">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Right: status indicators -->
  <div class="header-right">
    {#if clientCount > 0}
      <span class="client-count" title="{clientCount} client{clientCount !== 1 ? 's' : ''} connected">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        {clientCount}
      </span>
    {/if}
    <span class="connection-status" class:connected={$connected} title={$connected ? 'Connected' : 'Disconnected'}>
      <span class="status-dot"></span>
      <span class="status-label">{$connected ? 'Connected' : 'Offline'}</span>
    </span>
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 16px;
    background: #1e1d1a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    min-width: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-shrink: 0;
  }

  .hamburger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: #908b81;
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .hamburger-btn:hover {
    color: #d4d0c8;
  }

  /* Hide hamburger on desktop where sidebar is always present */
  @media (min-width: 1024px) {
    .hamburger-btn {
      display: none;
    }
  }

  .header-project {
    font-size: 13px;
    font-weight: 600;
    color: #908b81;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 600px) {
    .header-project {
      display: none;
    }
  }

  .header-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0 16px;
  }

  .header-title {
    font-size: 14px;
    font-weight: 500;
    color: #d4d0c8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .popout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: none;
    color: #6b6760;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    margin-left: 6px;
    transition: all 0.15s;
  }

  .popout-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #da7756;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
  }

  .client-count {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #908b81;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #908b81;
  }

  .connection-status.connected {
    color: #908b81;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6b6760;
    transition: background 0.3s, box-shadow 0.3s;
  }

  .connection-status.connected .status-dot {
    background: #57ab5a;
    box-shadow: 0 0 6px rgba(87, 171, 90, 0.4);
  }

  .status-label {
    white-space: nowrap;
  }

  @media (max-width: 480px) {
    .status-label {
      display: none;
    }
  }
</style>
