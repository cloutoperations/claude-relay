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
  import { send, getBasePath } from '../../stores/ws.svelte.js';
  import { configState } from '../../stores/chat.svelte.js';

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
    const sl = sessionList.find(s => s.id === id);
    return {
      id,
      title: tab.title || 'Session',
      processing: tab.processing,
      loadingHistory: ss?.loadingHistory || false,
      hasUnread: tab.hasUnread,
      isHome: false,
      type: 'session',
      boardCardId: sl?.boardCardId || null,
    };
  }

  // Per-pane tab lists (hide __home__ from the bar — it's only an internal fallback)
  // Card links derived from sessionList (reactive)
  let cardLinks = $derived(
    sessionList.reduce((map, s) => { if (s.boardCardId) map[s.id] = s.boardCardId; return map; }, {})
  );

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

  // --- Board card link lookup (reactive to sessionList) ---
  function getLinkedCardId(tabId) {
    return sessionList.find(s => s.id === tabId)?.boardCardId || null;
  }

  // --- Board card cache ---
  let cardCache = $state({}); // cardId → { title, status, fetchedAt }
  let cardLinkPicker = $state(null); // { tabId, x, y, cards, loading }

  // Non-reactive fetch tracker — plain Set avoids mutating $state during render
  const _fetchingCards = new Set();

  function getCardInfo(cardId) {
    if (!cardId) return null;
    if (cardCache[cardId]) return cardCache[cardId];
    if (!_fetchingCards.has(cardId)) {
      _fetchingCards.add(cardId);
      fetch(`${getBasePath()}api/board-cards/${cardId}`)
        .then(r => r.ok ? r.json() : null)
        .then(card => {
          _fetchingCards.delete(cardId);
          if (card) cardCache = { ...cardCache, [cardId]: { title: card.title, status: card.status, id: card.id } };
        })
        .catch(() => { _fetchingCards.delete(cardId); });
    }
    return { title: `#${cardId}`, status: 'unknown' };
  }

  const cardStatusColors = { todo: '#6b7280', in_progress: '#3b82f6', blocked: '#ef4444', done: '#22c55e' };

  function ctxUnlinkCard() {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    send({ type: 'update_session_meta', id: ctxMenu.tabId, boardCardId: null });
    // Also unlink on board side via relay proxy
    const sl = sessionList.find(s => s.id === ctxMenu.tabId);
    if (sl?.boardCardId) {
      fetch(`${getBasePath()}api/board-cards/${sl.boardCardId}/link`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: ctxMenu.tabId }),
      }).catch(() => {});
    }
    closeCtxMenu();
  }

  async function ctxLinkCard() {
    if (!ctxMenu || ctxMenu.type !== 'session') return;
    const tabId = ctxMenu.tabId;
    const x = ctxMenu.x;
    const y = ctxMenu.y;
    closeCtxMenu();

    // Fetch cards via relay proxy (same-origin)
    cardLinkPicker = { tabId, x, y, cards: [], loading: true, query: '' };
    try {
      const res = await fetch(`${getBasePath()}api/board-cards`);
      if (res.ok) {
        const cards = await res.json();
        cardLinkPicker.cards = (Array.isArray(cards) ? cards : []).filter(c => c.status !== 'archived').sort((a, b) => (b.updated_at || '') > (a.updated_at || '') ? 1 : -1);
      }
    } catch {}
    cardLinkPicker.loading = false;
    cardLinkPicker = { ...cardLinkPicker }; // trigger reactivity
  }

  function pickCard(cardId) {
    if (!cardLinkPicker) return;
    const sessionId = cardLinkPicker.tabId;
    // Update relay session meta
    send({ type: 'update_session_meta', id: sessionId, boardCardId: cardId });
    // Link on board side via relay proxy
    fetch(`${getBasePath()}api/board-cards/${cardId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
    cardLinkPicker = null;
  }

  let filteredPickerCards = $derived(
    cardLinkPicker?.cards?.filter(c => !cardLinkPicker.query || c.title.toLowerCase().includes(cardLinkPicker.query.toLowerCase())) || []
  );

  // --- Hover tooltip ---
  let hoverTab = $state(null); // { id, type, boardCardId, rect }
  let hoverTimeout = null;

  function handleTabMouseEnter(e, tab) {
    if (tab.type !== 'session') return;
    clearTimeout(hoverTimeout);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimeout = setTimeout(() => {
      hoverTab = { id: tab.id, type: tab.type, boardCardId: tab.boardCardId, rect };
    }, 350);
  }

  function handleTabMouseLeave() {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => { hoverTab = null; }, 150);
  }

  function handleTooltipEnter() {
    clearTimeout(hoverTimeout);
  }

  function handleTooltipLeave() {
    hoverTab = null;
  }

  function tooltipLinkCard() {
    if (!hoverTab) return;
    const tabId = hoverTab.id;
    const rect = hoverTab.rect;
    hoverTab = null;
    // Reuse the card picker via relay proxy
    cardLinkPicker = { tabId, x: rect.left, y: rect.bottom + 4, cards: [], loading: true, query: '' };
    fetch(`${getBasePath()}api/board-cards`)
      .then(r => r.ok ? r.json() : null)
      .then(cards => {
        if (cards) cardLinkPicker.cards = (Array.isArray(cards) ? cards : []).filter(c => c.status !== 'archived').sort((a, b) => (b.updated_at || '') > (a.updated_at || '') ? 1 : -1);
        cardLinkPicker.loading = false;
        cardLinkPicker = { ...cardLinkPicker };
      })
      .catch(() => { cardLinkPicker = null; });
  }

  function tooltipUnlinkCard() {
    if (!hoverTab) return;
    const tabId = hoverTab.id;
    const sl = sessionList.find(s => s.id === tabId);
    send({ type: 'update_session_meta', id: tabId, boardCardId: null });
    if (sl?.boardCardId) {
      fetch(`${getBasePath()}api/board-cards/${sl.boardCardId}/link`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: tabId }),
      }).catch(() => {});
    }
    hoverTab = null;
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
            onmouseenter={(e) => handleTabMouseEnter(e, tab)}
            onmouseleave={handleTabMouseLeave}
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
              {#key cardLinks[tab.id]}
                {#if cardLinks[tab.id]}
                  {@const cardId = cardLinks[tab.id]}
                  {@const ci = getCardInfo(cardId)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <a class="card-badge" href={`http://localhost:3100/?card=${cardId}`} target="_blank" style:background={cardStatusColors[ci?.status] || '#6b7280'} title={ci?.title || `Card #${cardId}`} onclick={(e) => e.stopPropagation()}>
                    {ci?.title ? ci.title.substring(0, 18) : `#${cardId}`}
                  </a>
                {/if}
              {/key}
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
      <div class="tab-ctx-sep"></div>
      {#if sessionList.find(s => s.id === ctxMenu.tabId)?.boardCardId}
        <button onclick={ctxUnlinkCard}>Unlink Card</button>
      {:else}
        <button onclick={ctxLinkCard}>Link to Card</button>
      {/if}
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

<!-- Card link picker -->
{#if cardLinkPicker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="tab-ctx-backdrop" onclick={() => { cardLinkPicker = null; }}></div>
  <div class="card-picker" style="left: {cardLinkPicker.x}px; top: {cardLinkPicker.y}px">
    <input
      class="card-picker-search"
      placeholder="Search cards..."
      oninput={(e) => { cardLinkPicker.query = e.target.value; cardLinkPicker = { ...cardLinkPicker }; }}
      autofocus
    />
    {#if cardLinkPicker.loading}
      <div class="card-picker-empty">Loading cards...</div>
    {:else if filteredPickerCards.length === 0}
      <div class="card-picker-empty">No cards found</div>
    {:else}
      <div class="card-picker-list">
        {#each filteredPickerCards.slice(0, 20) as card (card.id)}
          <button class="card-picker-item" onclick={() => pickCard(card.id)}>
            <span class="card-picker-dot" style:background={cardStatusColors[card.status] || '#6b7280'}></span>
            <span class="card-picker-title">{card.title}</span>
            <span class="card-picker-id">#{card.id}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<!-- Card hover tooltip -->
{#if hoverTab}
  {@const ci = hoverTab.boardCardId ? getCardInfo(hoverTab.boardCardId) : null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="card-tooltip below"
    style="left: {hoverTab.rect.left + hoverTab.rect.width / 2}px; top: {hoverTab.rect.bottom + 6}px; transform: translateX(-50%)"
    onmouseenter={handleTooltipEnter}
    onmouseleave={handleTooltipLeave}
  >
    {#if ci}
      <div class="card-tooltip-linked">
        <span class="card-tooltip-dot" style:background={cardStatusColors[ci.status] || '#6b7280'}></span>
        <span class="card-tooltip-title">{ci.title || `Card #${hoverTab.boardCardId}`}</span>
        <span class="card-tooltip-id">#{hoverTab.boardCardId}</span>
        <button class="card-tooltip-unlink" onclick={tooltipUnlinkCard} title="Unlink card">&times;</button>
      </div>
    {:else}
      <button class="card-tooltip-link-btn" onclick={tooltipLinkCard}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        Link to Card
      </button>
    {/if}
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

  /* --- Card badge --- */
  .card-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
    flex-shrink: 0;
    line-height: 14px;
    font-weight: 500;
    opacity: 0.85;
    text-decoration: none;
    cursor: pointer;
  }
  .card-badge:hover { opacity: 1; filter: brightness(1.2); }

  .tab.active .card-badge { opacity: 1; }

  /* --- Card picker --- */
  .card-picker {
    position: fixed;
    z-index: 1000;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.1);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(var(--shadow-rgb), 0.25);
    padding: 4px;
    width: 280px;
    max-height: 320px;
    display: flex;
    flex-direction: column;
  }

  .card-picker-search {
    padding: 6px 10px;
    font-size: 13px;
    background: var(--bg-deeper);
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 5px;
    color: var(--text);
    margin: 4px;
    outline: none;
  }

  .card-picker-search:focus {
    border-color: var(--accent);
  }

  .card-picker-list {
    overflow-y: auto;
    max-height: 260px;
  }

  .card-picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    font-size: 13px;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .card-picker-item:hover {
    background: rgba(var(--overlay-rgb), 0.06);
    color: var(--text);
  }

  .card-picker-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* --- Card hover tooltip --- */
  .card-tooltip {
    position: fixed;
    z-index: 1001;
    background: var(--bg-raised);
    border: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(var(--shadow-rgb), 0.3);
    padding: 8px 12px;
    pointer-events: auto;
    min-width: 140px;
    max-width: 280px;
  }

  .card-tooltip::after {
    content: '';
    position: absolute;
    top: -5px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 8px;
    height: 8px;
    background: var(--bg-raised);
    border-left: 1px solid rgba(var(--overlay-rgb), 0.12);
    border-top: 1px solid rgba(var(--overlay-rgb), 0.12);
  }

  .card-tooltip-linked {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-tooltip-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .card-tooltip-title {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-tooltip-id {
    font-size: 11px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .card-tooltip-unlink {
    font-size: 11px;
    color: var(--text-dimmer);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 4px;
    flex-shrink: 0;
    transition: color 0.1s, background 0.1s;
  }

  .card-tooltip-unlink:hover {
    color: var(--text);
    background: rgba(var(--overlay-rgb), 0.08);
  }

  .card-tooltip-link-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dimmer);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    transition: color 0.1s;
    white-space: nowrap;
  }

  .card-tooltip-link-btn:hover {
    color: var(--accent);
  }

  .card-tooltip-link-btn svg {
    opacity: 0.6;
  }

  .card-tooltip-link-btn:hover svg {
    opacity: 1;
  }

  .card-picker-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-picker-id {
    font-size: 11px;
    color: var(--text-dimmer);
    flex-shrink: 0;
  }

  .card-picker-empty {
    padding: 12px;
    text-align: center;
    color: var(--text-dimmer);
    font-size: 13px;
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
