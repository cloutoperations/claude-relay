<script>
  import { get } from 'svelte/store';
  import { sidebarOpen, filePanelVisible } from '../../stores/ui.js';
  import { connected } from '../../stores/ws.js';
  import { activeSessionId, leaveSession } from '../../stores/sessions.js';
  import { openPopup } from '../../stores/popups.js';
  import { messages, processing, thinking, currentDelta } from '../../stores/chat.js';
  import { hasOpenFiles } from '../../stores/files.js';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let {
    projectName = 'Claude Relay',
    sessionTitle = '',
    clientCount = 0,
    accountId = null,
    accounts = [],
  } = $props();

  let displayTitle = $derived(sessionTitle || 'Claude Relay');

  let accountColor = $derived.by(() => {
    if (!accountId || accounts.length < 2) return null;
    const idx = accounts.findIndex(a => a.id === accountId);
    return ACCOUNT_COLORS[idx >= 0 ? idx % ACCOUNT_COLORS.length : 0];
  });

  let accountLabel = $derived.by(() => {
    if (!accountId || accounts.length < 2) return null;
    const acct = accounts.find(a => a.id === accountId);
    if (!acct?.email) return null;
    const email = acct.email;
    return email.length > 20 ? email.substring(0, 20) + '...' : email;
  });

  function popOutToPopup() {
    const id = $activeSessionId;
    const title = sessionTitle;
    if (!id) return;

    // Snapshot current chat state before leaving fullscreen
    const chatState = {
      messages: get(messages),
      processing: get(processing),
      thinking: get(thinking).active,
      currentText: get(currentDelta),
      isStreaming: !!get(currentDelta),
    };

    leaveSession();
    openPopup(id, title || 'Session', chatState);
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

  <!-- Center: active session title + account badge -->
  <div class="header-center">
    {#if accountColor}
      <span class="header-account-dot" style="background: {accountColor}"></span>
    {/if}
    <span class="header-title">{displayTitle}</span>
    {#if accountLabel}
      <span class="header-account-badge" style="color: {accountColor}; background: {accountColor}12; border-color: {accountColor}30">{accountLabel}</span>
    {/if}
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
    {#if $hasOpenFiles}
      <button
        class="header-icon-btn"
        class:active={$filePanelVisible}
        onclick={() => filePanelVisible.update(v => !v)}
        title={$filePanelVisible ? 'Hide file panel' : 'Show file panel'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="15" y1="3" x2="15" y2="21"></line>
        </svg>
      </button>
    {/if}
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

  .header-account-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .header-account-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 4px;
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

  .header-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    border: none;
    background: none;
    color: #6b6760;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .header-icon-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #d4d0c8;
  }

  .header-icon-btn.active {
    color: #da7756;
  }
</style>
