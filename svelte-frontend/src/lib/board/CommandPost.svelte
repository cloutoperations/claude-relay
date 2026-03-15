<script>
  import { onMount } from 'svelte';
  import { projectInfo, accountUsage } from '../../stores/chat.svelte.js';
  import { sessionList, createSession } from '../../stores/sessions.svelte.js';
  import { send } from '../../stores/ws.svelte.js';
  import { boardData, boardLoading } from '../../stores/board.svelte.js';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let accounts = $derived(projectInfo.accounts || []);
  let hasMultipleAccounts = $derived(accounts.length > 1);

  let totalSessions = $derived(sessionList.length);
  let processingSessions = $derived(sessionList.filter(s => s.isProcessing).length);

  let showAccountPicker = $state(false);

  // Fetch usage on mount, refresh every 60s
  onMount(() => {
    send({ type: 'get_usage' });
    const interval = setInterval(() => send({ type: 'get_usage' }), 60000);
    return () => clearInterval(interval);
  });

  function handleNewSession() {
    if (hasMultipleAccounts) {
      showAccountPicker = !showAccountPicker;
      return;
    }
    createSession();
  }

  function pickAccount(accountId) {
    showAccountPicker = false;
    createSession(accountId);
  }

  function barColor(pct) {
    if (pct >= 80) return '#ef4444';
    if (pct >= 50) return '#f59e0b';
    return '#57ab5a';
  }

  function planBadge(profile) {
    if (!profile?.organization) return '';
    const tier = profile.organization.rate_limit_tier || '';
    const match = tier.match(/(\d+x)/);
    if (profile.account?.has_claude_max) {
      return 'Max' + (match ? ' ' + match[1] : '');
    }
    if (profile.organization.organization_type === 'claude_pro') return 'Pro';
    return profile.organization.organization_type || '';
  }

  function timeUntil(isoStr) {
    if (!isoStr) return '';
    const diff = new Date(isoStr).getTime() - Date.now();
    if (diff <= 0) return 'now';
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'now';
    if (mins < 60) return mins + ' min';
    const hours = Math.floor(mins / 60);
    const remMin = mins % 60;
    if (hours < 24) {
      return remMin > 0 ? hours + 'h ' + remMin + 'min' : hours + 'h';
    }
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return days + 'd ' + remH + 'h';
  }

  function accountColor(idx) {
    return ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
  }
</script>

