<script>
  import { tabs, activeTabId, switchTab, closeTab, demoteTabToPopup, moveTab, forkTab } from '../../stores/tabs.svelte.js';
  import { tabOrder } from '../../stores/tabs.svelte.js';
  import { openFiles, activeFilePath, closeFileTab, switchTab as switchFileTab } from '../../stores/files.svelte.js';
  import { panes, paneLayout, findPaneForTab, switchPaneTab, addTabToPane, moveTabToPane, activePaneId, splitPane, closePane } from '../../stores/panes.svelte.js';
  const FILE_PREFIX = '__file__:';
  const AREA_PREFIX = '__area__:';
  const PROJECT_PREFIX = '__project__:';

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
    return {
      id,
      title: tab.title || 'Session',
      processing: tab.processing,
      hasUnread: tab.hasUnread,
      isHome: false,
      type: 'session',
    };
  }

  // Per-pane tab lists (hide __home__ from the bar — it's only an internal fallback)
  let paneTabs = $derived.by(() => {
    return paneList.map(pane => ({
      paneId: pane.id,
      activeTabId: pane.activeTabId,
      tabs: pane.tabIds.filter(id => id !== '__home__').map(makeTabInfo).filter(Boolean),
    }));
  });

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
      if (id.startsWith(AREA_PREFIX) || id.startsWith(PROJECT_PREFIX)) { onTabClosed(id); return; }
      if (id.startsWith(FILE_PREFIX)) { closeFileTab(id.slice(FILE_PREFIX.length)); return; }
      closeTab(id);
    }
  }

  import { onTabClosed } from '../../stores/panes.svelte.js';

  function handleCloseClick(e, id) {
    e.stopPropagation();
    if (id.startsWith(AREA_PREFIX) || id.startsWith(PROJECT_PREFIX)) {
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
    if (!dragTabId || dragTabId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropTargetId = id;
  }

  function handleDragLeave(e, id) {
    if (dropTargetId === id) dropTargetId = null;
  }

  function handleDrop(e, id, targetPaneId) {
    e.preventDefault();
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

  function ctxFork() {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    forkTab(ctxMenu.tabId);
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

<div class="tab-bar">
  <!-- Pane sections -->
  {#each paneTabs as section, idx (section.paneId)}
    {#if idx > 0 && isSplit}
      <div class="pane-divider"></div>
    {/if}
    <div
      class="tab-section"
      class:active-pane={activePaneId.value === section.paneId}
      style={isSplit ? `flex: ${layout.ratios[idx] || 1}` : 'flex: 1'}
    >
      <div class="tab-list">
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
          >
            {#if tab.isHome}
              <svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            {:else if tab.type === 'area'}
              <svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="tab-title">{tab.title}</span>
              <button class="tab-close" onclick={(e) => handleCloseClick(e, tab.id)} title="Close tab">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            {:else if tab.type === 'project'}
              <svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              {#if tab.processing}
                <span class="tab-spinner"></span>
              {/if}
              <span class="tab-title">{tab.title}</span>
              <button class="tab-popout" onclick={(e) => handlePopOut(e, tab.id)} title="Pop out to window">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="10" y2="14"/>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
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
    {/if}
    <button onclick={ctxSplitRight}>Split Right</button>
    <button onclick={ctxSplitDown}>Split Down</button>
    <div class="tab-ctx-sep"></div>
    <button onclick={ctxCloseTab}>Close</button>
    <button onclick={ctxCloseOthers}>Close Others</button>
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    background: var(--bg-deeper);
    border-bottom: 1px solid rgba(var(--overlay-rgb), 0.06);
    flex-shrink: 0;
    min-width: 0;
    height: 36px;
  }

  /* Pane sections */
  .tab-section {
    display: flex;
    min-width: 0;
    height: 100%;
    overflow: hidden;
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
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: none;
    height: 100%;
  }

  .tab-list::-webkit-scrollbar { display: none; }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
    color: var(--text-dimmer);
    cursor: pointer;
    white-space: nowrap;
    border-right: 1px solid rgba(var(--overlay-rgb), 0.04);
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
    user-select: none;
    height: 100%;
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
  }

  .tab.drop-target {
    border-left: 2px solid var(--accent);
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
  }

  .tab-title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-popout,
  .tab-close {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dimmer);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    opacity: 0;
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
    font-size: 12px;
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
</style>
