<script>
  import { sidebarOpen, filePanelVisible } from '../../stores/ui.svelte.js';
  import { wsState } from '../../stores/ws.svelte.js';
  import { getHasOpenFiles } from '../../stores/files.svelte.js';
  import { themeMode, getCurrentVariant, setThemeMode } from '../../stores/theme.svelte.js';

  function cycleThemeMode() {
    const mode = themeMode.value;
    if (mode === 'auto') setThemeMode('claude-light');
    else if (mode === 'claude-light') setThemeMode('claude');
    else setThemeMode('auto');
  }

  let hasOpenFiles = $derived(getHasOpenFiles());

  let themeIcon = $derived(getCurrentVariant() === 'light' ? 'sun' : 'moon');
  let themeTitle = $derived.by(() => {
    const m = themeMode.value;
    if (m === 'auto') return 'Theme: Auto (OS)';
    if (m === 'claude-light') return 'Theme: Light';
    return 'Theme: Dark';
  });

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let {
    projectName = 'Claude Relay',
    sessionTitle = '',
    clientCount = 0,
    accountId = null,
    accounts = [],
  } = $props();

  let displayTitle = $derived(sessionTitle || projectName);

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
</script>

<header class="header">
  <!-- Left: sidebar toggle + project name -->
  <div class="header-left">
    <button class="hamburger-btn" onclick={() => sidebarOpen.value = !sidebarOpen.value} title="Toggle sidebar">
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
  </div>

  <!-- Right: status indicators -->
  <div class="header-right">
    {#if hasOpenFiles}
      <button
        class="header-icon-btn"
        class:active={filePanelVisible.value}
        onclick={() => filePanelVisible.value = !filePanelVisible.value}
        title={filePanelVisible.value ? 'Hide file panel' : 'Show file panel'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="15" y1="3" x2="15" y2="21"></line>
        </svg>
      </button>
    {/if}
    <button class="header-icon-btn theme-toggle" onclick={cycleThemeMode} title={themeTitle}>
      {#if themeIcon === 'sun'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      {/if}
      {#if themeMode.value === 'auto'}
        <span class="theme-auto-badge">A</span>
      {/if}
    </button>
    {#if clientCount > 0}
      <span class="client-count" title="{clientCount} client{clientCount !== 1 ? 's' : ''} connected">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        {clientCount}
      </span>
    {/if}
    <span class="connection-status" class:connected={wsState.connected} title={wsState.connected ? 'Connected' : 'Disconnected'}>
      <span class="status-dot"></span>
      <span class="status-label">{wsState.connected ? 'Connected' : 'Offline'}</span>
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
    background: var(--code-bg);
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.10);
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
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .hamburger-btn:hover {
    color: var(--text);
  }

  .header-project {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 600px) {
    .header-project {
      max-width: 80px;
      font-size: 11px;
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
    color: var(--text);
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
    color: var(--text-muted);
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .connection-status.connected {
    color: var(--text-muted);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-dimmer);
    transition: background 0.3s, box-shadow 0.3s;
  }

  .connection-status.connected .status-dot {
    background: var(--success);
    box-shadow: 0 0 6px var(--success-40);
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
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .header-icon-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .header-icon-btn.active {
    color: var(--accent);
  }

  .theme-toggle {
    position: relative;
  }

  .theme-auto-badge {
    position: absolute;
    bottom: 1px;
    right: 1px;
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    color: var(--accent);
  }
</style>