<div class="command-post">
  {#if boardLoading.value && !boardData.value}
    <div class="cp-loading-state">
      <div class="cp-spinner-large"></div>
      <span>Loading workspace...</span>
    </div>
  {:else if !boardData.value}
    <div class="cp-welcome">
      <div class="cp-welcome-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h2 class="cp-welcome-title">Claude Relay</h2>
      <p class="cp-welcome-text">Start a new session or select one from the sidebar</p>
    </div>
  {:else}
  <div class="cp-scroll">
    <div class="cp-content">

      <!-- Header -->
      <div class="cp-header">
        <h1 class="cp-title">{projectInfo.name || 'Claude Relay'}</h1>
        <p class="cp-subtitle">{projectInfo.cwd || ''}</p>
      </div>

      <!-- Account Usage Cards -->
      <section class="cp-section">
        <h2 class="cp-section-title">Account Usage</h2>

        {#if accountUsage.loading}
          <div class="cp-card cp-loading">
            <span class="cp-loading-text">Loading usage data...</span>
          </div>
        {:else if accountUsage.accounts.length === 0}
          <div class="cp-card">
            <span class="cp-empty-text">No account data available</span>
          </div>
        {:else}
          <div class="cp-usage-grid">
            {#each accountUsage.accounts as acct, i}
              <div class="cp-usage-card" style="border-left-color: {accountColor(i)}">
                {#if acct.error}
                  <div class="cp-usage-header">
                    <span class="cp-usage-email">{acct.account?.email || 'Account ' + (i + 1)}</span>
                  </div>
                  <div class="cp-usage-error">{acct.error}</div>
                {:else}
                  <div class="cp-usage-header">
                    <span class="cp-usage-email">{acct.profile?.account?.display_name || acct.account?.email || 'Account'}</span>
                    {#if planBadge(acct.profile)}
                      <span class="cp-plan-badge">{planBadge(acct.profile)}</span>
                    {/if}
                  </div>
                  <span class="cp-usage-email-sub">{acct.account?.email || ''}</span>

                  {#if acct.usage}
                    <!-- 5-hour bar -->
                    {#if acct.usage.five_hour}
                      {@const u = acct.usage.five_hour}
                      <div class="cp-bar-group">
                        <div class="cp-bar-label">
                          <span>5h</span>
                          <span class="cp-bar-pct" style="color: {barColor(u.utilization)}">{u.utilization}%</span>
                          <span class="cp-bar-reset">resets in {timeUntil(u.resets_at)}</span>
                        </div>
                        <div class="cp-bar-track">
                          <div class="cp-bar-fill" style="width: {Math.min(u.utilization, 100)}%; background: {barColor(u.utilization)}"></div>
                        </div>
                      </div>
                    {/if}

                    <!-- 7-day bar -->
                    {#if acct.usage.seven_day}
                      {@const u = acct.usage.seven_day}
                      <div class="cp-bar-group">
                        <div class="cp-bar-label">
                          <span>7d</span>
                          <span class="cp-bar-pct" style="color: {barColor(u.utilization)}">{u.utilization}%</span>
                          <span class="cp-bar-reset">resets in {timeUntil(u.resets_at)}</span>
                        </div>
                        <div class="cp-bar-track">
                          <div class="cp-bar-fill" style="width: {Math.min(u.utilization, 100)}%; background: {barColor(u.utilization)}"></div>
                        </div>
                      </div>
                    {/if}

                    <!-- 7-day Sonnet bar -->
                    {#if acct.usage.seven_day_sonnet}
                      {@const u = acct.usage.seven_day_sonnet}
                      <div class="cp-bar-group">
                        <div class="cp-bar-label">
                          <span>7d Sonnet</span>
                          <span class="cp-bar-pct" style="color: {barColor(u.utilization)}">{u.utilization}%</span>
                          <span class="cp-bar-reset">resets in {timeUntil(u.resets_at)}</span>
                        </div>
                        <div class="cp-bar-track">
                          <div class="cp-bar-fill" style="width: {Math.min(u.utilization, 100)}%; background: {barColor(u.utilization)}"></div>
                        </div>
                      </div>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Sessions -->
      <section class="cp-section">
        <h2 class="cp-section-title">Sessions</h2>
        <div class="cp-card">
          <div class="cp-stat-row">
            <span class="cp-stat-number">{totalSessions}</span>
            <span class="cp-stat-label">total</span>
          </div>
          {#if processingSessions > 0}
            <div class="cp-stat-row processing">
              <span class="cp-stat-number">{processingSessions}</span>
              <span class="cp-stat-label">processing</span>
              <span class="cp-processing-dot"></span>
            </div>
          {/if}
        </div>
      </section>

      <!-- New Session -->
      <section class="cp-section">
        <div class="cp-new-session-wrapper">
          <button class="cp-new-session-btn" onclick={handleNewSession}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Session
          </button>
          {#if showAccountPicker}
            <div class="cp-account-picker">
              {#each accounts as account, i}
                <button class="cp-account-pick-btn" onclick={() => pickAccount(account.id)}>
                  <span class="cp-account-dot" style="background: {ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}"></span>
                  {account.email || account.id}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </section>

      <!-- Keyboard Shortcuts -->
      <section class="cp-section">
        <h2 class="cp-section-title">Keyboard Shortcuts</h2>
        <div class="cp-card cp-shortcuts">
          <div class="cp-shortcut"><kbd>Enter</kbd><span>Send message</span></div>
          <div class="cp-shortcut"><kbd>Shift + Enter</kbd><span>New line</span></div>
          <div class="cp-shortcut"><kbd>/</kbd><span>Slash commands</span></div>
          <div class="cp-shortcut"><kbd>Esc</kbd><span>Interrupt / cancel</span></div>
        </div>
      </section>

    </div>
  </div>
  {/if}
</div>

<style>
  .command-post {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .cp-welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dimmer);
    padding: 40px;
  }

  .cp-welcome-icon {
    opacity: 0.3;
    margin-bottom: 4px;
  }

  .cp-welcome-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0;
  }

  .cp-welcome-text {
    font-size: 14px;
    margin: 0;
  }

  .cp-loading-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dimmer);
    font-size: 14px;
  }

  .cp-spinner-large {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(var(--overlay-rgb), 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .cp-scroll {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .cp-content {
    max-width: 700px;
    margin: 0 auto;
    padding: 40px 24px 60px;
    width: 100%;
    box-sizing: border-box;
  }

  /* Header */
  .cp-header {
    margin-bottom: 32px;
    text-align: center;
  }

  .cp-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 4px;
  }

  .cp-subtitle {
    font-size: 12px;
    color: var(--text-dimmer);
    margin: 0;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
  }

  /* Sections */
  .cp-section {
    margin-bottom: 20px;
  }

  .cp-section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 8px 2px;
  }

  /* Cards */
  .cp-card {
    background: var(--bg-alt, var(--code-bg));
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 10px;
    padding: 14px 16px;
  }

  .cp-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }

  .cp-loading-text {
    font-size: 13px;
    color: var(--text-dimmer);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .cp-empty-text {
    font-size: 13px;
    color: var(--text-dimmer);
  }

  /* Usage grid */
  .cp-usage-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cp-usage-card {
    background: var(--bg-alt, var(--code-bg));
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 10px;
    border-left: 3px solid var(--accent);
    padding: 14px 16px;
  }

  .cp-usage-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }

  .cp-usage-email {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-usage-email-sub {
    font-size: 11px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    display: block;
    margin-bottom: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-plan-badge {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-8);
    border: 1px solid var(--accent-30);
    border-radius: 4px;
    padding: 1px 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cp-usage-error {
    font-size: 12px;
    color: #ef4444;
    margin-top: 6px;
    padding: 6px 8px;
    background: rgba(239, 68, 68, 0.08);
    border-radius: 6px;
  }

  /* Bar groups */
  .cp-bar-group {
    margin-bottom: 8px;
  }

  .cp-bar-group:last-child {
    margin-bottom: 0;
  }

  .cp-bar-label {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .cp-bar-pct {
    font-weight: 700;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    font-size: 12px;
  }

  .cp-bar-reset {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, Monaco, monospace;
  }

  .cp-bar-track {
    height: 8px;
    background: rgba(var(--overlay-rgb), 0.08);
    border-radius: 4px;
    overflow: hidden;
  }

  .cp-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
    min-width: 2px;
  }

  /* Stats */
  .cp-stat-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }

  .cp-stat-row:last-child {
    margin-bottom: 0;
  }

  .cp-stat-row.processing {
    align-items: center;
  }

  .cp-stat-number {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    line-height: 1;
  }

  .cp-stat-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .cp-processing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
    margin-left: 2px;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* New session button */
  .cp-new-session-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .cp-new-session-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 32px;
    border-radius: 10px;
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }

  .cp-new-session-btn:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
    transform: translateY(-1px);
  }

  .cp-new-session-btn:active {
    transform: translateY(0);
  }

  .cp-account-picker {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--bg-alt, var(--code-bg));
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px;
    padding: 4px;
    min-width: 220px;
  }

  .cp-account-pick-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.12s, color 0.12s;
    text-align: left;
  }

  .cp-account-pick-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .cp-account-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Shortcuts */
  .cp-shortcuts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
  }

  .cp-shortcut {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cp-shortcut kbd {
    display: inline-block;
    padding: 2px 7px;
    font-size: 11px;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    color: var(--text-muted);
    background: rgba(var(--overlay-rgb), 0.06);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 4px;
    white-space: nowrap;
  }

  .cp-shortcut span {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Responsive */
  @media (max-width: 500px) {
    .cp-content {
      padding: 24px 16px 40px;
    }

    .cp-shortcuts {
      grid-template-columns: 1fr;
    }
  }
</style>
