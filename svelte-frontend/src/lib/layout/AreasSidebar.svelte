<script>
  import { onMount } from 'svelte';
  import { boardData, boardLoading, fetchBoard, tagSession } from '../../stores/board.svelte.js';
  import { sidebarOpen, chatSearchQuery } from '../../stores/ui.svelte.js';
  import { wsState } from '../../stores/ws.svelte.js';
  import { createSession, sessionList as sessions, searchSessions, sessionSearchQuery, sessionSearchResults, startAutoTag, startAreaAnalysis, setSessionStatus, startSessionReview } from '../../stores/sessions.svelte.js';
  import { projectInfo, clientCount } from '../../stores/chat.svelte.js';
  import { themeMode, getCurrentVariant, setThemeMode } from '../../stores/theme.svelte.js';
  import { openTab, activeTabId, HOME_TAB } from '../../stores/tabs.svelte.js';
  import { addTabToPane, onTabClosed, findPaneForTab, switchPaneTab, activePaneId } from '../../stores/panes.svelte.js';


  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';
  const OPERATION_PREFIX = '__operation__:';
  import SessionBubble from '../board/SessionBubble.svelte';
  import SessionTagger from '../board/SessionTagger.svelte';
  import FileTree from '../files/FileTree.svelte';
  import { searchFiles, fileSearchResults, fileSearchQuery, openFile } from '../../stores/files.svelte.js';
  import { agents, agentOrder, getAgentList, getRunningCount } from '../../stores/agents.svelte.js';
  import { gitStatus, getTotalCount as getGitCount, refreshStatus as refreshGit, stageFile, unstageFile, discardFile, openDiff, pendingGitChat, buildGitSummary } from '../../stores/git.svelte.js';
  import { pushState, subscribeToPush } from '../../stores/push.svelte.js';

  const AGENT_PREFIX = '__agent__:';

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

  // Sidebar section expand state — persisted to localStorage
  const SIDEBAR_STATE_KEY = 'claude-relay-sidebar-sections';
  function loadSidebarSections() {
    try { return JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) || '{}'); } catch { return {}; }
  }
  function saveSidebarSections() {
    try {
      localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify({
        areas: areasExpanded, sessions: sessionsExpanded, agents: agentsExpanded, git: gitExpanded, files: filesExpanded, archived: archivedExpanded,
      }));
    } catch {}
  }
  const _ss = loadSidebarSections();

  // Areas section
  let areasExpanded = $state(_ss.areas ?? true);

  // Sessions section
  let sessionsExpanded = $state(_ss.sessions ?? true);
  let sessionQuery = $state('');
  let statusFilter = $state('all'); // 'all' | 'open' | 'done' | 'waiting'

  function handleSessionSearch(e) {
    sessionQuery = e.target.value;
    searchSessions(sessionQuery);
    chatSearchQuery.value = sessionQuery.trim();
  }

  // Filtered session list: search results or all sessions sorted by recent
  let activeSessions = $derived((sessions || []).filter(s => !s.archived));
  let archivedSessions = $derived((sessions || []).filter(s => s.archived));
  let archivedExpanded = $state(_ss.archived ?? false);

  // Cache the sorted list — only re-sort when activeSessions changes, not on every keystroke
  let sortedActiveSessions = $derived(
    [...activeSessions]
      .filter(s => statusFilter === 'all' || (s.status || 'open') === statusFilter)
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
  );

  let statusCounts = $derived.by(() => {
    const c = { open: 0, done: 0, waiting: 0 };
    for (const s of activeSessions) {
      const st = s.status || 'open';
      if (c[st] !== undefined) c[st]++;
    }
    return c;
  });

  let displayedSessions = $derived.by(() => {
    if (!sessionQuery.trim()) {
      return sortedActiveSessions;
    }
    const results = sessionSearchResults.value;
    if (!results) return []; // searching...
    const matchIds = new Set(results.map(r => r.id));
    const matchTypes = new Map(results.map(r => [r.id, r.matchType]));
    return sortedActiveSessions
      .filter(s => matchIds.has(s.id))
      .map(s => ({ ...s, matchType: matchTypes.get(s.id) }));
  });

  let sessionSearchPending = $derived(!!sessionQuery.trim() && !sessionSearchResults.value);

  // File search state
  let fileQuery = $state('');

  function handleFileSearch(e) {
    fileQuery = e.target.value;
    searchFiles(fileQuery);
  }

  // Git section collapsed state
  let gitExpanded = $state(_ss.git ?? true);
  let gitCount = $derived(getGitCount());
  let gitContextMenu = $state(null); // { x, y, path, section }

  // Auto-refresh git status every 30s when the section is open and tab is visible
  $effect(() => {
    if (!gitExpanded) return;
    const iv = setInterval(() => {
      if (!document.hidden) refreshGit();
    }, 30000);
    return () => clearInterval(iv);
  });

  function gitFileName(p) {
    const parts = p.split('/');
    return parts[parts.length - 1];
  }

  function gitFileDir(p) {
    const parts = p.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  }

  function handleGitContextMenu(e, filePath, section) {
    e.preventDefault();
    e.stopPropagation();
    gitContextMenu = { x: e.clientX, y: e.clientY, path: filePath, section };
  }

  function closeGitContextMenu() {
    gitContextMenu = null;
  }

  function handleGitStage(filePath) {
    stageFile(filePath);
    closeGitContextMenu();
  }

  function handleGitUnstage(filePath) {
    unstageFile(filePath);
    closeGitContextMenu();
  }

  function handleGitDiscard(filePath) {
    if (confirm('Discard changes to ' + gitFileName(filePath) + '?')) {
      discardFile(filePath);
    }
    closeGitContextMenu();
  }

  function startGitChat() {
    pendingGitChat.active = true;
    createSession();
  }

  // Agents section collapsed state
  let agentsExpanded = $state(_ss.agents ?? true);

  let agentList = $derived(getAgentList());
  let runningAgentCount = $derived(getRunningCount());

  function openAgentTab(agentId) {
    const tabId = AGENT_PREFIX + agentId;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }

  function agentTypeIcon(type) {
    if (type === 'ralph') return '\u27F3'; // ⟳
    if (type === 'cron') return '\u23F0';  // ⏰
    return '\u25CF'; // ●
  }

  function agentStatusLabel(status) {
    if (status === 'running') return 'running';
    if (status === 'passed') return 'passed';
    if (status === 'failed') return 'failed';
    if (status === 'scheduled') return 'scheduled';
    if (status === 'stopped') return 'stopped';
    return 'idle';
  }

  function formatAgentTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return Math.floor(diff / 1000) + 's';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return Math.floor(diff / 86400000) + 'd';
  }

  function openNewAgentTab() {
    const tabId = '__agent_new__';
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }

  // Files section collapsed state
  let filesExpanded = $state(_ss.files ?? true);

  // Listen for expand-files events from other components (e.g., NotionEditor Browse buttons)
  if (typeof window !== 'undefined') {
    window.addEventListener('relay-expand-files', () => { filesExpanded = true; saveSidebarSections(); });
  }

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

  let floatingPickerPos = $state(null); // { x, y } for collapsed-rail picker

  function handleNewSession(e) {
    if (hasMultipleAccounts) {
      if (!sidebarOpen.value) {
        // Sidebar collapsed — show floating picker next to the + button
        if (floatingPickerPos) {
          floatingPickerPos = null;
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        // Position to the right of the button, anchored to bottom so it opens upward
        floatingPickerPos = { x: rect.right + 8, bottom: window.innerHeight - rect.bottom };
        return;
      }
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
    }, 300);
  }

  function onPanelMouseEnter() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function onPanelMouseLeave() {
    hideTimer = setTimeout(() => {
      hoverPanelVisible = false;
      hoveredArea = null;
    }, 300);
  }

  // Hover panel position
  let panelTop = $derived.by(() => {
    if (!hoveredAreaEl || !hoverPanelVisible) return 0;
    const rect = hoveredAreaEl.getBoundingClientRect();
    const maxTop = window.innerHeight - 400; // rough panel height
    return Math.min(rect.top, Math.max(0, maxTop));
  });

  // Hover panel: detail item for bottom section
  let hoverDetailItem = $state(null); // { type: 'project'|'operation', data: ..., sessions: [] }

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
    }, 300);
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
    }, 300);
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

  // --- Operation hover panel state ---
  let hoveredOperation = $state(null);
  let hoveredOperationArea = $state(null);
  let operationPanelVisible = $state(false);
  let operationShowTimer = $state(null);
  let operationHideTimer = $state(null);
  let hoveredOperationEl = $state(null);

  function onOperationMouseEnter(e, op, area) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } // keep area panel open
    if (operationHideTimer) { clearTimeout(operationHideTimer); operationHideTimer = null; }
    hoveredOperation = op;
    hoveredOperationArea = area;
    hoveredOperationEl = e.currentTarget;
    if (operationShowTimer) clearTimeout(operationShowTimer);
    operationShowTimer = setTimeout(() => {
      operationPanelVisible = true;
    }, 200);
  }

  function onOperationMouseLeave() {
    if (operationShowTimer) { clearTimeout(operationShowTimer); operationShowTimer = null; }
    operationHideTimer = setTimeout(() => {
      operationPanelVisible = false;
      hoveredOperation = null;
      hoveredOperationArea = null;
    }, 300);
  }

  function onOperationPanelMouseEnter() {
    if (operationHideTimer) { clearTimeout(operationHideTimer); operationHideTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } // keep area panel open too
  }

  function onOperationPanelMouseLeave() {
    operationHideTimer = setTimeout(() => {
      operationPanelVisible = false;
      hoveredOperation = null;
      hoveredOperationArea = null;
    }, 300);
  }

  let operationPanelTop = $derived.by(() => {
    if (!hoveredOperationEl || !operationPanelVisible) return 0;
    const rect = hoveredOperationEl.getBoundingClientRect();
    const maxTop = window.innerHeight - 350;
    return Math.min(rect.top, Math.max(0, maxTop));
  });

  function getOperationRelatedSessions(op, area) {
    if (!op || !area) return [];
    const keywords = op.name.split(/[-_]/).filter(w => w.length > 2);
    const allSessions = getAreaSessions(area);
    return allSessions.filter(s => {
      const title = (s.title || '').toLowerCase();
      return keywords.some(k => title.includes(k.toLowerCase()));
    }).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).slice(0, 5);
  }

  // --- Session tooltip state ---
  let tooltipSession = $state(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let tooltipVisible = $state(false);
  let tooltipShowTimer = $state(null);

  function onSessionMouseEnter(e, session) {
    if (tooltipShowTimer) clearTimeout(tooltipShowTimer);
    tooltipSession = session;
    tooltipX = e.clientX + 12;
    tooltipY = e.clientY - 8;
    tooltipShowTimer = setTimeout(() => {
      tooltipVisible = true;
    }, 300);
  }

  function onSessionMouseMove(e) {
    tooltipX = e.clientX + 12;
    tooltipY = e.clientY - 8;
  }

  function onSessionMouseLeave() {
    if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
    tooltipVisible = false;
    tooltipSession = null;
  }

  function formatCost(cost) {
    if (!cost) return '$0';
    return '$' + cost.toFixed(2);
  }

  let operationRelatedSessions = $derived(
    hoveredOperation && hoveredOperationArea
      ? getOperationRelatedSessions(hoveredOperation, hoveredOperationArea)
      : []
  );

  // Active session area indicator (Task 9.12)
  let activeSessionArea = $derived.by(() => {
    const activeId = activeTabId.value;
    if (!activeId || activeId.startsWith('__')) return null;
    const session = sessions.find(s => s.id === activeId);
    return session?.projectPath?.split('/')[0] || null;
  });

  // Untagged sessions
  let untaggedSessions = $derived(sessions.filter(s => !s.projectPath));
  let sidebarTaggerId = $state(null); // session ID being tagged from sidebar
  let sidebarTaggerPos = $state({ x: 0, y: 0 }); // position for fixed dropdown

  // Session count badges by area (Task 9.13)
  let sessionCountByArea = $derived.by(() => {
    const counts = {};
    for (const s of sessions) {
      if (s.projectPath) {
        const area = s.projectPath.split('/')[0];
        counts[area] = (counts[area] || 0) + 1;
      }
    }
    return counts;
  });

  // Open operation detail tab (Task 9.9)
  function openOperationTab(opPath) {
    const tabId = OPERATION_PREFIX + opPath;
    const existing = findPaneForTab(tabId);
    if (existing) {
      switchPaneTab(existing, tabId);
      activePaneId.value = existing;
    } else {
      addTabToPane(tabId);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar" class:open={sidebarOpen.value}>
  <!-- Sidebar header with collapse button -->
  <div class="sidebar-header">
    <span class="sidebar-project-name clickable" onclick={() => { switchPaneTab(activePaneId.value, HOME_TAB); activeTabId.value = HOME_TAB; }}>{projectInfo.name || 'Claude Relay'}</span>
    <button class="collapse-btn" onclick={() => sidebarOpen.value = false} title="Collapse sidebar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <polyline points="14 9 11 12 14 15"/>
      </svg>
    </button>
  </div>

  <!-- Areas section (collapsible) -->
  <div class="collapse-section" class:expanded={areasExpanded}>
    <button class="collapse-header" onclick={() => { areasExpanded = !areasExpanded; saveSidebarSections(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={areasExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>AREAS</span>
    </button>
    {#if areasExpanded}
      <div class="collapse-body areas-section">
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
              <div class="area-header">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="area-name clickable" onclick={(e) => { e.stopPropagation(); openAreaTab(area.name); }}>{formatAreaName(area.name)}</span>
                <div class="area-meta" onclick={() => toggleAreaCollapse(area.name)} role="button" tabindex="0">
                  {#if processingCount > 0}
                    <span class="area-session-count">{processingCount}</span>
                  {/if}
                  {#if area.projects.length > 0}
                    <span class="meta-count">{area.projects.length}</span>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Agents section (collapsible) -->
  <div class="collapse-section" class:expanded={agentsExpanded}>
    <button class="collapse-header" onclick={() => { agentsExpanded = !agentsExpanded; saveSidebarSections(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={agentsExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>AGENTS</span>
      {#if agentOrder.length > 0}
        <span class="collapse-count">{agentOrder.length}</span>
      {/if}
      {#if runningAgentCount > 0}
        <span class="agent-running-badge">{runningAgentCount}</span>
      {/if}
    </button>
    {#if agentsExpanded}
      <div class="collapse-body">
        {#if agentList.length === 0}
          <div class="section-status">No agents yet</div>
        {:else}
          <div class="agents-list">
            {#each agentList as agent (agent.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="agent-item"
                class:running={agent.status === 'running'}
                class:passed={agent.status === 'passed'}
                class:failed={agent.status === 'failed'}
                onclick={() => openAgentTab(agent.id)}
              >
                <span class="agent-type-icon">{agentTypeIcon(agent.type)}</span>
                <span class="agent-name">{agent.name || agent.id}</span>
                <span class="agent-status-badge" class:running={agent.status === 'running'} class:passed={agent.status === 'passed'} class:failed={agent.status === 'failed'}>{agentStatusLabel(agent.status)}</span>
                {#if agent.lastActivity}
                  <span class="agent-time">{formatAgentTime(agent.lastActivity)}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <button class="agent-new-btn" onclick={openNewAgentTab}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Agent
        </button>
      </div>
    {/if}
  </div>

  <!-- Git section (collapsible) -->
  <div class="collapse-section" class:expanded={gitExpanded}>
    <button class="collapse-header" onclick={() => { gitExpanded = !gitExpanded; if (gitExpanded) refreshGit(); saveSidebarSections(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={gitExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>GIT</span>
      {#if gitCount > 0}
        <span class="collapse-count">{gitCount}</span>
      {/if}
      {#if gitStatus.loading}
        <span class="git-loading-dot"></span>
      {/if}
    </button>
    {#if gitExpanded}
      <div class="collapse-body">
        <div class="git-toolbar">
          {#if gitCount > 0}
            <button class="git-chat-btn" onclick={startGitChat} title="Open a chat session about these changes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Review
            </button>
          {/if}
          <button class="git-refresh-btn" onclick={() => refreshGit()} title="Refresh git status">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>

        {#if gitCount === 0 && !gitStatus.error}
          <div class="section-status">Working tree clean</div>
        {/if}

        {#if gitStatus.error}
          <div class="section-status git-error">{gitStatus.error}</div>
        {/if}

        <!-- Staged files -->
        {#if gitStatus.staged.length > 0}
          <div class="git-group">
            <div class="git-group-label">Staged ({gitStatus.staged.length})</div>
            {#each gitStatus.staged as file (file.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="git-file" onclick={() => openDiff(file.path, true)} oncontextmenu={(e) => handleGitContextMenu(e, file.path, 'staged')}>
                <span class="git-status-letter staged">{file.status}</span>
                <span class="git-file-name">{gitFileName(file.path)}</span>
                <span class="git-file-dir">{gitFileDir(file.path)}</span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Changed (unstaged) files -->
        {#if gitStatus.changed.length > 0}
          <div class="git-group">
            <div class="git-group-label">Changed ({gitStatus.changed.length})</div>
            {#each gitStatus.changed as file (file.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="git-file" onclick={() => openDiff(file.path, false)} oncontextmenu={(e) => handleGitContextMenu(e, file.path, 'changed')}>
                <span class="git-status-letter changed">{file.status}</span>
                <span class="git-file-name">{gitFileName(file.path)}</span>
                <span class="git-file-dir">{gitFileDir(file.path)}</span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Untracked files -->
        {#if gitStatus.untracked.length > 0}
          <div class="git-group">
            <div class="git-group-label">Untracked ({gitStatus.untracked.length})</div>
            {#each gitStatus.untracked as file (file.path)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="git-file" onclick={() => openDiff(file.path, false)} oncontextmenu={(e) => handleGitContextMenu(e, file.path, 'untracked')}>
                <span class="git-status-letter untracked">?</span>
                <span class="git-file-name">{gitFileName(file.path)}</span>
                <span class="git-file-dir">{gitFileDir(file.path)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if gitContextMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="git-context-backdrop" onclick={closeGitContextMenu}></div>
    <div class="git-context-menu" style="left: {gitContextMenu.x}px; top: {gitContextMenu.y}px">
      <button class="git-context-item" onclick={() => { openDiff(gitContextMenu.path, gitContextMenu.section === 'staged'); closeGitContextMenu(); }}>View Diff</button>
      <button class="git-context-item" onclick={() => { openFile(gitContextMenu.path); closeGitContextMenu(); }}>Open File</button>
      {#if gitContextMenu.section === 'changed' || gitContextMenu.section === 'untracked'}
        <button class="git-context-item" onclick={() => handleGitStage(gitContextMenu.path)}>Stage</button>
      {/if}
      {#if gitContextMenu.section === 'staged'}
        <button class="git-context-item" onclick={() => handleGitUnstage(gitContextMenu.path)}>Unstage</button>
      {/if}
      {#if gitContextMenu.section === 'changed'}
        <button class="git-context-item danger" onclick={() => handleGitDiscard(gitContextMenu.path)}>Discard Changes</button>
      {/if}
    </div>
  {/if}

  <!-- Sessions section (collapsible) -->
  <div class="collapse-section" class:expanded={sessionsExpanded}>
    <button class="collapse-header" onclick={() => { sessionsExpanded = !sessionsExpanded; saveSidebarSections(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={sessionsExpanded}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <span>SESSIONS</span>
      <span class="collapse-count">{activeSessions.length}</span>
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
        <div class="status-filters">
          <button class="status-chip" class:active={statusFilter === 'all'} onclick={() => statusFilter = 'all'}>All</button>
          <button class="status-chip" class:active={statusFilter === 'open'} onclick={() => statusFilter = 'open'}>Open {statusCounts.open}</button>
          <button class="status-chip" class:active={statusFilter === 'waiting'} onclick={() => statusFilter = 'waiting'}>Waiting {statusCounts.waiting}</button>
          <button class="status-chip" class:active={statusFilter === 'done'} onclick={() => statusFilter = 'done'}>Done {statusCounts.done}</button>
          <button class="review-sessions-btn" onclick={() => startSessionReview(boardData.value)} title="Review sessions with Claude">Review</button>
          {#if untaggedSessions.length > 0}
            <button class="status-chip autotag-chip" onclick={startAutoTag} title="Auto-tag untagged sessions">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              {untaggedSessions.length}
            </button>
          {/if}
        </div>
        {#if sessionSearchPending}
          <div class="section-status">Searching...</div>
        {:else if sessionQuery.trim() && displayedSessions.length === 0}
          <div class="section-status">No sessions found</div>
        {:else}
          <div class="sessions-list">
            {#each displayedSessions.slice(0, 100) as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="session-item"
                class:processing={session.isProcessing}
                onclick={(e) => {
                  if (e.shiftKey) {
                    openTab(session.id, session.title || 'Session');
                  } else {
                    openTab(session.id, session.title || 'Session');
                  }
                }}
                oncontextmenu={(e) => handleContextMenu(e, session.id)}
              >
                <span class="session-dot" class:processing={session.isProcessing} class:done={!session.isProcessing && session.status === 'done'} class:waiting={!session.isProcessing && session.status === 'waiting'}></span>
                <span class="session-title">{session.title || 'Untitled'}</span>
                {#if !session.projectPath}
                  <button class="session-tag-btn" title="Tag this session" onclick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); sidebarTaggerPos = { x: rect.right + 4, y: rect.top }; sidebarTaggerId = sidebarTaggerId === session.id ? null : session.id; if (!boardData.value) fetchBoard(); }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  </button>
                {/if}
                {#if session.matchType}
                  <span class="session-match-badge">{session.matchType === 'both' ? 'title + chat' : session.matchType === 'content' ? 'in chat' : 'title'}</span>
                {/if}
                {#if session.isProcessing}
                  <span class="session-processing-badge">active</span>
                {/if}
              </div>
              <!-- tag picker is rendered as fixed overlay below -->
            {/each}
            {#if displayedSessions.length > 100}
              <div class="section-status">{displayedSessions.length - 100} more...</div>
            {/if}
          </div>
        {/if}

        <!-- Archived sessions -->
        {#if archivedSessions.length > 0}
          <button class="archived-toggle" onclick={() => archivedExpanded = !archivedExpanded}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-chevron" class:open={archivedExpanded}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            Archived ({archivedSessions.length})
          </button>
          {#if archivedExpanded}
            <div class="sessions-list archived-list">
              {#each archivedSessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).slice(0, 50) as session (session.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="session-item archived"
                  onclick={() => openTab(session.id, session.title || 'Session')}
                  oncontextmenu={(e) => handleContextMenu(e, session.id)}
                >
                  <span class="session-dot archived"></span>
                  <span class="session-title">{session.title || 'Untitled'}</span>
                </div>
              {/each}
              {#if archivedSessions.length > 50}
                <div class="section-status">{archivedSessions.length - 50} more...</div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Files section (collapsible) -->
  <div class="collapse-section" class:expanded={filesExpanded}>
    <button class="collapse-header" onclick={() => { filesExpanded = !filesExpanded; saveSidebarSections(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="collapse-chevron" class:open={filesExpanded}>
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
      {#if pushState.supported}
        <button
          class="status-btn"
          class:push-active={pushState.subscribed}
          onclick={subscribeToPush}
          disabled={pushState.subscribed || pushState.loading}
          title={pushState.denied ? 'Notifications blocked in browser settings' : pushState.subscribed ? 'Push notifications enabled' : pushState.loading ? 'Enabling...' : 'Enable push notifications'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={pushState.subscribed ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {#if pushState.denied}
            <span class="push-denied-badge">!</span>
          {/if}
        </button>
      {/if}
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

<!-- Fixed sidebar tag picker -->
{#if sidebarTaggerId && boardData.value}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sidebar-tagger-backdrop" onclick={() => sidebarTaggerId = null}></div>
  <div class="sidebar-tagger-fixed" style="left: {sidebarTaggerPos.x}px; top: {Math.min(sidebarTaggerPos.y, (typeof window !== 'undefined' ? window.innerHeight - 300 : sidebarTaggerPos.y))}px">
    <div class="sidebar-tagger-header">Tag session</div>
    {#each boardData.value.areas as area}
      <button class="sidebar-tag-area" onclick={() => { tagSession(sidebarTaggerId, area.name); sidebarTaggerId = null; }}>
        {area.name}
      </button>
      {#each area.projects.slice(0, 5) as proj}
        <button class="sidebar-tag-proj" onclick={() => { tagSession(sidebarTaggerId, proj.path); sidebarTaggerId = null; }}>
          {proj.name}
        </button>
      {/each}
    {/each}
  </div>
{/if}

<!-- Hover panel — 3-column layout -->
{#if hoverPanelVisible && hoveredArea}
  {@const hpAllSessions = getAreaSessions(hoveredArea)}
  {@const hpSessionCount = hpAllSessions.length}
  {@const hpProcessingCount = hpAllSessions.filter(s => s.isProcessing).length}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hover-panel"
    style="top: {panelTop}px; left: {sidebarOpen.value ? 288 : 52}px"
    onmouseenter={onPanelMouseEnter}
    onmouseleave={() => { onPanelMouseLeave(); hoverDetailItem = null; }}
  >
    <!-- 3-column grid -->
    <div class="hp-columns">
      <!-- Left column: Overview -->
      <div class="hp-col">
        <div class="hp-col-header">Overview</div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="hp-area-name clickable" onclick={() => openAreaTab(hoveredArea.name)}>{formatAreaName(hoveredArea.name)}</div>
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
        <div class="hp-overview-stats">
          <span>{hpSessionCount} session{hpSessionCount !== 1 ? 's' : ''}</span>
          {#if hpProcessingCount > 0}
            <span class="hp-stat-active">{hpProcessingCount} processing</span>
          {/if}
        </div>
        <div class="hp-overview-actions">
          <button class="hp-overview-btn" onclick={() => { createSession(null, true, hoveredArea.name); hoverPanelVisible = false; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Session
          </button>
          <button class="hp-overview-btn analyse" onclick={() => { startAreaAnalysis(hoveredArea.name, boardData.value); hoverPanelVisible = false; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Analyse
          </button>
        </div>
      </div>

      <!-- Middle column: Projects -->
      <div class="hp-col">
        <div class="hp-col-header">Projects</div>
        {#each hoveredArea.projects as proj (proj.path)}
          {@const projSessions = [...proj.sessions, ...proj.subProjects.flatMap(s => s.sessions || [])]}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hp-col-row"
            class:active={hoverDetailItem?.type === 'project' && hoverDetailItem?.data?.path === proj.path}
            onclick={() => openProjectTab(proj.path)}
            onmouseenter={() => { hoverDetailItem = { type: 'project', data: proj, sessions: projSessions }; }}
          >
            <span class="hp-col-row-name">{proj.name}</span>
            {#if projSessions.length > 0}
              <span class="hp-col-row-badge">{projSessions.length}</span>
            {/if}
          </div>
        {/each}
        {#if hoveredArea.projects.length === 0}
          <div class="hp-col-empty">No projects</div>
        {/if}
      </div>

      <!-- Right column: Operations -->
      <div class="hp-col">
        <div class="hp-col-header">Operations</div>
        {#if hoveredArea.operations?.length > 0}
          {#each hoveredArea.operations as op (op.path)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="hp-col-row"
              class:active={hoverDetailItem?.type === 'operation' && hoverDetailItem?.data?.path === op.path}
              onclick={() => { addTabToPane(OPERATION_PREFIX + op.path); hoverPanelVisible = false; }}
              onmouseenter={() => { hoverDetailItem = { type: 'operation', data: op, sessions: getOperationRelatedSessions(op, hoveredArea) }; }}
            >
              <span class="hp-col-row-name">{op.name}</span>
            </div>
          {/each}
        {:else}
          <div class="hp-col-empty">No operations</div>
        {/if}
      </div>
    </div>

    <!-- Bottom detail section -->
    {#if hoverDetailItem}
      <div class="hp-detail">
        {#if hoverDetailItem.type === 'project'}
          <div class="hp-detail-title">{hoverDetailItem.data.name}</div>
          {#if hoverDetailItem.sessions.length > 0}
            {#each hoverDetailItem.sessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="hp-session"
                onclick={() => { openTab(session.id, session.title || 'Session'); hoverPanelVisible = false; }}
                oncontextmenu={(e) => handleContextMenu(e, session.id)}
              >
                <span class="hp-session-dot" class:processing={session.isProcessing}></span>
                <span class="hp-session-title">{session.title || 'Untitled'}</span>
                <span class="hp-session-time">{session.isProcessing ? 'working' : (session.lastActivity ? formatAgentTime(session.lastActivity) + ' ago' : '')}</span>
              </div>
            {/each}
          {:else}
            <div class="hp-col-empty">No sessions yet</div>
          {/if}
          <button class="hp-detail-action" onclick={() => { createSession(null, true, hoverDetailItem.data.path); hoverPanelVisible = false; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Session
          </button>
        {:else if hoverDetailItem.type === 'operation'}
          <div class="hp-detail-title">{'\u27F3'} {hoverDetailItem.data.name}</div>
          {#if hoverDetailItem.data.description}
            <div class="hp-detail-desc">{hoverDetailItem.data.description}</div>
          {/if}
          {#if hoverDetailItem.sessions.length > 0}
            <div class="hp-detail-sub">Related Sessions</div>
            {#each hoverDetailItem.sessions as session (session.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="hp-session"
                onclick={() => { openTab(session.id, session.title || 'Session'); hoverPanelVisible = false; }}
              >
                <span class="hp-session-dot" class:processing={session.isProcessing}></span>
                <span class="hp-session-title">{session.title || 'Untitled'}</span>
              </div>
            {/each}
          {/if}
          <button class="hp-detail-action" onclick={() => { createSession(null, true, hoveredArea.name); hoverPanelVisible = false; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Session
          </button>
          <button class="hp-detail-action analyse" onclick={() => { startAreaAnalysis(hoveredArea.name, boardData.value); hoverPanelVisible = false; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Analyse Area
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- Project hover panel -->
{#if projectPanelVisible && hoveredProject}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hover-panel"
    style="top: {projectPanelTop}px; left: {sidebarOpen.value ? 288 : 52}px"
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
                  onclick={() => {
                    openTab(session.id, session.title || 'Session');
                    projectPanelVisible = false;
                  }}
                  oncontextmenu={(e) => handleContextMenu(e, session.id)}
                  onmouseenter={(e) => onSessionMouseEnter(e, session)}
                  onmousemove={onSessionMouseMove}
                  onmouseleave={onSessionMouseLeave}
                >
                  <span class="hp-session-dot" class:processing={session.isProcessing}></span>
                  <span class="hp-session-title">{session.title || 'Untitled'}</span>
                  <span class="hp-session-time">{session.isProcessing ? 'working' : (session.lastActivity ? formatAgentTime(session.lastActivity) + ' ago' : '')}</span>
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
          onclick={() => {
            openTab(session.id, session.title || 'Session');
            projectPanelVisible = false;
          }}
          oncontextmenu={(e) => handleContextMenu(e, session.id)}
          onmouseenter={(e) => onSessionMouseEnter(e, session)}
          onmousemove={onSessionMouseMove}
          onmouseleave={onSessionMouseLeave}
        >
          <span class="hp-session-dot" class:processing={session.isProcessing}></span>
          <span class="hp-session-title">{session.title || 'Untitled'}</span>
          <span class="hp-session-time">{session.isProcessing ? 'working' : (session.lastActivity ? formatAgentTime(session.lastActivity) + ' ago' : '')}</span>
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

<!-- Operation hover panel removed — operations now shown in main hover panel -->

<!-- Session tooltip disabled — data was inaccurate and intrusive -->

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

<!-- Floating account picker (shown when sidebar is collapsed and + is clicked) -->
{#if floatingPickerPos}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="floating-picker-backdrop" onclick={() => floatingPickerPos = null}></div>
  <div class="floating-picker" style="left:{floatingPickerPos.x}px;bottom:{floatingPickerPos.bottom}px">
    <div class="account-picker-label">Select account</div>
    {#each accounts as account, i}
      <button class="account-option" onclick={() => { floatingPickerPos = null; handlePickAccount(account.id); }}>
        <span class="account-dot" style="background: {ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}"></span>
        <span class="account-email">{account.email || account.id}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .sidebar {
    width: 280px;
    flex-shrink: 0;
    background: var(--code-bg);
    border-right: 1px solid rgba(var(--overlay-rgb), 0.10);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px 0;
    flex-shrink: 0;
  }

  .sidebar-project-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 8px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .sidebar-project-name:hover {
    color: var(--text);
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

  @media (min-width: 1024px) and (max-width: 1440px) {
    .sidebar.open {
      width: 240px;
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
    margin-bottom: 4px;
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
    font-size: 13px;
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

  .meta-count {
    font-size: 12px;
    color: var(--text-dimmer);
    font-weight: 500;
  }

  .meta-count.active {
    color: var(--accent);
    font-weight: 600;
  }

  .meta-sep {
    color: var(--text-dimmer);
    font-size: 10px;
    margin: 0 2px;
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
    font-size: 12px;
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

  .project-count {
    font-size: 11px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  /* Collapsible sections (Sessions, Files) */
  .collapse-section {
    flex-shrink: 0;
    border-top: 1px solid rgba(var(--overlay-rgb), 0.10);
  }

  .collapse-section.expanded {
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .collapse-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    background: none;
    border: none;
    transition: color 0.12s;
    flex-shrink: 0;
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
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 4px 4px;
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
    padding: 2px 0;
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
    gap: 2px;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .session-item:hover {
    background: rgba(var(--overlay-rgb), 0.04);
  }

  .session-dot {
    width: 8px;
    height: 8px;
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

  .session-tag-btn {
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; padding: 2px;
    color: var(--text-dimmer); opacity: 0.4;
    cursor: pointer; flex-shrink: 0; border-radius: 3px;
    transition: all 0.12s;
  }
  .session-tag-btn:hover { opacity: 1; color: var(--accent); background: rgba(var(--overlay-rgb), 0.06); }

  .sidebar-tagger-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
  }

  .sidebar-tagger-fixed {
    position: fixed;
    z-index: 200;
    width: 200px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(var(--shadow-rgb), 0.5);
    padding: 4px 0;
    animation: hpSlideIn 0.15s ease-out;
  }

  .sidebar-tagger-header {
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .sidebar-tag-area, .sidebar-tag-proj {
    display: block; width: 100%; text-align: left;
    padding: 5px 12px; background: none; border: none;
    border-radius: 0; font-size: 12px; cursor: pointer;
    color: var(--text-muted); transition: background 0.1s;
    font-family: inherit;
  }
  .sidebar-tag-area { font-weight: 600; color: var(--text); padding-top: 8px; }
  .sidebar-tag-area:hover, .sidebar-tag-proj:hover { background: rgba(var(--overlay-rgb), 0.06); }
  .sidebar-tag-proj { padding-left: 24px; color: var(--text-dimmer); font-size: 11px; }

  /* Archived sessions */
  .archived-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text-dimmer);
    font-family: inherit;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.12s;
  }

  .archived-toggle:hover {
    color: var(--text-muted);
  }

  .archived-list {
    opacity: 0.6;
  }

  .session-item.archived {
    opacity: 0.7;
  }

  .session-dot.archived {
    background: var(--text-dimmer);
    opacity: 0.4;
  }

  /* Git section */
  .git-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 0 2px 4px;
  }

  .git-chat-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .git-chat-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
    border-color: rgba(var(--overlay-rgb), 0.2);
  }

  .git-refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }

  .git-refresh-btn:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

  .git-loading-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 4px;
    animation: pulse-badge 1s ease-in-out infinite;
  }

  .git-error {
    color: #e5534b !important;
  }

  .git-group {
    margin-bottom: 6px;
  }

  .git-group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--text-dimmer);
    padding: 2px 8px;
  }

  .git-file {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.1s;
  }

  .git-file:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .git-status-letter {
    flex-shrink: 0;
    width: 14px;
    font-size: 11px;
    font-weight: 700;
    font-family: monospace;
    text-align: center;
  }

  .git-status-letter.staged { color: #57ab5a; }
  .git-status-letter.changed { color: #d4a72c; }
  .git-status-letter.untracked { color: #768390; }

  .git-file-name {
    flex-shrink: 0;
    color: var(--text);
    white-space: nowrap;
  }

  .git-file-dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .git-context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
  }

  .git-context-menu {
    position: fixed;
    z-index: 201;
    background: var(--bg-raised, var(--bg));
    border: 1px solid rgba(var(--overlay-rgb), 0.15);
    border-radius: 6px;
    padding: 4px;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(var(--shadow-rgb), 0.15);
  }

  .git-context-item {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .git-context-item:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .git-context-item.danger {
    color: #e5534b;
  }

  .git-context-item.danger:hover {
    background: rgba(229, 83, 75, 0.1);
  }

  /* Agents section */
  .agent-running-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--bg);
    background: var(--accent);
    border-radius: 8px;
    padding: 0 5px;
    margin-left: 4px;
    line-height: 16px;
    animation: pulse-badge 2s ease-in-out infinite;
  }

  @keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .agent-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.1s;
  }

  .agent-item:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .agent-type-icon {
    flex-shrink: 0;
    font-size: 13px;
    width: 16px;
    text-align: center;
  }

  .agent-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .agent-status-badge {
    flex-shrink: 0;
    font-size: 9px;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .agent-status-badge.running {
    color: var(--accent);
  }

  .agent-status-badge.passed {
    color: #57ab5a;
  }

  .agent-status-badge.failed {
    color: #e5534b;
  }

  .agent-time {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-dimmer);
  }

  .agent-new-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    margin-top: 4px;
    border: 1px dashed rgba(var(--overlay-rgb), 0.15);
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .agent-new-btn:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
    border-color: rgba(var(--overlay-rgb), 0.25);
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
    border-top: 1px solid rgba(var(--overlay-rgb), 0.10);
    flex-shrink: 0;
  }

  .sidebar-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px;
    font-size: 11px;
    flex-wrap: wrap;
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

  .push-active {
    color: var(--accent);
  }

  .push-denied-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    font-size: 7px;
    font-weight: 700;
    line-height: 1;
    color: var(--warning);
  }

  .new-session-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .new-session-btn:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .new-session-btn.top {
    margin: 8px 12px;
    width: calc(100% - 24px);
  }

  .account-picker.top {
    margin: 0 12px 8px;
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

  /* Floating account picker — shown outside sidebar when collapsed rail + is clicked */
  .floating-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .floating-picker {
    position: fixed;
    z-index: 1000;
    padding: 4px 0;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(var(--shadow-rgb), 0.4);
    min-width: 200px;
    animation: fpSlideIn 0.12s ease-out;
  }
  @keyframes fpSlideIn {
    from { opacity: 0; transform: translateX(-4px); }
    to { opacity: 1; transform: translateX(0); }
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
    width: clamp(500px, 50vw, 700px);
    display: flex;
    flex-direction: column;
    background: var(--bg-alt);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(var(--shadow-rgb), 0.25);
    z-index: 200;
    animation: hpSlideIn 0.15s ease-out;
    overflow: hidden;
  }

  .hover-panel::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 16px;
    width: 12px;
    height: 12px;
    background: var(--bg-raised);
    border-left: 1px solid rgba(var(--overlay-rgb), 0.10);
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.10);
    transform: rotate(45deg);
    z-index: 1;
  }

  @keyframes hpSlideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  /* 3-column grid */
  .hp-columns {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1px;
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-col {
    background: var(--bg-alt);
    padding: 12px;
    min-width: 0;
  }

  .hp-col-header {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .hp-col-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-col-row:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .hp-col-row.active {
    background: rgba(var(--overlay-rgb), 0.10);
  }

  .hp-col-row-name {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .hp-col-row:hover .hp-col-row-name {
    color: var(--accent);
  }

  .hp-col-row-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    background: rgba(var(--overlay-rgb), 0.08);
    padding: 1px 5px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .hp-col-empty {
    font-size: 11px;
    color: var(--text-dimmer);
    font-style: italic;
    padding: 4px 6px;
  }

  .hp-overview-stats {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .hp-stat-active {
    color: var(--accent);
    font-weight: 500;
  }

  .hp-overview-actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }

  .hp-overview-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--accent-30);
    border-radius: 6px;
    background: var(--accent-8);
    color: var(--accent);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
    font-family: inherit;
  }

  .hp-overview-btn:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .hp-overview-btn.analyse {
    background: rgba(var(--overlay-rgb), 0.04);
    border-color: rgba(var(--overlay-rgb), 0.15);
    color: var(--text-muted);
  }

  .hp-overview-btn.analyse:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

  /* Bottom detail section */
  .hp-detail {
    border-top: 1px solid rgba(var(--overlay-rgb), 0.12);
    padding: 10px 14px;
    max-height: 50vh;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .hp-detail-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 6px;
  }

  .hp-detail-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hp-detail-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dimmer);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin: 6px 0 4px;
  }

  .hp-detail-action {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--accent-30);
    background: var(--accent-8);
    color: var(--accent);
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .hp-detail-action:hover {
    background: var(--accent-15);
    border-color: var(--accent-50);
  }

  .hp-detail-action.analyse {
    background: rgba(var(--overlay-rgb), 0.04);
    border-color: rgba(var(--overlay-rgb), 0.15);
    color: var(--text-muted);
  }
  .hp-detail-action.analyse:hover {
    background: rgba(var(--overlay-rgb), 0.08);
    color: var(--text);
  }

  .hp-area-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 6px;
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
    border-top: 1px solid rgba(var(--overlay-rgb), 0.10);
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

  .hp-session-time {
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

  /* Operation rows in area hover panel */
  .hp-operation {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-operation:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-op-icon {
    font-size: 12px;
    flex-shrink: 0;
    color: var(--text-dimmer);
  }

  .hp-op-name {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
    white-space: nowrap;
  }

  .hp-op-desc {
    font-size: 10px;
    color: var(--text-dimmer);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  /* Operation sub-hover panel */
  .operation-panel {
    width: 380px;
  }

  .operation-panel::before {
    display: none;
  }

  .hp-op-label {
    font-size: 10px;
    color: var(--text-dimmer);
    font-style: italic;
    margin-bottom: 4px;
  }

  .hp-op-description {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hp-doc-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .hp-doc-item:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  .hp-doc-name {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Badges */
  .hp-badges {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  .hp-badge {
    font-size: 10px;
    color: var(--text-dimmer);
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(var(--overlay-rgb), 0.06);
  }

  /* Session tooltip */
  .session-tooltip {
    position: fixed;
    z-index: 300;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.15);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 4px 12px rgba(var(--shadow-rgb), 0.2);
    pointer-events: none;
    max-width: 260px;
    animation: hpSlideIn 0.1s ease-out;
  }

  .st-stats {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .st-message {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-style: italic;
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
    border-right: 1px solid rgba(var(--overlay-rgb), 0.10);
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
    background: rgba(var(--overlay-rgb), 0.04);
    cursor: pointer;
    position: relative;
    transition: all 0.15s;
  }

  .rail-area:hover {
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .rail-area.has-processing {
    background: var(--accent-8);
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

  /* Task 9.12: Active session area indicator */
  .area-card.active-area {
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }

  /* Task 9.13: Session count badges */
  .area-session-count {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-12, rgba(var(--accent-rgb, 91, 159, 214), 0.12));
    padding: 1px 5px;
    border-radius: 8px;
    line-height: 1.4;
  }

  /* Task 9.9: Clickable operations in hover panel */
  .hp-operation.clickable {
    cursor: pointer;
  }

  .hp-operation.clickable:hover {
    background: rgba(var(--overlay-rgb), 0.06);
  }

  /* Untagged sessions */
  .untagged-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
  }

  .untagged-title {
    flex: 1;
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    min-width: 0;
  }

  .untagged-title:hover {
    color: var(--text);
  }

  .untagged-tag-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: none;
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 4px;
    color: var(--text-dimmer);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: all 0.12s;
  }

  .untagged-tag-btn:hover {
    color: var(--accent);
    border-color: var(--accent-20);
  }

  .untagged-picker {
    padding: 2px 12px 6px 20px;
  }

  .untagged-pick-area, .untagged-pick-proj {
    display: block;
    width: 100%;
    text-align: left;
    padding: 3px 8px;
    background: none;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    color: var(--text-muted);
    transition: background 0.1s;
  }

  .untagged-pick-area {
    font-weight: 600;
    color: var(--text);
  }

  .untagged-pick-area:hover, .untagged-pick-proj:hover {
    background: var(--accent-12);
  }

  .untagged-pick-proj {
    padding-left: 16px;
    color: var(--text-dimmer);
  }

  /* Status filter chips */
  .status-filters {
    display: flex;
    gap: 3px;
    padding: 4px 12px 6px;
    flex-wrap: wrap;
    align-items: center;
    flex-shrink: 0;
  }

  .status-chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.12s;
    white-space: nowrap;
  }

  .status-chip:hover { color: var(--text-secondary); border-color: rgba(var(--overlay-rgb), 0.2); }
  .status-chip.active { background: var(--accent-12); color: var(--accent); border-color: var(--accent-30); }
  .autotag-chip { display: inline-flex; align-items: center; gap: 3px; border-style: dashed; }
  .autotag-chip:hover { color: var(--accent); border-color: var(--accent-30); }

  .review-sessions-btn {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    background: none;
    color: var(--text-dimmer);
    cursor: pointer;
    font-family: inherit;
    margin-left: auto;
    transition: all 0.12s;
    white-space: nowrap;
  }
  .review-sessions-btn:hover { color: var(--accent); border-color: var(--accent-30); }

  /* Status dot colors */
  .session-dot.done { background: #57ab5a; }
  .session-dot.waiting { background: #d4a72c; }
</style>
