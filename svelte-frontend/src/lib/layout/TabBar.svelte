<script>
  import { tabs, activeTabId, switchTab, closeTab, demoteTabToPopup, moveTab, forkTab, promotePopupToTab } from '../../stores/tabs.svelte.js';
  import { tabOrder } from '../../stores/tabs.svelte.js';
  import { sessions as sessionStates } from '../../stores/session-state.svelte.js';
  import { archiveSession, unarchiveSession, sessionList, setSessionStatus } from '../../stores/sessions.svelte.js';
  import { isPopupOpen } from '../../stores/popups.svelte.js';
  import { openFiles, activeFilePath, closeFileTab, switchTab as switchFileTab } from '../../stores/files.svelte.js';
  import { panes, paneLayout, findPaneForTab, switchPaneTab, addTabToPane, moveTabToPane, activePaneId, splitPane, closePane } from '../../stores/panes.svelte.js';
  import { agents } from '../../stores/agents.svelte.js';
  import { isMobile } from '../../stores/ui.svelte.js';
  const FILE_PREFIX = '__file__:';
  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';
  const AGENT_PREFIX = '__agent__:';
  const OPERATION_PREFIX = '__operation__:';

  let { paneId = null } = $props();

  let paneList = $derived(panes);
  let layout = $derived(paneLayout);
  let isSplit = $derived(paneList.length > 1);

  // Build tab info lookup from stores
  function makeTabInfo(id) {
    if (id === '__home__') {
      return { id: '__home__', title: 'Home', isHome: true, type: 'home' };
    }
    if (id.startsWith(AREA_PREFIX)) {
      const name = id.slice(AREA_PREFIX.length);
      const formatted = name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id, title: formatted, isHome: false, type: 'area' };
    }
    if (id.startsWith(PROJECT_PREFIX)) {
      const path = id.slice(PROJECT_PREFIX.length);
      const name = path.split('/').pop() || path;
      const formatted = name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id, title: formatted, isHome: false, type: 'project' };
    }
    if (id.startsWith(OPERATION_PREFIX)) {
      const path = id.slice(OPERATION_PREFIX.length);
      const name = path.split('/').pop() || path;
      const formatted = name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id, title: formatted, isHome: false, type: 'operation' };
    }
    if (id === '__agent_new__') {
      return { id, title: 'New Agent', isHome: false, type: 'agent-new' };
    }
    if (id === '__git_diff__') {
      return { id, title: 'Diff', isHome: false, type: 'git-diff' };
    }
    if (id.startsWith(AGENT_PREFIX)) {
      const agentId = id.slice(AGENT_PREFIX.length);
      const agent = agents[agentId];
      return { id, title: agent?.name || 'Agent', isHome: false, type: 'agent' };
    }
    if (id.startsWith(FILE_PREFIX)) {
      const path = id.slice(FILE_PREFIX.length);
      return {
        id,
        title: path.split('/').pop() || path,
        isHome: false,
        type: 'file',
        filePath: path,
      };
    }
    const tab = tabs[id];
    if (!tab) return null;
    const ss = sessionStates[id];
    return {
      id,
      title: tab.title || 'Session',
      processing: tab.processing,
      loadingHistory: ss?.loadingHistory || false,
      hasUnread: tab.hasUnread,
      isHome: false,
      type: 'session',
    };
  }

  // Per-pane tab lists (hide __home__ from the bar — it's only an internal fallback)
  let allPaneTabs = $derived.by(() => {
    return paneList.map(pane => ({
      paneId: pane.id,
      activeTabId: pane.activeTabId,
      tabs: pane.tabIds.filter(id => id !== '__home__').map(makeTabInfo).filter(Boolean),
    }));
  });

  // When paneId prop is set, only show that pane's tabs
  let paneTabs = $derived(paneId ? allPaneTabs.filter(s => s.paneId === paneId) : allPaneTabs);

  // Drag state
  let dragTabId = $state(null);
  let dropTargetId = $state(null);

  function handleTabClick(id, paneId) {
    if (id.startsWith(FILE_PREFIX)) {
      const path = id.slice(FILE_PREFIX.length);
      switchFileTab(path);
      switchTab('__file__');
    } else {
      switchTab(id);
    }
    // Activate in the pane that owns it
    if (paneId) {
      switchPaneTab(paneId, id);
    } else {
      const found = findPaneForTab(id);
      if (found) switchPaneTab(found, id);
      else addTabToPane(id);
    }
    if (id !== '__home__' && !id.startsWith('__') && tabs[id]) {
      tabs[id].hasUnread = false;
    }
  }

  function handleMiddleClick(e, id) {
    if (e.button === 1 && id !== '__home__') {
      e.preventDefault();
      if (id.startsWith(AREA_PREFIX) || id.startsWith(PROJECT_PREFIX) || id.startsWith(OPERATION_PREFIX) || id.startsWith(AGENT_PREFIX) || id === '__agent_new__' || id === '__git_diff__') { onTabClosed(id); return; }
      if (id.startsWith(FILE_PREFIX)) { closeFileTab(id.slice(FILE_PREFIX.length)); return; }
      closeTab(id);
    }
  }

  import { onTabClosed } from '../../stores/panes.svelte.js';

  function handleCloseClick(e, id) {
    e.stopPropagation();
    if (id.startsWith(AREA_PREFIX) || id.startsWith(PROJECT_PREFIX) || id.startsWith(OPERATION_PREFIX) || id.startsWith(AGENT_PREFIX) || id === '__agent_new__' || id === '__git_diff__') {
      onTabClosed(id);
      return;
    }
    if (id.startsWith(FILE_PREFIX)) {
      closeFileTab(id.slice(FILE_PREFIX.length));
      return;
    }
    closeTab(id);
  }

  function handlePopOut(e, id) {
    e.stopPropagation();
    if (id.startsWith(FILE_PREFIX)) return; // files can't pop out
    demoteTabToPopup(id);
  }

  // Drag handlers
  function handleDragStart(e, id) {
    if (id === '__home__') { e.preventDefault(); return; }
    dragTabId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    if (e.target) e.target.style.opacity = '0.5';
  }

  function handleDragEnd(e) {
    if (e.target) e.target.style.opacity = '';
    dragTabId = null;
    dropTargetId = null;
  }

  function handleDragOver(e, id) {
    // Allow both internal tab drags and external popup drags
    if (dragTabId && dragTabId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropTargetId = id;
  }

  function handleDragLeave(e, id) {
    if (dropTargetId === id) dropTargetId = null;
  }

  function handleDrop(e, id, targetPaneId) {
    e.preventDefault();

    // Check if this is a popup being dragged to the tab bar
    if (!dragTabId) {
      const sessionId = e.dataTransfer.getData('text/plain');
      if (sessionId && isPopupOpen(sessionId)) {
        promotePopupToTab(sessionId);
        dropTargetId = null;
        return;
      }
    }

    if (!dragTabId || dragTabId === id) return;

    // If dropping into a different pane section, move the tab to that pane
    const sourcePaneId = findPaneForTab(dragTabId);
    if (targetPaneId && sourcePaneId && targetPaneId !== sourcePaneId) {
      moveTabToPane(dragTabId, targetPaneId);
    } else {
      // Same pane — reorder in global tab order
      const order = tabOrder;
      const targetIndex = order.indexOf(id);
      if (targetIndex >= 0) {
        moveTab(dragTabId, targetIndex);
      }
    }
    dragTabId = null;
    dropTargetId = null;
  }

  // --- Context menu ---
  let ctxMenu = $state(null); // { x, y, tabId, type }

  function handleContextMenu(e, tab) {
    if (tab.isHome) return;
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, tabId: tab.id, type: tab.type };
  }

  function closeCtxMenu() { ctxMenu = null; }

  function ctxCloseTab() {
    if (!ctxMenu) return;
    const id = ctxMenu.tabId;
    if (id.startsWith(FILE_PREFIX)) closeFileTab(id.slice(FILE_PREFIX.length));
    else closeTab(id);
    closeCtxMenu();
  }

  function ctxCloseOthers() {
    if (!ctxMenu) return;
    const keepId = ctxMenu.tabId;
    // Close all session tabs except this one
    for (const id of tabOrder) {
      if (id === '__home__' || id === keepId) continue;
      closeTab(id);
    }
    // Close all file tabs except this one
    for (const f of openFiles) {
      const fid = FILE_PREFIX + f.path;
      if (fid === keepId) continue;
      closeFileTab(f.path);
    }
    closeCtxMenu();
  }

  function ctxPopOut() {
    if (!ctxMenu || ctxMenu.type === 'file') return;
    demoteTabToPopup(ctxMenu.tabId);
    closeCtxMenu();
  }

  function ctxArchive() {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    const s = sessionList.find(s => s.id === ctxMenu.tabId);
    if (s?.archived) {
      unarchiveSession(ctxMenu.tabId);
    } else {
      archiveSession(ctxMenu.tabId);
    }
    closeCtxMenu();
  }

  function ctxFork() {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    forkTab(ctxMenu.tabId);
    closeCtxMenu();
  }

  function ctxSetStatus(status) {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    setSessionStatus(ctxMenu.tabId, status);
    closeCtxMenu();
  }

  function ctxSplitRight() {
    if (!ctxMenu) return;
    splitPane(ctxMenu.tabId, 'horizontal');
    closeCtxMenu();
  }

  function ctxSplitDown() {
    if (!ctxMenu) return;
    splitPane(ctxMenu.tabId, 'vertical');
    closeCtxMenu();
  }
