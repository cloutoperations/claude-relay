<script>
  import { sessions, activeSessionId, leaveSession, createSession, renameSession } from '../../stores/sessions.js';
  import { sidebarOpen, chatSearchQuery } from '../../stores/ui.js';
  import { openPopup } from '../../stores/popups.js';
  import { projectInfo } from '../../stores/chat.js';
  import { send, onMessage } from '../../stores/ws.js';
  import FileTree from '../files/FileTree.svelte';
  import ProjectsPanel from '../board/ProjectsPanel.svelte';
  import SessionTagger from '../board/SessionTagger.svelte';
  import { activeFilePath } from '../../stores/files.js';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let { projectName = 'Claude Relay' } = $props();

  let activeTab = $state('sessions'); // 'sessions' | 'files' | 'projects'
  let showAccountPicker = $state(false);
  let pickerAnchorEl = $state(null);
  let searchQuery = $state('');
  let searchResults = $state(null); // null = no search, array = server results
  let searchDebounce = null;
  let renamingId = $state(null);
  let renameValue = $state('');
  let taggerSessionId = $state(null);
  let taggerX = $state(0);
  let taggerY = $state(0);

  let accounts = $derived($projectInfo.accounts || []);
  let hasMultipleAccounts = $derived(accounts.length > 1);

  // Listen for search results from server
  onMessage((msg) => {
    if (msg.type === 'search_results') {
      if (msg.query !== searchQuery) return; // stale
      searchResults = msg.results || [];
    }
  });

  // Send search to server on query change
  $effect(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
    const q = searchQuery.trim();
    chatSearchQuery.set(q); // sync to shared store for SearchTimeline
    if (!q) {
      searchResults = null;
      return;
    }
    searchDebounce = setTimeout(() => {
      send({ type: 'search_sessions', query: q });
    }, 200);
  });

  // Merge server results with session list for display
  let searchMatchMap = $derived.by(() => {
    if (!searchResults) return null;
    const map = new Map();
    for (const r of searchResults) {
      map.set(r.id, r.matchType);
    }
    return map;
  });

  let filteredSessions = $derived.by(() => {
    if (!searchQuery.trim()) return $sessions;
    if (!searchMatchMap) return $sessions; // still waiting for server
    return $sessions.filter(s => searchMatchMap.has(s.id));
  });

  function accountColor(accountId) {
    if (!accountId || !hasMultipleAccounts) return null;
    const idx = accounts.findIndex(a => a.id === accountId);
    return ACCOUNT_COLORS[idx >= 0 ? idx % ACCOUNT_COLORS.length : 0];
  }

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

  let grouped = $derived(groupByDate(filteredSessions));

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

  function handleNewSession(e) {
    if (hasMultipleAccounts) {
      pickerAnchorEl = e.currentTarget;
      showAccountPicker = !showAccountPicker;
      return;
    }
    createSession();
    if (window.innerWidth < 1024) {
      sidebarOpen.set(false);
    }
  }

  function handlePickAccount(accountId) {
    showAccountPicker = false;
    createSession(accountId);
    if (window.innerWidth < 1024) {
      sidebarOpen.set(false);
    }
  }

  function truncateId(id) {
    if (!id) return '';
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  function startRename(sessionId, currentTitle) {
    renamingId = sessionId;
    renameValue = currentTitle || 'New Session';
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim());
    }
    renamingId = null;
    renameValue = '';
  }

  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  function handleRenameKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  }

  function handleSessionContext(e, sessionId) {
    e.preventDefault();
    taggerSessionId = sessionId;
    taggerX = e.clientX;
    taggerY = e.clientY;
  }

  // Switch to files tab when a file is opened
  $effect(() => {
    if ($activeFilePath) {
      activeTab = 'files';
    }
  });

  // Close picker when clicking outside
  function handleSidebarClick(e) {
    if (showAccountPicker && !e.target.closest('.sidebar-footer')) {
      showAccountPicker = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar" class:open={$sidebarOpen} onclick={handleSidebarClick}>
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
    <button
      class="sidebar-tab"
      class:active={activeTab === 'projects'}
      onclick={() => activeTab = 'projects'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 17 12 22 22 17"></polyline>
        <polyline points="2 12 12 17 22 12"></polyline>
      </svg>
      Board
    </button>
  </div>

  <!-- Tab content -->
  <div class="sidebar-content">
    {#if activeTab === 'sessions'}
      <div class="session-search">
        <svg class="session-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          class="session-search-input"
          type="text"
          placeholder="Search titles & content..."
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="session-search-clear" onclick={() => searchQuery = ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      </div>

      <div class="session-list">
        {#each grouped as group}
          <div class="session-group-label">{group.label}</div>
          {#each group.sessions as session (session.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="session-item"
              class:active={$activeSessionId === session.id}
              onclick={() => { if (renamingId !== session.id) handleSessionClick(session.id); }}
              ondblclick={() => startRename(session.id, session.title)}
              oncontextmenu={(e) => handleSessionContext(e, session.id)}
              title={renamingId === session.id ? '' : (session.title || 'Untitled')}
            >
              {#if hasMultipleAccounts && accountColor(session.accountId)}
                <span class="session-account-dot" style="background: {accountColor(session.accountId)}"></span>
              {/if}
              {#if renamingId === session.id}
                <input
                  class="session-rename-input"
                  type="text"
                  bind:value={renameValue}
                  onkeydown={handleRenameKeydown}
                  onblur={commitRename}
                  onclick={e => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <span class="session-item-text">{session.title || 'Untitled'}</span>
              {/if}
              {#if session.isProcessing}
                <span class="session-processing-dot"></span>
              {/if}
              {#if renamingId !== session.id}
                {#if searchMatchMap && searchMatchMap.get(session.id) === 'content'}
                  <span class="session-match-badge content">in chat</span>
                {:else if searchMatchMap && searchMatchMap.get(session.id) === 'both'}
                  <span class="session-match-badge both">title + chat</span>
                {:else}
                  <span class="session-id">{truncateId(session.id)}</span>
                {/if}
              {/if}
            </div>
          {/each}
        {/each}

        {#if filteredSessions.length === 0 && $sessions.length > 0}
          <div class="session-empty">No matching sessions</div>
        {:else if $sessions.length === 0}
          <div class="session-empty">No sessions yet</div>
        {/if}
      </div>
    {:else if activeTab === 'files'}
      <FileTree />
    {:else if activeTab === 'projects'}
      <ProjectsPanel />
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
      {#if hasMultipleAccounts}
        <svg class="chevron" class:open={showAccountPicker} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      {/if}
    </button>

    {#if showAccountPicker}
      <div class="account-picker">
        <div class="account-picker-label">Select account</div>
        {#each accounts as account, i}
          <button class="account-option" onclick={() => handlePickAccount(account.id)}>
            <span class="account-dot" style="background: {ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}"></span>
            <span class="account-email">{account.email || account.id}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {#if taggerSessionId}
    <SessionTagger
      sessionId={taggerSessionId}
      x={taggerX}
      y={taggerY}
      onClose={() => taggerSessionId = null}
    />
  {/if}
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

  /* Desktop: collapse/expand */
  @media (min-width: 1024px) {
    .sidebar {
      position: relative;
      transition: width 0.2s ease, opacity 0.2s ease;
    }
    .sidebar:not(.open) {
      width: 0;
      border-right: none;
      opacity: 0;
      pointer-events: none;
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
    overflow-x: auto;
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

  .sidebar-content::-webkit-scrollbar-corner {
    background: transparent;
  }

  /* Session search */
  .session-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 8px 4px;
    padding: 6px 10px;
    background: #262522;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    flex-shrink: 0;
  }

  .session-search:focus-within {
    border-color: rgba(218, 119, 86, 0.3);
  }

  .session-search-icon {
    color: #6b6760;
    flex-shrink: 0;
  }

  .session-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #d4d0c8;
    font-family: inherit;
    font-size: 12px;
    min-width: 0;
  }

  .session-search-input::placeholder {
    color: #5a5650;
  }

  .session-search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    color: #6b6760;
    cursor: pointer;
    padding: 0;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .session-search-clear:hover {
    color: #d4d0c8;
    background: rgba(255, 255, 255, 0.06);
  }

  .session-list {
    padding: 2px 8px;
  }

  /* Session rename */
  .session-rename-input {
    flex: 1;
    background: #1e1d1a;
    border: 1px solid rgba(218, 119, 86, 0.4);
    border-radius: 4px;
    color: #d4d0c8;
    font-family: inherit;
    font-size: 13px;
    padding: 2px 6px;
    outline: none;
    min-width: 0;
  }

  .session-rename-input:focus {
    border-color: #da7756;
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
    transition: background 0.15s, color 0.15s, transform 0.15s;
    user-select: none;
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

  .session-match-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .session-match-badge.content {
    color: #5b9fd6;
    background: rgba(91, 159, 214, 0.12);
  }

  .session-match-badge.both {
    color: #57ab5a;
    background: rgba(87, 171, 90, 0.12);
  }

  .session-empty {
    padding: 24px 16px;
    font-size: 13px;
    color: #6b6760;
    text-align: center;
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

  .new-session-btn .chevron {
    margin-left: auto;
    transition: transform 0.15s;
    opacity: 0.6;
  }

  .new-session-btn .chevron.open {
    transform: rotate(180deg);
  }

  /* Account dot on session items */
  .session-account-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Account picker */
  .account-picker {
    padding: 4px 0;
    margin-top: 4px;
    background: #262522;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
  }

  .account-picker-label {
    padding: 6px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: #6b6760;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .account-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: #b0ab9f;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .account-option:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #d4d0c8;
  }

  .account-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .account-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
