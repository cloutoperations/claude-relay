<script>
  import { sessionList as sessions, activeSessionId, leaveSession, createSession, renameSession, switchSession, sessionSearchResults, sessionSearchQuery, searchSeq as storeSearchSeq } from '../../stores/sessions.svelte.js';
  import { sidebarOpen, chatSearchQuery, activeSidebarTab } from '../../stores/ui.svelte.js';
  import { openPopup } from '../../stores/popups.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { projectInfo } from '../../stores/chat.svelte.js';
  import { send } from '../../stores/ws.svelte.js';
  import FileTree from '../files/FileTree.svelte';
  import SessionTagger from '../board/SessionTagger.svelte';
  import { activeFilePath } from '../../stores/files.svelte.js';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let { projectName = 'Claude Relay' } = $props();

  let activeTab = $derived(activeSidebarTab.value);
  let showAccountPicker = $state(false);
  let pickerAnchorEl = $state(null);
  let searchQuery = $state('');
  let searchResults = $derived(sessionSearchResults.value); // from server via session-router
  let searchDebounce = null;
  let renamingId = $state(null);
  let renameValue = $state('');
  let taggerSessionId = $state(null);
  let taggerX = $state(0);
  let taggerY = $state(0);

  let accounts = $derived(projectInfo.accounts || []);
  let hasMultipleAccounts = $derived(accounts.length > 1);

  // Send search to server on query change
  $effect(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
    const q = searchQuery.trim();
    chatSearchQuery.value = q; // sync to shared store for SearchTimeline
    if (!q) {
      sessionSearchResults.value = null;
      sessionSearchQuery.value = '';
      return;
    }
    // Clear stale results immediately so user sees "searching..." not old results
    sessionSearchResults.value = null;
    searchDebounce = setTimeout(() => {
      storeSearchSeq.value++;
      sessionSearchQuery.value = q;
      send({ type: 'search_sessions', query: q, _searchSeq: storeSearchSeq.value });
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

  let searchPending = $derived(!!searchQuery.trim() && !searchResults);

  let filteredSessions = $derived.by(() => {
    if (!searchQuery.trim()) return sessions;
    if (!searchMatchMap) return []; // waiting for server — show empty, not all sessions
    const matched = sessions.filter(s => searchMatchMap.has(s.id));
    // Include archived results from _old_versions that aren't in active sessions
    const seenIds = new Set(sessions.map(s => s.id));
    if (searchResults) {
      for (const r of searchResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          matched.push({ id: r.id, title: r.title, lastActivity: r.lastActivity, isProcessing: false, archived: true, crossProject: r.crossProject || null });
        }
      }
    }
    return matched;
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
    const session = sessions.find(s => s.id === sessionId);
    openTab(sessionId, session?.title || 'Session');
    if (window.innerWidth < 1024) {
      sidebarOpen.value = false;
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
      sidebarOpen.value = false;
    }
  }

  function handlePickAccount(accountId) {
    showAccountPicker = false;
    createSession(accountId);
    if (window.innerWidth < 1024) {
      sidebarOpen.value = false;
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
    if (activeFilePath.value) {
      activeSidebarTab.value = 'files';
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
<aside class="sidebar" class:open={sidebarOpen.value} onclick={handleSidebarClick}>
  <!-- Header -->
  <div class="sidebar-header">
    <button class="sidebar-logo" onclick={() => {}}>
      <span class="logo-text">{projectName}</span>
    </button>
    <button class="sidebar-toggle" onclick={() => sidebarOpen.value = false} title="Close sidebar">
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
      onclick={() => activeSidebarTab.value = 'sessions'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      Sessions
    </button>
    <button
      class="sidebar-tab"
      class:active={activeTab === 'files'}
      onclick={() => activeSidebarTab.value = 'files'}
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
              class:active={activeSessionId.value === session.id}
              onclick={() => { if (renamingId !== session.id) handleSessionClick(session.id); }}
              ondblclick={(e) => { e.preventDefault(); startRename(session.id, session.title); }}
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
                {#if session.crossProject}
                  <span class="session-match-badge cross-project">{session.crossProject}</span>
                {:else if session.archived}
                  <span class="session-match-badge archived">archived</span>
                {:else if searchMatchMap && searchMatchMap.get(session.id) === 'content'}
                  <span class="session-match-badge content">in chat</span>
                {:else if searchMatchMap && searchMatchMap.get(session.id) === 'both'}
                  <span class="session-match-badge both">title + chat</span>
                {:else if session.projectPath}
                  <span class="session-area-tag">{session.projectPath.split('/')[0]}</span>
                {:else}
                  <span class="session-id">{truncateId(session.id)}</span>
                {/if}
              {/if}
            </div>
          {/each}
        {/each}

        {#if filteredSessions.length === 0 && sessions.length > 0}
          <div class="session-empty">No matching sessions</div>
        {:else if sessions.length === 0}
          <div class="session-empty">No sessions yet</div>
        {/if}
      </div>
    {:else if activeTab === 'files'}
      <FileTree />
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
{#if sidebarOpen.value}
  <div class="sidebar-overlay" onclick={() => sidebarOpen.value = false} role="presentation"></div>
{/if}

<style>
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--code-bg);
    border-right: 1px solid rgba(var(--overlay-rgb), 0.06);
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
    background: rgba(var(--shadow-rgb), 0.6);
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
    color: var(--text-muted);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s;
    font-family: inherit;
  }

  .sidebar-logo:hover {
    color: var(--text);
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
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
    padding: 0;
  }

  .sidebar-toggle:hover {
    background: var(--border-subtle);
    color: var(--text);
  }

  /* Tabs */
  .sidebar-tabs {
    display: flex;
    padding: 0 8px;
    gap: 2px;
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.06);
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
    color: var(--text-muted);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }

  .sidebar-tab:hover {
    color: var(--text-secondary);
  }

  .sidebar-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
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
    background: rgba(var(--overlay-rgb), 0.1);
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
    background: var(--sidebar-bg);
    border: 1px solid rgba(var(--overlay-rgb), 0.06);
    border-radius: 8px;
    flex-shrink: 0;
  }

  .session-search:focus-within {
    border-color: var(--accent-30);
  }

  .session-search-icon {
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .session-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: 12px;
    min-width: 0;
  }

  .session-search-input::placeholder {
    color: var(--text-dimmer);
  }

  .session-search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .session-search-clear:hover {
    color: var(--text);
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .session-list {
    padding: 2px 8px;
  }

  /* Session rename */
  .session-rename-input {
    flex: 1;
    background: var(--code-bg);
    border: 1px solid var(--accent-40);
    border-radius: 4px;
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    padding: 2px 6px;
    outline: none;
    min-width: 0;
  }

  .session-rename-input:focus {
    border-color: var(--accent);
  }

  .session-group-label {
    padding: 10px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dimmer);
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
    color: var(--text-secondary);
    background: none;
    transition: background 0.15s, color 0.15s, transform 0.15s;
    user-select: none;
  }

  .session-item:hover {
    background: var(--border-subtle);
    color: var(--text);
    transform: translateX(3px);
  }

  .session-item.active {
    background: var(--accent-12);
    color: var(--text);
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
    background: var(--accent);
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
    color: var(--text-dimmer);
    font-family: 'SF Mono', Menlo, Monaco, monospace;
    flex-shrink: 0;
  }

  .session-area-tag {
    font-size: 9px;
    color: var(--text-muted);
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    color: var(--success);
    background: var(--success-12);
  }

  .session-match-badge.archived {
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .session-match-badge.cross-project {
    color: #c084fc;
    background: rgba(192, 132, 252, 0.12);
  }

  .session-empty {
    padding: 24px 16px;
    font-size: 13px;
    color: var(--text-dimmer);
    text-align: center;
    font-style: italic;
  }

  /* Footer */
  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.06);
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
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .new-session-btn:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
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
    background: var(--sidebar-bg);
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px;
  }

  .account-picker-label {
    padding: 6px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
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
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .account-option:hover {
    background: rgba(var(--overlay-rgb), 0.05);
    color: var(--text);
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