</script>

<div class="tab-bar" class:split={isSplit} class:per-pane={!!paneId}>
  {#each paneTabs as section, idx (section.paneId)}
    {#if idx > 0 && isSplit && !paneId}
      <div class="pane-divider"></div>
    {/if}
    <div
      class="tab-section"
      class:active-pane={activePaneId.value === section.paneId}
      style={paneId ? 'flex: 1' : isSplit ? `flex: ${layout.ratios[idx] || 1}` : 'flex: 1'}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tab-list"
        ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        ondrop={(e) => {
          e.preventDefault();
          const sessionId = e.dataTransfer.getData('text/plain');
          if (sessionId && isPopupOpen(sessionId)) {
            promotePopupToTab(sessionId);
          }
        }}
      >
        {#each section.tabs as tab (tab.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="tab"
            class:active={section.activeTabId === tab.id}
            class:home={tab.isHome}
            class:unread={tab.hasUnread}
            class:drop-target={dropTargetId === tab.id}
            class:dragging={dragTabId === tab.id}
            draggable={!tab.isHome}
            onclick={() => handleTabClick(tab.id, section.paneId)}
            oncontextmenu={(e) => handleContextMenu(e, tab)}
            onauxclick={(e) => handleMiddleClick(e, tab.id)}
            ondragstart={(e) => handleDragStart(e, tab.id)}
            ondragend={handleDragEnd}
            ondragover={(e) => handleDragOver(e, tab.id)}
            ondragleave={(e) => handleDragLeave(e, tab.id)}
            ondrop={(e) => handleDrop(e, tab.id, section.paneId)}
            title={tab.title}
            style:border-bottom-color={tab.type === 'session' ? (sessionList.find(s => s.id === tab.id)?.status === 'done' ? '#57ab5a' : sessionList.find(s => s.id === tab.id)?.status === 'waiting' ? '#d4a72c' : 'transparent') : 'transparent'}
            style:border-bottom-width={tab.type === 'session' && (sessionList.find(s => s.id === tab.id)?.status === 'done' || sessionList.find(s => s.id === tab.id)?.status === 'waiting') ? '2px' : '0'}
            style:border-bottom-style="solid"
          >
            {#if tab.isHome}
              <svg class="tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span class="tab-title">Home</span>
            {:else if tab.type === 'area'}
              <svg class="tab-icon area-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="tab-title">{tab.title}</span>
              <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)} title="Close tab">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            {:else if tab.type === 'project'}
              <svg class="tab-icon project-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span class="tab-title">{tab.title}</span>
              <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)} title="Close tab">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            {:else if tab.type === 'file'}
              <svg class="tab-icon file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span class="tab-title">{tab.title}</span>
              <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)} title="Close tab">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            {:else}
              {#if tab.processing || tab.loadingHistory}
                <span class="tab-spinner" class:loading={tab.loadingHistory && !tab.processing}></span>
              {/if}
              {#if !sessionList.find(s => s.id === tab.id)?.projectPath}
                <button class="tab-tag-btn" title="Tag this session" onclick={(e) => { e.stopPropagation(); handleContextMenu(e, tab); }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                </button>
              {/if}
              <span class="tab-title">{tab.title}</span>
              <button class="tab-popout" onclick={(e) => handlePopOut(e, tab.id)} title="Pop out to window">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2"/><rect x="10" y="10" width="12" height="12" rx="1" fill="var(--bg-raised)"/>
                </svg>
              </button>
              <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)} title="Close tab">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            {/if}
          </div>
        {/each}
      </div>
      {#if isSplit}
        <button class="pane-close-btn" onclick={() => closePane(section.paneId)} title="Close pane">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      {/if}
    </div>
  {/each}
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if ctxMenu}
  <div class="tab-ctx-backdrop" onclick={closeCtxMenu}></div>
  <div class="tab-ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px">
    {#if ctxMenu.type === 'session'}
      <button onclick={ctxPopOut}>Pop Out</button>
      <button onclick={ctxFork}>Fork Session</button>
      <div class="tab-ctx-sep"></div>
      <button class="tab-ctx-item" onclick={() => ctxSetStatus('open')}>Mark Open</button>
      <button class="tab-ctx-item" onclick={() => ctxSetStatus('done')}>Mark Done</button>
      <button class="tab-ctx-item" onclick={() => ctxSetStatus('waiting')}>Mark Waiting</button>
      <div class="tab-ctx-sep"></div>
      <button onclick={ctxArchive}>{sessionList.find(s => s.id === ctxMenu.tabId)?.archived ? 'Unarchive' : 'Archive'}</button>
    {/if}
    {#if !isMobile.value}
      <button onclick={ctxSplitRight}>Split Right</button>
      <button onclick={ctxSplitDown}>Split Down</button>
    {/if}
    <div class="tab-ctx-sep"></div>
    <button onclick={ctxCloseTab}>Close</button>
    <button onclick={ctxCloseOthers}>Close Others</button>
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-deeper);
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.06);
    flex-shrink: 0;
    min-width: 0;
    min-height: 40px;
  }

  /* When split, each tab-section sizes independently via subgrid-like behavior */
  /* When rendered as shared bar during split, hide — per-pane TabBars handle it */
  .tab-bar.split:not(.per-pane) {
    display: none;
  }

  /* Pane sections */
  .tab-section {
    display: flex;
    min-width: 0;
    min-height: 40px;
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
  }

  .pane-close-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 4px;
    padding: 0;
    flex-shrink: 0;
    margin: auto 4px auto 0;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }

  .tab-section:hover .pane-close-btn,
  .tab-section.active-pane .pane-close-btn {
    opacity: 0.5;
  }

  .pane-close-btn:hover {
    opacity: 1 !important;
    background: rgba(var(--overlay-rgb), 0.1);
    color: var(--text);
  }

  .pane-divider {
    width: 5px;
    background: transparent;
    flex-shrink: 0;
    align-self: stretch;
  }

  /* Tab list */
  .tab-list {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
    align-content: flex-start;
    background: var(--bg-deeper);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 13px;
    color: var(--text-dimmer);
    cursor: pointer;
    white-space: nowrap;
    border-right: 1px solid rgba(var(--overlay-rgb), 0.04);
    flex: 1 1 120px;
    min-width: 120px;
    max-width: 220px;
    transition: background 0.12s, color 0.12s;
    user-select: none;
    height: 40px;
    position: relative;
  }

  .tab:hover {
    background: rgba(var(--overlay-rgb), 0.04);
    color: var(--text-muted);
  }

  .tab.active {
    background: var(--bg-raised);
    color: var(--text);
  }

  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
  }

  .tab.unread:not(.active) {
    color: var(--accent);
  }

  .tab.dragging {
    opacity: 0.5;
    transform: scale(0.95);
    transition: background 0.12s, color 0.12s, opacity 0.15s, transform 0.15s;
  }

  .tab.drop-target {
    border-left: 2px solid var(--accent);
    transform: translateX(2px);
    transition: background 0.12s, color 0.12s, transform 0.15s ease-out, border-left 0.1s;
  }

  .tab.home {
    padding: 0 10px;
  }

  .tab-icon {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .tab.active .tab-icon {
    opacity: 1;
    color: var(--accent);
  }

  .file-icon {
    opacity: 0.6;
  }

  .tab.active .file-icon {
    opacity: 0.9;
    color: var(--hl-function);
  }

  .tab.active .area-icon { color: var(--hl-type); }
  .tab.active .project-icon { color: var(--hl-string); }

  .tab-area-prefix {
    font-size: 10px;
    color: var(--text-dimmer);
    flex-shrink: 0;
    cursor: pointer;
    transition: color 0.12s;
  }
  .tab-area-prefix:hover {
    color: var(--accent);
  }

  .tab-tag-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: var(--text-dimmer);
    opacity: 0;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.12s;
    padding: 0;
  }

  .tab:hover .tab-tag-btn { opacity: 0.5; }
  .tab-tag-btn:hover { opacity: 1 !important; color: var(--accent); background: rgba(var(--overlay-rgb), 0.06); }

  .tab-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-popout,
  .tab-close {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    opacity: 0.3;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .tab:hover .tab-popout,
  .tab.active .tab-popout,
  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 1;
  }

  .tab-popout:hover,
  .tab-close:hover {
    background: rgba(var(--overlay-rgb), 0.1);
    color: var(--text);
  }

  .tab-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--accent-25);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: tabSpin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .tab-spinner.loading {
    border-color: var(--border);
    border-top-color: var(--text-dimmer);
    animation-duration: 1s;
  }

  @keyframes tabSpin { to { transform: rotate(360deg); } }

  /* Context menu */
  .tab-ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .tab-ctx-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(var(--shadow-rgb), 0.25);
    padding: 4px;
    min-width: 150px;
  }

  .tab-ctx-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .tab-ctx-menu button:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .tab-ctx-sep {
    height: 1px;
    background: rgba(var(--overlay-rgb), 0.06);
    margin: 3px 4px;
  }

  /* --- Mobile compact tabs --- */
  @media (max-width: 767px) {
    .tab-bar { min-height: 36px; }
    .tab { padding: 0 8px; font-size: 12px; }
    .tab-title { max-width: clamp(60px, 25vw, 120px); }
    .tab-close { display: none; }
    .tab.active .tab-close { display: flex; width: 24px; height: 24px; opacity: 0.7; }
    .tab-popout { display: none; }
    .tab-tag-btn { display: none; }
    .tab-area-prefix { display: none; }
    .pane-close-btn { display: none; }
    .pane-divider { display: none; }
    .tab { height: 36px; }
  }
</style>
