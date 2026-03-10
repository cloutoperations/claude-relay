<script>
  import { sessions, activeSessionId, leaveSession, createSession } from '../../stores/sessions.js';
  import { sidebarOpen } from '../../stores/ui.js';
  import { openPopup } from '../../stores/popups.js';

  let { projectName = 'Claude Relay' } = $props();

  let activeTab = $state('sessions'); // 'sessions' | 'files'

  // Group sessions by date
  function groupByDate(sessionList) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const groups = { today: [], yesterday: [], week: [], older: [] };

    // Sort by lastActivity descending
    const sorted = [...sessionList].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    for (const s of sorted) {
      const d = new Date(s.lastActivity || 0);
      if (d >= today) groups.today.push(s);
      else if (d >= yesterday) groups.yesterday.push(s);
      else if (d >= weekAgo) groups.week.push(s);
      else groups.older.push(s);
    }

    const result = [];
    if (groups.today.length) result.push({ label: 'Today', sessions: groups.today });
    if (groups.yesterday.length) result.push({ label: 'Yesterday', sessions: groups.yesterday });
    if (groups.week.length) result.push({ label: 'This Week', sessions: groups.week });
    if (groups.older.length) result.push({ label: 'Older', sessions: groups.older });
    return result;
  }

  let grouped = $derived(groupByDate($sessions));

  function handleSessionClick(sessionId) {
    // If fullscreen session is active, leave it first
    if ($activeSessionId) {
      leaveSession();
    }
    // Open as popup
    const session = $sessions.find(s => s.id === sessionId);
    openPopup(sessionId, session?.title || 'Session');
    // Close sidebar on mobile
    if (window.innerWidth < 1024) {
      sidebarOpen.set(false);
    }
  }

  function handleNewSession() {
    createSession();
    if (window.innerWidth < 1024) {
      sidebarOpen.set(false);
    }
  }

  function truncateId(id) {
    if (!id) return '';
    return id.length > 8 ? id.slice(0, 8) : id;
  }
</script>

<aside class="sidebar" class:open={$sidebarOpen}>
  <!-- Header -->
  <div class="sidebar-header">
    <button class="sidebar-logo" onclick={() => {}}>
      <span class="logo-text">{projectName}</span>
    </button>
    <button class="sidebar-toggle" onclick={() => sidebarOpen.set(false)} title="Close sidebar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
      </svg>
    </button>
  </div>

  <!-- Tabs -->
  <div class="sidebar-tabs">
    <button
      class="sidebar-tab"
      class:active={activeTab === 'sessions'}
      onclick={() => activeTab = 'sessions'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      Sessions
    </button>
    <button
      class="sidebar-tab"
      class:active={activeTab === 'files'}
      onclick={() => activeTab = 'files'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      Files
    </button>
  </div>

  <!-- Tab content -->
  <div class="sidebar-content">
    {#if activeTab === 'sessions'}
      <div class="session-list-header">
        <span>Sessions</span>
      </div>

      <div class="session-list">
        {#each grouped as group}
          <div class="session-group-label">{group.label}</div>
          {#each group.sessions as session (session.id)}
            <button
              class="session-item"
              class:active={$activeSessionId === session.id}
              onclick={() => handleSessionClick(session.id)}
              title={session.title || 'Untitled'}
            >
              <span class="session-item-text">{session.title || 'Untitled'}</span>
              {#if session.isProcessing}
                <span class="session-processing-dot"></span>
              {/if}
              <span class="session-id">{truncateId(session.id)}</span>
            </button>
          {/each}
        {/each}

        {#if $sessions.length === 0}
          <div class="session-empty">No sessions yet</div>
        {/if}
      </div>
    {:else}
      <div class="files-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.3;">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>File browser coming soon</span>
      </div>
    {/if}
  </div>

  <!-- Footer: new session button -->
  <div class="sidebar-footer">
    <button class="new-session-btn" onclick={handleNewSession}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      New Session
    </button>
  </div>
</aside>

<!-- Mobile overlay -->
{#if $sidebarOpen}
  <div class="sidebar-overlay" onclick={() => sidebarOpen.set(false)} role="presentation"></div>
{/if}

<style>
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: #1e1d1a;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s ease;
    height: 100%;
  }

  /* Mobile: slide-over drawer */
  @media (max-width: 1023px) {
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 100;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
    }
    .sidebar.open {
      transform: translateX(0);
    }
  }

  /* Desktop: always visible when open */
  @media (min-width: 1024px) {
    .sidebar {
      position: relative;
      transform: none;
    }
    .sidebar-overlay {
      display: none !important;
    }
  }

  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 99;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  /* Header */
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 8px;
    flex-shrink: 0;
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #908b81;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s;
    font-family: inherit;
  }

  .sidebar-logo:hover {
    color: #d4d0c8;
  }

  .logo-text {
    font-size: 14px;
    font-weight: 600;
  }

  .sidebar-toggle {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #908b81;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
    padding: 0;
  }

  .sidebar-toggle:hover {
    background: #353430;
    color: #d4d0c8;
  }

  /* Tabs */
  .sidebar-tabs {
    display: flex;
    padding: 0 8px;
    gap: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .sidebar-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 0;
    border: none;
    background: transparent;
    color: #908b81;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }

  .sidebar-tab:hover {
    color: #b0ab9f;
  }

  .sidebar-tab.active {
    color: #d4d0c8;
    border-bottom-color: #da7756;
  }

  /* Content area */
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  .sidebar-content::-webkit-scrollbar {
    width: 6px;
  }
  .sidebar-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .sidebar-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }

  /* Session list header */
  .session-list-header {
    display: flex;
    align-items: center;
    padding: 16px 16px 4px 20px;
    font-size: 11px;
    font-weight: 600;
    color: #6b6760;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .session-list {
    padding: 2px 8px;
  }

  .session-group-label {
    padding: 10px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    color: #6b6760;
    letter-spacing: 0.3px;
  }

  .session-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 7px 12px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    color: #b0ab9f;
    background: none;
    border: none;
    font-family: inherit;
    text-align: left;
    transition: background 0.15s, color 0.15s, transform 0.15s;
  }

  .session-item:hover {
    background: #353430;
    color: #d4d0c8;
    transform: translateX(3px);
  }

  .session-item.active {
    background: rgba(218, 119, 86, 0.12);
    color: #d4d0c8;
  }

  .session-item-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .session-processing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da7756;
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
    margin-left: 4px;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .session-id {
    font-size: 10px;
    color: #6b6760;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    flex-shrink: 0;
  }

  .session-empty {
    padding: 24px 16px;
    font-size: 13px;
    color: #6b6760;
    text-align: center;
    font-style: italic;
  }

  /* Files placeholder */
  .files-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 16px;
    color: #6b6760;
    font-size: 13px;
    font-style: italic;
  }

  /* Footer */
  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .new-session-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid rgba(218, 119, 86, 0.3);
    background: rgba(218, 119, 86, 0.08);
    color: #da7756;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .new-session-btn:hover {
    background: rgba(218, 119, 86, 0.15);
    border-color: rgba(218, 119, 86, 0.5);
  }
</style>
