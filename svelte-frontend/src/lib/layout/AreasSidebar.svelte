<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard } from '../../stores/board.svelte.js';
  import { sidebarOpen, chatSearchQuery } from '../../stores/ui.svelte.js';
  import { wsState } from '../../stores/ws.svelte.js';
  import { createSession, sessionList as sessions, searchSessions, sessionSearchQuery, sessionSearchResults } from '../../stores/sessions.svelte.js';
  import { projectInfo, clientCount } from '../../stores/chat.svelte.js';
  import { themeMode, getCurrentVariant, setThemeMode } from '../../stores/theme.svelte.js';
  import { openPopup } from '../../stores/popups.svelte.js';
  import { openTab } from '../../stores/tabs.svelte.js';
  import { addTabToPane, onTabClosed, findPaneForTab, switchPaneTab, activePaneId } from '../../stores/panes.svelte.js';


  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';
  import SessionBubble from '../board/SessionBubble.svelte';
  import SessionTagger from '../board/SessionTagger.svelte';
  import FileTree from '../files/FileTree.svelte';
  import { searchFiles, fileSearchResults, fileSearchQuery, openFile } from '../../stores/files.svelte.js';

  const ACCOUNT_COLORS = ['#da7756', '#5b9fd6', '#57ab5a', '#c084fc', '#f59e0b', '#ec4899'];

  let accounts = $derived(projectInfo.accounts || []);
  let hasMultipleAccounts = $derived(accounts.length > 1);
  let showAccountPicker = $state(false);

  // Theme
  function cycleThemeMode() {
    const m = themeMode.value;
    if (m === 'auto') setThemeMode('claude-light');
    else if (m === 'claude-light') setThemeMode('claude');
    else setThemeMode('auto');
  }
  let themeIcon = $derived(getCurrentVariant() === 'light' ? 'sun' : 'moon');
  let themeTitle = $derived.by(() => {
    const m = themeMode.value;
    if (m === 'auto') return 'Theme: Auto (OS)';
    if (m === 'claude-light') return 'Theme: Light';
    return 'Theme: Dark';
  });

  // Sessions section
  let sessionsExpanded = $state(false);
  let sessionQuery = $state('');

  function handleSessionSearch(e) {
    sessionQuery = e.target.value;
    searchSessions(sessionQuery);
    chatSearchQuery.value = sessionQuery.trim();
  }

  // Filtered session list: search results or all sessions sorted by recent
  let displayedSessions = $derived.by(() => {
    const all = sessions || [];
    if (!sessionQuery.trim()) {
      return [...all].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    }
    const results = sessionSearchResults.value;
    if (!results) return []; // searching...
    const matchIds = new Set(results.map(r => r.id));
    const matchTypes = new Map(results.map(r => [r.id, r.matchType]));
    return all
      .filter(s => matchIds.has(s.id))
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
      .map(s => ({ ...s, matchType: matchTypes.get(s.id) }));
  });

  let sessionSearchPending = $derived(!!sessionQuery.trim() && !sessionSearchResults.value);

  // File search state
  let fileQuery = $state('');

  function handleFileSearch(e) {
    fileQuery = e.target.value;
    searchFiles(fileQuery);
  }

  // Files section collapsed state
  let filesExpanded = $state(false);

  // Tagger
  let taggerSessionId = $state(null);
  let taggerX = $state(0);
  let taggerY = $state(0);

  // Area collapse state (persisted)
  let collapsedAreas = $state((() => {
    try {
      const saved = localStorage.getItem('claude-relay-collapsed-areas');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  })());

  function persistCollapsed() {
    try { localStorage.setItem('claude-relay-collapsed-areas', JSON.stringify([...collapsedAreas])); } catch {}
  }

  function toggleAreaCollapse(name) {
    if (collapsedAreas.has(name)) {
      collapsedAreas.delete(name);
    } else {
      collapsedAreas.add(name);
    }
    collapsedAreas = new Set(collapsedAreas); // trigger reactivity
    persistCollapsed();
  }

  onMount(() => {
    if (!boardData.value) fetchBoard();
  });

  // Sort areas by weight
  let sortedAreas = $derived.by(() => {
    if (!boardData.value) return [];
    return [...boardData.value.areas].sort((a, b) => areaWeight(b) - areaWeight(a));
  });

  function areaWeight(area) {
    let sessionCount = (area.areaSessions?.length || 0);
    let processingCount = (area.areaSessions?.filter(s => s.isProcessing).length || 0);
    for (const p of area.projects) {
      sessionCount += p.sessions.length;
      processingCount += p.sessions.filter(s => s.isProcessing).length;
      for (const sub of p.subProjects) {
        if (sub.sessions) {
          sessionCount += sub.sessions.length;
          processingCount += sub.sessions.filter(s => s.isProcessing).length;
        }
      }
    }
    return area.projects.length * 2
      + sessionCount * 3
      + processingCount * 5
      + (processingCount > 0 ? 2 : 0)
      + ((area.presentState || area.desiredState) ? 1 : 0);
  }

  function getAreaSessions(area) {
    const sessions = [];
    if (area.areaSessions) {
      for (const s of area.areaSessions) sessions.push({ ...s, projectName: area.name });
    }
    for (const p of area.projects) {
      for (const s of p.sessions) sessions.push({ ...s, projectName: p.name });
      for (const sub of p.subProjects) {
        if (sub.sessions) {
          for (const s of sub.sessions) sessions.push({ ...s, projectName: sub.name || sub });
        }
      }
    }
    return sessions;
  }

  function getAreaSessionCount(area) {
    return getAreaSessions(area).length;
  }

  function getAreaProcessingCount(area) {
    return getAreaSessions(area).filter(s => s.isProcessing).length;
  }

  function formatAreaName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function openAreaTab(areaName) {
    const tabId = AREA_PREFIX + areaName;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
    hoverPanelVisible = false;
  }

  function openProjectTab(projectPath) {
    const tabId = PROJECT_PREFIX + projectPath;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
    hoverPanelVisible = false;
  }

  function handleContextMenu(e, sessionId) {
    e.preventDefault();
    e.stopPropagation();
    taggerSessionId = sessionId;
    taggerX = e.clientX;
    taggerY = e.clientY;
  }

  function handleNewSession() {
    if (hasMultipleAccounts) {
      showAccountPicker = !showAccountPicker;
      return;
    }
    createSession();
    if (window.innerWidth < 1024) sidebarOpen.value = false;
  }

  function handlePickAccount(accountId) {
    showAccountPicker = false;
    createSession(accountId);
    if (window.innerWidth < 1024) sidebarOpen.value = false;
  }

  // Hover panel state
  let hoveredArea = $state(null);
  let hoverPanelVisible = $state(false);
  let showTimer = $state(null);
  let hideTimer = $state(null);
  let hoveredAreaEl = $state(null);

  function onAreaMouseEnter(e, area) {
    // Dismiss project panel
    if (projectPanelVisible) {
      projectPanelVisible = false;
      hoveredProject = null;
      hoveredProjectArea = null;
    }
    if (projectShowTimer) { clearTimeout(projectShowTimer); projectShowTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hoveredArea = area;
    hoveredAreaEl = e.currentTarget;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      hoverPanelVisible = true;
    }, 200);
  }

  function onAreaMouseLeave() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    hideTimer = setTimeout(() => {
      hoverPanelVisible = false;
      hoveredArea = null;
    }, 400);
  }

  function onPanelMouseEnter() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function onPanelMouseLeave() {
    hideTimer = setTimeout(() => {
      hoverPanelVisible = false;
      hoveredArea = null;
    }, 400);
  }

  // Hover panel position
  let panelTop = $derived.by(() => {
    if (!hoveredAreaEl || !hoverPanelVisible) return 0;
    const rect = hoveredAreaEl.getBoundingClientRect();
    const maxTop = window.innerHeight - 400; // rough panel height
    return Math.min(rect.top, Math.max(0, maxTop));
  });

  // Hover panel: expanded projects
  let expandedHoverProjects = $state(new Set());

  function toggleHoverProject(path) {
    if (expandedHoverProjects.has(path)) {
      expandedHoverProjects.delete(path);
    } else {
      expandedHoverProjects.add(path);
    }
    expandedHoverProjects = new Set(expandedHoverProjects);
  }

  function expandHoverProject(path) {
    if (!expandedHoverProjects.has(path)) {
      expandedHoverProjects.add(path);
      expandedHoverProjects = new Set(expandedHoverProjects);
    }
  }

  // Reset expanded projects when hovering a different area
  $effect(() => {
    if (hoveredArea) {
      expandedHoverProjects = new Set();
    }
  });

  // --- Project hover panel state ---
  let hoveredProject = $state(null);
  let hoveredProjectArea = $state(null);
  let projectPanelVisible = $state(false);
  let projectShowTimer = $state(null);
  let projectHideTimer = $state(null);
  let hoveredProjectEl = $state(null);

  function onProjectMouseEnter(e, proj, area) {
    // Dismiss area panel and cancel its timers
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    hoverPanelVisible = false;
    hoveredArea = null;
    if (projectHideTimer) { clearTimeout(projectHideTimer); projectHideTimer = null; }
    hoveredProject = proj;
    hoveredProjectArea = area;
    hoveredProjectEl = e.currentTarget;
    if (projectShowTimer) clearTimeout(projectShowTimer);
    projectShowTimer = setTimeout(() => {
      projectPanelVisible = true;
    }, 200);
  }

  function onProjectMouseLeave(e) {
    if (projectShowTimer) { clearTimeout(projectShowTimer); projectShowTimer = null; }
    projectHideTimer = setTimeout(() => {
      projectPanelVisible = false;
      hoveredProject = null;
      hoveredProjectArea = null;
    }, 400);
    // If mouse moved back into the area card (not into the project panel),
    // restart the area hover so the area panel can reappear
    const related = e.relatedTarget;
    if (related && related.closest && related.closest('.area-card') && !related.closest('.hover-panel')) {
      const areaCard = related.closest('.area-card');
      if (hoveredProjectArea && !hideTimer) {
        hoveredArea = hoveredProjectArea;
        hoveredAreaEl = areaCard;
        showTimer = setTimeout(() => {
          hoverPanelVisible = true;
        }, 300);
      }
    }
  }

  function onProjectPanelMouseEnter() {
    if (projectHideTimer) { clearTimeout(projectHideTimer); projectHideTimer = null; }
  }

  function onProjectPanelMouseLeave() {
    projectHideTimer = setTimeout(() => {
      projectPanelVisible = false;
      hoveredProject = null;
      hoveredProjectArea = null;
    }, 400);
  }

  let projectPanelTop = $derived.by(() => {
    if (!hoveredProjectEl || !projectPanelVisible) return 0;
    const rect = hoveredProjectEl.getBoundingClientRect();
    const maxTop = window.innerHeight - 350;
    return Math.min(rect.top, Math.max(0, maxTop));
  });

  function getProjectSessions(proj) {
    const sessions = [...proj.sessions];
    for (const sub of (proj.subProjects || [])) {
      if (sub.sessions) sessions.push(...sub.sessions);
    }
    return sessions;
  }

  let hoveredProjectSessions = $derived(hoveredProject ? getProjectSessions(hoveredProject) : []);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar" class:open={sidebarOpen.value}>
  <!-- Sidebar header with collapse button -->
  <div class="sidebar-header">
    <button class="collapse-btn" onclick={() => sidebarOpen.value = false} title="Collapse sidebar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <polyline points="14 9 11 12 14 15"/>
      </svg>
    </button>
  </div>
  <!-- Areas section -->
  <div class="areas-section">
    {#if boardLoading.value && !boardData.value}
      <div class="areas-loading">
        <div class="areas-spinner"></div>
        <span>Loading areas...</span>
      </div>
    {:else if boardData.value}
      {#each sortedAreas as area (area.name)}
        {@const sessionCount = getAreaSessionCount(area)}
        {@const processingCount = getAreaProcessingCount(area)}
        {@const allSessions = getAreaSessions(area)}
        {@const isCollapsed = collapsedAreas.has(area.name)}
        <div
          class="area-card"
          class:has-processing={processingCount > 0}
          onmouseenter={(e) => onAreaMouseEnter(e, area)}
          onmouseleave={onAreaMouseLeave}
        >
          <!-- Area header row -->
          <div class="area-header">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="area-name clickable" onclick={(e) => { e.stopPropagation(); openAreaTab(area.name); }}>{formatAreaName(area.name)}</span>
            <div class="area-meta" onclick={() => toggleAreaCollapse(area.name)} role="button" tabindex="0">
              {#if processingCount > 0}
                <span class="meta-badge active">{processingCount}</span>
              {/if}
              <span class="meta-badge">{sessionCount}</span>
              <div class="area-dots">
                {#each allSessions.slice(0, 6) as session (session.id)}
                  <SessionBubble {session} size="sm" onContextMenu={handleContextMenu} />
                {/each}
                {#if allSessions.length > 6}
                  <span class="dots-overflow">+{allSessions.length - 6}</span>
                {/if}
              </div>
            </div>
          </div>

          <!-- Projects (collapsible) -->
          {#if !isCollapsed}
            <div class="area-projects">
              {#each area.projects as proj (proj.path)}
                {@const projSessions = [...proj.sessions, ...proj.subProjects.flatMap(s => s.sessions || [])]}
                {#if projSessions.length > 0}
                  <div class="project-row" onmouseenter={(e) => onProjectMouseEnter(e, proj, area)} onmouseleave={onProjectMouseLeave}>
                    <span class="project-name clickable" onclick={(e) => { e.stopPropagation(); openProjectTab(proj.path); }}>{proj.name}</span>
                    <div class="project-dots">
                      {#each projSessions.slice(0, 4) as session (session.id)}
                        <SessionBubble {session} size="sm" onContextMenu={handleContextMenu} />
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Sessions section (collapsible) -->
  <div class="collapse-section" class:expanded={sessionsExpanded}>
    <button class="collapse-header" onclick={() => sessionsExpanded = !sessionsExpanded}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={sessionsExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>SESSIONS</span>
      <span class="collapse-count">{sessions?.length || 0}</span>
    </button>
    {#if sessionsExpanded}
      <div class="collapse-body">
        <div class="section-search">
          <svg class="section-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            class="section-search-input"
            placeholder="Search sessions..."
            value={sessionQuery}
            oninput={handleSessionSearch}
          />
          {#if sessionQuery}
            <button class="section-search-clear" onclick={() => { sessionQuery = ''; searchSessions(''); chatSearchQuery.value = ''; }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          {/if}
        </div>
        {#if sessionSearchPending}
          <div class="section-status">Searching...</div>
        {:else if sessionQuery.trim() && displayedSessions.length === 0}
          <div class="section-status">No sessions found</div>
        {:else}
          <div class="sessions-list">
            {#each displayedSessions.slice(0, 50) as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="session-item"
                class:processing={session.isProcessing}
                onclick={(e) => {
                  if (e.shiftKey) {
                    openPopup(session.id, session.title || 'Session');
                  } else {
                    openTab(session.id, session.title || 'Session');
                  }
                }}
                oncontextmenu={(e) => handleContextMenu(e, session.id)}
              >
                <span class="session-dot" class:processing={session.isProcessing}></span>
                <span class="session-title">{session.title || 'Untitled'}</span>
                {#if session.matchType}
                  <span class="session-match-badge">{session.matchType === 'both' ? 'title + chat' : session.matchType === 'content' ? 'in chat' : 'title'}</span>
                {/if}
                {#if session.isProcessing}
                  <span class="session-processing-badge">active</span>
                {/if}
              </div>
            {/each}
            {#if displayedSessions.length > 50}
              <div class="section-status">{displayedSessions.length - 50} more...</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Files section (collapsible) -->
  <div class="collapse-section" class:expanded={filesExpanded}>
    <button class="collapse-header" onclick={() => filesExpanded = !filesExpanded}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={filesExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>FILES</span>
    </button>
    {#if filesExpanded}
      <div class="collapse-body">
        <div class="section-search">
          <svg class="section-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            class="section-search-input"
            placeholder="Search files..."
            value={fileQuery}
            oninput={handleFileSearch}
          />
          {#if fileQuery}
            <button class="section-search-clear" onclick={() => { fileQuery = ''; searchFiles(''); }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          {/if}
        </div>
        {#if fileQuery.trim() && fileSearchResults.value.length > 0}
          <div class="file-results">
            {#each fileSearchResults.value.slice(0, 30) as result (result.path || result.name)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="file-result-item" onclick={() => { openFile(result.path); fileQuery = ''; searchFiles(''); }}>
                <span class="file-result-name">{result.name}</span>
                <span class="file-result-dir">{result.path.split('/').slice(0, -1).join('/')}</span>
              </div>
            {/each}
          </div>
        {:else if fileQuery.trim() && fileSearchResults.value.length === 0}
          <div class="section-status">No files found</div>
        {:else}
          <div class="files-tree">
            <FileTree />
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="sidebar-footer">
    <div class="sidebar-status">
      <span class="connection-status" class:connected={wsState.connected} title={wsState.connected ? 'Connected' : 'Disconnected'}>
        <span class="status-dot"></span>
        <span class="status-label">{wsState.connected ? 'Connected' : 'Offline'}</span>
      </span>
      {#if clientCount.count > 1}
        <span class="client-count" title="{clientCount.count} clients connected">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          {clientCount.count}
        </span>
      {/if}
      <button class="status-btn" onclick={cycleThemeMode} title={themeTitle}>
        {#if themeIcon === 'sun'}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {/if}
        {#if themeMode.value === 'auto'}
          <span class="theme-auto-badge">A</span>
        {/if}
      </button>
    </div>
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

<!-- Hover panel -->
{#if hoverPanelVisible && hoveredArea}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hover-panel"
    style="top: {panelTop}px; left: {sidebarOpen.value ? 328 : 56}px"
    onmouseenter={onPanelMouseEnter}
    onmouseleave={onPanelMouseLeave}
  >
    <div class="hp-header">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="hp-area-name clickable" onclick={() => openAreaTab(hoveredArea.name)}>{formatAreaName(hoveredArea.name)}</span>
      <span class="hp-count">{getAreaSessionCount(hoveredArea)} sessions</span>
    </div>

    <!-- TOTE bar -->
    {#if hoveredArea.presentState || hoveredArea.desiredState}
      {@const hpSessions = getAreaSessions(hoveredArea)}
      {@const hpTotal = hpSessions.length || 1}
      {@const hpProcessing = hpSessions.filter(s => s.isProcessing).length}
      <div class="hp-tote">
        <div class="hp-tote-bar">
          <div class="hp-tote-fill" style="width: {Math.min(100, Math.round((hpProcessing / hpTotal) * 100 + (hoveredArea.presentState ? 30 : 0)))}%"></div>
        </div>
      </div>

      {#if hoveredArea.presentState}
        <div class="hp-state">
          <span class="hp-state-label">Present:</span>
          <span class="hp-state-text">{hoveredArea.presentState}</span>
        </div>
      {/if}
      {#if hoveredArea.desiredState}
        <div class="hp-state">
          <span class="hp-state-label">Desired:</span>
          <span class="hp-state-text">{hoveredArea.desiredState}</span>
        </div>
      {/if}
    {/if}

    <!-- Projects -->
    <div class="hp-section-label">Projects</div>
    {#each hoveredArea.projects as proj (proj.path)}
      {@const projSessions = [...proj.sessions, ...proj.subProjects.flatMap(s => s.sessions || [])]}
      {@const isExpanded = expandedHoverProjects.has(proj.path)}
      <div class="hp-project">
        {#if projSessions.length > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="hp-project-row" onclick={() => toggleHoverProject(proj.path)} onmouseenter={() => expandHoverProject(proj.path)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="hp-chevron" class:open={isExpanded}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span class="hp-project-name clickable" onclick={(e) => { e.stopPropagation(); openProjectTab(proj.path); }}>{proj.name}</span>
            <span class="hp-project-count">{projSessions.length}</span>
          </div>
          {#if isExpanded}
            <div class="hp-sessions">
              {#each projSessions.slice(0, 4) as session (session.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="hp-session"
                  onclick={(e) => {
                    if (e.shiftKey) {
                      openTab(session.id, session.title || 'Session');
                    } else {
                      openPopup(session.id, session.title || 'Session');
                    }
                    hoverPanelVisible = false;
                  }}
                  oncontextmenu={(e) => handleContextMenu(e, session.id)}
                >
                  <span class="hp-session-dot" class:processing={session.isProcessing}></span>
                  <span class="hp-session-title">{session.title || 'Untitled'}</span>
                  <span class="hp-session-status">{session.isProcessing ? 'processing' : 'idle'}</span>
                </div>
              {/each}
              {#if projSessions.length > 4}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="hp-more" onclick={() => openAreaTab(hoveredArea.name)}>+{projSessions.length - 4} more</div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="hp-project-row dimmed" onclick={() => openProjectTab(proj.path)}>
            <span class="hp-project-name">{proj.name}</span>
            <span class="hp-project-count">0</span>
          </div>
        {/if}
      </div>
    {/each}

    <!-- Area-level sessions -->
    {#if hoveredArea.areaSessions?.length > 0}
      <div class="hp-section-label">Area Sessions</div>
      {#each hoveredArea.areaSessions as session (session.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="hp-session"
          onclick={(e) => {
            if (e.shiftKey) {
              openTab(session.id, session.title || 'Session');
            } else {
              openPopup(session.id, session.title || 'Session');
            }
            hoverPanelVisible = false;
          }}
          oncontextmenu={(e) => handleContextMenu(e, session.id)}
        >
          <span class="hp-session-dot" class:processing={session.isProcessing}></span>
          <span class="hp-session-title">{session.title || 'Untitled'}</span>
          <span class="hp-session-status">{session.isProcessing ? 'processing' : 'idle'}</span>
        </div>
      {/each}
    {/if}

    <!-- New session button -->
    <button class="hp-new-session" onclick={() => { createSession(); hoverPanelVisible = false; }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      New Session in {formatAreaName(hoveredArea.name)}
    </button>
  </div>
{/if}

<!-- Project hover panel -->
{#if projectPanelVisible && hoveredProject}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hover-panel"
    style="top: {projectPanelTop}px; left: {sidebarOpen.value ? 328 : 56}px"
    onmouseenter={onProjectPanelMouseEnter}
    onmouseleave={onProjectPanelMouseLeave}
  >
    <div class="hp-header">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="hp-area-name clickable" onclick={() => openProjectTab(hoveredProject.path)}>{formatAreaName(hoveredProject.name)}</span>
      <span class="hp-count">{hoveredProjectSessions.length} sessions</span>
    </div>

    <!-- Breadcrumb -->
    {#if hoveredProjectArea}
      <div class="hp-breadcrumb">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="hp-crumb clickable" onclick={() => { projectPanelVisible = false; openAreaTab(hoveredProjectArea.name); }}>{formatAreaName(hoveredProjectArea.name)}</span>
        <span class="hp-crumb-sep">/</span>
        <span class="hp-crumb current">{hoveredProject.name}</span>
      </div>
    {/if}

    <!-- Sub-projects -->
    {#if hoveredProject.subProjects?.length > 0}
      <div class="hp-section-label">Sub-projects ({hoveredProject.subProjects.length})</div>
      {#each hoveredProject.subProjects as sub (sub.path || sub.name || sub)}
        <div class="hp-project">
          <div class="hp-project-row dimmed">
            <span class="hp-project-name">{sub.name || sub}</span>
            {#if sub.sessions?.length > 0}
              <span class="hp-project-count">{sub.sessions.length}</span>
            {/if}
          </div>
          {#if sub.sessions?.length > 0}
            <div class="hp-sessions">
              {#each sub.sessions.slice(0, 3) as session (session.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="hp-session"
                  onclick={(e) => {
                    if (e.shiftKey) { openTab(session.id, session.title || 'Session'); }
                    else { openPopup(session.id, session.title || 'Session'); }
                    projectPanelVisible = false;
                  }}
                  oncontextmenu={(e) => handleContextMenu(e, session.id)}
                >
                  <span class="hp-session-dot" class:processing={session.isProcessing}></span>
                  <span class="hp-session-title">{session.title || 'Untitled'}</span>
                  <span class="hp-session-status">{session.isProcessing ? 'processing' : 'idle'}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}

    <!-- Sessions -->
    {#if hoveredProject.sessions?.length > 0}
      <div class="hp-section-label">Sessions ({hoveredProject.sessions.length})</div>
      {#each hoveredProject.sessions.slice(0, 6) as session (session.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="hp-session"
          onclick={(e) => {
            if (e.shiftKey) { openTab(session.id, session.title || 'Session'); }
            else { openPopup(session.id, session.title || 'Session'); }
            projectPanelVisible = false;
          }}
          oncontextmenu={(e) => handleContextMenu(e, session.id)}
        >
          <span class="hp-session-dot" class:processing={session.isProcessing}></span>
          <span class="hp-session-title">{session.title || 'Untitled'}</span>
          <span class="hp-session-status">{session.isProcessing ? 'processing' : 'idle'}</span>
        </div>
      {/each}
      {#if hoveredProject.sessions.length > 6}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="hp-more" onclick={() => openProjectTab(hoveredProject.path)}>+{hoveredProject.sessions.length - 6} more</div>
      {/if}
    {/if}

    <!-- New session + Open detail -->
    <div class="hp-footer-actions">
      <button class="hp-new-session" onclick={() => { createSession(null, true, hoveredProject.path); projectPanelVisible = false; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Session
      </button>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="hp-open-detail clickable" onclick={() => openProjectTab(hoveredProject.path)}>Open Detail →</span>
    </div>
  </div>
{/if}

<!-- Collapsed rail (desktop only, when sidebar closed) -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !sidebarOpen.value}
  <aside class="sidebar-rail">
    <button class="rail-toggle" onclick={() => sidebarOpen.value = true} title="Expand sidebar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
    {#if boardData.value}
      {#each sortedAreas as area (area.name)}
        {@const sessionCount = getAreaSessionCount(area)}
        {@const processingCount = getAreaProcessingCount(area)}
        <div
          class="rail-area"
          class:has-processing={processingCount > 0}
          title="{formatAreaName(area.name)} ({sessionCount})"
          onclick={() => sidebarOpen.value = true}
          onmouseenter={(e) => onAreaMouseEnter(e, area)}
          onmouseleave={onAreaMouseLeave}
        >
          <span class="rail-initial">{area.name.charAt(0).toUpperCase()}</span>
          {#if processingCount > 0}
            <span class="rail-active-dot"></span>
          {/if}
        </div>
      {/each}
    {/if}
    <button class="rail-new" onclick={handleNewSession} title="New Session">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
  </aside>
{/if}

<!-- Mobile overlay -->
{#if sidebarOpen.value}
  <div class="sidebar-overlay" onclick={() => sidebarOpen.value = false} role="presentation"></div>
{/if}

<style>
  .sidebar {
    width: 320px;
    flex-shrink: 0;
    background: var(--code-bg);
    border-right: 1px solid rgba(var(--overlay-rgb), 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 4px 6px 0;
    flex-shrink: 0;
  }

  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .collapse-btn:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

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

  /* Areas section */
  .areas-section {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    scrollbar-width: thin;
  }

  .areas-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-dimmer);
    font-size: 12px;
  }

  .areas-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Area card */
  .area-card {
    padding: 8px 10px;
    border-radius: 8px;
    transition: background 0.12s;
    margin-bottom: 2px;
  }

  .area-card:hover {
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .area-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    gap: 8px;
  }

  .area-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .area-card.has-processing .area-name {
    color: var(--accent);
  }

  .area-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .meta-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 1px 5px;
    border-radius: 8px;
    line-height: 1.4;
  }

  .meta-badge.active {
    color: var(--accent);
    background: var(--accent-12);
  }

  .area-dots {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .dots-overflow {
    font-size: 9px;
    color: var(--text-dimmer);
    margin-left: 1px;
  }

  /* Projects under area */
  .area-projects {
    padding: 4px 0 2px 12px;
  }

  .project-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
    gap: 6px;
  }

  .project-name {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .project-dots {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  /* Collapsible sections (Sessions, Files) */
  .collapse-section {
    flex-shrink: 0;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.06);
  }

  .collapse-section.expanded {
    flex: 0 1 auto;
    min-height: 0;
  }

  .collapse-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    background: none;
    border: none;
    transition: color 0.12s;
  }

  .collapse-header:hover { color: var(--text-muted); }

  .collapse-chevron {
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .collapse-chevron.open { transform: rotate(90deg); }

  .collapse-count {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-dimmer);
    font-weight: 500;
  }

  .collapse-body {
    max-height: 300px;
    overflow-y: auto;
    padding: 0 4px 8px;
    scrollbar-width: thin;
  }

  /* Section search */
  .section-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 6px;
    position: sticky;
    top: 0;
    background: var(--code-bg);
    z-index: 1;
  }

  .section-search-icon {
    flex-shrink: 0;
    color: var(--text-dimmer);
  }

  .section-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-family: inherit;
    font-size: 12px;
    color: var(--text);
    padding: 4px 0;
    min-width: 0;
  }

  .section-search-input::placeholder {
    color: var(--text-dimmer);
  }

  .section-search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    flex-shrink: 0;
  }

  .section-search-clear:hover {
    background: rgba(var(--overlay-rgb), 0.1);
    color: var(--text);
  }

  .section-status {
    font-size: 11px;
    color: var(--text-dimmer);
    padding: 8px 12px;
    font-style: italic;
  }

  /* Session items */
  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .session-item:hover {
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .session-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5b9fd6;
    flex-shrink: 0;
  }

  .session-dot.processing {
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .session-title {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .session-item:hover .session-title { color: var(--text); }

  .session-match-badge {
    font-size: 9px;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.06);
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .session-processing-badge {
    font-size: 9px;
    color: var(--accent);
    flex-shrink: 0;
  }

  /* File search results */
  .file-results {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .file-result-item {
    display: flex;
    flex-direction: column;
    padding: 5px 10px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
    gap: 1px;
  }

  .file-result-item:hover {
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .file-result-name {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .file-result-item:hover .file-result-name { color: var(--text); }

  .file-result-dir {
    font-size: 10px;
    color: var(--text-dimmer);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .files-tree {
    max-height: 280px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* Footer */
  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.06);
    flex-shrink: 0;
  }

  .sidebar-status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 8px;
    font-size: 11px;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-dimmer);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dimmer);
    transition: background 0.3s, box-shadow 0.3s;
  }

  .connection-status.connected .status-dot {
    background: var(--success);
    box-shadow: 0 0 6px var(--success-40);
  }

  .client-count {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .status-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    margin-left: auto;
    position: relative;
    transition: all 0.15s;
  }

  .status-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .theme-auto-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    font-size: 7px;
    font-weight: 700;
    line-height: 1;
    color: var(--accent);
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
    transition: background 0.12s;
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

  /* ─── Hover Panel ─── */
  .hover-panel {
    position: fixed;
    /* left set dynamically via inline style */
    width: 350px;
    max-height: 70vh;
    overflow-y: auto;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(var(--shadow-rgb), 0.25);
    padding: 14px;
    z-index: 200;
    animation: hpSlideIn 0.15s ease-out;
  }

  @keyframes hpSlideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .hp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .hp-area-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }

  .hp-count {
    font-size: 11px;
    color: var(--text-dimmer);
  }

  .hp-tote {
    margin-bottom: 10px;
  }

  .hp-tote-bar {
    height: 6px;
    background: rgba(var(--overlay-rgb), 0.08);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .hp-tote-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .hp-state {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
    line-height: 1.5;
  }

  .hp-state-label {
    font-weight: 600;
    color: var(--text-secondary);
    margin-right: 4px;
  }

  .hp-state-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hp-section-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 12px 0 6px;
    padding-top: 8px;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.06);
  }

  .hp-project {
    margin-bottom: 2px;
  }

  .hp-project-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-project-row:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-project-row.dimmed {
    opacity: 0.4;
    cursor: default;
  }

  .hp-chevron {
    transition: transform 0.15s;
    flex-shrink: 0;
    color: var(--text-dimmer);
  }

  .hp-chevron.open {
    transform: rotate(90deg);
  }

  .hp-project-name {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hp-project-count {
    font-size: 10px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .hp-sessions {
    padding: 2px 0 4px 20px;
  }

  .hp-session {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-session:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-session-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5b9fd6;
    flex-shrink: 0;
  }

  .hp-session-dot.processing {
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .hp-session-title {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hp-session-status {
    font-size: 9px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .hp-more {
    font-size: 10px;
    color: var(--text-dimmer);
    padding: 2px 6px;
    cursor: pointer;
  }

  .hp-more:hover {
    color: var(--accent);
  }

  .hp-new-session {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    margin-top: 12px;
    border-radius: 8px;
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .hp-new-session:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .hp-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }

  .hp-crumb {
    font-size: 11px;
    color: var(--text-dimmer);
  }

  .hp-crumb.current {
    color: var(--text-muted);
    font-weight: 500;
  }

  .hp-crumb-sep {
    font-size: 10px;
    color: var(--text-dimmer);
  }

  .hp-footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }

  .hp-footer-actions .hp-new-session {
    flex: 1;
    margin-top: 0;
  }

  .hp-open-detail {
    font-size: 11px;
    color: var(--text-dimmer);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .clickable {
    cursor: pointer;
    transition: color 0.12s;
  }

  .clickable:hover {
    color: var(--accent) !important;
  }

  /* --- Collapsed Rail --- */
  .sidebar-rail {
    width: 48px;
    flex-shrink: 0;
    background: var(--code-bg);
    border-right: 1px solid rgba(var(--overlay-rgb), 0.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 2px;
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .sidebar-rail::-webkit-scrollbar { display: none; }

  @media (max-width: 1023px) {
    .sidebar-rail { display: none; }
  }

  .rail-toggle {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 6px;
    margin-bottom: 6px;
    transition: all 0.15s;
  }

  .rail-toggle:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .rail-area {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    position: relative;
    transition: background 0.12s;
  }

  .rail-area:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .rail-area.has-processing {
    background: rgba(var(--accent-rgb), 0.08);
  }

  .rail-initial {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    line-height: 1;
  }

  .rail-area:hover .rail-initial {
    color: var(--text);
  }

  .rail-active-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 4px var(--accent-40);
  }

  .rail-new {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 8px;
    margin-top: auto;
    transition: all 0.15s;
  }

  .rail-new:hover {
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
  }
</style>
